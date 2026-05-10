import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import NavBar from '../components/NavBar'
import { fetchSubmissions } from '../lib/submissions'
import { getQueueCount, processOfflineQueue } from '../lib/offlineSync'

const PAGE_SIZE = 25

function getTypeLabel(s) {
  if (s.template === 'pm_flare_combustor') return 'PM'
  if (s.template === 'service_call') return 'SC'
  if (s.template === 'expense_report') return 'EXP'
  if (s.template === 'daily_inspection') return 'INSP'
  if (s.template === 'jha') return 'JHA'
  const jt = s.data?.jobType || s.job_type || ''
  if (jt === 'PM') return 'PM'
  if (jt === 'Service Call') return 'SC'
  if (jt === 'Expense Report') return 'EXP'
  if (jt === 'Daily Inspection') return 'INSP'
  if (jt === 'JHA/JSA') return 'JHA'
  return jt || '?'
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

export default function SubmissionsListPage() {
  const { user, signOut, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('ALL')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [queueCount, setQueueCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [page, setPage] = useState(1)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleSync = useCallback(async () => {
    if (syncing) return
    setSyncing(true); setSyncMsg('')
    try {
      const count = await processOfflineQueue(user?.id)
      setSyncMsg(count > 0 ? count + ' submission' + (count !== 1 ? 's' : '') + ' synced!' : 'All caught up!')
      setQueueCount(0)
      if (user) {
        const fresh = await fetchSubmissions(user.id); setSubmissions(fresh)
      }
    } catch(e) {
      setSyncMsg('Sync failed: ' + e.message)
    } finally {
      setSyncing(false); setTimeout(() => setSyncMsg(''), 4000)
    }
  }, [user, syncing])

  useEffect(() => {
    const updateQueue = async () => {
      try { setQueueCount(await getQueueCount()) } catch(e) {}
    }
    updateQueue()
    const onOnline = async () => {
      setIsOnline(true)
      const count = await getQueueCount()
      setQueueCount(count)
      if (count > 0) handleSync()
    }
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [handleSync])

  // Wire up SW Background Sync signal → trigger handleSync when back online
  useEffect(() => {
    const onSyncQueue = () => {
      if (navigator.onLine) handleSync()
    }
    window.addEventListener('ros-sync-queue', onSyncQueue)
    return () => window.removeEventListener('ros-sync-queue', onSyncQueue)
  }, [handleSync])

  useEffect(() => {
    if (!user) return
    fetchSubmissions(user.id)
      .then(setSubmissions)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [user])

  useEffect(() => { setPage(1) }, [search, filterType])

  const handleLogout = async () => {
    setLoggingOut(true)
    // Clear Supabase session (may fail silently on mobile — that's OK)
    try { await signOut() } catch(e) {}
    // Hard-clear all sb- auth tokens from localStorage
    try {
      Object.keys(localStorage).forEach(function(k) {
        if (k.startsWith('sb-') && (k.endsWith('-auth-token') || k.includes('-auth-'))) {
          localStorage.removeItem(k)
        }
      })
    } catch(e) {}
    // Hard redirect — forces full page reload, bypasses React Router on mobile
    window.location.replace('/login')
  }

  const filtered = submissions.filter(s => {
    const q = search.toLowerCase().trim()
    const lbl = getTypeLabel(s)
    const matchesType = filterType === 'ALL' || lbl === filterType
    if (!q) return matchesType
    const haystack = [
      s.customer_name, s.location_name, s.date, s.truck_number, lbl,
      s.pm_number ? String(s.pm_number) : '',
      s.summary, s.work_type,
      ...(Array.isArray(s.data?.techs) ? s.data.techs : [])
    ].filter(Boolean).join(' ').toLowerCase()
    return matchesType && haystack.includes(q)
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Shared button style for nav — solid tap targets
  const btnStyle = {
    padding: '8px 14px',
    borderRadius: 6,
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 700,
    lineHeight: '1',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
    minHeight: 36,
  }

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', fontFamily: 'system-ui,sans-serif' }}>
      {!isOnline && (
        <div style={{ background: '#dc2626', color: '#fff', padding: '8px 16px', fontSize: 13, fontWeight: 700, textAlign: 'center' }}>
          ⚡ Offline — forms save locally and sync when you reconnect.
          {queueCount > 0 && <span style={{ marginLeft: 8 }}>({queueCount} pending)</span>}
        </div>
      )}
      {isOnline && queueCount > 0 && (
        <div style={{ background: '#2563eb', color: '#fff', padding: '8px 16px', fontSize: 13, fontWeight: 700, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          📤 {queueCount} submission{queueCount !== 1 ? 's' : ''} pending sync
          <button onClick={handleSync} disabled={syncing} style={{ background: '#fff', color: '#2563eb', border: 'none', borderRadius: 4, padding: '2px 10px', fontSize: 12, fontWeight: 700, cursor: syncing ? 'not-allowed' : 'pointer' }}>
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      )}
      {syncMsg && (
        <div style={{ background: '#16a34a', color: '#fff', padding: '6px 16px', fontSize: 13, fontWeight: 700, textAlign: 'center' }}>{syncMsg}</div>
      )}
      {/* NAV — two rows so buttons never overflow on small screens */}
      <NavBar user={user} isAdmin={isAdmin} onLogout={handleLogout} loggingOut={loggingOut} />

      <div style={{ maxWidth: 700, margin: '0 auto', padding: '12px 12px 80px' }}>
        {/* SEARCH + FILTER */}
        <div style={{ background: '#fff', borderRadius: 10, padding: '10px 12px', marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="Search by customer, location, PM#, date, tech..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 160, border: '1px solid #ddd', borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }}
          />
          <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '8px 8px', fontSize: 13, background: '#fff', cursor: 'pointer' }}>
            <option value="ALL">All Types</option>
            <option value="PM">PM Only</option>
            <option value="SC">Service Calls</option>
            <option value="EXP">Expenses</option>
            <option value="INSP">Inspections</option>
            <option value="JHA">JHA / JSA</option>
          </select>
        </div>

        {!loading && !error && (
          <div style={{ fontSize: 12, color: '#888', marginBottom: 8, paddingLeft: 4 }}>
            {filtered.length === submissions.length
              ? submissions.length + ' submissions'
              : filtered.length + ' of ' + submissions.length + ' submissions'}
            {search && ' matching "' + search + '"'}
            {totalPages > 1 && ' — Page ' + page + ' of ' + totalPages}
          </div>
        )}

        {loading && <p style={{ textAlign: 'center', color: '#888', marginTop: 40 }}>Loading...</p>}
        {error && <p style={{ textAlign: 'center', color: '#e65c00', marginTop: 40 }}>Error: {error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 60, color: '#aaa' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <p style={{ fontSize: 15 }}>{search || filterType !== 'ALL' ? 'No results found.' : 'No submissions yet.'}</p>
            {(search || filterType !== 'ALL') && (
              <button onClick={() => { setSearch(''); setFilterType('ALL') }} style={{ marginTop: 8, color: '#e65c00', background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', textDecoration: 'underline' }}>Clear filters</button>
            )}
          </div>
        )}
        {paginated.map(s => {
          const lbl = getTypeLabel(s)
          const color = getTypeColor(s)
          const jobLabel = s.pm_number ? lbl + ' #' + s.pm_number : lbl
          const techs = Array.isArray(s.data?.techs) ? s.data.techs : []
          const isWarranty = s.data?.warrantyWork === true
          let rightValue
          if (lbl === 'EXP') {
            const total = s.data?.expenseTotal || 0
            rightValue = '$' + parseFloat(total).toFixed(2)
          } else if (lbl === 'INSP') {
            const fails = s.data?.failCount || 0
            rightValue = fails === 0 ? '✓ All Pass' : '⚠️ ' + fails + ' Fail' + (fails !== 1 ? 's' : '')
          } else {
            const grandTotal = s.data?.grandTotal || (parseFloat(s.labor_total || 0) + parseFloat(s.parts_total || 0) + parseFloat(s.mileage_total || 0))
            rightValue = isWarranty ? 'WARRANTY' : '$' + parseFloat(grandTotal || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
          }
          const rightColor = lbl === 'INSP'
            ? (s.data?.failCount > 0 ? '#dc2626' : '#16a34a')
            : (isWarranty ? '#e65c00' : '#222')
          return (
            <div key={s.id} style={{ background: '#fff', borderRadius: 10, marginBottom: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: '4px solid ' + color, overflow: 'hidden' }}>
              <Link to={'/view/' + s.id} style={{ textDecoration: 'none', display: 'block', padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#1a2332' }}>
                      {lbl === 'EXP' || lbl === 'INSP' ? (techs[0] || s.location_name || 'Unknown') : (s.customer_name || 'Unknown Customer')}
                    </div>
                    <div style={{ color: '#555', fontSize: 13, marginTop: 2 }}>
                      {lbl === 'EXP'
                        ? 'Expense Report' + (s.data?.expenseItems?.length ? ' — ' + s.data.expenseItems.length + ' items' : '')
                        : lbl === 'INSP'
                          ? (s.data?.inspectionType || 'Inspection') + ' — Truck ' + (s.truck_number || s.data?.truckNumber || '?')
                          : (s.location_name || '')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color }}>{jobLabel}</div>
                    <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{s.date || ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 12, color: '#888' }}>{techs.join(', ') || (s.data?.techName || '')}</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: rightColor }}>{rightValue}</div>
                </div>
              </Link>
              <div style={{ borderTop: '1px solid #f0f0f0', padding: '8px 14px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={e => { e.preventDefault(); navigate('/edit/' + s.id) }}
                  style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 600, color: '#333', cursor: 'pointer' }}
                >✏️ Edit</button>
              </div>
            </div>
          )
        })}

        {/* PAGINATION */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button onClick={() => setPage(1)} disabled={page === 1} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #ddd', background: page === 1 ? '#f5f5f5' : '#fff', color: page === 1 ? '#aaa' : '#333', cursor: page === 1 ? 'not-allowed' : 'pointer', fontSize: 13 }}>«</button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #ddd', background: page === 1 ? '#f5f5f5' : '#fff', color: page === 1 ? '#aaa' : '#333', cursor: page === 1 ? 'not-allowed' : 'pointer', fontSize: 13 }}>‹ Prev</button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let p
              if (totalPages <= 7) p = i + 1
              else if (page <= 4) p = i + 1
              else if (page >= totalPages - 3) p = totalPages - 6 + i
              else p = page - 3 + i
              return (
                <button key={p} onClick={() => setPage(p)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid ' + (p === page ? '#e65c00' : '#ddd'), background: p === page ? '#e65c00' : '#fff', color: p === page ? '#fff' : '#333', cursor: 'pointer', fontWeight: p === page ? 700 : 400, fontSize: 13 }}>{p}</button>
              )
            })}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #ddd', background: page === totalPages ? '#f5f5f5' : '#fff', color: page === totalPages ? '#aaa' : '#333', cursor: page === totalPages ? 'not-allowed' : 'pointer', fontSize: 13 }}>Next ›</button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #ddd', background: page === totalPages ? '#f5f5f5' : '#fff', color: page === totalPages ? '#aaa' : '#333', cursor: page === totalPages ? 'not-allowed' : 'pointer', fontSize: 13 }}>»</button>
          </div>
        )}
      </div>
    </div>
  )
}
