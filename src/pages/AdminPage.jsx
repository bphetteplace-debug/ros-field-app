import { useState, useEffect } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { fetchAllSubmissions, updateSubmissionStatus, deleteSubmission } from '../lib/submissions'

export default function AdminPage() {
  const { isAdmin, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('ALL')
  const [filterTech, setFilterTech] = useState('ALL')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [deleting, setDeleting] = useState(null) // id being deleted

  const handleStatusChange = async (id, newStatus) => {
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s))
    try { await updateSubmissionStatus(id, newStatus) } catch(e) { console.error('Status update failed:', e) }
  }

  const handleDelete = async (s) => {
    const label = (s.template === 'pm_flare_combustor' ? 'PM' : 'SC') + (s.pm_number ? ' #' + s.pm_number : '') + ' — ' + (s.customer_name || '')
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
    const matchesType = filterType === 'ALL' || s.template === filterType ||
      (filterType === 'PM' && s.template === 'pm_flare_combustor') ||
      (filterType === 'SC' && s.template === 'service_call')
    const matchesStatus = filterStatus === 'ALL' || s.status === filterStatus
    const techList = Array.isArray(s.data?.techs) ? s.data.techs : []
    const matchesTech = filterTech === 'ALL' || techList.includes(filterTech)
    const matchesDate = (!dateFrom || s.date >= dateFrom) && (!dateTo || s.date <= dateTo)
    if (!matchesType || !matchesStatus || !matchesTech || !matchesDate) return false
    if (!q) return true
    const haystack = [
      s.customer_name, s.location_name, s.date, s.truck_number,
      s.pm_number ? String(s.pm_number) : '',
      s.summary, s.profiles?.full_name, s.work_type,
      ...(Array.isArray(s.data?.techs) ? s.data.techs : [])
    ].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(q)
  })

  const totalRevenue = filtered.reduce((sum, s) => sum + parseFloat(s.data?.grandTotal || 0), 0)
  const warrantyCount = filtered.filter(s => s.data?.warrantyWork).length
  const pmCount = filtered.filter(s => s.template === 'pm_flare_combustor').length
  const scCount = filtered.filter(s => s.template === 'service_call').length

  const navBar = { background: '#1a2332', padding: '0 16px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }

  const statCard = (label, value, color) => (
    <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || '#1a2332', marginTop: 4 }}>{value}</div>
    </div>
  )

  const getTypeLabel = (s) => {
    if (s.template === 'pm_flare_combustor') return 'PM'
    if (s.template === 'service_call') return 'SC'
    return s.template || '?'
  }
  const getTypeColor = (s) => s.template === 'pm_flare_combustor' ? '#e65c00' : '#2563eb'

  const hasFilters = search || filterType !== 'ALL' || filterStatus !== 'ALL' || filterTech !== 'ALL' || dateFrom || dateTo
  const clearFilters = () => { setSearch(''); setFilterType('ALL'); setFilterStatus('ALL'); setFilterTech('ALL'); setDateFrom(''); setDateTo('') }

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', fontFamily: 'system-ui,sans-serif' }}>
      {/* NAV */}
      <div style={navBar}>
        <span style={{ color: '#e65c00', fontWeight: 700, fontSize: 16 }}>🛡 Admin — All Submissions</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link to="/settings" style={{ color: '#aaa', fontSize: 13, textDecoration: 'none' }}>⚙ Settings</Link>
          <Link to="/submissions" style={{ color: '#aaa', fontSize: 13, textDecoration: 'none' }}>← My Submissions</Link>
        </div>
      </div>

      <div style={{ maxWidth: 980, margin: '0 auto', padding: '12px 12px 80px' }}>
        {/* STAT CARDS */}
        {!loading && !error && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            {statCard('Total Jobs', filtered.length)}
            {statCard('Revenue', fmt(totalRevenue), '#16a34a')}
            {statCard('PMs', pmCount, '#e65c00')}
            {statCard('Service Calls', scCount, '#2563eb')}
            {statCard('Warranty', warrantyCount, '#888')}
          </div>
        )}

        {/* FILTERS */}
        <div style={{ background: '#fff', borderRadius: 10, padding: '10px 12px', marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <input type="search" placeholder="Search customer, location, PM#, tech, date..."
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180, border: '1px solid #ddd', borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }} />
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              style={{ border: '1px solid #ddd', borderRadius: 6, padding: '8px 8px', fontSize: 13, background: '#fff', cursor: 'pointer' }}>
              <option value="ALL">All Types</option>
              <option value="PM">PM Only</option>
              <option value="SC">SC Only</option>
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ border: '1px solid #ddd', borderRadius: 6, padding: '8px 8px', fontSize: 13, background: '#fff', cursor: 'pointer' }}>
              <option value="ALL">All Status</option>
              <option value="submitted">Submitted</option>
              <option value="reviewed">Reviewed</option>
              <option value="invoiced">Invoiced</option>
              <option value="draft">Draft</option>
            </select>
            {allTechs.length > 0 && (
              <select value={filterTech} onChange={e => setFilterTech(e.target.value)}
                style={{ border: '1px solid #ddd', borderRadius: 6, padding: '8px 8px', fontSize: 13, background: '#fff', cursor: 'pointer' }}>
                <option value="ALL">All Techs</option>
                {allTechs.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 600, whiteSpace: 'nowrap' }}>Date from</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ border: '1px solid #ddd', borderRadius: 6, padding: '6px 8px', fontSize: 13 }} />
            <label style={{ fontSize: 12, color: '#666', fontWeight: 600, whiteSpace: 'nowrap' }}>to</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ border: '1px solid #ddd', borderRadius: 6, padding: '6px 8px', fontSize: 13 }} />
            {hasFilters && (
              <button onClick={clearFilters}
                style={{ color: '#e65c00', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', whiteSpace: 'nowrap' }}>
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* RESULT COUNT */}
        {!loading && !error && (
          <div style={{ fontSize: 12, color: '#888', marginBottom: 8, paddingLeft: 4 }}>
            {filtered.length === submissions.length
              ? submissions.length + ' submissions'
              : filtered.length + ' of ' + submissions.length + ' submissions'}
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
            <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 90px 80px 90px 90px 100px', gap: 0, background: '#1a2332', color: '#aaa', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 14px' }}>
              <div>Type</div>
              <div>Customer / Location</div>
              <div>Techs</div>
              <div>Date</div>
              <div>Status</div>
              <div>By</div>
              <div style={{ textAlign: 'right' }}>Total</div>
              <div style={{ textAlign: 'center' }}>Actions</div>
            </div>
            {filtered.map((s, i) => {
              const techs = Array.isArray(s.data?.techs) ? s.data.techs : []
              const grandTotal = s.data?.grandTotal || 0
              const isWarranty = s.data?.warrantyWork
              const submittedBy = s.profiles?.full_name || (Array.isArray(s.data?.techs) && s.data.techs[0]) || '-'
              const isBeingDeleted = deleting === s.id
              return (
                <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 90px 80px 90px 90px 100px', gap: 0, padding: '8px 14px', borderBottom: '1px solid #f0f0f0', background: isBeingDeleted ? '#fff5f5' : (i % 2 === 0 ? '#fff' : '#fafafa'), alignItems: 'center', borderLeft: '3px solid ' + getTypeColor(s) }}>
                  {/* Type */}
                  <div style={{ cursor: 'pointer' }} onClick={() => navigate('/view/' + s.id)}>
                    <span style={{ background: getTypeColor(s), color: '#fff', fontWeight: 700, fontSize: 11, padding: '2px 7px', borderRadius: 4 }}>
                      {getTypeLabel(s)}{s.pm_number ? ' #' + s.pm_number : ''}
                    </span>
                  </div>
                  {/* Customer */}
                  <div style={{ cursor: 'pointer' }} onClick={() => navigate('/view/' + s.id)}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#1a2332' }}>{s.customer_name || '—'}</div>
                    <div style={{ fontSize: 12, color: '#777' }}>{s.location_name || ''}</div>
                  </div>
                  {/* Techs */}
                  <div style={{ fontSize: 12, color: '#555', cursor: 'pointer' }} onClick={() => navigate('/view/' + s.id)}>{techs.join(', ') || '—'}</div>
                  {/* Date */}
                  <div style={{ fontSize: 12, color: '#555', cursor: 'pointer' }} onClick={() => navigate('/view/' + s.id)}>{s.date || '—'}</div>
                  {/* Status */}
                  <div onClick={e => e.stopPropagation()}>
                    <select value={s.status || 'submitted'} onChange={e => handleStatusChange(s.id, e.target.value)}
                      style={{ fontSize: 11, padding: '2px 4px', borderRadius: 5, fontWeight: 700, cursor: 'pointer', outline: 'none',
                        border: '1.5px solid ' + ((s.status === 'submitted' || !s.status) ? '#16a34a' : s.status === 'reviewed' ? '#d97706' : '#7c3aed'),
                        background: (s.status === 'submitted' || !s.status) ? '#dcfce7' : s.status === 'reviewed' ? '#fef3c7' : '#f5f3ff',
                        color: (s.status === 'submitted' || !s.status) ? '#16a34a' : s.status === 'reviewed' ? '#92400e' : '#5b21b6',
                      }}>
                      <option value="submitted">Submitted</option>
                      <option value="reviewed">Reviewed</option>
                      <option value="invoiced">Invoiced</option>
                    </select>
                  </div>
                  {/* By */}
                  <div style={{ fontSize: 12, color: '#555' }}>{submittedBy}</div>
                  {/* Total */}
                  <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, color: isWarranty ? '#888' : '#1a2332', cursor: 'pointer' }} onClick={() => navigate('/view/' + s.id)}>
                    {isWarranty ? 'WARRANTY' : fmt(grandTotal)}
                  </div>
                  {/* Actions — Edit + Delete */}
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => navigate('/edit/' + s.id)}
                      title="Edit submission"
                      style={{ background: '#f0f7ff', border: '1px solid #93c5fd', color: '#2563eb', borderRadius: 5, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => handleDelete(s)}
                      disabled={isBeingDeleted}
                      title="Delete submission"
                      style={{ background: '#fff5f5', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 5, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: isBeingDeleted ? 'not-allowed' : 'pointer' }}>
                      {isBeingDeleted ? '...' : '🗑 Del'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
