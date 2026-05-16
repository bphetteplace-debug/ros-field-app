import { useState, useEffect, lazy, Suspense } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchSubmission, getPhotoUrl, deleteSubmission } from '../lib/submissions'
import { useAuth } from '../lib/auth'
import NavBar from '../components/NavBar'
const DownloadPDFButton = lazy(() => import('../components/DownloadPDFButton').then(m => ({ default: m.DownloadPDFButton })))

const COND_COLOR = { Good: '#16a34a', Fair: '#d97706', Poor: '#dc2626', Replaced: '#7c3aed' }

// --- PhotoLightboxUrl ---
function PhotoLightboxUrl({ photos, idx, onClose, onPrev, onNext, getUrl }) {
  if (idx < 0 || !photos || idx >= photos.length) return null;
  const photo = photos[idx];
  const src = getUrl(photo.storage_path);
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div onClick={e=>e.stopPropagation()} style={{position:'relative',maxWidth:'95vw',maxHeight:'90vh',display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
        <img src={src} alt="" style={{maxWidth:'90vw',maxHeight:'78vh',objectFit:'contain',borderRadius:8}} />
        {photo.caption && <div style={{color:'#ccc',fontSize:12}}>{photo.caption}</div>}
        <div style={{color:'#aaa',fontSize:11}}>{idx+1} / {photos.length}</div>
        <div style={{display:'flex',gap:8}}>
          {idx > 0 && <button type="button" onClick={onPrev} style={{background:'#334',color:'#fff',border:'none',borderRadius:6,padding:'8px 16px',cursor:'pointer',fontWeight:700}}>Prev</button>}
          <a href={src} download={'photo-'+(idx+1)+'.jpg'} target="_blank" rel="noreferrer"
            style={{background:'#0891b2',color:'#fff',border:'none',borderRadius:6,padding:'8px 16px',cursor:'pointer',fontWeight:700,textDecoration:'none',display:'flex',alignItems:'center'}}>Save to Device</a>
          {idx < photos.length-1 && <button type="button" onClick={onNext} style={{background:'#334',color:'#fff',border:'none',borderRadius:6,padding:'8px 16px',cursor:'pointer',fontWeight:700}}>Next</button>}
        </div>
        <button type="button" onClick={onClose} style={{position:'absolute',top:-36,right:0,background:'transparent',color:'#fff',border:'none',fontSize:22,cursor:'pointer',fontWeight:700}}>Close X</button>
      </div>
    </div>
  );
}

function InfoCard({ children, accent }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden', marginBottom: 14, borderTop: '3px solid ' + (accent || '#1a2332') }}>
      {children}
    </div>
  )
}

function CardHeader({ title, icon, accent }) {
  return (
    <div style={{ padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
      {icon && <span style={{ fontSize: 15 }}>{icon}</span>}
      <span style={{ fontWeight: 700, fontSize: 12, color: '#374151', letterSpacing: 0.8, textTransform: 'uppercase' }}>{title}</span>
    </div>
  )
}

function CardBody({ children, style }) {
  return <div style={{ padding: '14px 16px', ...style }}>{children}</div>
}

function Field({ label, value, wide, mono }) {
  if (!value && value !== 0) return null
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#1a2332', fontWeight: 500, fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
    </div>
  )
}

export default function ViewSubmissionPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [sub, setSub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState('')
  const [lightboxPhotos, setLightboxPhotos] = useState([])
  const [lightboxIdx, setLightboxIdx]     = useState(-1)
  const [deleting, setDeleting] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState('')
  const { isAdmin, isDemo, user, signOut } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = async () => {
    setLoggingOut(true)
    try { await signOut() } catch(e) {}
    setLoggingOut(false)
    navigate('/login')
  }

  const handleResend = async () => {
    if (!sub) return
    setResending(true); setResendMsg('')
    try {
      const res = await fetch('/api/send-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId: sub.id }) })
      const data = await res.json()
      setResendMsg(res.ok ? 'Report sent!' : 'Error: ' + (data.error || res.status))
    } catch(e) { setResendMsg('Error: ' + e.message) }
    setResending(false)
    setTimeout(() => setResendMsg(''), 4000)
  }

  const handleCopy = () => {
    if (!sub) return
    const d = sub.data || {}
    const isPM = (d.jobType === 'PM')
    const formType = isPM ? 'pm' : 'sc'
    const prefill = {
      customerName: sub.customer_name || '', locationName: sub.location_name || '',
      truckNumber: sub.truck_number || '', typeOfWork: sub.work_type || '',
      glCode: sub.gl_code || d.glCode || '', assetTag: sub.asset_tag || d.assetTag || '',
      workArea: sub.work_area || d.workArea || '', customerContact: sub.contact || d.customerContact || '',
      customerWorkOrder: sub.work_order || d.customerWorkOrder || '',
      techs: d.techs || [], warrantyWork: d.warrantyWork || false,
      costPerMile: sub.cost_per_mile != null ? String(sub.cost_per_mile) : '1.50',
      hourlyRate: sub.labor_rate != null ? String(sub.labor_rate) : '115.00',
      arrestors: d.arrestors || [], flares: d.flares || [], heaters: d.heaters || [],
    }
    try { sessionStorage.setItem('ros_copy_prefill', JSON.stringify({ formType, ...prefill })) } catch(e) {}
    navigate('/form?type=' + formType)
  }

  const handleDelete = async () => {
    if (!sub || !window.confirm('Permanently delete this submission? This cannot be undone.')) return
    setDeleting(true)
    try { await deleteSubmission(sub.id); navigate('/admin') }
    catch(e) { setDeleteMsg('Delete failed: ' + e.message); setDeleting(false) }
  }

  useEffect(() => {
    fetchSubmission(id).then(data => { setSub(data); setLoading(false) }).catch(err => { setError(err.message); setLoading(false) })
  }, [id])

  if (loading) return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: '#f0f2f5', minHeight: '100vh' }}>
      <NavBar user={user} isAdmin={isAdmin} isDemo={isDemo} onLogout={handleLogout} loggingOut={loggingOut} />
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px 60px' }}>
        {/* Hero placeholder — mimics the WO header that renders after load */}
        <div style={{ background: '#fff', borderRadius: 10, padding: 20, marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderTop: '3px solid #cbd5e1' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div className="shimmer" style={{ height: 22, width: 60 }}></div>
            <div className="shimmer" style={{ height: 22, width: 80 }}></div>
          </div>
          <div className="shimmer" style={{ height: 26, width: 180, marginBottom: 8 }}></div>
          <div className="shimmer" style={{ height: 16, width: '70%', maxWidth: 320, marginBottom: 4 }}></div>
          <div className="shimmer" style={{ height: 14, width: '50%', maxWidth: 220 }}></div>
        </div>
        {/* Info-card skeletons */}
        {[0, 1, 2].map(function(i) {
          return (
            <div key={i} style={{ background: '#fff', borderRadius: 10, marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderTop: '3px solid #cbd5e1', overflow: 'hidden' }}>
              <div style={{ padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                <div className="shimmer" style={{ height: 14, width: 140 }}></div>
              </div>
              <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px 24px' }}>
                {[0, 1, 2, 3, 4, 5].map(function(j) {
                  return (
                    <div key={j}>
                      <div className="shimmer" style={{ height: 10, width: 70, marginBottom: 6 }}></div>
                      <div className="shimmer" style={{ height: 16, width: 110 }}></div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
  if (error) return <div style={{ padding: 40, color: '#c00', fontFamily: 'system-ui,sans-serif' }}>Error: {error}</div>
  if (!sub) return null

  const d = sub.data || {}
  const isJHA = (d.jobType === 'JHA/JSA') || (sub.work_type || '').includes('JHA')
  const isExpense = (d.jobType === 'Expense') || (sub.work_type || '').includes('Expense')
  const isInspection = (d.jobType === 'Daily Inspection') || (sub.work_type || '').includes('Inspect')
  const parts = d.parts || []
  const techs = d.techs || []
  const isWarranty = d.warrantyWork || false
  const jobType = d.jobType || (sub.work_type && sub.work_type.toLowerCase().includes('pm') ? 'PM' : 'Service Call')
  const isPM = jobType === 'PM'
  const prefix = isJHA ? 'JHA/JSA' : isPM ? 'PM' : 'SC'
  const accentColor = isJHA ? '#059669' : isPM ? '#e65c00' : '#2563eb'
  const arrestors = isPM && Array.isArray(d.arrestors) ? d.arrestors : []
  const flares = isPM && Array.isArray(d.flares) ? d.flares : []
  const heaters = isPM && Array.isArray(d.heaters) ? d.heaters : []
  const scEquipment = !isPM && Array.isArray(d.scEquipment) ? d.scEquipment : []
  const fmt = v => v != null ? '$' + parseFloat(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '-'
  const fmtDate = v => v ? new Date(v + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '-'
  const statusColors = { submitted: { bg: '#dcfce7', color: '#16a34a', label: 'Submitted' }, reviewed: { bg: '#fef3c7', color: '#92400e', label: 'Reviewed' }, invoiced: { bg: '#f5f3ff', color: '#5b21b6', label: 'Invoiced' }, draft: { bg: '#f3f4f6', color: '#6b7280', label: 'Draft' } }
  const statusInfo = statusColors[sub.status] || statusColors.submitted

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: '#f0f2f5', minHeight: '100vh' }}>
      <NavBar user={user} isAdmin={isAdmin} isDemo={isDemo} onLogout={handleLogout} loggingOut={loggingOut} />

      {/* HERO HEADER */}
      <div style={{ background: '#1a2332', color: '#fff', padding: '0' }}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 20px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ background: accentColor, color: '#fff', fontWeight: 800, padding: '4px 12px', borderRadius: 6, fontSize: 13, letterSpacing: 0.5 }}>{prefix}</span>
                <span style={{ background: statusInfo.bg, color: statusInfo.color, fontWeight: 700, padding: '4px 10px', borderRadius: 6, fontSize: 12 }}>{statusInfo.label}</span>
                {isWarranty && <span style={{ background: '#fef9c3', color: '#854d0e', fontWeight: 700, padding: '4px 10px', borderRadius: 6, fontSize: 12 }}>WARRANTY</span>}
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>W/O #{sub.work_order}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#cbd5e1', marginBottom: 2 }}>{sub.customer_name}{sub.location_name ? ' — ' + sub.location_name : ''}</div>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>{fmtDate(sub.date)}</div>
            </div>
            <button onClick={() => navigate(-1)} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ← Back
            </button>
          </div>

          {/* ACTION BAR */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <button onClick={handleCopy} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              📋 Copy Job
            </button>
            {(isAdmin || (sub && user && sub.created_by === user.id)) && (
              <button onClick={() => navigate('/edit/' + sub.id)} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', borderRadius: 7, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                ✏️ Edit
              </button>
            )}
            <Suspense fallback={null}><DownloadPDFButton sub={sub} style={{ marginRight: 6 }} /></Suspense>
            {isAdmin && (
              <>
                <button onClick={handleResend} disabled={resending} style={{ background: resending ? 'rgba(255,255,255,0.05)' : '#e65c00', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: resending ? 'not-allowed' : 'pointer' }}>
                  {resending ? 'Sending...' : '📧 Resend Report'}
                </button>
                <button onClick={handleDelete} disabled={deleting} style={{ background: deleting ? 'rgba(255,255,255,0.05)' : 'rgba(220,38,38,0.8)', color: '#fff', border: '1px solid rgba(220,38,38,0.5)', borderRadius: 7, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: deleting ? 'not-allowed' : 'pointer' }}>
                  {deleting ? 'Deleting...' : '🗑️ Delete'}
                </button>
              </>
            )}
            {resendMsg && <span style={{ alignSelf: 'center', fontSize: 13, color: resendMsg.startsWith('Error') ? '#fca5a5' : '#86efac', fontWeight: 700 }}>{resendMsg}</span>}
            {deleteMsg && <span style={{ alignSelf: 'center', fontSize: 13, color: '#fca5a5', fontWeight: 700 }}>{deleteMsg}</span>}
          </div>
        </div>
      </div>

      {/* PAGE BODY */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 16px 60px' }}>

        {!isJHA && !isExpense && !isInspection && (
          <>
            {/* JOB DETAILS */}
            <InfoCard accent={accentColor}>
              <CardHeader title='Job Details' icon='📋' />
              <CardBody>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px 24px' }}>
                  <Field label='Job Type' value={isPM ? 'Preventive Maintenance' : 'Service Call'} />
                  <Field label='Date' value={fmtDate(sub.date)} />
                  <Field label='Customer' value={sub.customer_name} />
                  <Field label='Location' value={sub.location_name} />
                  <Field label='Truck #' value={sub.truck_number} />
                  <Field label='Type of Work' value={sub.work_type} />
                  <Field label='Start Time' value={sub.start_time} />
                  <Field label='Departure' value={sub.departure_time} />
                  <Field label='Asset Tag' value={sub.asset_tag || d.assetTag} />
                  <Field label='Work Area' value={sub.work_area || d.workArea} />
                  <Field label='Contact' value={sub.contact || d.customerContact} />
                  <Field label='Customer W/O #' value={sub.work_order || d.customerWorkOrder} />
                  <Field label='GL Code' value={sub.gl_code || d.glCode} />
                  <Field label='Last Service Date' value={d.lastServiceDate} />
                </div>
                {isWarranty && (
                  <div style={{ marginTop: 14, padding: '10px 16px', background: '#fef9c3', border: '1px solid #fde047', borderRadius: 8, fontWeight: 700, color: '#854d0e', fontSize: 14 }}>
                    ⚠️ WARRANTY WORK — NO CHARGE
                  </div>
                )}
                {d.gpsLat && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <a href={'https://maps.google.com/?q=' + d.gpsLat + ',' + d.gpsLng} target='_blank' rel='noopener noreferrer' style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', background: '#1a2332', color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
                      📍 Open in Google Maps
                    </a>
                    {d.gpsAccuracy && <span style={{ fontSize: 11, color: '#888' }}>±{d.gpsAccuracy}m</span>}
                  </div>
                )}
              </CardBody>
            </InfoCard>

            {/* TECHS */}
            {techs.length > 0 && (
              <InfoCard>
                <CardHeader title='Field Technicians' icon='👷' />
                <CardBody>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {techs.map(t => <span key={t} style={{ padding: '6px 16px', background: '#f0f4ff', border: '1px solid #c7d2fe', borderRadius: 20, fontSize: 14, fontWeight: 600, color: '#3730a3' }}>{t}</span>)}
                  </div>
                </CardBody>
              </InfoCard>
            )}

            {/* DESCRIPTION */}
            {sub.summary && (
              <InfoCard>
                <CardHeader title='Description of Work' icon='📝' />
                <CardBody>
                  <div style={{ fontSize: 14, lineHeight: 1.7, color: '#374151', whiteSpace: 'pre-line' }}>{sub.summary}</div>
                  {d.equipment && <div style={{ marginTop: 10, fontSize: 13, color: '#555' }}><strong>Equipment:</strong> {d.equipment}</div>}
                </CardBody>
              </InfoCard>
            )}

            {/* SC EQUIPMENT */}
            {!isPM && scEquipment.length > 0 && (
              <InfoCard accent='#2563eb'>
                <CardHeader title='Equipment Worked On' icon='⚙️' />
                <CardBody>
                  {scEquipment.map((item, i) => (
                    <div key={i} style={{ marginBottom: i < scEquipment.length - 1 ? 12 : 0, paddingBottom: i < scEquipment.length - 1 ? 12 : 0, borderBottom: i < scEquipment.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#1a2332', marginBottom: 4 }}>{item.type}</div>
                      {item.notes && <div style={{ fontSize: 13, color: '#555', lineHeight: 1.5 }}>{item.notes}</div>}
                    </div>
                  ))}
                </CardBody>
              </InfoCard>
            )}

            {/* PM: FLAME ARRESTORS */}
            {isPM && arrestors.length > 0 && (
              <InfoCard accent='#e65c00'>
                <CardHeader title={'Flame Arrestors (' + arrestors.length + ')'} icon='🔥' />
                <CardBody>
                  {arrestors.map((a, i) => (
                    <div key={i} style={{ marginBottom: i < arrestors.length - 1 ? 14 : 0, paddingBottom: i < arrestors.length - 1 ? 14 : 0, borderBottom: i < arrestors.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#e65c00', marginBottom: 8 }}>Arrestor #{i + 1}{a.arrestorId ? ' — ' + a.arrestorId : ''}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                        <Field label='Condition' value={a.condition} />
                        <Field label='Filter Changed' value={a.filterChanged ? 'Yes' : 'No'} />
                      </div>
                      {a.notes && <div style={{ marginTop: 8, fontSize: 13, color: '#555', fontStyle: 'italic' }}>{a.notes}</div>}
                    </div>
                  ))}
                </CardBody>
              </InfoCard>
            )}

            {/* PM: FLARES */}
            {isPM && flares.length > 0 && (
              <InfoCard accent='#e65c00'>
                <CardHeader title={'Flares (' + flares.length + ')'} icon='🕯️' />
                <CardBody>
                  {flares.map((f, i) => (
                    <div key={i} style={{ marginBottom: i < flares.length - 1 ? 14 : 0, paddingBottom: i < flares.length - 1 ? 14 : 0, borderBottom: i < flares.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#e65c00', marginBottom: 8 }}>Flare #{i + 1}{f.flareId ? ' — ' + f.flareId : ''}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px 24px' }}>
                        <Field label='Condition' value={f.condition} />
                        <Field label='Pilot Lit' value={f.pilotLit ? 'Yes' : 'No'} />
                        <Field label='Last Ignition' value={f.lastIgnition} />
                      </div>
                      {f.notes && <div style={{ marginTop: 8, fontSize: 13, color: '#555', fontStyle: 'italic' }}>{f.notes}</div>}
                    </div>
                  ))}
                </CardBody>
              </InfoCard>
            )}

            {/* PM: HEATER TREATERS */}
            {isPM && heaters.length > 0 && (
              <InfoCard accent='#e65c00'>
                <CardHeader title={'Heater Treaters (' + heaters.length + ')'} icon='🌡️' />
                <CardBody>
                  {heaters.map((h, hi) => {
                    const fts = Array.isArray(h.firetubes) ? h.firetubes : []
                    return (
                      <div key={hi} style={{ marginBottom: hi < heaters.length - 1 ? 16 : 0, paddingBottom: hi < heaters.length - 1 ? 16 : 0, borderBottom: hi < heaters.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#e65c00', marginBottom: 8 }}>HT #{hi + 1}{h.heaterId ? ' — ' + h.heaterId : ''}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', marginBottom: 8 }}>
                          <Field label='Condition' value={h.condition} />
                          <Field label='Last Tube Clean' value={h.lastCleanDate} />
                        </div>
                        {h.notes && <div style={{ fontSize: 13, color: '#555', fontStyle: 'italic', marginBottom: 8 }}>{h.notes}</div>}
                        {fts.length > 0 && (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Firetubes ({fts.length})</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {fts.map((ft, fi) => <span key={fi} style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#f0f0f0', color: COND_COLOR[ft.condition] || '#333' }}>FT {fi + 1}: {ft.condition || 'Good'}</span>)}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </CardBody>
              </InfoCard>
            )}

            {/* PARTS */}
            {parts.length > 0 && (
              <InfoCard>
                <CardHeader title={'Parts & Materials (' + parts.length + ')'} icon='🔧' />
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ padding: '8px 16px', textAlign: 'left', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase' }}>SKU</th>
                      <th style={{ padding: '8px 16px', textAlign: 'left', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase' }}>Description</th>
                      <th style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase' }}>Qty</th>
                      {!isDemo && <th style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase' }}>Unit</th>}
                      {!isDemo && <th style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase' }}>Total</th>}
                    </tr></thead>
                    <tbody>
                      {parts.map((p, i) => (
                        <tr key={p.sku || i} style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                          <td style={{ padding: '10px 16px', color: '#888', fontSize: 12, fontFamily: 'monospace' }}>{p.sku || '—'}</td>
                          <td style={{ padding: '10px 16px', fontWeight: 500, color: '#1a2332' }}>{p.name || p.description || p.sku}</td>
                          <td style={{ padding: '10px 16px', textAlign: 'right', color: '#555' }}>{p.qty}</td>
                          {!isDemo && <td style={{ padding: '10px 16px', textAlign: 'right', color: '#555' }}>{fmt(p.price)}</td>}
                          {!isDemo && <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: isWarranty ? '#888' : '#e65c00' }}>{isWarranty ? '—' : fmt((p.price || 0) * (p.qty || 0))}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </InfoCard>
            )}

            {/* COST SUMMARY */}
            {!isDemo && (
              <InfoCard accent='#16a34a'>
                <CardHeader title='Cost Summary' icon='💰' />
                <CardBody>
                  {isWarranty ? (
                    <div style={{ textAlign: 'center', padding: '14px 0', color: '#854d0e', fontWeight: 800, fontSize: 16, background: '#fef9c3', borderRadius: 8, border: '2px solid #fde047' }}>WARRANTY — NO CHARGE</div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14 }}><span style={{ color: '#555' }}>Parts</span><span style={{ fontWeight: 600 }}>{fmt(d.partsTotal)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14 }}><span style={{ color: '#555' }}>Mileage ({sub.miles || 0} mi @ ${sub.cost_per_mile || 1.50}/mi)</span><span style={{ fontWeight: 600 }}>{fmt(d.mileageTotal)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '2px solid #1a2332', fontSize: 14 }}><span style={{ color: '#555' }}>Labor ({sub.labor_hours || 0} hrs @ ${sub.labor_rate || 115}/hr × {d.billableTechs || techs.length} tech{(d.billableTechs || techs.length) !== 1 ? 's' : ''})</span><span style={{ fontWeight: 600 }}>{fmt(d.laborTotal)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 4px', fontSize: 18, fontWeight: 800 }}><span>TOTAL</span><span style={{ color: '#e65c00' }}>{fmt(d.grandTotal)}</span></div>
                    </>
                  )}
                </CardBody>
              </InfoCard>
            )}
          </>
        )}

        {/* JHA */}
        {isJHA && (
          <>
            <InfoCard accent='#059669'>
              <CardHeader title='JHA Overview' icon='🛡️' />
              <CardBody>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px 24px' }}>
                  <Field label='Job / Location' value={sub.customer_name || d.customerName} />
                  <Field label='Date' value={sub.date} />
                  <Field label='Supervisor' value={d.jhaSupervisor || d.supervisor} />
                  <Field label='Truck #' value={sub.truck_number || d.truckNumber} />
                  <Field label='Crew Members' value={d.jhaCrewMembers || d.crewMembers} wide />
                  {d.description && <Field label='Job Description' value={d.description} wide />}
                </div>
              </CardBody>
            </InfoCard>

            {d.jhaSteps && d.jhaSteps.length > 0 && (
              <InfoCard accent='#059669'>
                <CardHeader title={'Hazard Steps (' + d.jhaSteps.length + ')'} icon='⚠️' />
                <CardBody style={{ padding: '10px 12px' }}>
                  {d.jhaSteps.map((step, i) => {
                    const riskColor = step.risk === 'High' ? '#dc2626' : step.risk === 'Medium' ? '#d97706' : '#16a34a'
                    return (
                      <div key={i} style={{ padding: '10px 12px', marginBottom: 8, background: '#f8f9fa', borderRadius: 7, borderLeft: '4px solid ' + riskColor }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>Step {i + 1}</div>
                            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 14 }}>{step.taskStep || step.task || step.step || '—'}</div>
                            {step.hazard && <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 3 }}><strong>Hazard:</strong> {step.hazard}</div>}
                            {(step.controls || step.control) && <div style={{ fontSize: 13, color: '#059669' }}><strong>Controls:</strong> {step.controls || step.control}</div>}
                          </div>
                          {step.risk && <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: step.risk === 'High' ? '#fef2f2' : step.risk === 'Medium' ? '#fffbeb' : '#f0fdf4', color: riskColor, whiteSpace: 'nowrap' }}>{step.risk}</span>}
                        </div>
                      </div>
                    )
                  })}
                </CardBody>
              </InfoCard>
            )}

            {d.jhaPPE && d.jhaPPE.length > 0 && (
              <InfoCard accent='#059669'>
                <CardHeader title='PPE Required' icon='🧜upsilonvariant' />
                <CardBody>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {d.jhaPPE.map((item, i) => <span key={i} style={{ padding: '5px 14px', background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 20, fontSize: 13, fontWeight: 600, color: '#065f46' }}>✓ {item}</span>)}
                  </div>
                </CardBody>
              </InfoCard>
            )}

            {(d.jhaEmergencyContact || d.jhaNearestHospital || d.jhaMeetingPoint || d.jhaAdditionalHazards) && (
              <InfoCard accent='#dc2626'>
                <CardHeader title='Emergency Info' icon='🚨' />
                <CardBody>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px 24px' }}>
                    <Field label='Emergency Contact' value={d.jhaEmergencyContact} />
                    <Field label='Nearest Hospital' value={d.jhaNearestHospital} />
                    <Field label='Meeting Point' value={d.jhaMeetingPoint} />
                    <Field label='Additional Hazards' value={d.jhaAdditionalHazards} wide />
                  </div>
                </CardBody>
              </InfoCard>
            )}
          </>
        )}

        {/* EXPENSE */}
        {isExpense && (
          <InfoCard accent='#7c3aed'>
            <CardHeader title='Expense Items' icon='🧯' />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ background: '#f8f4ff', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '8px 16px', textAlign: 'left', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase' }}>Category</th>
                  <th style={{ padding: '8px 16px', textAlign: 'left', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase' }}>Description</th>
                  <th style={{ padding: '8px 16px', textAlign: 'left', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase' }}>Date</th>
                  <th style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase' }}>Amount</th>
                </tr></thead>
                <tbody>
                  {(d.expenseItems || []).length === 0 && <tr><td colSpan={4} style={{ padding: '20px 16px', textAlign: 'center', color: '#9ca3af' }}>No expense items.</td></tr>}
                  {(d.expenseItems || []).map((item, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '10px 16px', fontWeight: 600 }}>{item.category || '—'}</td>
                      <td style={{ padding: '10px 16px', color: '#555' }}>{item.description || '—'}</td>
                      <td style={{ padding: '10px 16px', color: '#888', fontSize: 12 }}>{item.date || '—'}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700 }}>${(parseFloat(item.amount) || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                {(d.expenseItems || []).length > 0 && (
                  <tfoot><tr style={{ background: '#7c3aed', color: '#fff' }}>
                    <td colSpan={3} style={{ padding: '10px 16px', fontWeight: 800 }}>TOTAL</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 800, fontSize: 15 }}>${(parseFloat(d.expenseTotal) || 0).toFixed(2)}</td>
                  </tr></tfoot>
                )}
              </table>
            </div>
          </InfoCard>
        )}

        {/* INSPECTION */}
        {isInspection && (
          <InfoCard accent='#0891b2'>
            <CardHeader title={'Daily Inspection' + (d.inspectionType ? ' — ' + d.inspectionType : '')} icon='🔍' />
            <CardBody>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
                {d.odometer && <span style={{ fontSize: 14 }}><strong>Odometer:</strong> {d.odometer}</span>}
                <span style={{ padding: '5px 14px', borderRadius: 20, fontWeight: 700, fontSize: 13, background: d.allPass ? '#dcfce7' : '#fee2e2', color: d.allPass ? '#166534' : '#991b1b' }}>{d.allPass ? '✓ All Passed' : (d.failCount + ' Item(s) Failed')}</span>
              </div>
              {(d.checkItems || []).length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {(d.checkItems || []).map((item, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f0f0f0', background: item.pass === false ? '#fff5f5' : 'transparent' }}>
                        <td style={{ padding: '7px 12px', color: '#374151' }}>{item.label || item.name || ('Item ' + (i + 1))}</td>
                        <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 700, color: item.pass === false ? '#dc2626' : '#16a34a' }}>{item.pass === false ? 'FAIL' : 'PASS'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {d.defects && <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef2f2', borderRadius: 6, fontSize: 13 }}><strong>Defects:</strong> {d.defects}</div>}
            </CardBody>
          </InfoCard>
        )}

        {/* PHOTOS & VIDEOS */}
        {sub.photos && sub.photos.length > 0 && (() => {
          const videoSections = ['arrival-video', 'departure-video']
          const videos = sub.photos.filter(p => videoSections.includes(p.section))
          const regularPhotos = sub.photos.filter(p => !videoSections.includes(p.section))
          return (
            <>
              {videos.length > 0 && (
                <InfoCard>
                  <CardHeader title='Arrival & Departure Videos' icon='🎥' />
                  <CardBody>
                    {videos.map(v => (
                      <div key={v.id} style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a2332', marginBottom: 6 }}>{v.section === 'arrival-video' ? '🎥 Arrival — Before Work' : '🎦 Departure — After Work'}</div>
                        <video src={getPhotoUrl(v.storage_path)} controls style={{ width: '100%', borderRadius: 8, maxHeight: 300, background: '#000' }} />
                        {v.caption && <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{v.caption}</div>}
                      </div>
                    ))}
                  </CardBody>
                </InfoCard>
              )}
              {regularPhotos.length > 0 && (
                <InfoCard>
                  <CardHeader title={'Photos (' + regularPhotos.length + ')'} icon='📸' />
                  <CardBody>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                      {regularPhotos.sort((a, b) => a.display_order - b.display_order).map((photo, pIdx) => (
                        <div key={photo.id} style={{ borderRadius: 8, overflow: 'hidden', background: '#f0f0f0', border: '1px solid #e5e7eb', position: 'relative' }}>
                          <img src={getPhotoUrl(photo.storage_path)} alt={photo.caption || 'photo'}
                            onClick={() => { setLightboxPhotos(regularPhotos); setLightboxIdx(pIdx); }}
                            style={{ width: '100%', height: 130, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
                          <a href={getPhotoUrl(photo.storage_path)} download={'photo-'+(pIdx+1)+'.jpg'} target="_blank" rel="noreferrer"
                            style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(15,31,56,0.75)', color: '#fff', borderRadius: '50%', width: 22, height: 22, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
                            title="Save photo">DL</a>
                          {photo.caption && <div style={{ padding: '4px 8px', fontSize: 11, color: '#555' }}>{photo.caption}</div>}
                          {photo.section && photo.section !== 'work' && <div style={{ padding: '2px 8px', fontSize: 10, color: '#aaa', fontStyle: 'italic' }}>{photo.section}</div>}
                        </div>
                      ))}
                    </div>
                  </CardBody>
                </InfoCard>
              )}
            </>
          )
        })()}

      <PhotoLightboxUrl photos={lightboxPhotos} idx={lightboxIdx} onClose={()=>setLightboxIdx(-1)} onPrev={()=>setLightboxIdx(i=>i-1)} onNext={()=>setLightboxIdx(i=>i+1)} getUrl={getPhotoUrl} />
      </div>
    </div>
  )
}
