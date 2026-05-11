import { useState, useEffect, useCallback } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import NavBar from '../components/NavBar'
import { fetchAllSubmissions, updateSubmissionStatus, deleteSubmission, fetchPartsCatalog, addPart, deletePart, updatePart } from '../lib/submissions'

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
// ── PARTS CATALOG ADMIN ───────────────────────────────────────────────
function PartsCatalogAdmin() {
  const { isDemo } = useAuth()
  const [parts, setParts] = useState([])
  const [loadingParts, setLoadingParts] = useState(true)
  const [partsSearch, setPartsSearch] = useState('')
  const [form, setForm] = useState({ code: '', description: '', price: '', category: '' })
  const [saving, setSaving] = useState(false)
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
    setSaving(true)
    try { await addPart(form); setForm({ code: '', description: '', price: '', category: '' }); loadParts() }
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
  const { user, isAdmin, isDemo, loading: authLoading, logout } = useAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const handleLogout = useCallback(async () => {
    setLoggingOut(true)
    try { await logout() } catch(e) {}
    setLoggingOut(false)
  }, [logout])
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
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button onClick={() => setActiveTab('submissions')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'submissions' ? '#1a2332' : '#fff', color: activeTab === 'submissions' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            📋 Submissions
          </button>
          <button onClick={() => setActiveTab('expenses')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'expenses' ? '#7c3aed' : '#fff', color: activeTab === 'expenses' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            💜 Expense Analytics
          </button>
          <button onClick={() => setActiveTab('parts')} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: activeTab === 'parts' ? '#0891b2' : '#fff', color: activeTab === 'parts' ? '#fff' : '#555', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            🔧 Parts Catalog
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
