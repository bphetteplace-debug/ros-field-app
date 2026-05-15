import { useState, useEffect, useCallback } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import NavBar from '../components/NavBar'
import { fetchAllSubmissions, updateSubmissionStatus, deleteSubmission, fetchPartsCatalog, addPart, deletePart, updatePart, fetchSettings, saveSettings, getAuthToken } from '../lib/submissions'
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

  // Group by tech
  const byTech = {}
  for (const s of filtered) {
    const tech = (Array.isArray(s.data?.techs) && s.data.techs[0]) || s.location_name || s.profiles?.full_name || 'Unknown'
    if (!byTech[tech]) byTech[tech] = { total: 0, count: 0, woCount: 0, laborHours: 0, items: [] }
    const lbl2 = getTypeLabel(s)
    const rev = (lbl2 === 'EXP' || lbl2 === 'INSP') ? 0 : parseFloat(s.data?.grandTotal || 0)
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
      const tokenKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      let token = null
      try { token = tokenKey ? JSON.parse(localStorage.getItem(tokenKey))?.access_token : null } catch { token = null }
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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
      alert('Error updating role: ' + e.message)
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
  const totalRevenue = isDemo ? null : subs.reduce((sum, s) => sum + (parseFloat(s.total_revenue) || 0), 0)

  const techMap = {}
  subs.forEach(s => {
    const t = s.technician || s.tech || 'Unknown'
    if (!techMap[t]) techMap[t] = 0
    techMap[t]++
  })
  const topTechs = Object.entries(techMap).sort((a, b) => b[1] - a[1]).slice(0, 5)

  const custMap = {}
  subs.forEach(s => {
    const c = s.customer || 'Unknown'
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#1a2332', marginBottom: 12 }}>🏆 Most Active Technicians</div>
          {topTechs.length === 0 ? <div style={{ color: '#aaa', fontSize: 13 }}>No data</div> : topTechs.map(([name, count], i) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < topTechs.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
              <span style={{ fontSize: 13, color: '#333' }}>{i + 1}. {name}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#0891b2' }}>{count} jobs</span>
            </div>
          ))}
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#1a2332', marginBottom: 12 }}>🏢 Top Customers by Jobs</div>
          {topCusts.length === 0 ? <div style={{ color: '#aaa', fontSize: 13 }}>No data</div> : topCusts.map(([name, count], i) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < topCusts.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
              <span style={{ fontSize: 13, color: '#333' }}>{i + 1}. {name}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#f97316' }}>{count} jobs</span>
            </div>
          ))}
        </div>
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

  const loadParts = () => {
    setLoadingParts(true)
    fetchPartsCatalog().then(p => { setParts(p); setLoadingParts(false) })
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
  const { user, isAdmin, isDemo, loading: authLoading, signOut } = useAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const handleLogout = useCallback(async () => {
    setLoggingOut(true)
    try { await signOut() } catch(e) {}
    setLoggingOut(false)
  }, [signOut])
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('ALL')
  const [filterTech, setFilterTech] = useState('ALL')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [activeTab, setActiveTab] = useState('submissions') // 'submissions' | 'expenses' | 'parts'

  const handleStatusChange = async (id, newStatus) => {
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s))
    try { await updateSubmissionStatus(id, newStatus) } catch(e) { console.error('Status update failed:', e) }
  }

  const handleDelete = async (s) => {
    const lbl = getTypeLabel(s)
    const label = lbl + (s.pm_number ? ' #' + s.pm_number : '') + ' — ' + (s.customer_name || s.location_name || '')
    if (!window.confirm('Permanently delete ' + label + '?\nThis cannot be undone.')) return
    setDeleting(s.id)
    try {
      await deleteSubmission(s.id)
      setSubmissions(prev => prev.filter(x => x.id !== s.id))
    } catch(e) {
      alert('Delete failed: ' + e.message)
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

  // Revenue: PM/SC only (excludes expenses). Filtered list respects user search/filter.
  const totalRevenue = filtered.reduce((sum, s) => {
    const lbl = getTypeLabel(s)
    if (lbl === 'EXP' || lbl === 'INSP') return sum
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
    return sum + parseFloat(s.data?.grandTotal || 0)
  }, 0)
  const monthExpenses = thisMonthSubs.reduce((sum, s) => {
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
    <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || '#1a2332', marginTop: 4 }}>{value}</div>
    </div>
  )
  const hasFilters = search || filterType !== 'ALL' || filterStatus !== 'ALL' || filterTech !== 'ALL' || dateFrom || dateTo
  const clearFilters = () => { setSearch(''); setFilterType('ALL'); setFilterStatus('ALL'); setFilterTech('ALL'); setDateFrom(''); setDateTo('') }
  // Tech performance (all submissions)
  const byTech = {}
  for (const s of submissions) {
    const tech = (Array.isArray(s.data?.techs) && s.data.techs[0]) || s.location_name || s.profiles?.full_name || 'Unknown'
    if (!byTech[tech]) byTech[tech] = { total: 0, count: 0, woCount: 0, laborHours: 0, items: [] }
    const lbl2 = getTypeLabel(s)
    const rev = lbl2 === 'EXP' ? parseFloat(s.data?.expenseTotal || 0) : parseFloat(s.data?.grandTotal || 0)
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
          <button onClick={() => setActiveTab('submissions')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'submissions' ? '#1a2332' : '#fff', color: activeTab === 'submissions' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            📋 Submissions
          </button>
          <button onClick={() => setActiveTab('expenses')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'expenses' ? '#7c3aed' : '#fff', color: activeTab === 'expenses' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            💜 Expense Analytics
          </button>
          <button onClick={() => setActiveTab('parts')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'parts' ? '#0891b2' : '#fff', color: activeTab === 'parts' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            🔧 Parts Catalog
          </button>
          <button onClick={() => setActiveTab('live')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'live' ? '#16a34a' : '#fff', color: activeTab === 'live' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: activeTab === 'live' ? '#fff' : '#16a34a', boxShadow: '0 0 0 2px #16a34a' }}></span> Live
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
          <button onClick={() => setActiveTab('analytics')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'analytics' ? '#16a34a' : '#fff', color: activeTab === 'analytics' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            📊 Analytics
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
          <LivePresence />
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
        {activeTab === 'analytics' && <AnalyticsAdmin submissions={submissions} />}
        {/* SUBMISSIONS TAB */}
        {activeTab === 'submissions' && (
          <>
            {/* STAT CARDS */}
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
              </div>
            </div>

            {!loading && !error && (
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8, paddingLeft: 4 }}>
                {filtered.length === submissions.length ? submissions.length + ' submissions' : filtered.length + ' of ' + submissions.length + ' submissions'}
              </div>
            )}

            {loading && <p style={{ textAlign: 'center', color: '#888', marginTop: 40 }}>Loading all submissions...</p>}
            {error && <p style={{ textAlign: 'center', color: '#e65c00', marginTop: 40 }}>Error: {error}</p>}
            {!loading && !error && filtered.length === 0 && (
              <div style={{ textAlign: 'center', marginTop: 60, color: '#aaa' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                <p style={{ fontSize: 15 }}>No results found.</p>
              </div>
            )}

            {/* TABLE */}
            {!loading && !error && filtered.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr 90px 80px 90px 90px 100px', gap: 0, background: '#1a2332', color: '#aaa', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 14px' }}>
                  <div>Type</div><div>Name / Location</div><div>Techs</div><div>Date</div><div>Status</div><div>By</div><div style={{ textAlign: 'right' }}>Total</div><div style={{ textAlign: 'center' }}>Actions</div>
                </div>
                {filtered.map((s, i) => {
                  const lbl = getTypeLabel(s)
                  const color = getTypeColor(s)
                  const techs = Array.isArray(s.data?.techs) ? s.data.techs : []
                  const isWarranty = s.data?.warrantyWork
                  const submittedBy = s.profiles?.full_name || (Array.isArray(s.data?.techs) && s.data.techs[0]) || '-'
                  const isBeingDeleted = deleting === s.id
                  let displayTotal
                  if (lbl === 'EXP') { displayTotal = fmt(s.data?.expenseTotal || 0) }
                  else if (lbl === 'INSP') { const fails = s.data?.failCount || 0; displayTotal = fails === 0 ? '✓ Pass' : '⚠️ ' + fails + ' Fail' }
                  else { displayTotal = isWarranty ? 'WARRANTY' : fmt(s.data?.grandTotal || 0) }
                  const totalColor = lbl === 'INSP' ? (s.data?.failCount > 0 ? '#dc2626' : '#16a34a') : (isWarranty ? '#888' : '#1a2332')
                  const displayName = lbl === 'EXP' || lbl === 'INSP' ? (techs[0] || s.location_name || '-') : (s.customer_name || '-')
                  const displaySub = lbl === 'EXP' ? 'Expense Report' : lbl === 'INSP' ? (s.data?.inspectionType || 'Inspection') + ' — Truck ' + (s.truck_number || '?') : (s.location_name || '')
                  return (
                    <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr 90px 80px 90px 90px 100px', gap: 0, padding: '8px 14px', borderBottom: '1px solid #f0f0f0', background: isBeingDeleted ? '#fff5f5' : (i % 2 === 0 ? '#fff' : '#fafafa'), alignItems: 'center', borderLeft: '3px solid ' + color }}>
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
    </div>
  )
}
