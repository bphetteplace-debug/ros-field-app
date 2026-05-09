import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { fetchSubmissions } from '../lib/submissions'
import { getQueueCount, processOfflineQueue } from '../lib/offlineSync'

function getTypeLabel(s) {
  if (s.template === 'pm_flare_combustor') return 'PM'
  if (s.template === 'service_call') return 'SC'
  if (s.template === 'expense_report') return 'EXP'
  if (s.template === 'daily_inspection') return 'INSP'
  // fallback: use job_type field from data
  const jt = s.data?.jobType || s.job_type || ''
  if (jt === 'PM') return 'PM'
  if (jt === 'Service Call') return 'SC'
  if (jt === 'Expense Report') return 'EXP'
  if (jt === 'Daily Inspection') return 'INSP'
  return jt || '?'
}

function getTypeColor(s) {
  const lbl = getTypeLabel(s)
  if (lbl === 'PM') return '#e65c00'
  if (lbl === 'SC') return '#2563eb'
  if (lbl === 'EXP') return '#7c3aed'
  if (lbl === 'INSP') return '#0891b2'
  return '#888'
}

export default function SubmissionsListPage() {
  const { user } = useAuth()
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('ALL')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [queueCount, setQueueCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  useEffect(() => {
    const updateQueue = async () => {
      try { setQueueCount(await getQueueCount()) } catch(e) {}
    }
    updateQueue()
    const onOnline = () => { setIsOnline(true); updateQueue() }
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])

  useEffect(() => {
    if (!user) return
    fetchSubmissions(user.id)
      .then(setSubmissions)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [user])

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true); setSyncMsg('')
    try {
      const count = await processOfflineQueue(user?.id)
      setSyncMsg(count > 0 ? count + ' submission' + (count !== 1 ? 's' : '') + ' synced!' : 'All caught up!')
      setQueueCount(0)
      if (user) { const fresh = await fetchSubmissions(user.id); setSubmissions(fresh) }
    } catch(e) { setSyncMsg('Sync failed: ' + e.message) }
    finally { setSyncing(false); setTimeout(() => setSyncMsg(''), 4000) }
  }

  const fmt = n => '$' + (n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  const filtered = submissions.filter(s => {
    const q = search.toLowerCase().trim()
    const lbl = getTypeLabel(s)
    const matchesType = filterType === 'ALL' || lbl === filterType
    if (!q) return matchesType
    const haystack = [s.customer_name, s.location_name, s.date, s.truck_number, lbl,
      s.pm_number ? String(s.pm_number) : '', s.summary, s.work_type,
      ...(Array.isArray(s.data?.techs) ? s.data.techs : [])
    ].filter(Boolean).join(' ').toLowerCase()
    return matchesType && haystack.includes(q)
  })

  const navBar = { background: '#1a2332', padding: '0 16px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }

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

      {/* NAV */}
      <div style={navBar}>
        <span style={{ color: '#e65c00', fontWeight: 700, fontSize: 16 }}>📋 ReliableTrack</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Link to="/form?type=pm" style={{ background: '#e65c00', color: '#fff', padding: '5px 10px', borderRadius: 6, textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>+ PM</Link>
          <Link to="/form?type=sc" style={{ background: '#2563eb', color: '#fff', padding: '5px 10px', borderRadius: 6, textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>+ SC</Link>
          <Link to="/expense" style={{ background: '#7c3aed', color: '#fff', padding: '5px 10px', borderRadius: 6, textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>+ Expense</Link>
          <Link to="/inspection" style={{ background: '#0891b2', color: '#fff', padding: '5px 10px', borderRadius: 6, textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>+ Inspect</Link>
        </div>
      </div>

      <div style={{ maxWidth: 700, margin: '0 auto', padding: '12px 12px 80px' }}>
        {/* SEARCH + FILTER */}
        <div style={{ background: '#fff', borderRadius: 10, padding: '10px 12px', marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="search" placeholder="Search by customer, location, PM#, date, tech..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 160, border: '1px solid #ddd', borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }} />
          <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '8px 8px', fontSize: 13, background: '#fff', cursor: 'pointer' }}>
            <option value="ALL">All Types</option>
            <option value="PM">PM Only</option>
            <option value="SC">Service Calls</option>
            <option value="EXP">Expenses</option>
            <option value="INSP">Inspections</option>
          </select>
        </div>

        {!loading && !error && (
          <div style={{ fontSize: 12, color: '#888', marginBottom: 8, paddingLeft: 4 }}>
            {filtered.length === submissions.length ? submissions.length + ' submissions' : filtered.length + ' of ' + submissions.length + ' submissions'}
            {search && ' matching "' + search + '"'}
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

        {filtered.map(s => {
          const lbl = getTypeLabel(s)
          const color = getTypeColor(s)
          const jobLabel = s.pm_number ? lbl + ' #' + s.pm_number : lbl
          const techs = Array.isArray(s.data?.techs) ? s.data.techs : []
          const isWarranty = s.data?.warrantyWork === true
          // For expense reports, show expense total from data; for inspections show pass/fail; others show grand total
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
          const rightColor = lbl === 'INSP' ? (s.data?.failCount > 0 ? '#dc2626' : '#16a34a') : (isWarranty ? '#e65c00' : '#222')

          return (
            <Link key={s.id} to={'/view/' + s.id} style={{ textDecoration: 'none' }}>
              <div style={{ background: '#fff', borderRadius: 10, marginBottom: 10, padding: '12px 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: '4px solid ' + color }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#1a2332' }}>
                      {lbl === 'EXP' || lbl === 'INSP'
                        ? (techs[0] || s.location_name || 'Unknown')
                        : (s.customer_name || 'Unknown Customer')
                      }
                    </div>
                    <div style={{ color: '#555', fontSize: 13, marginTop: 2 }}>
                      {lbl === 'EXP' ? 'Expense Report' + (s.data?.expenseItems?.length ? ' — ' + s.data.expenseItems.length + ' items' : '')
                       : lbl === 'INSP' ? (s.data?.inspectionType || 'Inspection') + ' — Truck ' + (s.truck_number || s.data?.truckNumber || '?')
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
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
