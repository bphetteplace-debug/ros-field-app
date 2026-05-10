import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchSubmission, getPhotoUrl, deleteSubmission } from '../lib/submissions'
import { useAuth } from '../lib/auth'
import NavBar from '../components/NavBar'

const COND_COLOR = { Good: '#16a34a', Fair: '#d97706', Poor: '#dc2626', Replaced: '#7c3aed' }

export default function ViewSubmissionPage() {
  const { id }        = useParams()
  const navigate      = useNavigate()
  const [sub, setSub]             = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState('')
  
  const [deleting, setDeleting] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState('')
  const { isAdmin, user } = useAuth()

  const handleResend = async () => {
    if (!sub) return
    setResending(true)
    setResendMsg('')
    try {
      const res = await fetch('/api/send-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: sub.id }),
      })
      const data = await res.json()
      if (res.ok) {
        setResendMsg('Report sent!')
      } else {
        setResendMsg('Error: ' + (data.error || res.status))
      }
    } catch (e) {
      setResendMsg('Error: ' + e.message)
    }
    setResending(false)
    setTimeout(() => setResendMsg(''), 4000)
  }

  const handleCopy = () => {
    if (!sub) return
    const d = sub.data || {}
    const isPM = (d.jobType || sub.work_type || '').toString().toUpperCase().includes('PM') ||
                 (d.jobType === 'PM')
    const formType = isPM ? 'pm' : 'sc'

    const prefill = {
      customerName:       sub.customer_name   || '',
      locationName:       sub.location_name   || '',
      truckNumber:        sub.truck_number     || '',
      typeOfWork:         sub.work_type        || '',
      glCode:             sub.gl_code          || d.glCode          || '',
      assetTag:           sub.asset_tag        || d.assetTag        || '',
      workArea:           sub.work_area        || d.workArea        || '',
      customerContact:    sub.contact          || d.customerContact || '',
      customerWorkOrder:  sub.work_order       || d.customerWorkOrder || '',
      techs:              d.techs              || [],
      warrantyWork:       d.warrantyWork       || false,
      costPerMile:        sub.cost_per_mile    != null ? String(sub.cost_per_mile) : '1.50',
      hourlyRate:         sub.labor_rate       != null ? String(sub.labor_rate)    : '115.00',
      arrestors:          d.arrestors          || [],
      flares:             d.flares             || [],
      heaters:            d.heaters            || [],
    }

    try {
      sessionStorage.setItem('ros_copy_prefill', JSON.stringify({ formType, ...prefill }))
    } catch(e) {
      console.warn('sessionStorage write failed', e)
    }
    navigate('/form?type=' + formType)
  }

  const handleDelete = async () => {
    if (!sub) return
    if (!window.confirm('Permanently delete this submission? This cannot be undone.')) return
    setDeleting(true)
    try {
      await deleteSubmission(sub.id)
      navigate('/admin')
    } catch(e) {
      setDeleteMsg('Delete failed: ' + e.message)
      setDeleting(false)
    }
  }

  useEffect(() => {
    fetchSubmission(id)
      .then(data => { setSub(data); setLoading(false) })
      .catch(err  => { setError(err.message); setLoading(false) })
  }, [id])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>
  if (error)   return <div style={{ padding: 40, color: '#c00' }}>Error: {error}</div>
  if (!sub)    return null

  const d = sub.data || {}
  const isJHA       = (d.jobType === 'JHA/JSA') || (sub.work_type || '').includes('JHA')
  const isExpense    = (d.jobType === 'Expense') || (sub.work_type || '').includes('Expense')
  const isInspection = (d.jobType === 'Daily Inspection') || (sub.work_type || '').includes('Inspect')
  const parts      = d.parts      || []
  const techs      = d.techs      || []
  const isWarranty = d.warrantyWork || false
  const jobType    = d.jobType || (sub.work_type && sub.work_type.toLowerCase().includes('pm') ? 'PM' : 'Service Call')
  const isPM   = jobType === 'PM'
  const prefix = isJHA ? 'JHA/JSA' : isPM ? 'PM' : 'SC'

  const arrestors   = isPM && Array.isArray(d.arrestors)  ? d.arrestors  : []
  const flares      = isPM && Array.isArray(d.flares)     ? d.flares     : []
  const heaters     = isPM && Array.isArray(d.heaters)    ? d.heaters    : []
  const scEquipment = !isPM && Array.isArray(d.scEquipment) ? d.scEquipment : []

  const fmt     = v => v != null ? '$' + parseFloat(v).toFixed(2) : '-'
  const fmtDate = v => v ? new Date(v + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  }) : '-'

  const sHdr  = { background: '#1a2332', color: '#fff', padding: '10px 16px', borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' }
  const sBody = { background: '#fff', border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 16 }
  const row2  = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }
  const fLbl  = { fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }
  const fVal  = { fontSize: 15, color: '#222', fontWeight: 500 }

  function Field({ label, value }) {
    return (
      <div>
        <div style={fLbl}>{label}</div>
        <div style={fVal}>{value || '-'}</div>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '0 auto', padding: '0 0 40px', background: '#f0f2f5', minHeight: '100vh' }}>

      <NavBar />

      {/* Header */}
      <div style={{ background: '#1a2332', color: '#fff', padding: '20px 16px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{ background: isJHA ? '#059669' : isPM ? '#e65c00' : '#2563eb', color: '#fff', fontWeight: 700, padding: '4px 10px', borderRadius: 6, fontSize: 13 }}>{prefix}</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{prefix} W/O #{sub.work_order}</div>
        </div>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>{sub.customer_name} — {sub.location_name}</div>
        <div style={{ color: '#aaa', fontSize: 13 }}>{fmtDate(sub.date)}</div>
        {sub.submitted_at && <div style={{ color: '#aaa', fontSize: 12 }}>Submitted {new Date(sub.submitted_at).toLocaleString()}</div>}

        {/* Action buttons */}
        <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Copy button — available to everyone */}
          <button
            onClick={handleCopy}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            📋 Copy this Submission
          </button>

          {/* Resend — admin only */}
          {/* Edit button — visible to submission owner OR admin */}
          {(isAdmin || (sub && user && sub.created_by === user.id)) && (
            <button onClick={() => navigate('/edit/' + sub.id)} style={{ background: '#f0f7ff', border: '1px solid #93c5fd', color: '#2563eb', borderRadius: 6, padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              ✏️ Edit Submission
            </button>
          )}
          {isAdmin && (
            <>
              <button
                onClick={handleResend}
                disabled={resending}
                style={{ background: resending ? '#aaa' : '#e65c00', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: resending ? 'not-allowed' : 'pointer' }}
              >
                {resending ? 'Sending...' : '📧 Resend Report'}
              </button>
              {resendMsg && (
                <span style={{ fontSize: 13, color: resendMsg.startsWith('Error') ? '#fca5a5' : '#86efac', fontWeight: 700 }}>
                  {resendMsg}
                </span>
              )}
            
              {/* Delete button */}
              <button onClick={handleDelete} disabled={deleting}
                style={{ background: deleting ? '#fef2f2' : '#fee2e2', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 6, padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: deleting ? 'not-allowed' : 'pointer' }}>
                {deleting ? 'Deleting...' : '🗑️ Delete'}
              </button>
              {deleteMsg && <span style={{ fontSize: 13, color: '#fca5a5', fontWeight: 700 }}>{deleteMsg}</span>}</>
          )}
        </div>
      </div>

      {!isJHA && (
      <>
      {/* JOB DETAILS */}
      <div style={{ margin: '0 12px 12px' }}>
        <div style={sHdr}>Job Details</div>
        <div style={sBody}>
          <div style={row2}>
            <Field label='Job Type'  value={isPM ? 'Preventive Maintenance' : 'Service Call'} />
            <Field label='Warranty'  value={isWarranty ? 'Yes - WARRANTY WORK' : 'No - Standard Billing'} />
            <Field label='Customer'  value={sub.customer_name} />
            <Field label='Truck'     value={sub.truck_number} />
            <Field label='Location'  value={sub.location_name} />
            <Field label='Type of Work' value={sub.work_type} />
            <Field label='Date'      value={fmtDate(sub.date)} />
            <Field label='Start Time'   value={sub.start_time} />
            <Field label='Departure'    value={sub.departure_time} />
            {(sub.asset_tag  || d.assetTag)        && <Field label='Asset Tag'  value={sub.asset_tag  || d.assetTag} />}
            {(sub.work_area  || d.workArea)        && <Field label='Work Area'  value={sub.work_area  || d.workArea} />}
            {(sub.contact    || d.customerContact) && <Field label='Contact'    value={sub.contact    || d.customerContact} />}
            {(sub.work_order || d.customerWorkOrder) && <Field label='Customer W/O #' value={sub.work_order || d.customerWorkOrder} />}
            {(sub.gl_code    || d.glCode)          && <Field label='GL Code'    value={sub.gl_code    || d.glCode} />}
            {d.lastServiceDate && <Field label='Last Service Date' value={d.lastServiceDate} />}
          </div>
          {/* GPS LOCATION LINK */}
          {d.gpsLat && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>GPS Location</span>
              <a
                href={'https://maps.google.com/?q=' + d.gpsLat + ',' + d.gpsLng}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', background: '#1a2332', color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
                📍 Open in Google Maps
              </a>
              {d.gpsAccuracy && <span style={{ fontSize: 11, color: '#888' }}>±{d.gpsAccuracy}m accuracy</span>}
              <span style={{ fontSize: 11, color: '#aaa' }}>{Number(d.gpsLat).toFixed(6)}, {Number(d.gpsLng).toFixed(6)}</span>
            </div>
          )}
        </div>
      </div>

      {/* DESCRIPTION */}
      {sub.summary && (
        <div style={{ margin: '0 12px 12px' }}>
          <div style={sHdr}>Description of Work</div>
          <div style={sBody}>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: '#333' }}>{sub.summary}</div>
            {d.equipment && <div style={{ marginTop: 8, fontSize: 13, color: '#666' }}><strong>Equipment:</strong> {d.equipment}</div>}
          </div>
        </div>
      )}

      {/* TECHS */}
      {techs.length > 0 && (
        <div style={{ margin: '0 12px 12px' }}>
          <div style={sHdr}>Field Techs</div>
          <div style={sBody}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {techs.map(t => (
                <div key={t} style={{ padding: '6px 14px', background: '#f0f0f0', borderRadius: 20, fontSize: 14, fontWeight: 600 }}>{t}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SC EQUIPMENT */}
      {!isPM && scEquipment.length > 0 && (
        <div style={{ margin: '0 12px 12px' }}>
          <div style={sHdr}>Equipment Worked On</div>
          <div style={sBody}>
            {scEquipment.map((item, i) => (
              <div key={i} style={{ marginBottom: i < scEquipment.length - 1 ? 12 : 0, paddingBottom: i < scEquipment.length - 1 ? 12 : 0, borderBottom: i < scEquipment.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1a2332', marginBottom: 4 }}>{item.type}</div>
                {item.notes && <div style={{ fontSize: 13, color: '#555', lineHeight: 1.5 }}>{item.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PM: FLAME ARRESTORS */}
      {isPM && arrestors.length > 0 && (
        <div style={{ margin: '0 12px 12px' }}>
          <div style={sHdr}>Flame Arrestors</div>
          <div style={sBody}>
            {arrestors.map((a, i) => (
              <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < arrestors.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Arrestor #{i + 1}{a.arrestorId ? ' - ' + a.arrestorId : ''}</div>
                <div style={row2}>
                  <Field label='Condition'      value={a.condition} />
                  <Field label='Filter Changed' value={a.filterChanged ? 'Yes' : 'No'} />
                </div>
                {a.notes && <div style={{ marginTop: 6, fontSize: 13, color: '#555' }}>{a.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PM: FLARES */}
      {isPM && flares.length > 0 && (
        <div style={{ margin: '0 12px 12px' }}>
          <div style={sHdr}>Flares</div>
          <div style={sBody}>
            {flares.map((f, i) => (
              <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < flares.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Flare #{i + 1}{f.flareId ? ' - ' + f.flareId : ''}</div>
                <div style={row2}>
                  <Field label='Condition' value={f.condition} />
                  <Field label='Pilot Lit' value={f.pilotLit ? 'Yes' : 'No'} />
                  {f.lastIgnition && <Field label='Last Ignition' value={f.lastIgnition} />}
                </div>
                {f.notes && <div style={{ marginTop: 6, fontSize: 13, color: '#555' }}>{f.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PM: HEATER TREATERS */}
      {isPM && heaters.length > 0 && (
        <div style={{ margin: '0 12px 12px' }}>
          <div style={sHdr}>Heater Treaters</div>
          <div style={sBody}>
            {heaters.map((h, hi) => {
              const fts = Array.isArray(h.firetubes) ? h.firetubes : []
              return (
                <div key={hi} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: hi < heaters.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>HT #{hi + 1}{h.heaterId ? ' - ' + h.heaterId : ''}</div>
                  <div style={row2}>
                    <Field label='Condition'      value={h.condition} />
                    {h.lastCleanDate && <Field label='Last Tube Clean' value={h.lastCleanDate} />}
                  </div>
                  {h.notes && <div style={{ marginTop: 6, fontSize: 13, color: '#555' }}>{h.notes}</div>}
                  {fts.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                        Firetubes ({fts.length})
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {fts.map((ft, fi) => (
                          <span key={fi} style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#f0f0f0', color: COND_COLOR[ft.condition] || '#333' }}>
                            FT {fi + 1}: {ft.condition || 'Good'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* PARTS */}
      {parts.length > 0 && (
        <div style={{ margin: '0 12px 12px' }}>
          <div style={sHdr}>Parts Used</div>
          <div style={{ background: '#fff', border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
            {parts.map((p, i) => (
              <div key={p.sku || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid #f0f0f0' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name || p.sku}</div>
                  <div style={{ color: '#888', fontSize: 12 }}>{p.sku} · Qty: {p.qty} · {fmt(p.price)} ea</div>
                </div>
                <div style={{ fontWeight: 700, color: isWarranty ? '#888' : '#e65c00' }}>
                  {isWarranty ? '-' : fmt((p.price || 0) * (p.qty || 0))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* COST SUMMARY */}
      <div style={{ margin: '0 12px 12px' }}>
        <div style={sHdr}>Cost Summary</div>
        <div style={sBody}>
          {isWarranty ? (
            <div style={{ textAlign: 'center', padding: 12, color: '#c00', fontWeight: 800, fontSize: 16, border: '2px solid #c00', borderRadius: 6 }}>WARRANTY - NO CHARGE</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span>Parts</span><span>{fmt(d.partsTotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span>Mileage ({sub.miles || 0} mi @ ${sub.cost_per_mile || 1.50}/mi)</span>
                <span>{fmt(d.mileageTotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span>Labor ({sub.labor_hours || 0} hrs @ ${sub.labor_rate || 115}/hr x {d.billableTechs || techs.length} tech{(d.billableTechs || techs.length) !== 1 ? 's' : ''})</span>
                <span>{fmt(d.laborTotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontWeight: 700, fontSize: 16 }}>
                <span>TOTAL</span>
                <span style={{ color: '#e65c00' }}>{fmt(d.grandTotal)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* PHOTOS */}
      </>
      )}

      {/* JHA-SPECIFIC SECTIONS */}
      {isJHA && (
        <div style={{ margin: '0 12px 12px' }}>
          <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, marginBottom: 12 }}>
            <div style={{ background: '#1a2332', color: '#fff', padding: '10px 16px', borderRadius: '8px 8px 0 0', fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' }}>JHA Overview</div>
            <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Job / Location</div><div style={{ fontWeight: 600 }}>{sub.customer_name || d.customerName || '-'}</div></div>
              <div><div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Date</div><div style={{ fontWeight: 600 }}>{sub.date || '-'}</div></div>
              <div><div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Supervisor</div><div style={{ fontWeight: 600 }}>{d.jhaSupervisor || d.supervisor || '-'}</div></div>
              <div><div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Truck #</div><div style={{ fontWeight: 600 }}>{sub.truck_number || d.truckNumber || '-'}</div></div>
              <div style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Crew Members</div><div style={{ fontWeight: 600 }}>{d.jhaCrewMembers || d.crewMembers || '-'}</div></div>
              {d.description && (<div style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Job Description</div><div style={{ fontWeight: 600 }}>{d.description}</div></div>)}
            </div>
          </div>
          {d.jhaSteps && d.jhaSteps.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ background: '#1a2332', color: '#fff', padding: '10px 16px', borderRadius: '8px 8px 0 0', fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' }}>Hazard Steps ({d.jhaSteps.length})</div>
              <div style={{ padding: 8 }}>
                {d.jhaSteps.map(function(step, i) {
                  var riskColor = step.risk === 'High' ? '#dc2626' : step.risk === 'Medium' ? '#d97706' : '#16a34a';
                  var riskBg = step.risk === 'High' ? '#fef2f2' : step.risk === 'Medium' ? '#fffbeb' : '#f0fdf4';
                  return (
                    <div key={i} style={{ padding: '10px 12px', marginBottom: 8, background: '#f8f9fa', borderRadius: 6, borderLeft: '4px solid ' + riskColor }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Step {i + 1}</div>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>{step.taskStep || step.task || step.step || '-'}</div>
                          {step.hazard && <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}><strong>Hazard:</strong> {step.hazard}</div>}
                          {(step.controls || step.control) && <div style={{ fontSize: 13, color: '#555' }}><strong>Control Measures:</strong> {step.controls || step.control}</div>}
                        </div>
                        {step.risk && <div style={{ padding: '2px 8px', borderRadius: 4, background: riskBg, color: riskColor, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{step.risk}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {d.jhaPPE && d.jhaPPE.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ background: '#1a2332', color: '#fff', padding: '10px 16px', borderRadius: '8px 8px 0 0', fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' }}>PPE Required</div>
              <div style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {d.jhaPPE.map(function(item, i) { return (
                  <span key={i} style={{ padding: '4px 10px', background: '#e0f2fe', color: '#0369a1', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>✓ {item}</span>
                ); })}
              </div>
            </div>
          )}
          {(d.jhaEmergencyContact || d.jhaNearestHospital || d.jhaMeetingPoint || d.jhaAdditionalHazards) && (
            <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ background: '#dc2626', color: '#fff', padding: '10px 16px', borderRadius: '8px 8px 0 0', fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' }}>Emergency Info</div>
              <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {d.jhaEmergencyContact && (<div><div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Emergency Contact</div><div style={{ fontWeight: 600 }}>{d.jhaEmergencyContact}</div></div>)}
                {d.jhaNearestHospital && (<div><div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Nearest Hospital</div><div style={{ fontWeight: 600 }}>{d.jhaNearestHospital}</div></div>)}
                {d.jhaMeetingPoint && (<div><div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Meeting Point</div><div style={{ fontWeight: 600 }}>{d.jhaMeetingPoint}</div></div>)}
                {d.jhaAdditionalHazards && (<div style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Additional Hazards</div><div style={{ fontWeight: 600 }}>{d.jhaAdditionalHazards}</div></div>)}
              </div>
            </div>
          )}
        </div>
      {isExpense && (
        <div style={{ margin: '0 12px 12px' }}>
          <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, marginBottom: 12 }}>
            <div style={{ background: '#1a2332', color: '#fff', padding: '10px 16px', borderRadius: '8px 8px 0 0', fontWeight: 700, fontSize: 14 }}>EXPENSE ITEMS</div>
            <div style={{ padding: 16 }}>
              {(d.expenseItems || []).length === 0 && <div style={{ color: '#999', fontSize: 14 }}>No expense items recorded.</div>}
              {(d.expenseItems || []).map(function(item, i) { return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{item.category || item.description || 'Item '+(i+1)}</div>
                    {item.description && item.category && <div style={{ color: '#666', fontSize: 12 }}>{item.description}</div>}
                    {item.date && <div style={{ color: '#999', fontSize: 12 }}>{item.date}</div>}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#1a2332' }}>${(parseFloat(item.amount)||0).toFixed(2)}</div>
                </div>
              )})}
              {(d.expenseItems||[]).length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15, paddingTop: 10, borderTop: '2px solid #1a2332', marginTop: 4 }}>
                  <span>TOTAL</span>
                  <span>${(parseFloat(d.expenseTotal)||0).toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {isInspection && (
        <div style={{ margin: '0 12px 12px' }}>
          <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, marginBottom: 12 }}>
            <div style={{ background: '#1a2332', color: '#fff', padding: '10px 16px', borderRadius: '8px 8px 0 0', fontWeight: 700, fontSize: 14 }}>
              DAILY INSPECTION
              {d.inspectionType && <span style={{ fontWeight: 400, marginLeft: 8, fontSize: 12, opacity: 0.8 }}>— {d.inspectionType}</span>}
            </div>
            <div style={{ padding: 16 }}>
              {d.odometer && <div style={{ marginBottom: 8, fontSize: 14 }}><strong>Odometer:</strong> {d.odometer}</div>}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                  <div style={{ background: d.allPass ? '#dcfce7' : '#fee2e2', color: d.allPass ? '#166534' : '#991b1b', padding: '4px 12px', borderRadius: 20, fontWeight: 700, fontSize: 13 }}>
                    {d.allPass ? '✓ All Passed' : '⚠️ '+d.failCount+' Item(s) Failed'}
                  </div>
                </div>
              </div>
              {(d.checkItems||[]).length > 0 && (
                <div>
                  {(d.checkItems||[]).map(function(item, i) { return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f5f5f5', fontSize: 14 }}>
                      <span>{item.label || item.name || 'Item '+(i+1)}</span>
                      <span style={{ fontWeight: 700, color: item.pass===false ? '#dc2626' : '#16a34a' }}>
                        {item.pass===false ? '✗ FAIL' : '✓ PASS'}
                      </span>
                    </div>
                  )})}
                </div>
              )}
              {d.defects && <div style={{ marginTop: 10, padding: 10, background: '#fef2f2', borderRadius: 6, fontSize: 14 }}><strong>Defects/Notes:</strong> {d.defects}</div>}
            </div>
          </div>
        </div>
      )}
      {sub.photos && sub.photos.length > 0 && (() => {
        const videoSections = ['arrival-video', 'departure-video']
        const videos = sub.photos.filter(p => videoSections.includes(p.section))
        const regularPhotos = sub.photos.filter(p => !videoSections.includes(p.section))
        return (
          <>
            {/* SC Arrival / Departure Videos */}
            {videos.length > 0 && (
              <div style={{ margin: '0 12px 12px' }}>
                <div style={sHdr}>📹 Arrival &amp; Departure Videos</div>
                <div style={{ background: '#fff', border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 12 }}>
                  {videos.map(v => (
                    <div key={v.id} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a2332', marginBottom: 4 }}>
                        {v.section === 'arrival-video' ? '📹 Arrival — Before Work' : '🎬 Departure — After Work'}
                      </div>
                      <video
                        src={getPhotoUrl(v.storage_path)}
                        controls
                        style={{ width: '100%', borderRadius: 6, maxHeight: 300, background: '#000' }}
                      />
                      {v.caption && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{v.caption}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Regular Photos */}
            {regularPhotos.length > 0 && (
              <div style={{ margin: '0 12px 12px' }}>
                <div style={sHdr}>Photos</div>
                <div style={{ background: '#fff', border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                    {regularPhotos.sort((a, b) => a.display_order - b.display_order).map(photo => (
                      <div key={photo.id} style={{ borderRadius: 8, overflow: 'hidden', background: '#f0f0f0' }}>
                        <img
                          src={getPhotoUrl(photo.storage_path)}
                          alt={photo.caption || 'photo'}
                          style={{ width: '100%', height: 120, objectFit: 'cover' }}
                        />
                        {photo.caption && <div style={{ padding: '4px 8px', fontSize: 11, color: '#666' }}>{photo.caption}</div>}
                        {photo.section && photo.section !== 'work' && (
                          <div style={{ padding: '2px 8px', fontSize: 10, color: '#aaa', fontStyle: 'italic' }}>{photo.section}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )
      })()}

    </div>
  )
}
