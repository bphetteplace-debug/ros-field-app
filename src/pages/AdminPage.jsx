import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import NavBar from '../components/NavBar'
import { fetchAllSubmissions, updateSubmissionStatus, deleteSubmission, fetchPartsCatalog, addPart, deletePart, updatePart, fetchSettings, saveSettings, getAuthToken, logAudit, fetchAuditLog, ensureShareToken, createAssignedSubmission, getCustomerContacts, saveCustomerContacts, parseContactsCsv } from '../lib/submissions'
import { canonicalTech } from '../lib/techs'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/toast'
import TechMap from '../components/TechMap'
import StartDispatchDialog from '../components/StartDispatchDialog'
import ShareDispatchDialog from '../components/ShareDispatchDialog'
import DispatchMapModal from '../components/DispatchMapModal'
import PmScheduleAdmin from '../components/PmScheduleAdmin'
import BillingAdmin from '../components/BillingAdmin'
import MonthlyExpensesAdmin from '../components/MonthlyExpensesAdmin'
import { fetchMonthlyExpenses } from '../lib/monthlyExpenses'
import { fetchOpenDispatches, setDispatchStatus, formatRelativeTime, formatEta } from '../lib/dispatch'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { PDF_SECTION_DEFS, DEFAULT_PDF_LAYOUT, normalizePdfLayout } from '../components/WorkOrderPDFTemplate'

function getTypeLabel(s) {
  if (s.template === 'pm_flare_combustor') return 'PM'
  if (s.template === 'service_call') return 'SC'
  if (s.template === 'expense_report') return 'EXP'
  if (s.template === 'daily_inspection') return 'INSP'
  if (s.template === 'jha') return 'JHA'
  const jt = s.data?.jobType || ''
  if (jt === 'PM') return 'PM'
  if (jt === 'Service Call') return 'SC'
  if (jt === 'Expense Report') return 'EXP'
  if (jt === 'Daily Inspection') return 'INSP'
  if (jt === 'JHA/JSA') return 'JHA'
  return s.template || '?'
}
function getTypeColor(s) {
  const lbl = getTypeLabel(s)
  if (lbl === 'PM') return '#e65c00'
  if (lbl === 'SC') return '#2563eb'
  if (lbl === 'EXP') return '#7c3aed'
  if (lbl === 'INSP') return '#0891b2'
  if (lbl === 'JHA') return '#059669'
  return '#888'
}

// Build a CSV from a list of submission rows and trigger a browser download.
// Uses CRLF line endings so Excel on Windows opens it cleanly. Numbers stay
// unformatted so the spreadsheet treats them as numbers, not strings.
function downloadSubmissionsCSV(rows) {
  const csvCell = v => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const header = ['WO#','Date','Type','Customer','Location','Customer PO/WO#','Truck','Tech(s)','Status','Labor Hours','Labor Rate','Labor Total','Parts Total','Mileage Miles','Mileage Total','Grand Total','Submitted At']
  const lines = [header.map(csvCell).join(',')]
  for (const s of rows) {
    const d = s.data || {}
    const techs = Array.isArray(d.techs) ? d.techs.join('; ') : (d.techs || '')
    const lbl = getTypeLabel(s)
    const total = lbl === 'EXP' ? d.expenseTotal : (lbl === 'INSP' || lbl === 'JHA' ? '' : d.grandTotal)
    lines.push([
      s.pm_number || '',
      s.date || '',
      lbl,
      s.customer_name || '',
      s.location_name || '',
      d.customerWorkOrder || '',
      s.truck_number || '',
      techs,
      s.status || 'submitted',
      d.laborHours || '',
      d.hourlyRate || '',
      d.laborTotal || '',
      d.partsTotal || '',
      d.miles || '',
      d.mileageTotal || '',
      total || '',
      s.created_at || ''
    ].map(csvCell).join(','))
  }
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ros-submissions-${new Date().toISOString().slice(0,10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── EXPENSE ANALYTICS ──────────────────────────────────────────────────────────
function getWeekRange() {
  const now = new Date()
  const day = now.getDay()
  const start = new Date(now); start.setDate(now.getDate() - day); start.setHours(0,0,0,0)
  const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999)
  return { start, end }
}
function getMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  return { start, end }
}
function getYearRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59)
  return { start, end }
}

function ExpenseAnalytics({ submissions }) {
  const [period, setPeriod] = useState('month')

  const expenseSubmissions = submissions.filter(s => getTypeLabel(s) === 'EXP')

  const getRangeForPeriod = (p) => {
    if (p === 'week') return getWeekRange()
    if (p === 'month') return getMonthRange()
    return getYearRange()
  }

  const filtered = expenseSubmissions.filter(s => {
    if (!s.date) return false
    const d = new Date(s.date)
    const { start, end } = getRangeForPeriod(period)
    return d >= start && d <= end
  })

  // Group by tech — non-billable WOs contribute hours but NOT revenue
  const byTech = {}
  for (const s of filtered) {
    const rawTech = (Array.isArray(s.data?.techs) && s.data.techs[0]) || s.location_name || s.profiles?.full_name || 'Unknown'
    const tech = canonicalTech(rawTech) || 'Unknown'
    if (!byTech[tech]) byTech[tech] = { total: 0, count: 0, woCount: 0, laborHours: 0, items: [] }
    const lbl2 = getTypeLabel(s)
    const isExpOrInsp = lbl2 === 'EXP' || lbl2 === 'INSP'
    const isNonBillable = s.data?.billable === false
    const rev = (isExpOrInsp || isNonBillable) ? 0 : parseFloat(s.data?.grandTotal || 0)
    byTech[tech].total += rev
    if (lbl2 === 'PM' || lbl2 === 'SC') byTech[tech].woCount += 1
    byTech[tech].laborHours += parseFloat(s.labor_hours || 0)
    byTech[tech].count += 1
    byTech[tech].items.push(s)
  }

  const allTechTotals = Object.entries(byTech).sort((a, b) => b[1].total - a[1].total)
  const grandTotal = allTechTotals.reduce((sum, [, v]) => sum + v.total, 0)

  const fmt = n => '$' + (n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  const periodLabels = { week: 'This Week', month: 'This Month', year: 'This Year' }

  return (
    <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ background: '#7c3aed', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>💜 Expense Tracking by Tech</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {['week', 'month', 'year'].map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
              background: period === p ? '#fff' : 'rgba(255,255,255,0.2)',
              color: period === p ? '#7c3aed' : '#fff'
            }}>{periodLabels[p]}</button>
          ))}
        </div>
      </div>
      {allTechTotals.length === 0 ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
          No expense reports for {periodLabels[period].toLowerCase()}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8f4ff' }}>
                <th style={{ textAlign: 'left', padding: '8px 16px', fontWeight: 700, color: '#555', fontSize: 11, textTransform: 'uppercase' }}>Technician</th>
                <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 700, color: '#555', fontSize: 11, textTransform: 'uppercase' }}>Reports</th>
                <th style={{ textAlign: 'right', padding: '8px 16px', fontWeight: 700, color: '#555', fontSize: 11, textTransform: 'uppercase' }}>Total</th>
                <th style={{ textAlign: 'right', padding: '8px 16px', fontWeight: 700, color: '#555', fontSize: 11, textTransform: 'uppercase' }}>% of Total</th>
              </tr>
            </thead>
            <tbody>
              {allTechTotals.map(([tech, data], i) => (
                <tr key={tech} style={{ borderTop: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fdf8ff' }}>
                  <td style={{ padding: '8px 16px', fontWeight: 600, color: '#1a2332' }}>{tech}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', color: '#666' }}>{data.count}</td>
                  <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 700, color: '#7c3aed' }}>{fmt(data.total)}</td>
                  <td style={{ padding: '8px 16px', textAlign: 'right', color: '#888' }}>
                    {grandTotal > 0 ? Math.round((data.total / grandTotal) * 100) + '%' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #7c3aed', background: '#f8f4ff' }}>
                <td style={{ padding: '8px 16px', fontWeight: 800, color: '#1a2332' }}>TOTAL ({periodLabels[period]})</td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#1a2332' }}>{allTechTotals.reduce((s, [,v]) => s + v.count, 0)}</td>
                <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 800, color: '#7c3aed', fontSize: 15 }}>{fmt(grandTotal)}</td>
                <td style={{ padding: '8px 16px', textAlign: 'right', color: '#888' }}>100%</td>
              </tr>
            </tfoot>
          </table>
          <div style={{ padding: '6px 16px 10px', fontSize: 11, color: '#aaa' }}>
            All {expenseSubmissions.length} expense reports total: {fmt(expenseSubmissions.reduce((s, e) => s + parseFloat(e.data?.expenseTotal || 0), 0))}
          </div>
        </div>
      )}
    </div>
  )
}
// ── LIVE PRESENCE ─────────────────────────────────────────────────────────
const SUPA_URL_P = import.meta.env.VITE_SUPABASE_URL
const SUPA_KEY_P = import.meta.env.VITE_SUPABASE_ANON_KEY

function LivePresence() {
  const [presence, setPresence] = useState([])
  const [lastRefresh, setLastRefresh] = useState(null)
  const [loading, setLoading] = useState(true)

  const STALE_MS = 2 * 60 * 1000 // 2 minutes

  async function fetchPresence() {
    try {
      const token = getAuthToken()
      const res = await fetch(SUPA_URL_P + '/rest/v1/user_presence?select=*&order=updated_at.desc', {
        headers: { 'apikey': SUPA_KEY_P, 'Authorization': 'Bearer ' + (token || SUPA_KEY_P) }
      })
      if (res.ok) {
        const data = await res.json()
        setPresence(data || [])
      } else {
        console.warn('presence fetch failed:', res.status)
      }
    } catch(e) { console.warn('presence fetch error:', e) }
    setLastRefresh(new Date())
    setLoading(false)
  }

  useEffect(() => {
    fetchPresence()
    const interval = setInterval(fetchPresence, 30000)
    return () => clearInterval(interval)
  }, [])

  const now = new Date()
  const active = presence.filter(p => (now - new Date(p.updated_at)) < STALE_MS)
  const idle = presence.filter(p => (now - new Date(p.updated_at)) >= STALE_MS)

  const formColors = { 'PM': '#e65c00', 'Service Call': '#2563eb', 'Expense Report': '#7c3aed', 'Daily Inspection': '#0891b2', 'JHA/JSA': '#059669' }
  const getColor = (ft) => formColors[ft] || '#6b7280'

  const timeAgo = (ts) => {
    const s = Math.floor((now - new Date(ts)) / 1000)
    if (s < 60) return s + 's ago'
    if (s < 3600) return Math.floor(s/60) + 'm ago'
    return Math.floor(s/3600) + 'h ago'
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ background: '#0f1f38', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: active.length > 0 ? '#22c55e' : '#6b7280', boxShadow: active.length > 0 ? '0 0 0 3px rgba(34,197,94,0.3)' : 'none', animation: active.length > 0 ? 'pulse 2s infinite' : 'none' }}></span>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>Live Activity</span>
          {active.length > 0 && <span style={{ background: '#22c55e', color: '#fff', fontWeight: 700, fontSize: 11, padding: '2px 8px', borderRadius: 10 }}>{active.length} active</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastRefresh && <span style={{ color: '#6b7280', fontSize: 12 }}>Updated {timeAgo(lastRefresh)}</span>}
          <button onClick={fetchPresence} style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Refresh</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>
      ) : active.length === 0 && idle.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#aaa' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>💤</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No active users</div>
          <div style={{ fontSize: 13 }}>Techs will appear here when they open a form</div>
        </div>
      ) : (
        <div style={{ padding: 16 }}>
          {active.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>● Currently Active</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {active.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#0f1f38', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                      {(p.user_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: '#1a2332', fontSize: 14 }}>{p.user_name || 'Unknown'}</div>
                      <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                        Working on <span style={{ fontWeight: 700, color: getColor(p.form_label), background: getColor(p.form_label) + '18', padding: '1px 6px', borderRadius: 4 }}>{p.form_label || p.form_type}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>ACTIVE</div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{timeAgo(p.updated_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {idle.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>◌ Recently Seen</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {idle.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 14px', opacity: 0.7 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#6b7280', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                      {(p.user_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: '#6b7280', fontSize: 13 }}>{p.user_name || 'Unknown'}</div>
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>Last seen in {p.form_label || p.form_type}</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{timeAgo(p.updated_at)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── PARTS CATALOG ADMIN ───────────────────────────────────────────────
// ─── BRANDING ADMIN ──────────────────────────────────────────────────────────
function BrandingAdmin() {
  const [branding, setBranding] = useState({
    company_name: 'Reliable Oilfield Services',
    tagline: 'Field Operations Management',
    primary_color: '#1a2332',
    accent_color: '#f97316',
    logo_url: '',
    email_footer: 'Thank you for choosing Reliable Oilfield Services.',
    pdf_header: '',
    pdf_footer: 'Reliable Oilfield Services | Confidential Work Order'
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchSettings().then(all => {
      const v = all && all.branding;
      if (v && typeof v === 'object') setBranding(b => ({ ...b, ...v }))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true); setSaved(false)
    try {
      await saveSettings('branding', branding)
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } finally { setSaving(false) }
  }

  const inp = { border: '1px solid #ddd', borderRadius: 6, padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box', background: '#fff' }
  const label = { fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 4, display: 'block' }
  const row = { marginBottom: 14 }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading branding settings...</div>

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#1a2332', marginBottom: 4 }}>🎨 Company Branding</div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 20 }}>Customize how your company appears across the app, emails, and PDFs.</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div style={row}>
          <span style={label}>Company Name</span>
          <input style={inp} value={branding.company_name} onChange={e => setBranding(b => ({ ...b, company_name: e.target.value }))} />
        </div>
        <div style={row}>
          <span style={label}>Tagline / Subtitle</span>
          <input style={inp} value={branding.tagline} onChange={e => setBranding(b => ({ ...b, tagline: e.target.value }))} />
        </div>
        <div style={row}>
          <span style={label}>Primary Color</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type='color' value={branding.primary_color} onChange={e => setBranding(b => ({ ...b, primary_color: e.target.value }))} style={{ width: 48, height: 36, border: 'none', cursor: 'pointer', borderRadius: 6 }} />
            <input style={{ ...inp, flex: 1 }} value={branding.primary_color} onChange={e => setBranding(b => ({ ...b, primary_color: e.target.value }))} />
          </div>
        </div>
        <div style={row}>
          <span style={label}>Accent Color</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type='color' value={branding.accent_color} onChange={e => setBranding(b => ({ ...b, accent_color: e.target.value }))} style={{ width: 48, height: 36, border: 'none', cursor: 'pointer', borderRadius: 6 }} />
            <input style={{ ...inp, flex: 1 }} value={branding.accent_color} onChange={e => setBranding(b => ({ ...b, accent_color: e.target.value }))} />
          </div>
        </div>
        <div style={{ ...row, gridColumn: '1 / -1' }}>
          <span style={label}>Company Logo (used in PDF header)</span>
          <div style={{display:'flex',alignItems:'center',gap:12,marginTop:4}}>
            {branding.logo_url && <img src={branding.logo_url} alt='logo preview' style={{maxHeight:80,maxWidth:200,borderRadius:6,border:'1px solid #eee',background:'#f9f9f9',padding:4}} />}
            <label style={{cursor:'pointer',background:'#1a2332',color:'#fff',padding:'8px 16px',borderRadius:6,fontSize:13,fontWeight:600}}>
              {branding.logo_url ? 'Change Logo' : 'Upload Logo'}
              <input type='file' accept='image/*' style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setBranding(b=>({...b,logo_url:ev.target.result}));r.readAsDataURL(f)}} />
            </label>
            {branding.logo_url && <button onClick={()=>setBranding(b=>({...b,logo_url:''}))} style={{background:'#ef4444',color:'#fff',border:'none',borderRadius:6,padding:'8px 12px',cursor:'pointer',fontSize:13}}>Remove</button>}
          </div>
        </div>
        <div style={{ ...row, gridColumn: '1 / -1' }}>
          <span style={label}>Email Footer / Signature Text</span>
          <textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={branding.email_footer} onChange={e => setBranding(b => ({ ...b, email_footer: e.target.value }))} />
        </div>
        <div style={row}>
          <span style={label}>PDF Header Text</span>
          <input style={inp} placeholder='Optional header line on PDFs' value={branding.pdf_header} onChange={e => setBranding(b => ({ ...b, pdf_header: e.target.value }))} />
        </div>
        <div style={row}>
          <span style={label}>PDF Footer Text</span>
          <input style={inp} placeholder='Footer line on PDFs' value={branding.pdf_footer} onChange={e => setBranding(b => ({ ...b, pdf_footer: e.target.value }))} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <button onClick={handleSave} disabled={saving} style={{ background: '#1a2332', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          {saving ? 'Saving...' : '💾 Save Branding'}
        </button>
        {saved && <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 13 }}>✓ Saved!</span>}
      </div>

      <div style={{ marginTop: 24, padding: 16, background: '#f8f9fa', borderRadius: 10, border: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 10 }}>PREVIEW</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 8, background: branding.primary_color }}>
          {branding.logo_url ? <img src={branding.logo_url} alt='logo' style={{ height: 36, borderRadius: 4 }} /> : <div style={{ width: 36, height: 36, borderRadius: '50%', background: branding.accent_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18, color: '#fff' }}>{(branding.company_name||'R')[0]}</div>}
          <div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>{branding.company_name || 'Company Name'}</div>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>{branding.tagline || 'Tagline'}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── SETTINGS ADMIN ──────────────────────────────────────────────────────────
function SettingsAdmin() {
  const [customers, setCustomers] = useState([])
  const [trucks, setTrucks] = useState([])
  const [techs, setTechs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [saved, setSaved] = useState(null)
  const [newCustomer, setNewCustomer] = useState('')
  const [newTruck, setNewTruck] = useState('')
  const [newTech, setNewTech] = useState('')

  useEffect(() => {
    fetchSettings().then(all => {
      const c = (all && Array.isArray(all.customers)) ? all.customers : [];
      const t = (all && Array.isArray(all.trucks)) ? all.trucks : [];
      const te = (all && Array.isArray(all.techs)) ? all.techs : [];
      setCustomers(c)
      setTrucks(t)
      setTechs(te)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const saveList = async (key, list, setter) => {
    setSaving(key); setSaved(null)
    try {
      await saveSettings(key, list)
      setter(list)
      setSaved(key); setTimeout(() => setSaved(null), 3000)
    } finally { setSaving(null) }
  }

  const addItem = (list, setter, value, clearFn, key) => {
    const v = value.trim()
    if (!v || list.includes(v)) return
    const next = [...list, v].sort()
    clearFn('')
    saveList(key, next, setter)
  }

  const removeItem = (list, setter, item, key) => {
    if (!window.confirm('Remove "' + item + '"?')) return
    const next = list.filter(x => x !== item)
    saveList(key, next, setter)
  }

  const inp = { border: '1px solid #ddd', borderRadius: 6, padding: '8px 12px', fontSize: 13, flex: 1 }
  const addBtn = { background: '#0891b2', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }
  const chip = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 20, padding: '4px 12px', fontSize: 13, fontWeight: 600 }
  const removeBtn = { background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontWeight: 900, fontSize: 15, lineHeight: 1, padding: 0 }

  const ListSection = ({ title, icon, list, setter, newVal, setNew, listKey }) => (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#1a2332', marginBottom: 12 }}>{icon} {title}</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input style={inp} placeholder={'Add ' + title.toLowerCase() + '...'} value={newVal} onChange={e => setNew(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addItem(list, setter, newVal, setNew, listKey) }} />
        <button style={addBtn} onClick={() => addItem(list, setter, newVal, setNew, listKey)}>+ Add</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {list.length === 0 && <div style={{ color: '#aaa', fontSize: 13 }}>No {title.toLowerCase()} added yet.</div>}
        {list.map(item => (
          <span key={item} style={chip}>
            {item}
            <button style={removeBtn} onClick={() => removeItem(list, setter, item, listKey)}>×</button>
          </span>
        ))}
      </div>
      {saving === listKey && <div style={{ marginTop: 8, color: '#0891b2', fontSize: 12, fontWeight: 700 }}>Saving...</div>}
      {saved === listKey && <div style={{ marginTop: 8, color: '#16a34a', fontSize: 12, fontWeight: 700 }}>✓ Saved!</div>}
    </div>
  )

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading settings...</div>

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#1a2332', marginBottom: 4 }}>⚙️ Settings Management</div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>Manage the dropdown lists used across the app.</div>
      <ListSection title='Customers' icon='🏢' list={customers} setter={setCustomers} newVal={newCustomer} setNew={setNewCustomer} listKey='customers' />
      <ListSection title='Trucks' icon='🚛' list={trucks} setter={setTrucks} newVal={newTruck} setNew={setNewTruck} listKey='trucks' />
      <ListSection title='Technicians' icon='👷' list={techs} setter={setTechs} newVal={newTech} setNew={setNewTech} listKey='techs' />
      <CustomerContactsSection customerList={customers} />
    </div>
  )
}

// Per-customer address book used by the dispatch dialog's searchable
// dropdown. Stored in app_settings.customer_contacts as
// [{customer, name, email}]. Bootstrapped with the Diamondback list
// when never saved before.
function CustomerContactsSection({ customerList }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [newCustomer, setNewCustomer] = useState('')
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [csvCustomer, setCsvCustomer] = useState('')
  const [csvText, setCsvText] = useState('')

  useEffect(() => {
    getCustomerContacts().then(list => {
      setContacts(list || [])
    }).finally(() => setLoading(false))
  }, [])

  const persist = async (next) => {
    setBusy(true)
    try {
      await saveCustomerContacts(next)
      setContacts(next)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2500)
    } catch (e) {
      toast.error('Save failed: ' + (e.message || String(e)))
    } finally {
      setBusy(false)
    }
  }

  const handleAdd = () => {
    const email = newEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) { toast.warning('Email is required'); return }
    if (contacts.some(c => c.email.toLowerCase() === email)) {
      toast.warning('That email is already in the list'); return
    }
    const row = { customer: newCustomer.trim(), name: newName.trim(), email }
    persist([...contacts, row])
    setNewCustomer(''); setNewName(''); setNewEmail('')
  }

  const handleRemove = (email) => {
    if (!window.confirm('Remove ' + email + '?')) return
    persist(contacts.filter(c => c.email !== email))
  }

  const handleImport = () => {
    if (!csvText.trim()) { toast.warning('Paste some CSV first'); return }
    const parsed = parseContactsCsv(csvText, csvCustomer)
    if (!parsed.length) { toast.warning('No valid rows found (need an email per line)'); return }
    const byEmail = new Map(contacts.map(c => [c.email.toLowerCase(), c]))
    let added = 0; let updated = 0
    for (const p of parsed) {
      if (byEmail.has(p.email)) {
        byEmail.set(p.email, { ...byEmail.get(p.email), ...p })
        updated++
      } else {
        byEmail.set(p.email, p)
        added++
      }
    }
    persist([...byEmail.values()])
    setCsvText('')
    toast.success('Imported — ' + added + ' added, ' + updated + ' updated')
  }

  const customersInList = Array.from(new Set(contacts.map(c => c.customer).filter(Boolean))).sort()
  const customerOptions = Array.from(new Set([...(customerList || []), ...customersInList])).sort()

  const visible = contacts.filter(c => {
    if (filter !== 'all' && (c.customer || '') !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!c.name.toLowerCase().includes(q) && !c.email.toLowerCase().includes(q)) return false
    }
    return true
  })

  const inp = { border: '1px solid #ddd', borderRadius: 6, padding: '8px 12px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' }
  const addBtn = { background: '#0891b2', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }
  const delBtn = { background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontWeight: 900, fontSize: 16, lineHeight: 1, padding: '0 6px' }

  if (loading) return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#1a2332', marginBottom: 12 }}>📇 Customer Contacts</div>
      <div style={{ color: '#888', fontSize: 13 }}>Loading…</div>
    </div>
  )

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#1a2332' }}>📇 Customer Contacts</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>{contacts.length} total</div>
      </div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>
        People you might email a tracking link to. Used by the 📍 dispatch dialog's searchable dropdown.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr auto', gap: 8, marginBottom: 14 }}>
        <select style={inp} value={newCustomer} onChange={e => setNewCustomer(e.target.value)}>
          <option value=''>Customer…</option>
          {customerOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input style={inp} placeholder='Name' value={newName} onChange={e => setNewName(e.target.value)} />
        <input style={inp} placeholder='email@company.com' value={newEmail} onChange={e => setNewEmail(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }} />
        <button style={addBtn} onClick={handleAdd} disabled={busy}>+ Add</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <select style={{ ...inp, flex: '0 0 180px' }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value='all'>All customers</option>
          {customersInList.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input style={{ ...inp, flex: 1, minWidth: 200 }} placeholder='Search name or email…' value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {savedFlash && <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 700, marginBottom: 6 }}>✓ Saved</div>}

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, maxHeight: 320, overflowY: 'auto', marginBottom: 16 }}>
        {visible.length === 0 ? (
          <div style={{ padding: 16, color: '#aaa', fontSize: 13, textAlign: 'center' }}>No contacts match.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', fontWeight: 700, color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Customer</th>
                <th style={{ padding: '8px 10px', fontWeight: 700, color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Name</th>
                <th style={{ padding: '8px 10px', fontWeight: 700, color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Email</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map(c => (
                <tr key={c.email} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '7px 10px', color: '#475569' }}>{c.customer || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                  <td style={{ padding: '7px 10px', fontWeight: 600, color: '#1a2332' }}>{c.name || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                  <td style={{ padding: '7px 10px', color: '#475569', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>{c.email}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                    <button style={delBtn} onClick={() => handleRemove(c.email)} disabled={busy} title='Remove'>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: '#0891b2', fontWeight: 700 }}>📥 Paste CSV to bulk-import</summary>
        <div style={{ marginTop: 10, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
            One contact per line. Columns can be in either order — we'll figure out which one has the email. Header row is fine.
          </div>
          <select style={{ ...inp, marginBottom: 8, width: '100%' }} value={csvCustomer} onChange={e => setCsvCustomer(e.target.value)}>
            <option value=''>Customer for these contacts (optional)…</option>
            {customerOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <textarea
            style={{ ...inp, width: '100%', minHeight: 120, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}
            placeholder={'email,name\njohn@diamondbackenergy.com,John Doe\njane@diamondbackenergy.com,Jane Roe'}
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={addBtn} onClick={handleImport} disabled={busy}>Import</button>
            <button style={{ background: 'transparent', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 6, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }} onClick={() => setCsvText('')}>
              Clear
            </button>
          </div>
        </div>
      </details>
    </div>
  )
}

// ─── ACTIVE DISPATCHES ADMIN ─────────────────────────────────────────────────
// Glance-view of every dispatch currently sharing live location with a
// customer. Polls every 20s. Lets admin copy the public tracking link or
// force-end a dispatch (e.g. tech forgot to mark done).
function DispatchesAdmin() {
  const { user, profile } = useAuth()
  const [dispatches, setDispatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [endingId, setEndingId] = useState(null)
  const [tick, setTick] = useState(0) // forces re-render so relative times refresh
  const [mapDispatch, setMapDispatch] = useState(null)
  const [shareDispatch, setShareDispatch] = useState(null)

  const load = useCallback(async () => {
    try {
      const list = await fetchOpenDispatches()
      setDispatches(Array.isArray(list) ? list : [])
    } catch (e) {
      console.warn('[DispatchesAdmin] load failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const i = setInterval(load, 20000)
    const t = setInterval(() => setTick(x => x + 1), 30000)
    return () => { clearInterval(i); clearInterval(t) }
  }, [load])

  const handleCopy = async (token) => {
    const url = window.location.origin + '/track/' + token
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Tracking link copied to clipboard')
    } catch {
      toast.warning('Copy failed — link: ' + url, 8000)
    }
  }

  const handleEnd = async (d) => {
    const who = d.customer_name || 'this customer'
    if (!window.confirm('End dispatch for ' + who + '?\nThe customer will no longer see live updates.')) return
    setEndingId(d.id)
    try {
      await setDispatchStatus(d.id, 'completed')
      logAudit({
        userId: user?.id, userName: profile?.full_name || user?.email,
        action: 'dispatch_ended', targetType: 'dispatch', targetId: d.id,
        details: { customer: d.customer_name, tech: d.tech_name, share_token: d.share_token },
      })
      toast.success('Dispatch ended')
      setDispatches(prev => prev.filter(x => x.id !== d.id))
    } catch (e) {
      toast.error('End failed: ' + (e.message || String(e)))
    } finally {
      setEndingId(null)
    }
  }

  const statusPill = (status) => {
    const map = {
      en_route:  { bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa', label: '🚐 En route' },
      arrived:   { bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0', label: '📍 Arrived' },
      completed: { bg: '#f1f5f9', fg: '#475569', border: '#cbd5e1', label: '✓ Completed' },
      cancelled: { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca', label: '✕ Cancelled' },
    }
    const s = map[status] || map.en_route
    return (
      <span style={{ background: s.bg, color: s.fg, border: '1px solid ' + s.border, padding: '2px 9px', borderRadius: 12, fontSize: 11, fontWeight: 800, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>
        {s.label}
      </span>
    )
  }

  const gpsCell = (d) => {
    if (!d.tech_updated_at) {
      return <span style={{ color: '#94a3b8', fontSize: 12, fontStyle: 'italic' }}>Waiting for tech to start sharing</span>
    }
    const ageMs = Date.now() - new Date(d.tech_updated_at).getTime()
    const fresh = ageMs < 90 * 1000 // <1.5 min = green
    const stale = ageMs > 8 * 60 * 1000 // >8 min = red
    const color = stale ? '#dc2626' : fresh ? '#16a34a' : '#ca8a04'
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', boxShadow: fresh ? '0 0 0 2px rgba(22,163,74,0.25)' : 'none' }}></span>
        {formatRelativeTime(d.tech_updated_at)}
      </span>
    )
  }

  const cell = { padding: '10px 12px', borderTop: '1px solid #f1f5f9', verticalAlign: 'top' }
  const th = { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.6, background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }

  if (loading) {
    return (
      <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#1a2332', marginBottom: 12 }}>📍 Active Dispatches</div>
        {[1,2,3].map(i => (
          <div key={i} style={{ height: 42, background: 'linear-gradient(90deg,#f1f5f9 25%,#e5e7eb 50%,#f1f5f9 75%)', borderRadius: 6, marginBottom: 8, backgroundSize: '200% 100%', animation: 'pulse 1.6s ease-in-out infinite' }}></div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }} data-tick={tick}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1a2332' }}>📍 Active Dispatches</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            Customers being notified with a live tracking link right now. Auto-refreshes every 20 seconds.
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>
          {dispatches.length} active
        </div>
      </div>

      {mapDispatch && (
        <DispatchMapModal
          dispatch={mapDispatch}
          onClose={() => setMapDispatch(null)}
        />
      )}
      {shareDispatch && (
        <ShareDispatchDialog
          dispatch={shareDispatch}
          currentUser={{ id: user?.id, email: user?.email, full_name: profile?.full_name }}
          onClose={() => setShareDispatch(null)}
        />
      )}

      {dispatches.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 4 }}>No active dispatches.</div>
          <div style={{ fontSize: 12 }}>Click the 📍 button on any submission row to start one.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Status</th>
                <th style={th}>Customer</th>
                <th style={th}>Tech</th>
                <th style={th}>Destination</th>
                <th style={th}>Started</th>
                <th style={th}>ETA</th>
                <th style={th}>Last GPS</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {dispatches.map(d => (
                <tr key={d.id} onClick={() => setMapDispatch(d)} style={{ cursor: 'pointer' }} title='Click row to view live map'>
                  <td style={cell}>{statusPill(d.status)}</td>
                  <td style={cell}>
                    <div style={{ fontWeight: 700, color: '#1a2332' }}>{d.customer_name || '—'}</div>
                    {d.customer_email && <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'ui-monospace, Menlo, monospace', marginTop: 2 }}>{d.customer_email}</div>}
                  </td>
                  <td style={cell}>
                    <div style={{ color: '#1a2332', fontWeight: 600 }}>{d.tech_name || '—'}</div>
                  </td>
                  <td style={cell}>
                    <div style={{ color: '#475569' }}>{d.destination_label || '—'}</div>
                  </td>
                  <td style={cell}>
                    <div style={{ color: '#475569', fontSize: 12 }}>{formatRelativeTime(d.started_at) || '—'}</div>
                  </td>
                  <td style={cell}>
                    <div style={{ color: '#475569', fontSize: 12 }}>{formatEta(d.eta_seconds) || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span>}</div>
                  </td>
                  <td style={cell}>{gpsCell(d)}</td>
                  <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setShareDispatch(d)}
                      title='Email this tracking link to a customer or supervisor'
                      style={{ background: '#ecfeff', border: '1px solid #67e8f9', color: '#0e7490', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', marginRight: 6 }}
                    >
                      ✉️ Share
                    </button>
                    <button
                      onClick={() => handleCopy(d.share_token)}
                      title='Copy public tracking link to clipboard'
                      style={{ background: '#f0f9ff', border: '1px solid #7dd3fc', color: '#0369a1', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', marginRight: 6 }}
                    >
                      🔗 Copy
                    </button>
                    <button
                      onClick={() => handleEnd(d)}
                      disabled={endingId === d.id}
                      title='Mark this dispatch as completed and stop sharing location'
                      style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: endingId === d.id ? 'wait' : 'pointer' }}
                    >
                      {endingId === d.id ? 'Ending…' : '🛑 End'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── ASSIGN JOB ADMIN ────────────────────────────────────────────────────────
// Admin creates a draft PM/SC pre-assigned to a tech. The tech gets an email
// with a deep link to /edit/:id, fills in remaining details, and submits.
function AssignJobAdmin() {
  const { user, profile } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [assignedToId, setAssignedToId] = useState('')
  const [jobType, setJobType] = useState('Service Call')
  const [customerName, setCustomerName] = useState('')
  const [locationName, setLocationName] = useState('')
  const [customerWorkOrder, setCustomerWorkOrder] = useState('')
  const [workType, setWorkType] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const reloadProfiles = useCallback(async () => {
    setLoadError(null)
    setLoading(true)
    try {
      const token = getAuthToken()
      const profRes = await fetch(SUPA_URL_P + '/rest/v1/profiles?select=*&order=created_at.asc', {
        cache: 'no-store',
        headers: {
          apikey: SUPA_KEY_P,
          Authorization: 'Bearer ' + (token || SUPA_KEY_P),
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      })
      if (!profRes.ok) {
        const txt = await profRes.text().catch(() => '')
        throw new Error('Failed to load techs (HTTP ' + profRes.status + (txt ? ' — ' + txt.slice(0, 120) : '') + ')')
      }
      const allProfiles = await profRes.json()
      console.log('[AssignJobAdmin] profiles fetched:', allProfiles)
      const techs = (allProfiles || [])
        .filter(p => p && p.role !== 'read-only')
        .sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''))
      const all = await fetchSettings()
      setProfiles(techs)
      const c = (all && Array.isArray(all.customers) && all.customers.length) ? all.customers : ['Diamondback','High Peak Energy','ExTex','A8 Oilfield Services','Pristine Alliance','KOS']
      setCustomers(c)
    } catch (e) {
      console.error('[AssignJobAdmin] load failed:', e)
      setLoadError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reloadProfiles() }, [reloadProfiles])

  const resetForm = () => {
    setAssignedToId('')
    setJobType('Service Call')
    setCustomerName('')
    setLocationName('')
    setCustomerWorkOrder('')
    setWorkType('')
    setDescription('')
    setDueDate('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrMsg(''); setSuccessMsg('')
    if (!assignedToId) { setErrMsg('Pick a tech to assign this job to.'); return }
    if (!customerName) { setErrMsg('Customer is required.'); return }
    if (!customerWorkOrder.trim()) { setErrMsg('Customer WO/PO# is required.'); return }
    const tech = profiles.find(p => p.id === assignedToId)
    if (!tech) { setErrMsg('Selected tech not found — reload the page.'); return }
    if (!tech.email) { setErrMsg('This tech has no email on file — fix it in the Users tab first, then come back.'); return }

    setSubmitting(true)
    try {
      const sub = await createAssignedSubmission({
        assignedToUserId: tech.id,
        assignedByUserId: user?.id,
        assignedByName: profile?.full_name || user?.email || 'Office',
        customerName,
        locationName,
        customerWorkOrder: customerWorkOrder.trim(),
        workType,
        description,
        dueDate: dueDate || null,
        jobType,
      })

      // Audit + email are fire-and-forget after the DB row is in place — even
      // if the email fails, the tech can still find the assignment in their list.
      logAudit({
        userId: user?.id,
        userName: profile?.full_name || user?.email,
        action: 'submission_assigned',
        targetType: 'submission',
        targetId: sub.id,
        details: { assignedTo: tech.full_name || tech.email, jobType, customerName, woNumber: sub.work_order },
      })

      let emailOk = false
      let emailErr = ''
      try {
        const emailRes = await fetch('/api/notify-assigned', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submissionId: sub.id,
            recipientEmail: tech.email,
            recipientName: tech.full_name,
            assignedByName: profile?.full_name || user?.email || 'Office',
          }),
        })
        if (emailRes.ok) {
          emailOk = true
        } else {
          const txt = await emailRes.text().catch(() => '')
          emailErr = 'HTTP ' + emailRes.status + (txt ? ' — ' + txt.slice(0, 200) : '')
        }
      } catch (e) {
        emailErr = e.message || String(e)
      }

      const techLabel = tech.full_name || tech.email
      const woLabel = '#' + sub.work_order
      if (emailOk) {
        setSuccessMsg('✓ Assigned ' + woLabel + ' to ' + techLabel + ' — email sent to ' + tech.email)
      } else {
        setSuccessMsg('✓ Assigned ' + woLabel + ' to ' + techLabel + ' — but EMAIL FAILED: ' + emailErr + '. They\'ll still see it in their list.')
      }
      resetForm()
    } catch (e) {
      setErrMsg('Assignment failed: ' + (e.message || String(e)))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading…</div>
  if (loadError) return <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>Error: {loadError}</div>

  const inp = { border: '1px solid #ddd', borderRadius: 6, padding: '9px 12px', fontSize: 14, width: '100%', boxSizing: 'border-box', outline: 'none' }
  const lbl = { fontSize: 12, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'block' }
  const req = <span style={{ color: '#dc2626' }}>*</span>

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#1a2332', marginBottom: 4 }}>📤 Assign Job to Tech</div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 20 }}>
        Creates a draft job pre-assigned to a tech. They get an email with a link to open the job in the app, complete it, and submit.
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={lbl}>
              Assign To {req}
              <button
                type='button'
                onClick={reloadProfiles}
                disabled={loading}
                title='Re-fetch the list of techs from the database'
                style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#0891b2', background: 'transparent', border: '1px solid #0891b2', borderRadius: 12, padding: '1px 8px', cursor: loading ? 'wait' : 'pointer', textTransform: 'none', letterSpacing: 0 }}
              >
                {loading ? 'Loading…' : '↻ Refresh'}
              </button>
              <span style={{ marginLeft: 8, fontSize: 10, color: '#888', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                {profiles.length} found
              </span>
            </label>
            <select value={assignedToId} onChange={e => setAssignedToId(e.target.value)} style={inp} required>
              <option value=''>— Pick a tech —</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.full_name || p.email || p.id}{p.email ? ' (' + p.email + ')' : ' — NO EMAIL'}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={lbl}>Job Type {req}</label>
            <select value={jobType} onChange={e => setJobType(e.target.value)} style={inp}>
              <option value='Service Call'>Service Call</option>
              <option value='PM'>PM</option>
            </select>
          </div>

          <div>
            <label style={lbl}>Customer {req}</label>
            <select value={customerName} onChange={e => setCustomerName(e.target.value)} style={inp} required>
              <option value=''>— Pick a customer —</option>
              {customers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label style={lbl}>Customer WO/PO # {req}</label>
            <input type='text' value={customerWorkOrder} onChange={e => setCustomerWorkOrder(e.target.value)} style={inp} placeholder='e.g. 4521-A' required />
          </div>

          <div>
            <label style={lbl}>Location</label>
            <input type='text' value={locationName} onChange={e => setLocationName(e.target.value)} style={inp} placeholder='Site / pad / lease' />
          </div>

          <div>
            <label style={lbl}>Type of Work</label>
            <input type='text' value={workType} onChange={e => setWorkType(e.target.value)} style={inp} placeholder='e.g. Quarterly PM, Pilot relight' />
          </div>

          <div>
            <label style={lbl}>Due Date</label>
            <input type='date' value={dueDate} onChange={e => setDueDate(e.target.value)} style={inp} />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Description / Instructions</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            style={{ ...inp, fontFamily: 'inherit', resize: 'vertical', minHeight: 80 }}
            placeholder='What does the tech need to know before they get on site?'
          />
        </div>

        {errMsg && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: 6, padding: '10px 14px', fontSize: 13, marginBottom: 12, fontWeight: 600 }}>{errMsg}</div>
        )}
        {successMsg && (
          <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', borderRadius: 6, padding: '10px 14px', fontSize: 13, marginBottom: 12, fontWeight: 600 }}>{successMsg}</div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type='submit'
            disabled={submitting}
            style={{ background: '#ea580c', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 24px', fontWeight: 800, fontSize: 14, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? 'Assigning…' : '📤 Assign & Send Email'}
          </button>
          <button
            type='button'
            onClick={() => { resetForm(); setErrMsg(''); setSuccessMsg('') }}
            disabled={submitting}
            style={{ background: 'transparent', color: '#666', border: '1px solid #ddd', borderRadius: 8, padding: '12px 18px', fontWeight: 700, fontSize: 13, cursor: submitting ? 'not-allowed' : 'pointer' }}
          >
            Clear
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── USERS ADMIN ─────────────────────────────────────────────────────────────
function UsersAdmin() {
  const { user } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState(null)

  const ROLES = ['admin', 'supervisor', 'technician', 'read-only']
  const ROLE_COLORS = { admin: '#ef4444', supervisor: '#f97316', technician: '#0891b2', 'read-only': '#6b7280' }

  const loadProfiles = async () => {
    setLoading(true); setError(null)
    try {
      const token = getAuthToken()
      const res = await fetch(SUPA_URL_P + '/rest/v1/profiles?select=*&order=created_at.asc', {
        headers: { 'apikey': SUPA_KEY_P, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
      })
      if (!res.ok) throw new Error('Failed to load profiles: ' + res.status)
      const data = await res.json()
      setProfiles(data || [])
    } catch (e) {
      setError(e.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { loadProfiles() }, [])

  const updateRole = async (userId, role) => {
    setSaving(userId)
    try {
      const token = getAuthToken()
      const res = await fetch(SUPA_URL_P + '/rest/v1/profiles?id=eq.' + userId, {
        method: 'PATCH',
        headers: { 'apikey': SUPA_KEY_P, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({ role })
      })
      if (!res.ok) throw new Error('Failed to update role')
      setProfiles(ps => ps.map(p => p.id === userId ? { ...p, role } : p))
    } catch (e) {
      toast.error('Error updating role: ' + e.message)
    } finally { setSaving(null) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading users...</div>
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>Error: {error}</div>

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#1a2332', marginBottom: 4 }}>👥 User Management</div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>View all users and manage their roles. To add a new user, have them sign up at the app login page.</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: '#555', borderBottom: '2px solid #e5e7eb' }}>Name</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: '#555', borderBottom: '2px solid #e5e7eb' }}>Email</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: '#555', borderBottom: '2px solid #e5e7eb' }}>Role</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: '#555', borderBottom: '2px solid #e5e7eb' }}>Joined</th>
            </tr>
          </thead>
          <tbody>
            {profiles.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 30, textAlign: 'center', color: '#aaa' }}>No users found.</td></tr>
            )}
            {profiles.map((p, i) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{p.full_name || p.name || '—'}</td>
                <td style={{ padding: '10px 12px', color: '#555' }}>{p.email || '—'}</td>
                <td style={{ padding: '10px 12px' }}>
                  {saving === p.id ? (
                    <span style={{ color: '#0891b2', fontSize: 12 }}>Saving...</span>
                  ) : (
                    <select value={p.role || 'technician'} onChange={e => updateRole(p.id, e.target.value)}
                      style={{ border: '1px solid ' + (ROLE_COLORS[p.role] || '#ddd'), borderRadius: 16, padding: '3px 10px', fontSize: 12, fontWeight: 700, color: ROLE_COLORS[p.role] || '#555', background: '#fff', cursor: 'pointer' }}>
                      {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                    </select>
                  )}
                </td>
                <td style={{ padding: '10px 12px', color: '#888', fontSize: 12 }}>{p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── ANALYTICS ADMIN ─────────────────────────────────────────────────────────
// ─── CUSTOMER HISTORY ────────────────────────────────────────────────────────
// One-stop view of a customer's relationship: lifetime stats, sites
// serviced (sorted by last visit), monthly revenue spark, and a
// chronological feed of every submission. Reads from the submissions
// prop the AdminPage already loads — no extra fetch.
function CustomersAdmin({ submissions }) {
  const { isDemo } = useAuth()
  const navigate = useNavigate()
  const subs = submissions || []
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [search, setSearch] = useState('')

  // Build the customer roster from actual submission data — anything the
  // admin can see in the submissions list is selectable here.
  const customerList = useMemo(() => {
    const map = new Map()
    subs.forEach(s => {
      const name = (s.customer_name || '').trim()
      if (!name) return
      const entry = map.get(name) || { name, count: 0, lastDate: '' }
      entry.count++
      const d = s.date || s.created_at || ''
      if (d > entry.lastDate) entry.lastDate = d
      map.set(name, entry)
    })
    return Array.from(map.values()).sort((a, b) => b.count - a.count)
  }, [subs])

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customerList
    return customerList.filter(c => c.name.toLowerCase().includes(q))
  }, [customerList, search])

  // Default to highest-job-count customer once data is available
  useEffect(() => {
    if (!selectedCustomer && customerList.length > 0) setSelectedCustomer(customerList[0].name)
  }, [customerList, selectedCustomer])

  const data = useMemo(() => {
    if (!selectedCustomer) return null
    const own = subs.filter(s => (s.customer_name || '').trim() === selectedCustomer)
    if (own.length === 0) return null
    const jobs = own.filter(s => s.template === 'pm_flare_combustor' || s.template === 'service_call')
    const pms = jobs.filter(s => s.template === 'pm_flare_combustor')
    const scs = jobs.filter(s => s.template === 'service_call')
    const expenses = own.filter(s => s.template === 'expense_report')
    const inspections = own.filter(s => s.template === 'daily_inspection')
    const jobRev = (s) => s?.data?.billable === false ? 0 : (parseFloat(s.data?.grandTotal || 0) || 0)
    const totalRevenue = jobs.reduce((sum, s) => sum + jobRev(s), 0)
    const totalHours = jobs.reduce((sum, s) => sum + (parseFloat(s.labor_hours || 0) || 0), 0)

    const sitesMap = new Map()
    own.forEach(s => {
      const site = (s.location_name || '').trim()
      if (!site) return
      const entry = sitesMap.get(site) || { name: site, count: 0, revenue: 0, lastDate: '' }
      entry.count++
      entry.revenue += jobRev(s)
      const d = s.date || s.created_at || ''
      if (d > entry.lastDate) entry.lastDate = d
      sitesMap.set(site, entry)
    })
    const sites = Array.from(sitesMap.values()).sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''))

    // Last 12 months of revenue, indexed by YYYY-MM
    const monthly = {}
    const now = new Date()
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      monthly[key] = { revenue: 0, jobs: 0, label: d.toLocaleString('en-US', { month: 'short' }) + (i >= 9 || d.getMonth() === 0 ? ' ' + String(d.getFullYear()).slice(2) : '') }
    }
    jobs.forEach(s => {
      const d = s.date || s.created_at
      if (!d) return
      const key = d.slice(0, 7)
      if (monthly[key]) {
        monthly[key].revenue += jobRev(s)
        monthly[key].jobs++
      }
    })

    const sorted = [...own].sort((a, b) => (b.date || b.created_at || '').localeCompare(a.date || a.created_at || ''))
    const firstDate = sorted.length ? (sorted[sorted.length - 1].date || sorted[sorted.length - 1].created_at) : null
    const lastDate = sorted.length ? (sorted[0].date || sorted[0].created_at) : null

    return { own, jobs, pms, scs, expenses, inspections, totalRevenue, totalHours, sites, monthly, sorted, firstDate, lastDate }
  }, [subs, selectedCustomer])

  if (customerList.length === 0) {
    return (
      <div style={{ background: '#fff', borderRadius: 12, padding: '32px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🏢</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2332', marginBottom: 6 }}>No customer data yet</div>
        <div style={{ fontSize: 13, color: '#666', maxWidth: 420, margin: '0 auto', lineHeight: 1.5 }}>
          Customer histories will populate here as your techs submit jobs against named customers.
        </div>
      </div>
    )
  }

  const fmtDate = (d) => {
    if (!d) return '—'
    const dt = new Date(d)
    if (Number.isNaN(dt.getTime())) return d
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
  const fmtMoney = (n) => '$' + (Math.round(n || 0)).toLocaleString('en-US')

  const card = (label, value, color) => (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '2px solid ' + color, flex: '1 1 140px', minWidth: 140 }}>
      <div style={{ fontSize: 24, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#888', fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  )

  const typePill = (s) => {
    const map = {
      pm_flare_combustor: { bg: '#ede9fe', fg: '#6d28d9', label: 'PM' },
      service_call:       { bg: '#dbeafe', fg: '#1d4ed8', label: 'SC' },
      expense_report:     { bg: '#fce7f3', fg: '#be185d', label: 'EXP' },
      daily_inspection:   { bg: '#fef3c7', fg: '#a16207', label: 'INSP' },
      jha:                { bg: '#fee2e2', fg: '#b91c1c', label: 'JHA' },
      quote:              { bg: '#d1fae5', fg: '#047857', label: 'QUOTE' },
    }
    const t = map[s.template] || { bg: '#f1f5f9', fg: '#475569', label: (s.template || '').slice(0, 8).toUpperCase() }
    return (
      <span style={{ background: t.bg, color: t.fg, fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 10, letterSpacing: 0.4 }}>
        {t.label}
      </span>
    )
  }

  const monthlyEntries = data ? Object.entries(data.monthly) : []
  const maxMonthRev = data ? Math.max(1, ...monthlyEntries.map(([, m]) => m.revenue)) : 1

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#1a2332', marginBottom: 4 }}>🏢 Customer History</div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
        Pick a customer to see their lifetime activity, sites you've serviced, monthly revenue trend, and full job history.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 16, alignItems: 'start' }}>
        {/* Customer picker */}
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid #e5e7eb' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={'Search ' + customerList.length + ' customers…'}
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ maxHeight: 460, overflowY: 'auto' }}>
            {filteredCustomers.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>No customer matches.</div>
            ) : filteredCustomers.map(c => {
              const active = c.name === selectedCustomer
              return (
                <button
                  key={c.name}
                  onClick={() => setSelectedCustomer(c.name)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: active ? '#fff7ed' : 'transparent',
                    border: 'none', borderLeft: active ? '3px solid #e65c00' : '3px solid transparent',
                    cursor: 'pointer', padding: '10px 12px', fontFamily: 'inherit',
                    borderBottom: '1px solid #f1f5f9',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: active ? '#9a3412' : '#1a2332' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {c.count} job{c.count === 1 ? '' : 's'} · last {fmtDate(c.lastDate)}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Detail pane */}
        {!data ? (
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', textAlign: 'center', color: '#94a3b8' }}>
            Pick a customer on the left to see their history.
          </div>
        ) : (
          <div>
            <div style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#1a2332' }}>{selectedCustomer}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                {data.own.length} total record{data.own.length === 1 ? '' : 's'} · first {fmtDate(data.firstDate)} · last {fmtDate(data.lastDate)}
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
              {card('PM', data.pms.length, '#7c3aed')}
              {card('SC', data.scs.length, '#1d4ed8')}
              {!isDemo && card('Revenue', fmtMoney(data.totalRevenue), '#16a34a')}
              {card('Labor hrs', (data.totalHours || 0).toFixed(1), '#0891b2')}
              {card('Sites', data.sites.length, '#ea580c')}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 12 }}>
              {/* Sites */}
              <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#1a2332', marginBottom: 10 }}>📍 Sites serviced</div>
                {data.sites.length === 0 ? (
                  <div style={{ color: '#aaa', fontSize: 12 }}>No location names on these records.</div>
                ) : (
                  <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                    {data.sites.map(site => (
                      <div key={site.name} style={{ padding: '7px 0', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a2332', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</div>
                          <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>Last visit {fmtDate(site.lastDate)}</div>
                        </div>
                        <div style={{ fontSize: 11, color: '#475569', textAlign: 'right', flexShrink: 0 }}>
                          <div>{site.count} visit{site.count === 1 ? '' : 's'}</div>
                          {!isDemo && site.revenue > 0 && <div style={{ color: '#16a34a', fontWeight: 700 }}>{fmtMoney(site.revenue)}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Monthly revenue bars */}
              <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#1a2332', marginBottom: 10 }}>📊 Last 12 months {!isDemo && '— revenue'}</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 160, padding: '4px 0' }}>
                  {monthlyEntries.map(([key, m]) => {
                    const h = isDemo ? (m.jobs / Math.max(1, ...monthlyEntries.map(([, x]) => x.jobs))) * 100 : (m.revenue / maxMonthRev) * 100
                    const display = isDemo ? m.jobs : m.revenue
                    return (
                      <div key={key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={key + (isDemo ? ' · ' + m.jobs + ' jobs' : ' · ' + fmtMoney(m.revenue))}>
                        <div style={{ width: '100%', height: 110, display: 'flex', alignItems: 'flex-end' }}>
                          <div style={{
                            width: '100%',
                            height: Math.max(2, h) + '%',
                            background: display > 0 ? 'linear-gradient(180deg, #16a34a, #15803d)' : '#e5e7eb',
                            borderRadius: '3px 3px 0 0',
                            transition: 'height 0.3s ease',
                          }} />
                        </div>
                        <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, whiteSpace: 'nowrap' }}>{m.label}</div>
                      </div>
                    )
                  })}
                </div>
                {!isDemo && (
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, textAlign: 'right' }}>
                    Peak month: {fmtMoney(maxMonthRev)}
                  </div>
                )}
              </div>
            </div>

            {/* Activity feed */}
            <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#1a2332', marginBottom: 10 }}>📋 Full history ({data.sorted.length})</div>
              <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                {data.sorted.slice(0, 100).map(s => {
                  const rawTech = (Array.isArray(s.data?.techs) && s.data.techs[0]) || s.profiles?.full_name || ''
                  const tech = canonicalTech(rawTech) || '—'
                  const num = s.work_order || s.pm_number || ''
                  return (
                    <button
                      key={s.id}
                      onClick={() => navigate('/view/' + s.id)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        background: 'transparent', border: 'none', borderBottom: '1px solid #f1f5f9',
                        cursor: 'pointer', padding: '10px 4px', fontFamily: 'inherit',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        {typePill(s)}
                        {num && <span style={{ fontSize: 12, fontWeight: 800, color: '#1a2332' }}>#{num}</span>}
                        <span style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(s.date || s.created_at)}</span>
                        <span style={{ fontSize: 12, color: '#475569' }}>· {tech}</span>
                        {s.location_name && <span style={{ fontSize: 12, color: '#64748b' }}>· {s.location_name}</span>}
                        {!isDemo && parseFloat(s.data?.grandTotal || 0) > 0 && (
                          <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 700, marginLeft: 'auto' }}>{fmtMoney(parseFloat(s.data?.grandTotal || 0))}</span>
                        )}
                      </div>
                    </button>
                  )
                })}
                {data.sorted.length > 100 && (
                  <div style={{ padding: 12, textAlign: 'center', fontSize: 11, color: '#94a3b8' }}>
                    Showing 100 most recent of {data.sorted.length} records.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AnalyticsAdmin({ submissions }) {
  const { isDemo } = useAuth()
  const subs = submissions || []

  const totalJobs = subs.filter(s => s.template === 'pm_flare_combustor' || s.template === 'service_call').length
  const totalPMs = subs.filter(s => s.template === 'pm_flare_combustor').length
  const totalSCs = subs.filter(s => s.template === 'service_call').length
  const totalInsp = subs.filter(s => s.template === 'daily_inspection').length
  const totalExp = subs.filter(s => s.template === 'expense_report').length

  const passCount = subs.filter(s => s.overall_result === 'pass' || s.status === 'approved').length
  const failCount = subs.filter(s => s.overall_result === 'fail').length
  const totalRevenue = isDemo ? null : subs.reduce((sum, s) => {
    if (s?.data?.billable === false) return sum
    const v = s?.data?.grandTotal != null ? s.data.grandTotal : s.total_revenue
    return sum + (parseFloat(v) || 0)
  }, 0)

  const techMap = {}
  subs.forEach(s => {
    const rawT = (Array.isArray(s.data?.techs) && s.data.techs[0]) || s.profiles?.full_name || ''
    const t = canonicalTech(rawT) || 'Unknown'
    if (!techMap[t]) techMap[t] = 0
    techMap[t]++
  })
  const topTechs = Object.entries(techMap).sort((a, b) => b[1] - a[1]).slice(0, 5)

  const custMap = {}
  subs.forEach(s => {
    const c = s.customer_name || 'Unknown'
    if (!custMap[c]) custMap[c] = 0
    custMap[c]++
  })
  const topCusts = Object.entries(custMap).sort((a, b) => b[1] - a[1]).slice(0, 5)

  const card = (label, value, color) => (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '2px solid ' + color, flex: '1 1 140px', minWidth: 140 }}>
      <div style={{ fontSize: 24, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#888', fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  )

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#1a2332', marginBottom: 4 }}>📊 Analytics Overview</div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>Summary based on all loaded submissions.</div>

      {subs.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 12, padding: '32px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📊</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2332', marginBottom: 6 }}>No submissions to analyze yet</div>
          <div style={{ fontSize: 13, color: '#666', maxWidth: 420, margin: '0 auto', lineHeight: 1.5 }}>
            Once your field techs start logging PMs, service calls, expenses, and inspections, totals, top performers, and customer breakdowns will show up here.
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
            {card('Total Jobs', totalJobs, '#1a2332')}
            {card('PMs', totalPMs, '#0891b2')}
            {card('Service Calls', totalSCs, '#f97316')}
            {card('Inspections', totalInsp, '#7c3aed')}
            {card('Expenses', totalExp, '#6b7280')}
            {!isDemo && totalRevenue !== null && card('Total Revenue', '$' + totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }), '#16a34a')}
            {card('Pass', passCount, '#16a34a')}
            {card('Fail', failCount, '#ef4444')}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#1a2332', marginBottom: 12 }}>🏆 Most Active Technicians</div>
              {topTechs.length === 0 ? <div style={{ color: '#aaa', fontSize: 13 }}>No technician data on these submissions.</div> : topTechs.map(([name, count], i) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < topTechs.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                  <span style={{ fontSize: 13, color: '#333' }}>{i + 1}. {name}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#0891b2' }}>{count} jobs</span>
                </div>
              ))}
            </div>
            <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#1a2332', marginBottom: 12 }}>🏢 Top Customers by Jobs</div>
              {topCusts.length === 0 ? <div style={{ color: '#aaa', fontSize: 13 }}>No customer data on these submissions.</div> : topCusts.map(([name, count], i) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < topCusts.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                  <span style={{ fontSize: 13, color: '#333' }}>{i + 1}. {name}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f97316' }}>{count} jobs</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}


// ─── AUDIT LOG ADMIN ─────────────────────────────────────────────────────────
function describeAudit(entry) {
  const d = entry.details || {}
  const id = entry.target_id
  switch (entry.action) {
    case 'submission_status_changed': {
      const who = d.pm_number ? '#' + d.pm_number : (id || '')
      const cust = d.customer_name ? ' (' + d.customer_name + ')' : ''
      const from = (d.from || '').toUpperCase()
      const to = (d.to || '').toUpperCase()
      return 'Changed status of ' + who + cust + ' from ' + from + ' to ' + to
    }
    case 'submission_deleted': {
      const who = d.pm_number ? '#' + d.pm_number : (id || '')
      const cust = d.customer_name ? ' (' + d.customer_name + ')' : ''
      return 'Deleted ' + (d.type || 'submission') + ' ' + who + cust
    }
    case 'submission_shared': {
      const who = d.pm_number ? '#' + d.pm_number : (id || '')
      const cust = d.customer_name ? ' (' + d.customer_name + ')' : ''
      return 'Generated share link for ' + who + cust
    }
    default:
      return entry.action + (entry.target_type ? ' on ' + entry.target_type : '') + (id ? ' ' + id : '')
  }
}

function fmtAuditTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return diffMin + 'm ago'
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const yest = new Date(now); yest.setDate(yest.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return 'Yesterday ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function AuditLogAdmin() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    setLoading(true); setError(null)
    fetchAuditLog(200)
      .then(rows => setEntries(rows))
      .catch(e => setError(e.message || String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading audit log…</div>

  return (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ background: '#0f1f38', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>📜 Audit Log</div>
        <button onClick={load} style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Refresh</button>
      </div>
      {error && <div style={{ padding: 16, color: '#dc2626', fontSize: 13 }}>Error: {error}</div>}
      {!error && entries.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📜</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No audit entries yet</div>
          <div style={{ fontSize: 12, color: '#aaa' }}>Status changes and deletions will be recorded here once you start making them.</div>
        </div>
      )}
      {!error && entries.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#555', fontSize: 11, textTransform: 'uppercase', borderBottom: '2px solid #e5e7eb' }}>When</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#555', fontSize: 11, textTransform: 'uppercase', borderBottom: '2px solid #e5e7eb' }}>Who</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#555', fontSize: 11, textTransform: 'uppercase', borderBottom: '2px solid #e5e7eb' }}>What</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '10px 14px', color: '#666', whiteSpace: 'nowrap' }} title={new Date(e.created_at).toLocaleString()}>{fmtAuditTime(e.created_at)}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1a2332' }}>{e.user_name || '—'}</td>
                  <td style={{ padding: '10px 14px', color: '#333' }}>{describeAudit(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: '8px 16px', fontSize: 11, color: '#aaa', borderTop: '1px solid #f0f0f0' }}>
        Showing up to 200 most recent entries.
      </div>
    </div>
  )
}

// ─── PDF LAYOUT ADMIN ────────────────────────────────────────────────────────
function PdfLayoutAdmin() {
  const [sections, setSections] = useState(DEFAULT_PDF_LAYOUT)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [migrated, setMigrated] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    fetchSettings().then(all => {
      const raw = all && Array.isArray(all.pdf_layout) ? all.pdf_layout : null
      const normalized = normalizePdfLayout(raw)
      setSections(normalized)
      if (raw && (raw.length !== normalized.length || raw.some((s, i) => s?.id !== normalized[i]?.id))) {
        setMigrated(true)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleDragEnd = (event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setSections(prev => {
      const oldIdx = prev.findIndex(s => s.id === active.id)
      const newIdx = prev.findIndex(s => s.id === over.id)
      if (oldIdx === -1 || newIdx === -1) return prev
      return arrayMove(prev, oldIdx, newIdx)
    })
  }

  const move = (from, to) => {
    if (from === to || to < 0 || to >= sections.length) return
    setSections(prev => arrayMove(prev, from, to))
  }

  const toggle = (id) => setSections(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s))

  const enabledCount = sections.filter(s => s.enabled).length
  const canSave = enabledCount > 0 && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true); setMsg('')
    try {
      await saveSettings('pdf_layout', sections)
      setMsg('Saved!')
      setMigrated(false)
    } catch(e) { setMsg('Error: ' + e.message) } finally { setSaving(false) }
  }

  const reset = () => { setSections(normalizePdfLayout(null)); setMsg('') }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', maxWidth: 640 }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: '#1a2332', marginBottom: 4 }}>📄 PDF Section Layout</div>
      <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>Drag to reorder. Toggle to show/hide. Changes apply to all new PDFs.</div>
      {migrated && (
        <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#92400e', marginBottom: 12 }}>
          ✨ Section list updated — new sections added or stale ones removed. Review the order, then save to confirm.
        </div>
      )}
      {enabledCount === 0 && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#b91c1c', marginBottom: 12 }}>
          ⚠ All sections are hidden. Enable at least one before saving.
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sections.map((sec, i) => (
              <PdfLayoutRow
                key={sec.id}
                sec={sec}
                index={i}
                total={sections.length}
                onToggle={toggle}
                onMove={move}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <button onClick={save} disabled={!canSave} style={{ background: canSave ? '#0f1f38' : '#9ca3af', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 700, fontSize: 14, cursor: canSave ? 'pointer' : 'not-allowed' }}>
          {saving ? 'Saving...' : '💾 Save Layout'}
        </button>
        <button onClick={reset} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#555' }}>
          Reset to Default
        </button>
        {msg && <span style={{ color: msg.startsWith('Error') ? '#dc2626' : '#16a34a', fontWeight: 700, fontSize: 13 }}>{msg}</span>}
      </div>
      <div style={{ marginTop: 16, padding: '10px 14px', background: '#f8f9fa', borderRadius: 8, fontSize: 12, color: '#888', border: '1px solid #e5e7eb' }}>
        💡 Tip: Drag the ⋮⋮ handle (touch and keyboard supported) or use the ↑↓ buttons. Header, footer, colors, and logo are controlled in the Branding tab.
      </div>
    </div>
  )
}

function PdfLayoutRow({ sec, index, total, onToggle, onMove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sec.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px', borderRadius: 8,
    border: isDragging ? '2px solid #0891b2' : '1.5px solid #e2e8f0',
    background: isDragging ? '#f0f9ff' : '#f8fafc',
    opacity: sec.enabled ? (isDragging ? 0.85 : 1) : 0.5,
    userSelect: 'none',
    cursor: 'default',
  }
  return (
    <div ref={setNodeRef} style={style}>
      <span {...attributes} {...listeners} style={{ fontSize: 18, color: '#9ca3af', cursor: 'grab', touchAction: 'none', padding: '0 4px' }}>⋮⋮</span>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#1a2332' }}>
        {index + 1}. {sec.label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={() => onMove(index, Math.max(0, index - 1))} disabled={index === 0}
          style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 8px', cursor: index === 0 ? 'not-allowed' : 'pointer', opacity: index === 0 ? 0.3 : 1, fontSize: 12, fontWeight: 700 }}>↑</button>
        <button type="button" onClick={() => onMove(index, Math.min(total - 1, index + 1))} disabled={index === total - 1}
          style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 8px', cursor: index === total - 1 ? 'not-allowed' : 'pointer', opacity: index === total - 1 ? 0.3 : 1, fontSize: 12, fontWeight: 700 }}>↓</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={sec.enabled} onChange={() => onToggle(sec.id)} style={{ width: 15, height: 15, cursor: 'pointer' }} />
          <span style={{ color: sec.enabled ? '#16a34a' : '#9ca3af', fontWeight: 700, fontSize: 12 }}>{sec.enabled ? 'ON' : 'OFF'}</span>
        </label>
      </div>
    </div>
  )
}

function PartsCatalogAdmin() {
  const { isDemo } = useAuth()
  const [parts, setParts] = useState([])
  const [loadingParts, setLoadingParts] = useState(true)
  const [partsSearch, setPartsSearch] = useState('')
  const [form, setForm] = useState({ code: '', description: '', price: '', category: '' })
  const [saving, setSaving] = useState(false)
  const [partError, setPartError] = useState('')
  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState({})

  // Suggests the next part code by finding the highest existing pure-numeric
  // code and adding 1. Non-numeric codes (e.g. "ABC-001", "42123-A") are
  // ignored. Returns '' if no numeric codes exist.
  const nextPartCode = (rows) => {
    const nums = (rows || [])
      .map(p => String(p.code || '').trim())
      .filter(c => /^\d+$/.test(c))
      .map(c => parseInt(c, 10))
    if (nums.length === 0) return ''
    return String(Math.max(...nums) + 1)
  }

  const loadParts = () => {
    setLoadingParts(true)
    fetchPartsCatalog().then(p => {
      setParts(p)
      setLoadingParts(false)
      // Pre-fill code with the next sequential value, but only if the user
      // hasn't started typing their own — never overwrite in-progress input.
      setForm(f => f.code ? f : { ...f, code: nextPartCode(p) })
    })
  }
  useEffect(loadParts, [])

  const cats = [...new Set(parts.map(p => p.category).filter(Boolean))].sort()
  const filteredParts = parts.filter(p => {
    const q = partsSearch.toLowerCase()
    return !q || (p.description||'').toLowerCase().includes(q) || (p.code||'').toLowerCase().includes(q) || (p.category||'').toLowerCase().includes(q)
  })

  const handleAddPart = async (e) => {
    e.preventDefault()
    if (!form.description.trim()) return
    setSaving(true); setPartError('')
    try { await addPart(form); setForm({ code: '', description: '', price: '', category: '' }); loadParts() }
    catch(err) { setPartError('Failed: ' + (err.message||'').substring(0,80)) }
    finally { setSaving(false) }
  }

  const handleDeletePart = async (id, desc) => {
    if (!window.confirm('Delete ' + JSON.stringify(desc) + '?')) return
    await deletePart(id); loadParts()
  }

  const handleEditSave = async (id) => {
    setSaving(true)
    try { await updatePart(id, editForm); setEditId(null); loadParts() }
    finally { setSaving(false) }
  }

  const pinp = { border: '1px solid #ddd', borderRadius: 6, padding: '6px 10px', fontSize: 13, background: '#fff' }
  const pbtn = (bg) => ({ background: bg, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12 })

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#1a2332', marginBottom: 14 }}>Parts Catalog ({parts.length} items)</div>
      {!isDemo && (<form onSubmit={handleAddPart} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, background: '#f0f9ff', borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0891b2', width: '100%', marginBottom: 4 }}>Add New Part</div>
        <input style={{ ...pinp, flex: '1 1 80px', minWidth: 80 }} placeholder='Code' value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
        <input style={{ ...pinp, flex: '3 1 200px', minWidth: 150 }} placeholder='Description *' required value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        <input style={{ ...pinp, flex: '1 1 80px', minWidth: 80 }} placeholder='Price' type='number' step='0.01' value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
        <input style={{ ...pinp, flex: '2 1 120px', minWidth: 100 }} placeholder='Category' value={form.category} list='part-cats' onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
        <datalist id='part-cats'>{cats.map(c => <option key={c} value={c} />)}</datalist>
        <button type='submit' disabled={saving} style={pbtn('#0891b2')}>+ Add Part</button>
        {partError && <div style={{ color: '#dc2626', fontSize: 12, width: '100%' }}>{partError}</div>}
      </form>)}
      <input style={{ ...pinp, width: '100%', marginBottom: 10, boxSizing: 'border-box' }} placeholder='Search parts...' value={partsSearch} onChange={e => setPartsSearch(e.target.value)} />
      {loadingParts ? <div style={{ color: '#888', padding: 20, textAlign: 'center' }}>Loading...</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left', color: '#555', fontWeight: 600 }}>Code</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', color: '#555', fontWeight: 600 }}>Description</th>
              {!isDemo && <th style={{ padding: '8px 10px', textAlign: 'right', color: '#555', fontWeight: 600 }}>Price</th>}
              <th style={{ padding: '8px 10px', textAlign: 'left', color: '#555', fontWeight: 600 }}>Category</th>
              <th style={{ padding: '8px 10px', textAlign: 'center', color: '#555', fontWeight: 600 }}>Actions</th>
            </tr></thead>
            <tbody>
              {filteredParts.map(p => editId === p.id ? (
                <tr key={p.id} style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
                  <td style={{ padding: '6px 8px' }}><input style={{ ...pinp, width: 70 }} value={editForm.code||''} onChange={e => setEditForm(f => ({ ...f, code: e.target.value }))} /></td>
                  <td style={{ padding: '6px 8px' }}><input style={{ ...pinp, width: '100%', minWidth: 150 }} value={editForm.description||''} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} /></td>
                  {!isDemo && <td style={{ padding: '6px 8px' }}><input style={{ ...pinp, width: 80, textAlign: 'right' }} type='number' step='0.01' value={editForm.price||''} onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))} /></td>}
                  <td style={{ padding: '6px 8px' }}><input style={{ ...pinp, width: 120 }} value={editForm.category||''} list='part-cats' onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} /></td>
                  <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button onClick={() => handleEditSave(p.id)} disabled={saving} style={{ ...pbtn('#16a34a'), marginRight: 4 }}>Save</button>
                    <button onClick={() => setEditId(null)} style={pbtn('#6b7280')}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '6px 10px', color: '#888', fontSize: 12 }}>{p.code||'\u2014'}</td>
                  <td style={{ padding: '6px 10px', fontWeight: 500 }}>{p.description}</td>
                  {!isDemo && <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>${parseFloat(p.price||0).toFixed(2)}</td>}
                  <td style={{ padding: '6px 10px', color: '#555' }}>{p.category||'\u2014'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {!isDemo && <button onClick={() => { setEditId(p.id); setEditForm({ code: p.code||'', description: p.description, price: p.price, category: p.category||'' }) }} style={{ ...pbtn('#2563eb'), marginRight: 4 }}>Edit</button>}
                    {!isDemo && <button onClick={() => handleDeletePart(p.id, p.description)} style={pbtn('#dc2626')}>Del</button>}
                  </td>
                </tr>
              ))}
              {filteredParts.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#888' }}>No parts found</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function AdminPage() {
  const { user, profile, isAdmin, isDemo, loading: authLoading, signOut } = useAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const handleLogout = useCallback(async () => {
    setLoggingOut(true)
    try { await signOut() } catch(e) {}
    setLoggingOut(false)
  }, [signOut])
  const [submissions, setSubmissions] = useState([])
  const [monthlyExpenses, setMonthlyExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('ALL')
  const [filterTech, setFilterTech] = useState('ALL')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [activeTab, setActiveTab] = useState('submissions') // 'submissions' | 'expenses' | 'parts' | 'dispatches' | ...
  const [openDispatchCount, setOpenDispatchCount] = useState(0)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  // Customer-tracking dispatch dialog state (null = closed, set to a
  // submission object to open).
  const [dispatchSub, setDispatchSub] = useState(null)

  const handleStatusChange = async (id, newStatus) => {
    const sub = submissions.find(s => s.id === id)
    if (!sub) return
    const prevStatus = sub.status || 'submitted'
    if (prevStatus === newStatus) return
    if (!window.confirm('Change status to "' + newStatus.toUpperCase() + '"?')) return
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s))
    try {
      await updateSubmissionStatus(id, newStatus)
      logAudit({
        userId: user?.id, userName: profile?.full_name || user?.email,
        action: 'submission_status_changed', targetType: 'submission', targetId: id,
        details: { from: prevStatus, to: newStatus, pm_number: sub.pm_number, customer_name: sub.customer_name },
      })
    } catch(e) {
      console.error('Status update failed:', e)
      toast.error('Status update failed: ' + (e.message || e) + '\nReverting to "' + prevStatus.toUpperCase() + '".')
      setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: prevStatus } : s))
    }
  }

  const handleShare = async (s) => {
    try {
      const token = await ensureShareToken(s)
      setSubmissions(prev => prev.map(x => x.id === s.id ? { ...x, share_token: token } : x))
      const url = window.location.origin + '/share/' + token
      try { await navigator.clipboard.writeText(url) } catch {}
      logAudit({
        userId: user?.id, userName: profile?.full_name || user?.email,
        action: 'submission_shared', targetType: 'submission', targetId: s.id,
        details: { pm_number: s.pm_number, customer_name: s.customer_name },
      })
      toast.success('Share link copied. Anyone with the link can view this submission read-only.', 5000)
    } catch (e) {
      toast.error('Couldn\'t generate share link: ' + (e.message || e))
    }
  }

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const clearSelection = () => setSelectedIds(new Set())

  const bulkUpdateStatus = async (newStatus) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!window.confirm('Mark ' + ids.length + ' submission' + (ids.length !== 1 ? 's' : '') + ' as ' + newStatus.toUpperCase() + '?')) return
    setBulkBusy(true)
    try {
      for (const id of ids) {
        const sub = submissions.find(s => s.id === id)
        if (!sub) continue
        const prevStatus = sub.status || 'submitted'
        if (prevStatus === newStatus) continue
        try {
          await updateSubmissionStatus(id, newStatus)
          setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s))
          logAudit({
            userId: user?.id, userName: profile?.full_name || user?.email,
            action: 'submission_status_changed', targetType: 'submission', targetId: id,
            details: { from: prevStatus, to: newStatus, pm_number: sub.pm_number, customer_name: sub.customer_name, bulk: true },
          })
        } catch (e) {
          console.warn('Bulk status update failed for ' + id + ':', e)
        }
      }
      clearSelection()
    } finally {
      setBulkBusy(false)
    }
  }

  const bulkDeleteSelected = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!window.confirm('Permanently delete ' + ids.length + ' submission' + (ids.length !== 1 ? 's' : '') + '?\nThis cannot be undone.')) return
    setBulkBusy(true)
    try {
      for (const id of ids) {
        const sub = submissions.find(s => s.id === id)
        if (!sub) continue
        try {
          await deleteSubmission(id)
          setSubmissions(prev => prev.filter(x => x.id !== id))
          logAudit({
            userId: user?.id, userName: profile?.full_name || user?.email,
            action: 'submission_deleted', targetType: 'submission', targetId: id,
            details: { pm_number: sub.pm_number, customer_name: sub.customer_name, type: getTypeLabel(sub), date: sub.date, bulk: true },
          })
        } catch (e) {
          console.warn('Bulk delete failed for ' + id + ':', e)
        }
      }
      clearSelection()
    } finally {
      setBulkBusy(false)
    }
  }

  const handleDelete = async (s) => {
    const lbl = getTypeLabel(s)
    const label = lbl + (s.pm_number ? ' #' + s.pm_number : '') + ' — ' + (s.customer_name || s.location_name || '')
    if (!window.confirm('Permanently delete ' + label + '?\nThis cannot be undone.')) return
    setDeleting(s.id)
    try {
      await deleteSubmission(s.id)
      setSubmissions(prev => prev.filter(x => x.id !== s.id))
      logAudit({
        userId: user?.id, userName: profile?.full_name || user?.email,
        action: 'submission_deleted', targetType: 'submission', targetId: s.id,
        details: { pm_number: s.pm_number, customer_name: s.customer_name, type: lbl, date: s.date },
      })
    } catch(e) {
      toast.error('Delete failed: ' + e.message)
    } finally {
      setDeleting(null)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin) return
    fetchAllSubmissions()
      .then(setSubmissions)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [isAdmin, authLoading])

  // Fetch office-side monthly expenses (separate table). Used by the
  // header "Expenses (This Month)" + "Net Profit" cards so both
  // tech-side and office-side outflows are reflected. Also feeds the
  // year-export-for-taxes function on the Monthly Expenses tab.
  useEffect(() => {
    if (authLoading || !isAdmin) return
    fetchMonthlyExpenses({ limit: 5000 }).then(rows => {
      setMonthlyExpenses(Array.isArray(rows) ? rows : [])
    }).catch(() => {})
  }, [isAdmin, authLoading])

  // Poll the open-dispatch count for the tab badge. Cheap query (one row
  // per tracked customer; usually 0-3 rows) and DispatchesAdmin re-polls
  // independently when its tab is active.
  useEffect(() => {
    if (authLoading || !isAdmin) return
    let cancelled = false
    const refresh = () => {
      fetchOpenDispatches().then(list => {
        if (!cancelled) setOpenDispatchCount(Array.isArray(list) ? list.length : 0)
      }).catch(() => {})
    }
    refresh()
    const i = setInterval(refresh, 20000)
    return () => { cancelled = true; clearInterval(i) }
  }, [isAdmin, authLoading])

  // Realtime: any insert/update/delete on submissions re-fetches the list so
  // the admin sees new submissions appear without refreshing. Falls back
  // silently if the realtime channel can't be established — initial fetch
  // above still works either way.
  const [realtimeStatus, setRealtimeStatus] = useState('connecting')
  useEffect(() => {
    if (authLoading) return
    if (!isAdmin) return
    if (!supabase) return
    let cancelled = false
    const channel = supabase
      .channel('admin-submissions-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, () => {
        if (cancelled) return
        fetchAllSubmissions().then(rows => { if (!cancelled) setSubmissions(rows) }).catch(() => {})
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_expenses' }, () => {
        if (cancelled) return
        fetchMonthlyExpenses({ limit: 5000 }).then(rows => { if (!cancelled) setMonthlyExpenses(Array.isArray(rows) ? rows : []) }).catch(() => {})
      })
      .subscribe(status => {
        if (cancelled) return
        if (status === 'SUBSCRIBED') setRealtimeStatus('live')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeStatus('offline')
      })
    return () => {
      cancelled = true
      try { supabase.removeChannel(channel) } catch {}
    }
  }, [isAdmin, authLoading])

  if (authLoading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>
  if (!isAdmin) return <Navigate to="/submissions" replace />

  const fmt = n => '$' + (n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  const allTechs = [...new Set(
    submissions.flatMap(s => { const techs = s.data?.techs || []; return Array.isArray(techs) ? techs : [] })
  )].sort()

  const filtered = submissions.filter(s => {
    const q = search.toLowerCase().trim()
    const lbl = getTypeLabel(s)
    const matchesType = filterType === 'ALL' || lbl === filterType
    const matchesStatus = filterStatus === 'ALL' || s.status === filterStatus
    const techList = Array.isArray(s.data?.techs) ? s.data.techs : []
    const matchesTech = filterTech === 'ALL' || techList.includes(filterTech)
    const matchesDate = (!dateFrom || s.date >= dateFrom) && (!dateTo || s.date <= dateTo)
    if (!matchesType || !matchesStatus || !matchesTech || !matchesDate) return false
    if (!q) return true
    const haystack = [s.customer_name, s.location_name, s.date, s.truck_number, s.pm_number ? String(s.pm_number) : '', s.summary, s.profiles?.full_name, s.work_type, ...(Array.isArray(s.data?.techs) ? s.data.techs : [])].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(q)
  })

  // Revenue: PM/SC only (excludes expenses + non-billable). Filtered list respects user search/filter.
  const totalRevenue = filtered.reduce((sum, s) => {
    const lbl = getTypeLabel(s)
    if (lbl === 'EXP' || lbl === 'INSP') return sum
    if (s?.data?.billable === false) return sum
    return sum + parseFloat(s.data?.grandTotal || 0)
  }, 0)
  // Month-scoped stats (reset each month)
  const nowD = new Date()
  const monthStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1).toISOString().split('T')[0]
  const monthEnd = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).toISOString().split('T')[0]
  const thisMonthSubs = submissions.filter(s => s.date >= monthStart && s.date <= monthEnd)
  const monthRevenue = thisMonthSubs.reduce((sum, s) => {
    const lbl = getTypeLabel(s)
    if (lbl === 'EXP' || lbl === 'INSP') return sum
    if (s?.data?.billable === false) return sum
    return sum + parseFloat(s.data?.grandTotal || 0)
  }, 0)
  // Expenses (This Month) = tech-side expense_report submissions
  // + office-side monthly_expenses for the current month. Unified so
  // the header card matches what's in the Monthly Expenses tab.
  const monthYearKey = nowD.getFullYear() + '-' + String(nowD.getMonth() + 1).padStart(2, '0')
  const monthOfficeExpenses = monthlyExpenses
    .filter(e => e.month_year === monthYearKey)
    .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)
  const monthExpenses = monthOfficeExpenses + thisMonthSubs.reduce((sum, s) => {
    if (getTypeLabel(s) === 'EXP') return sum + parseFloat(s.data?.expenseTotal || 0)
    return sum
  }, 0)
  const monthNetProfit = monthRevenue - monthExpenses
  const warrantyCount = filtered.filter(s => s.data?.warrantyWork).length
  const pmCount = filtered.filter(s => getTypeLabel(s) === 'PM').length
  const scCount = filtered.filter(s => getTypeLabel(s) === 'SC').length
  const expCount = filtered.filter(s => getTypeLabel(s) === 'EXP').length
  const inspCount = filtered.filter(s => getTypeLabel(s) === 'INSP').length

  const statCard = (label, value, color) => (
    <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', flex: '1 1 130px', minWidth: 130 }}>
      <div style={{ fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || '#1a2332', marginTop: 4 }}>{value}</div>
    </div>
  )
  const hasFilters = search || filterType !== 'ALL' || filterStatus !== 'ALL' || filterTech !== 'ALL' || dateFrom || dateTo
  const clearFilters = () => { setSearch(''); setFilterType('ALL'); setFilterStatus('ALL'); setFilterTech('ALL'); setDateFrom(''); setDateTo('') }
  // Tech performance (respects the user's current search/filter/date range)
  const byTech = {}
  for (const s of filtered) {
    const rawTech = (Array.isArray(s.data?.techs) && s.data.techs[0]) || s.location_name || s.profiles?.full_name || 'Unknown'
    const tech = canonicalTech(rawTech) || 'Unknown'
    if (!byTech[tech]) byTech[tech] = { total: 0, count: 0, woCount: 0, laborHours: 0, items: [] }
    const lbl2 = getTypeLabel(s)
    const isNonBillable = s.data?.billable === false
    const rev = lbl2 === 'EXP'
      ? parseFloat(s.data?.expenseTotal || 0)
      : (isNonBillable ? 0 : parseFloat(s.data?.grandTotal || 0))
    byTech[tech].total += rev
    if (lbl2 === 'PM' || lbl2 === 'SC') byTech[tech].woCount += 1
    byTech[tech].laborHours += parseFloat(s.labor_hours || 0)
    byTech[tech].count += 1
    byTech[tech].items.push(s)
  }
  const allTechTotals = Object.entries(byTech).sort((a, b) => b[1].total - a[1].total)
  const grandTotal = allTechTotals.reduce((sum, [, v]) => sum + v.total, 0)

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', fontFamily: 'system-ui,sans-serif' }}>
      <NavBar user={user} isAdmin={isAdmin} isDemo={isDemo} onLogout={handleLogout} loggingOut={loggingOut} />

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 12px 80px' }}>

        {/* TAB BAR */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <button onClick={() => setActiveTab('submissions')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'submissions' ? '#1a2332' : '#fff', color: activeTab === 'submissions' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            📋 Submissions
            {submissions.length > 0 && (
              <span style={{ background: activeTab === 'submissions' ? 'rgba(255,255,255,0.22)' : '#1a2332', color: '#fff', fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 10, minWidth: 18, textAlign: 'center' }}>
                {submissions.length}
              </span>
            )}
          </button>
          <button onClick={() => setActiveTab('assign')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'assign' ? '#ea580c' : '#fff', color: activeTab === 'assign' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            📤 Assign Job
          </button>
          <button onClick={() => setActiveTab('expenses')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'expenses' ? '#7c3aed' : '#fff', color: activeTab === 'expenses' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            💜 Expense Analytics
          </button>
          <button onClick={() => setActiveTab('parts')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'parts' ? '#0891b2' : '#fff', color: activeTab === 'parts' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            🔧 Parts Catalog
          </button>
          <button onClick={() => setActiveTab('live')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'live' ? '#16a34a' : '#fff', color: activeTab === 'live' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: activeTab === 'live' ? '#fff' : '#16a34a', boxShadow: '0 0 0 2px #16a34a', animation: 'pulse 2s infinite' }}></span> Live
          </button>
          <button onClick={() => setActiveTab('pm-schedule')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'pm-schedule' ? '#1d4ed8' : '#fff', color: activeTab === 'pm-schedule' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            📅 PM Schedule
          </button>
          <button onClick={() => setActiveTab('dispatches')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'dispatches' ? '#ea580c' : '#fff', color: activeTab === 'dispatches' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            📍 Dispatches
            {openDispatchCount > 0 && (
              <span style={{ background: activeTab === 'dispatches' ? 'rgba(255,255,255,0.22)' : '#ea580c', color: '#fff', fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 10, minWidth: 18, textAlign: 'center' }}>
                {openDispatchCount}
              </span>
            )}
          </button>
          <button onClick={() => setActiveTab("settings")} style={{ padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, background: activeTab === "settings" ? "#7c3aed" : "#fff", color: activeTab === "settings" ? "#fff" : "#555", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            Settings
          </button>
          <button onClick={() => setActiveTab("branding")} style={{ padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, background: activeTab === "branding" ? "#0891b2" : "#fff", color: activeTab === "branding" ? "#fff" : "#555", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            Branding
          </button>
          <button onClick={() => setActiveTab('pdf-layout')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'pdf-layout' ? '#0f172a' : '#fff', color: activeTab === 'pdf-layout' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            📄 PDF Layout
          </button>
          <button onClick={() => setActiveTab("users")} style={{ padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, background: activeTab === "users" ? "#dc2626" : "#fff", color: activeTab === "users" ? "#fff" : "#555", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            Users
          </button>
          <button onClick={() => setActiveTab('billing')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'billing' ? '#16a34a' : '#fff', color: activeTab === 'billing' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            💵 Billing
          </button>
          <button onClick={() => setActiveTab('monthly-expenses')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'monthly-expenses' ? '#dc2626' : '#fff', color: activeTab === 'monthly-expenses' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            💸 Monthly Expenses
          </button>
          <button onClick={() => setActiveTab('customers')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'customers' ? '#9a3412' : '#fff', color: activeTab === 'customers' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            🏢 Customers
          </button>
          <button onClick={() => setActiveTab('analytics')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'analytics' ? '#16a34a' : '#fff', color: activeTab === 'analytics' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            📊 Analytics
          </button>
          <button onClick={() => setActiveTab('audit')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'audit' ? '#0f1f38' : '#fff', color: activeTab === 'audit' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            📜 Audit Log
          </button>
        </div>

        {/* EXPENSE ANALYTICS TAB */}
        {activeTab === 'expenses' && !loading && !error && (
          <ExpenseAnalytics submissions={submissions} />
        )}

        {/* PARTS CATALOG TAB */}
        {activeTab === 'parts' && !loading && !error && (
          <PartsCatalogAdmin />
        )}

        {/* LIVE PRESENCE TAB */}
        {activeTab === 'live' && (
          <>
            <TechMap />
            <LivePresence />
          </>
        )}

        {/* SETTINGS TAB */}
        {activeTab === "settings" && <SettingsAdmin />}

        {/* BRANDING TAB */}
        {activeTab === "branding" && <BrandingAdmin />}

        {/* PDF LAYOUT TAB */}
        {activeTab === 'pdf-layout' && <PdfLayoutAdmin />}
        {/* USERS TAB */}
        {activeTab === "users" && <UsersAdmin />}


        {/* ANALYTICS TAB */}
        {activeTab === 'billing' && <BillingAdmin submissions={submissions} />}

        {activeTab === 'monthly-expenses' && <MonthlyExpensesAdmin />}

        {activeTab === 'customers' && <CustomersAdmin submissions={submissions} />}

        {activeTab === 'analytics' && <AnalyticsAdmin submissions={submissions} />}

        {/* AUDIT LOG TAB */}
        {activeTab === 'audit' && <AuditLogAdmin />}

        {/* ASSIGN JOB TAB */}
        {activeTab === 'assign' && <AssignJobAdmin />}

        {activeTab === 'pm-schedule' && <PmScheduleAdmin />}

        {activeTab === 'dispatches' && <DispatchesAdmin />}
        {/* SUBMISSIONS TAB */}
        {activeTab === 'submissions' && (
          <>
            {/* STAT CARDS */}
            {loading && !error && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                {Array.from({ length: isDemo ? 6 : 9 }).map((_, i) => (
                  <div key={i} style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', flex: '1 1 130px', minWidth: 130 }}>
                    <div className="shimmer" style={{ height: 11, width: '62%' }}></div>
                    <div className="shimmer" style={{ height: 22, width: '44%', marginTop: 9 }}></div>
                  </div>
                ))}
              </div>
            )}
            {!loading && !error && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                {statCard('Total Jobs', filtered.length)}
                {!isDemo && statCard('Revenue (This Month)', fmt(monthRevenue), '#16a34a')}
                {!isDemo && statCard('Expenses (This Month)', fmt(monthExpenses), '#dc2626')}
                {!isDemo && statCard('Net Profit (This Month)', fmt(monthNetProfit), monthNetProfit >= 0 ? '#2563eb' : '#dc2626')}
                {statCard('PMs', pmCount, '#e65c00')}
                {statCard('Service Calls', scCount, '#2563eb')}
                {statCard('Exp Reports', expCount, '#7c3aed')}
                {statCard('Inspections', inspCount, '#0891b2')}
                {statCard('Warranty', warrantyCount, '#888')}
              </div>
            )}

            {/* TECH PERFORMANCE */}
            {allTechTotals.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 10, padding: '12px 14px', marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#333', marginBottom: 8 }}>&#128203; Tech Performance</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                        <th style={{ padding: '6px 10px', fontWeight: 600, color: '#555' }}>Tech</th>
                        <th style={{ padding: '6px 10px', fontWeight: 600, color: '#555', textAlign: 'right' }}>WOs</th>
                        <th style={{ padding: '6px 10px', fontWeight: 600, color: '#555', textAlign: 'right' }}>Hours</th>
                        {!isDemo && <th style={{ padding: '6px 10px', fontWeight: 600, color: '#555', textAlign: 'right' }}>Revenue</th>}
                        {!isDemo && <th style={{ padding: '6px 10px', fontWeight: 600, color: '#555', textAlign: 'right' }}>% of Total</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {allTechTotals.map(([tech, d], idx) => (
                        <tr key={tech} style={{ borderTop: '1px solid #eee', background: idx === 0 ? '#fffbf0' : 'transparent' }}>
                          <td style={{ padding: '6px 10px', fontWeight: idx === 0 ? 700 : 400 }}>
                            {idx === 0 && <span style={{ color: '#f59e0b', marginRight: 4 }}>&#127942;</span>}{tech}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>{d.woCount}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>{d.laborHours.toFixed(1)}h</td>
                          {!isDemo && <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>{fmt(d.total)}</td>}
                          {!isDemo && <td style={{ padding: '6px 10px', textAlign: 'right', color: '#888' }}>
                            {totalRevenue > 0 ? Math.round((d.total / totalRevenue) * 100) + '%' : '—'}
                          </td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* FILTERS */}
            <div style={{ background: '#fff', borderRadius: 10, padding: '10px 12px', marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                <input type="search" placeholder="Search customer, location, PM#, tech, date..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 180, border: '1px solid #ddd', borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }} />
                <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '8px 8px', fontSize: 13, background: '#fff', cursor: 'pointer' }}>
                  <option value="ALL">All Types</option>
                  <option value="PM">PM Only</option>
                  <option value="SC">SC Only</option>
                  <option value="EXP">Expenses</option>
                  <option value="INSP">Inspections</option>
                <option value="JHA">JHA / JSA</option>
                </select>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '8px 8px', fontSize: 13, background: '#fff', cursor: 'pointer' }}>
                  <option value="ALL">All Status</option>
                  <option value="submitted">Submitted</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="invoiced">Invoiced</option>
                  <option value="draft">Draft</option>
                </select>
                {allTechs.length > 0 && (
                  <select value={filterTech} onChange={e => setFilterTech(e.target.value)} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '8px 8px', fontSize: 13, background: '#fff', cursor: 'pointer' }}>
                    <option value="ALL">All Techs</option>
                    {allTechs.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontSize: 12, color: '#666', fontWeight: 600, whiteSpace: 'nowrap' }}>Date from</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '6px 8px', fontSize: 13 }} />
                <label style={{ fontSize: 12, color: '#666', fontWeight: 600, whiteSpace: 'nowrap' }}>to</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '6px 8px', fontSize: 13 }} />
                {hasFilters && <button onClick={clearFilters} style={{ color: '#e65c00', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', whiteSpace: 'nowrap' }}>Clear all</button>}
                <button
                  onClick={() => downloadSubmissionsCSV(filtered)}
                  disabled={!filtered || filtered.length === 0}
                  title={hasFilters ? 'Export the filtered submissions to CSV' : 'Export all submissions to CSV'}
                  style={{ marginLeft: 'auto', background: filtered && filtered.length > 0 ? '#16a34a' : '#9ca3af', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: filtered && filtered.length > 0 ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  📥 Export CSV{hasFilters ? ' (filtered)' : ''} <span style={{ opacity: 0.8, fontSize: 11, fontWeight: 600 }}>{filtered ? filtered.length : 0}</span>
                </button>
              </div>
            </div>

            {!loading && !error && (
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8, paddingLeft: 4 }}>
                {filtered.length === submissions.length ? submissions.length + ' submissions' : filtered.length + ' of ' + submissions.length + ' submissions'}
                <span title={realtimeStatus === 'live' ? 'New submissions appear automatically' : 'Auto-refresh unavailable — reload to see latest'} style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: realtimeStatus === 'live' ? '#16a34a' : '#9ca3af' }}>
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: realtimeStatus === 'live' ? '#16a34a' : '#9ca3af', boxShadow: realtimeStatus === 'live' ? '0 0 0 2px rgba(22,163,74,0.25)' : 'none' }}></span>
                  {realtimeStatus === 'live' ? 'LIVE' : realtimeStatus === 'connecting' ? 'CONNECTING…' : 'OFFLINE'}
                </span>
              </div>
            )}

            {loading && (
              <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '32px 70px 1fr 1fr 90px 80px 90px 90px 100px', gap: 12, padding: '12px 14px', borderTop: i === 0 ? 'none' : '1px solid #f1f5f9', alignItems: 'center' }}>
                    <div className="shimmer" style={{ height: 14, width: 14, borderRadius: 3 }}></div>
                    <div className="shimmer" style={{ height: 12, width: '70%' }}></div>
                    <div className="shimmer" style={{ height: 12, width: '85%' }}></div>
                    <div className="shimmer" style={{ height: 12, width: '60%' }}></div>
                    <div className="shimmer" style={{ height: 12, width: '70%' }}></div>
                    <div className="shimmer" style={{ height: 12, width: '50%' }}></div>
                    <div className="shimmer" style={{ height: 12, width: '60%' }}></div>
                    <div className="shimmer" style={{ height: 12, width: '70%' }}></div>
                    <div className="shimmer" style={{ height: 18, width: '80%', borderRadius: 999 }}></div>
                  </div>
                ))}
              </div>
            )}
            {error && <p style={{ textAlign: 'center', color: '#e65c00', marginTop: 40 }}>Error: {error}</p>}
            {!loading && !error && filtered.length === 0 && (
              <div style={{ textAlign: 'center', marginTop: 60, color: '#aaa' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                <p style={{ fontSize: 15 }}>No results found.</p>
              </div>
            )}

            {/* BULK ACTION BAR */}
            {!isDemo && selectedIds.size > 0 && (
              <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0f1f38', color: '#fff', padding: '10px 14px', borderRadius: 10, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                <span style={{ fontWeight: 800, fontSize: 13 }}>{selectedIds.size} selected</span>
                <span style={{ flex: 1 }} />
                <button onClick={() => bulkUpdateStatus('submitted')} disabled={bulkBusy} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: bulkBusy ? 'not-allowed' : 'pointer', opacity: bulkBusy ? 0.6 : 1 }}>Submitted</button>
                <button onClick={() => bulkUpdateStatus('reviewed')} disabled={bulkBusy} style={{ background: '#d97706', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: bulkBusy ? 'not-allowed' : 'pointer', opacity: bulkBusy ? 0.6 : 1 }}>Reviewed</button>
                <button onClick={() => bulkUpdateStatus('invoiced')} disabled={bulkBusy} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: bulkBusy ? 'not-allowed' : 'pointer', opacity: bulkBusy ? 0.6 : 1 }}>Invoiced</button>
                <span style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.2)' }} />
                <button onClick={bulkDeleteSelected} disabled={bulkBusy} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: bulkBusy ? 'not-allowed' : 'pointer', opacity: bulkBusy ? 0.6 : 1 }}>🗑 Delete</button>
                <button onClick={clearSelection} disabled={bulkBusy} style={{ background: 'transparent', color: '#aaa', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Clear</button>
                {bulkBusy && <span style={{ fontSize: 12, color: '#fcd34d', fontWeight: 700 }}>Working…</span>}
              </div>
            )}

            {/* TABLE */}
            {!loading && !error && filtered.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflowX: 'auto', overflowY: 'visible' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '32px 70px 1fr 1fr 90px 80px 90px 90px 100px', gap: 0, background: '#1a2332', color: '#aaa', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 14px', alignItems: 'center', minWidth: 720 }}>
                  <div>
                    {!isDemo && (
                      <input
                        type="checkbox"
                        title={filtered.every(s => selectedIds.has(s.id)) ? 'Deselect all visible' : 'Select all visible'}
                        checked={filtered.length > 0 && filtered.every(s => selectedIds.has(s.id))}
                        onChange={() => setSelectedIds(prev => {
                          const next = new Set(prev)
                          const allSel = filtered.every(s => next.has(s.id))
                          if (allSel) { for (const s of filtered) next.delete(s.id) }
                          else { for (const s of filtered) next.add(s.id) }
                          return next
                        })}
                        style={{ width: 14, height: 14, cursor: 'pointer' }}
                      />
                    )}
                  </div>
                  <div>Type</div><div>Name / Location</div><div>Techs</div><div>Date</div><div>Status</div><div>By</div><div style={{ textAlign: 'right' }}>Total</div><div style={{ textAlign: 'center' }}>Actions</div>
                </div>
                {filtered.map((s, i) => {
                  const lbl = getTypeLabel(s)
                  const color = getTypeColor(s)
                  const techs = (Array.isArray(s.data?.techs) ? s.data.techs : []).map(canonicalTech)
                  const isWarranty = s.data?.warrantyWork
                  const rawSubmittedBy = s.profiles?.full_name || (Array.isArray(s.data?.techs) && s.data.techs[0]) || ''
                  const submittedBy = canonicalTech(rawSubmittedBy) || '-'
                  const isBeingDeleted = deleting === s.id
                  let displayTotal
                  if (lbl === 'EXP') { displayTotal = fmt(s.data?.expenseTotal || 0) }
                  else if (lbl === 'INSP') { const fails = s.data?.failCount || 0; displayTotal = fails === 0 ? '✓ Pass' : '⚠️ ' + fails + ' Fail' }
                  else { displayTotal = isWarranty ? 'WARRANTY' : fmt(s.data?.grandTotal || 0) }
                  const totalColor = lbl === 'INSP' ? (s.data?.failCount > 0 ? '#dc2626' : '#16a34a') : (isWarranty ? '#888' : '#1a2332')
                  const displayName = lbl === 'EXP' || lbl === 'INSP' ? (techs[0] || s.location_name || '-') : (s.customer_name || '-')
                  const displaySub = lbl === 'EXP' ? 'Expense Report' : lbl === 'INSP' ? (s.data?.inspectionType || 'Inspection') + ' — Truck ' + (s.truck_number || '?') : (s.location_name || '')
                  return (
                    <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '32px 70px 1fr 1fr 90px 80px 90px 90px 100px', gap: 0, padding: '8px 14px', borderBottom: '1px solid #f0f0f0', background: selectedIds.has(s.id) ? '#eff6ff' : (isBeingDeleted ? '#fff5f5' : (i % 2 === 0 ? '#fff' : '#fafafa')), alignItems: 'center', borderLeft: '3px solid ' + color, minWidth: 720 }}>
                      <div onClick={e => e.stopPropagation()}>
                        {!isDemo && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(s.id)}
                            onChange={() => toggleSelect(s.id)}
                            style={{ width: 14, height: 14, cursor: 'pointer' }}
                          />
                        )}
                      </div>
                      <div style={{ cursor: 'pointer' }} onClick={() => navigate('/view/' + s.id)}>
                        <span style={{ background: color, color: '#fff', fontWeight: 700, fontSize: 10, padding: '2px 6px', borderRadius: 4, display: 'inline-block' }}>
                          {lbl}{s.pm_number && lbl !== 'EXP' && lbl !== 'INSP' ? ' #' + s.pm_number : ''}
                        </span>
                      </div>
                      <div style={{ cursor: 'pointer' }} onClick={() => navigate('/view/' + s.id)}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#1a2332' }}>{displayName}</div>
                        <div style={{ fontSize: 12, color: '#777' }}>{displaySub}</div>
                      </div>
                      <div style={{ fontSize: 12, color: '#555', cursor: 'pointer' }} onClick={() => navigate('/view/' + s.id)}>{techs.join(', ') || '—'}</div>
                      <div style={{ fontSize: 12, color: '#555', cursor: 'pointer' }} onClick={() => navigate('/view/' + s.id)}>{s.date || '—'}</div>
                      <div onClick={e => e.stopPropagation()}>
                        <select value={s.status || 'submitted'} onChange={e => handleStatusChange(s.id, e.target.value)} style={{ fontSize: 11, padding: '2px 4px', borderRadius: 5, fontWeight: 700, cursor: 'pointer', outline: 'none', border: '1.5px solid ' + ((s.status === 'submitted' || !s.status) ? '#16a34a' : s.status === 'reviewed' ? '#d97706' : '#7c3aed'), background: (s.status === 'submitted' || !s.status) ? '#dcfce7' : s.status === 'reviewed' ? '#fef3c7' : '#f5f3ff', color: (s.status === 'submitted' || !s.status) ? '#16a34a' : s.status === 'reviewed' ? '#92400e' : '#5b21b6' }}>
                          <option value="submitted">Submitted</option>
                          <option value="reviewed">Reviewed</option>
                          <option value="invoiced">Invoiced</option>
                        </select>
                      </div>
                      <div style={{ fontSize: 12, color: '#555' }}>{submittedBy}</div>
                      <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, color: totalColor, cursor: 'pointer' }} onClick={() => navigate('/view/' + s.id)}>{isDemo && lbl !== 'INSP' ? '—' : displayTotal}</div>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
                        {(lbl === 'PM' || lbl === 'SC') && (
                          <button onClick={() => navigate('/edit/' + s.id)} title="Edit submission" style={{ background: '#f0f7ff', border: '1px solid #93c5fd', color: '#2563eb', borderRadius: 5, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>✏️ Edit</button>
                        )}
                        {!isDemo && (
                          <button onClick={() => handleShare(s)} title={s.share_token ? 'Copy existing share link' : 'Generate share link for customer'} style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#16a34a', borderRadius: 5, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>🔗</button>
                        )}
                        {!isDemo && (
                          <button onClick={() => setDispatchSub(s)} title="Start a customer-tracking dispatch (email step is separate — use 🔗 Share on the Dispatches tab)" style={{ background: '#fff7ed', border: '1px solid #fdba74', color: '#ea580c', borderRadius: 5, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>📍</button>
                        )}
                        {!isDemo && <button onClick={() => handleDelete(s)} disabled={isBeingDeleted} title="Delete submission" style={{ background: '#fff5f5', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 5, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: isBeingDeleted ? 'not-allowed' : 'pointer' }}>
                          {isBeingDeleted ? '...' : '🗑 Del'}
                        </button>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
      {dispatchSub && (
        <StartDispatchDialog
          submission={dispatchSub}
          techName={
            (Array.isArray(dispatchSub.data?.techs) && dispatchSub.data.techs[0]) ||
            dispatchSub.profiles?.full_name ||
            null
          }
          onClose={() => setDispatchSub(null)}
          onSent={({ token }) => {
            logAudit({
              userId: user?.id,
              userName: profile?.full_name || user?.email,
              action: 'dispatch_started',
              targetType: 'submission',
              targetId: dispatchSub.id,
              details: { pm_number: dispatchSub.pm_number, customer_name: dispatchSub.customer_name, share_token: token },
            })
          }}
        />
      )}
    </div>
  )
}
