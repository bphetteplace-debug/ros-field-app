import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { fetchSubmissions } from '../lib/submissions'

export default function SubmissionsListPage() {
  const { user } = useAuth()
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user) return
    fetchSubmissions(user.id)
      .then(setSubmissions)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [user])

  const fmt = n => '$' + (n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return (
    <div style={{ maxWidth:700, margin:'0 auto', padding:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:1, margin:0 }}>SUBMISSIONS</h1>
          <p style={{ color:'#888', margin:'4px 0 0', fontSize:13 }}>
            {loading ? 'Loading…' : submissions.length + ' record' + (submissions.length !== 1 ? 's' : '')}
          </p>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <Link to="/form?type=pm" style={pmBtn}>+ PM</Link>
          <Link to="/form?type=service" style={scBtn}>+ Service Call</Link>
        </div>
      </div>

      {error && (
        <div style={{ background:'#ffeaea', border:'1px solid #f88', borderRadius:8, padding:'12px 16px', marginBottom:16, color:'#c00', fontSize:14 }}>
          Error loading submissions: {error}
        </div>
      )}

      {!loading && submissions.length === 0 && !error && (
        <div style={{ textAlign:'center', padding:'60px 20px', background:'#fff', borderRadius:12, border:'1px solid #eee' }}>
          <div style={{ fontSize:48, marginBottom:16 }}>📋</div>
          <h2 style={{ fontSize:18, fontWeight:700, margin:'0 0 8px', letterSpacing:1 }}>NO SUBMISSIONS YET</h2>
          <p style={{ color:'#888', margin:0 }}>Tap PM or Service Call above to start your first field report. Saved submissions will appear here.</p>
        </div>
      )}

      {submissions.map(sub => {
        const d = sub.data || {}
        const isWarranty = d.warranty_work
        const total = d.grand_total || 0
        const jobType = d.job_type || 'PM'
        const dateStr = sub.date
          ? new Date(sub.date + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
          : '—'

        return (
          <Link key={sub.id} to={'/view/' + sub.id} style={{ textDecoration:'none' }}>
            <div style={{
              background:'#fff', borderRadius:12, border:'1px solid #eee',
              padding:'16px 20px', marginBottom:12,
              boxShadow:'0 1px 3px rgba(0,0,0,0.06)',
            }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                    <span style={{
                      background: jobType === 'PM' ? '#1a2332' : '#2563eb',
                      color:'#fff', fontSize:11, fontWeight:700, padding:'2px 8px',
                      borderRadius:4, letterSpacing:0.5,
                    }}>{jobType}</span>
                    <span style={{ fontSize:13, fontWeight:700, color:'#333' }}>
                      {jobType === 'PM' ? 'PM' : 'SC'} #{sub.pm_number}
                    </span>
                    <span style={{ fontSize:12, color:'#aaa' }}>{dateStr}</span>
                  </div>
                  <div style={{ fontSize:15, fontWeight:600, color:'#1a2332', marginBottom:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {sub.customer_name || '—'} — {sub.location_name || '—'}
                  </div>
                  {sub.work_type && <div style={{ fontSize:12, color:'#888' }}>{sub.work_type}</div>}
                </div>
                <div style={{ textAlign:'right', marginLeft:12, flexShrink:0 }}>
                  {isWarranty ? (
                    <span style={{ fontSize:12, fontWeight:700, color:'#856404', background:'#fff3cd', padding:'3px 8px', borderRadius:4 }}>WARRANTY</span>
                  ) : (
                    <span style={{ fontSize:15, fontWeight:700, color:'#e65c00' }}>{fmt(total)}</span>
                  )}
                  <div style={{ fontSize:11, color:'#aaa', marginTop:2 }}>→</div>
                </div>
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

const pmBtn = {
  display:'inline-flex', alignItems:'center', padding:'10px 16px',
  background:'#1a2332', color:'#fff', borderRadius:8, textDecoration:'none',
  fontSize:14, fontWeight:700, gap:4,
}
const scBtn = {
  display:'inline-flex', alignItems:'center', padding:'10px 16px',
  background:'#e65c00', color:'#fff', borderRadius:8, textDecoration:'none',
  fontSize:14, fontWeight:700, gap:4,
          }
