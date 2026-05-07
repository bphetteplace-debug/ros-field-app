import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchSubmission, getPhotoUrl } from '../lib/submissions'

export default function ViewSubmissionPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [sub, setSub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchSubmission(id)
      .then(data => { setSub(data); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [id])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>
  if (error) return <div style={{ padding: 40, color: '#c00' }}>Error: {error}</div>
  if (!sub) return null

  const d = sub.data || {}
  const parts = d.parts || []
  const techs = d.techs || []
  const warrantyWork = d.warranty_work || false
  const jobType = d.job_type || sub.work_type || 'PM'
  const prefix = jobType === 'Service Call' ? 'SC' : 'PM'

  const fmt = v => v != null ? '$' + parseFloat(v).toFixed(2) : '-'
  const fmtDate = v => v ? new Date(v + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '-'

  const sectionHeader = { background: '#1a2332', color: '#fff', padding: '10px 16px', borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' }
  const sectionBody = { background: '#fff', border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 16 }
  const row2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }
  const fieldLabel = { fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }
  const fieldVal = { fontSize: 15, color: '#222', fontWeight: 500 }

  function Field({ label, value }) {
    return (
      <div>
        <div style={fieldLabel}>{label}</div>
        <div style={fieldVal}>{value || '-'}</div>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '0 auto', padding: '0 0 40px', background: '#f0f2f5', minHeight: '100vh' }}>
      {/* Back button */}
      <div style={{ padding: '12px 16px', background: '#fff', borderBottom: '1px solid #eee' }}>
        <button onClick={() => navigate('/submissions')} style={{ background: 'none', border: 'none', color: '#e65c00', fontWeight: 700, fontSize: 14, cursor: 'pointer', padding: 0 }}>
          ← Submissions
        </button>
      </div>

      {/* Header card */}
      <div style={{ background: '#1a2332', color: '#fff', padding: '20px 16px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{ background: '#e65c00', color: '#fff', fontWeight: 700, padding: '4px 10px', borderRadius: 6, fontSize: 13 }}>{prefix}</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{prefix} #{sub.pm_number}</div>
        </div>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>{sub.customer_name} — {sub.location_name}</div>
        <div style={{ color: '#aaa', fontSize: 13 }}>{fmtDate(sub.date)}</div>
        {sub.submitted_at && (
          <div style={{ color: '#aaa', fontSize: 12 }}>Submitted {new Date(sub.submitted_at).toLocaleString()}</div>
        )}
      </div>

      {/* JOB DETAILS */}
      <div style={{ margin: '0 0 12px' }}>
        <div style={sectionHeader}>📋 Job Details</div>
        <div style={sectionBody}>
          <div style={row2}>
            <Field label="Job Type" value={jobType} />
            <Field label="Warranty" value={warrantyWork ? 'Yes — WARRANTY WORK' : 'No — Standard Billing'} />
            <Field label="Customer" value={sub.customer_name} />
            <Field label="Truck" value={sub.truck_number} />
            <Field label="Location" value={sub.location_name} />
            <Field label="Type of Work" value={sub.work_type} />
            <Field label="Date" value={fmtDate(sub.date)} />
            <Field label="Start Time" value={sub.start_time} />
            <Field label="Departure Time" value={sub.departure_time} />
          </div>
        </div>
      </div>

      {/* DESCRIPTION */}
      {sub.summary && (
        <div style={{ margin: '0 0 12px' }}>
          <div style={sectionHeader}>📝 Description of Work</div>
          <div style={sectionBody}>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: '#333' }}>{sub.summary}</div>
          </div>
        </div>
      )}

      {/* TECHS */}
      {techs.length > 0 && (
        <div style={{ margin: '0 0 12px' }}>
          <div style={sectionHeader}>👷 Field Techs</div>
          <div style={sectionBody}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {techs.map(t => (
                <div key={t} style={{ padding: '6px 14px', background: '#f0f0f0', borderRadius: 20, fontSize: 14, fontWeight: 600 }}>{t}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PARTS */}
      {parts.length > 0 && (
        <div style={{ margin: '0 0 12px' }}>
          <div style={sectionHeader}>🔧 Parts Used</div>
          <div style={{ background: '#fff', border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
            {warrantyWork && (
              <div style={{ background: '#fff8e1', border: '2px solid #f9a825', borderRadius: 8, margin: 12, padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#e65000', letterSpacing: 1, textTransform: 'uppercase' }}>
                WARRANTY — NO CHARGE
              </div>
            )}
            {parts.map((p, i) => (
              <div key={p.sku || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid #f0f0f0' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name || p.sku}</div>
                  <div style={{ color: '#888', fontSize: 12 }}>{p.sku} · Qty: {p.qty} · {fmt(p.price)} ea</div>
                </div>
                <div style={{ fontWeight: 700, color: warrantyWork ? '#888' : '#e65c00' }}>
                  {warrantyWork ? '—' : fmt((p.price || 0) * (p.qty || 0))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* COST SUMMARY */}
      <div style={{ margin: '0 0 12px' }}>
        <div style={sectionHeader}>💰 Cost Summary</div>
        <div style={sectionBody}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
            <span>Parts</span><span>{fmt(d.parts_total)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
            <span>Mileage ({sub.miles || 0} mi @ ${sub.cost_per_mile || 1.34}/mi)</span>
            <span>{fmt(d.mileage_total)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
            <span>Labor ({sub.labor_hours || 0} hrs @ ${sub.labor_rate || 123.62}/hr × {d.billable_techs || 1} tech{d.billable_techs !== 1 ? 's' : ''})</span>
            <span>{fmt(d.labor_total)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontWeight: 700, fontSize: 16 }}>
            <span>TOTAL</span>
            <span style={{ color: warrantyWork ? '#888' : '#e65c00' }}>
              {warrantyWork ? 'WARRANTY — NO CHARGE' : fmt(d.grand_total)}
            </span>
          </div>
        </div>
      </div>

      {/* PHOTOS */}
      {sub.photos && sub.photos.length > 0 && (
        <div style={{ margin: '0 0 12px' }}>
          <div style={sectionHeader}>📷 Photos</div>
          <div style={{ background: '#fff', border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {sub.photos.sort((a, b) => a.display_order - b.display_order).map(photo => (
                <div key={photo.id} style={{ borderRadius: 8, overflow: 'hidden', background: '#f0f0f0' }}>
                  <img src={getPhotoUrl(photo.storage_path)} alt={photo.caption || 'photo'} style={{ width: '100%', height: 120, objectFit: 'cover' }} />
                  {photo.caption && <div style={{ padding: '4px 8px', fontSize: 11, color: '#666' }}>{photo.caption}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
