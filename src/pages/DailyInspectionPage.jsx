import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { saveSubmission, uploadPhotos, fetchSettings, getAuthToken, DEFAULT_TRUCKS, DEFAULT_TECHS } from '../lib/submissions'
import { saveDraft as saveDraftToStore, loadDraft as loadDraftFromStore, clearDraft as clearDraftFromStore } from '../lib/draftStore'
import { toast } from '../lib/toast'

// Pre-trip / post-trip inspection checklist items
const INSPECTION_ITEMS = [
  { id: 'lights_head', label: 'Headlights (Hi & Low Beam)', section: 'Lights' },
  { id: 'lights_tail', label: 'Taillights & Brake Lights', section: 'Lights' },
  { id: 'lights_turn', label: 'Turn Signals & Hazards', section: 'Lights' },
  { id: 'lights_work', label: 'Work / Auxiliary Lights', section: 'Lights' },
  { id: 'tires_front', label: 'Front Tires — Pressure & Tread', section: 'Tires & Wheels' },
  { id: 'tires_rear', label: 'Rear Tires — Pressure & Tread', section: 'Tires & Wheels' },
  { id: 'tires_spare', label: 'Spare Tire Present & Inflated', section: 'Tires & Wheels' },
  { id: 'wheels_lugs', label: 'Lug Nuts Tight / No Missing', section: 'Tires & Wheels' },
  { id: 'brakes_parking', label: 'Parking Brake Functional', section: 'Brakes' },
  { id: 'brakes_service', label: 'Service Brakes Responsive', section: 'Brakes' },
  { id: 'fluid_oil', label: 'Engine Oil Level', section: 'Fluids' },
  { id: 'fluid_coolant', label: 'Coolant Level', section: 'Fluids' },
  { id: 'fluid_washer', label: 'Windshield Washer Fluid', section: 'Fluids' },
  { id: 'fluid_power', label: 'Power Steering Fluid', section: 'Fluids' },
  { id: 'fluid_brake', label: 'Brake Fluid Level', section: 'Fluids' },
  { id: 'body_wipers', label: 'Windshield Wipers', section: 'Body & Glass' },
  { id: 'body_mirrors', label: 'Mirrors — Clean & Adjusted', section: 'Body & Glass' },
  { id: 'body_glass', label: 'Windshield / Glass — No Cracks', section: 'Body & Glass' },
  { id: 'body_horn', label: 'Horn Functional', section: 'Body & Glass' },
  { id: 'body_doors', label: 'Doors Open / Close / Lock', section: 'Body & Glass' },
  { id: 'safety_extinguisher', label: 'Fire Extinguisher Present & Charged', section: 'Safety Equipment' },
  { id: 'safety_triangle', label: 'Reflective Triangles / Flares', section: 'Safety Equipment' },
  { id: 'safety_firstaid', label: 'First Aid Kit Present', section: 'Safety Equipment' },
  { id: 'safety_seatbelt', label: 'Seatbelts Functional', section: 'Safety Equipment' },
  { id: 'safety_ppe', label: 'PPE Onboard (Hard Hat, Vest, Gloves)', section: 'Safety Equipment' },
  { id: 'engine_noises', label: 'No Unusual Engine Noises', section: 'Engine & Drivetrain' },
  { id: 'engine_gauges', label: 'Gauges Normal (Oil Pressure, Temp)', section: 'Engine & Drivetrain' },
  { id: 'engine_exhaust', label: 'No Excessive Exhaust Smoke', section: 'Engine & Drivetrain' },
  { id: 'engine_leaks', label: 'No Visible Leaks (Oil, Fuel, Coolant)', section: 'Engine & Drivetrain' },
  { id: 'cargo_secured', label: 'Cargo / Equipment Secured', section: 'Cargo & Trailer' },
  { id: 'cargo_straps', label: 'Tie-Downs / Straps in Good Condition', section: 'Cargo & Trailer' },
  { id: 'cargo_weight', label: 'Load Within Rated Capacity', section: 'Cargo & Trailer' },
]

const PASS_FAIL_NA = ['Pass', 'Fail', 'N/A']
const SECTIONS = [...new Set(INSPECTION_ITEMS.map(i => i.section))]

function mkChecks() {
  const out = {}
  for (const item of INSPECTION_ITEMS) out[item.id] = 'Pass'
  return out
}

export default function DailyInspectionPage() {
  const { user, profile, isDemo } = useAuth()
  const navigate = useNavigate()

  const [TRUCKS, setTRUCKS] = useState(DEFAULT_TRUCKS)
  const [TECHS_LIST, setTECHS_LIST] = useState(DEFAULT_TECHS)

  const [techName, setTechName] = useState('')
  const [truckNumber, setTruckNumber] = useState('')
  const [inspType, setInspType] = useState('Pre-Trip')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [odometer, setOdometer] = useState('')
  const [checks, setChecks] = useState(mkChecks())
  const [defects, setDefects] = useState('')
  const [photos, setPhotos] = useState([])
  // Memoize photo preview URLs so each render doesn't leak one per photo.
  // Revokes previous URLs when the photos array changes (or on unmount).
  const photoUrls = useMemo(() => photos.map(p => URL.createObjectURL(p)), [photos])
  useEffect(() => () => photoUrls.forEach(URL.revokeObjectURL), [photoUrls])
  const [saving, setSaving] = useState(false)
  const [gpsLat, setGpsLat] = useState(null)
  const [gpsLng, setGpsLng] = useState(null)
  const [gpsAccuracy, setGpsAccuracy] = useState(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [gpsError, setGpsError] = useState(null)
  const captureGPS = () => {
    if (!navigator.geolocation) { setGpsError('GPS not supported on this device'); return }
    setGpsLoading(true); setGpsError(null)
    navigator.geolocation.getCurrentPosition(
      pos => { setGpsLat(pos.coords.latitude); setGpsLng(pos.coords.longitude); setGpsAccuracy(Math.round(pos.coords.accuracy)); setGpsLoading(false) },
      err => { setGpsError('GPS error: ' + err.message); setGpsLoading(false) },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }
  const [saveError, setSaveError] = useState(null)
  const [draftSaved, setDraftSaved] = useState(false)
  const saveDraft = async () => {
    try {
      await saveDraftToStore('inspection',
        { techName, truckNumber, inspType, date, odometer, checks, defects,
          gpsLat, gpsLng, gpsAccuracy },
        photos)
      setDraftSaved(true); setTimeout(() => setDraftSaved(false), 2000)
    } catch(e) { console.warn('[Inspection] saveDraft failed:', e?.message || e) }
  }
  const clearDraft = async () => { try { await clearDraftFromStore('inspection') } catch(e) {} }

  // Auto-save every 2s on any change so a tech who refreshes mid-form
  // doesn't have to remember to hit "Save Draft" first.
  useEffect(() => {
    const t = setTimeout(saveDraft, 2000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techName, truckNumber, inspType, date, odometer, checks, defects, photos, gpsLat, gpsLng, gpsAccuracy])

  useEffect(() => {
    fetchSettings().then(s => {
      if (!s) return
      if (s.trucks && s.trucks.length > 0) setTRUCKS(s.trucks)
      if (s.techs && s.techs.length > 0) setTECHS_LIST(s.techs)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (profile?.full_name) setTechName(profile.full_name)
    if (profile?.truck_number) setTruckNumber(profile.truck_number)
    let cancelled = false
    ;(async () => {
      try {
        const draft = await loadDraftFromStore('inspection')
        if (cancelled || !draft) return
        const saved = draft.fields || {}
        if (saved.techName) setTechName(saved.techName)
        if (saved.truckNumber) setTruckNumber(saved.truckNumber)
        if (saved.inspType) setInspType(saved.inspType)
        if (saved.date) setDate(saved.date)
        if (saved.odometer) setOdometer(saved.odometer)
        if (saved.checks) setChecks(saved.checks)
        if (saved.defects) setDefects(saved.defects)
        if (saved.gpsLat != null) setGpsLat(saved.gpsLat)
        if (saved.gpsLng != null) setGpsLng(saved.gpsLng)
        if (saved.gpsAccuracy != null) setGpsAccuracy(saved.gpsAccuracy)
        if (Array.isArray(draft.photos) && draft.photos.length > 0) setPhotos(draft.photos)
      } catch (e) {
        console.warn('[Inspection] loadDraft failed:', e?.message || e)
      }
    })()
    return () => { cancelled = true }
  }, [profile?.full_name, profile?.truck_number])

  const setCheck = (id, val) => setChecks(c => ({ ...c, [id]: val }))
  const failCount = Object.values(checks).filter(v => v === 'Fail').length
  const allPass = failCount === 0

  const addPhoto = (files) => {
    const arr = Array.from(files)
    setPhotos(ps => [...ps, ...arr].slice(0, 10))
  }

  const handleSubmit = async () => {
    if (isDemo) { setSaveError('Demo mode — read only'); return }
    if (!user?.id) { setSaveError('Not signed in — please log in again'); return }
    if (!techName) { setSaveError('Tech name is required'); return }
    if (!truckNumber) { setSaveError('Truck number is required'); return }
    setSaving(true); setSaveError(null)
    try {
      const checkArray = INSPECTION_ITEMS.map(item => ({
        id: item.id,
        label: item.label,
        section: item.section,
        result: checks[item.id] || 'Pass',
      }))
      const formData = {
        pmNumber: null,
        jobType: 'Daily Inspection',
        warrantyWork: false,
        customerName: 'Internal',
        truckNumber,
        locationName: techName,
        customerContact: '',
        customerWorkOrder: '',
        typeOfWork: inspType + ' Inspection',
        glCode: '',
        assetTag: truckNumber,
        workArea: '',
        date,
        startTime: '',
        departureTime: '',
        lastServiceDate: '',
        description: defects || (allPass ? 'All items pass — no defects noted.' : failCount + ' item(s) failed. See defects.'),
        techs: [techName],
        equipment: 'Truck ' + truckNumber + ' - Odometer: ' + (odometer || 'N/A'),
        parts: [],
        miles: 0,
        costPerMile: 0,
        laborHours: 0,
        hourlyRate: 0,
        billableTechs: 1,
        arrestors: [],
        flares: [],
        heaters: [],
        scEquipment: [],
        inspectionType: inspType,
        odometer,
        checkItems: checkArray,
        failCount,
        allPass,
        defects,
        gpsLat, gpsLng, gpsAccuracy,
      }
      const submission = await saveSubmission(formData, user.id, 'daily_inspection')
      if (photos.length > 0) {
        await uploadPhotos(submission.id, photos.map((f, i) => ({ file: f, caption: 'Inspection Photo ' + (i + 1) })), 'insp')
      }
      // Fire email
      try {
        const token = getAuthToken()
        fetch('/api/send-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId: submission.id, userToken: token }) }).then(async r => { if (!r.ok) { const t = await r.text().catch(() => r.statusText || ''); throw new Error('HTTP ' + r.status + ' — ' + (t || '').slice(0, 240)); } }).catch(err => { console.error('Email send failed:', err); toast.error('Email failed for inspection #' + (submission.pm_number || submission.id) + '\n\n' + (err.message || err) + '\n\nThe inspection was saved. Open it from the list and use "Send Report" to retry.'); })
      } catch (_) {}
      await clearDraft()
      navigate('/submissions')
    } catch (e) {
      setSaveError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const sHdr = { background: '#1a2332', color: '#fff', padding: '8px 12px', fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', borderRadius: '6px 6px 0 0' }
  const sBody = { background: '#fff', padding: '12px', border: '1px solid #e0e0e0', borderTop: 'none', borderRadius: '0 0 6px 6px' }
  const fld = { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }
  const lbl = { fontSize: 12, color: '#555', fontWeight: 600 }
  const inp = { padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, width: '100%', boxSizing: 'border-box' }
  const row = { display: 'flex', gap: 12, marginBottom: 10 }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '0 0 40px', fontFamily: 'system-ui,sans-serif' }}>
      {/* HEADER */}
      <div style={{ background: '#1a2332', padding: '12px 16px', position: 'sticky', top: 0, zIndex: 100, marginBottom: 12 }}>
        <div style={{ color: '#e65c00', fontWeight: 800, fontSize: 17 }}>ReliableTrack</div>
        <div style={{ color: '#aaa', fontSize: 10, fontWeight: 400 }}>Built for Reliable Oilfield Services</div>
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>Daily Vehicle Inspection</div>
      </div>

      {saveError && <div style={{ margin: '0 0 10px', background: '#fee', border: '1px solid #faa', borderRadius: 6, padding: '8px 12px', color: '#c00', fontSize: 13 }}>{saveError}</div>}

      {/* TECH INFO */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Tech & Vehicle</div>
        <div style={sBody}>
          <div style={row}>
            <div style={fld}>
              <label style={lbl}>Technician *</label>
              <select style={inp} value={techName} onChange={e => setTechName(e.target.value)}>
                <option value="">-- Select Tech --</option>
                {TECHS_LIST.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={fld}>
              <label style={lbl}>Truck # *</label>
              <select style={inp} value={truckNumber} onChange={e => setTruckNumber(e.target.value)}>
                <option value="">-- Select --</option>
                {TRUCKS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={row}>
            <div style={fld}>
              <label style={lbl}>Inspection Type</label>
              <select style={inp} value={inspType} onChange={e => setInspType(e.target.value)}>
                <option>Pre-Trip</option>
                <option>Post-Trip</option>
              </select>
            </div>
            <div style={fld}>
              <label style={lbl}>Date</label>
              <input type="date" style={inp} value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
          <div style={fld}>
            <label style={lbl}>Odometer Reading</label>
            <input type="number" min="0" style={inp} value={odometer} onChange={e => setOdometer(e.target.value)} placeholder="Miles" />
          {/* GPS CAPTURE */}
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={captureGPS} disabled={gpsLoading}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: gpsLat ? '#16a34a' : '#1a2332', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: gpsLoading ? 'not-allowed' : 'pointer' }}>
              {gpsLoading ? '⏳ Getting GPS...' : gpsLat ? '📍 GPS Captured' : '📍 Capture GPS Location'}
            </button>
            {gpsLat && <a href={'https://maps.google.com/?q=' + gpsLat + ',' + gpsLng} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}>View on Map ↗</a>}
            {gpsLat && <span style={{ fontSize: 11, color: '#888' }}>±{gpsAccuracy}m</span>}
            {gpsError && <span style={{ fontSize: 11, color: '#c00' }}>{gpsError}</span>}
          </div>
          </div>
        </div>
      </div>

      {/* STATUS BANNER */}
      {failCount > 0 && (
        <div style={{ margin: '0 0 10px', background: '#fee2e2', border: '2px solid #dc2626', borderRadius: 6, padding: '8px 12px', color: '#991b1b', fontWeight: 700, fontSize: 13, textAlign: 'center' }}>
          ⚠️ {failCount} ITEM{failCount !== 1 ? 'S' : ''} FAILED — Supervisor must be notified before operating vehicle
        </div>
      )}

      {/* CHECKLIST BY SECTION */}
      {SECTIONS.map(section => {
        const items = INSPECTION_ITEMS.filter(i => i.section === section)
        const sectionFails = items.filter(item => checks[item.id] === 'Fail').length
        return (
          <div key={section} style={{ margin: '0 0 10px' }}>
            <div style={{ ...sHdr, background: sectionFails > 0 ? '#991b1b' : '#1a2332' }}>
              {section} {sectionFails > 0 ? '⚠️ ' + sectionFails + ' FAIL' : ''}
            </div>
            <div style={sBody}>
              {items.map(item => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 13, color: checks[item.id] === 'Fail' ? '#dc2626' : '#333', fontWeight: checks[item.id] === 'Fail' ? 700 : 400, flex: 1 }}>
                    {item.label}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {PASS_FAIL_NA.map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setCheck(item.id, opt)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 5,
                          border: '1.5px solid ' + (checks[item.id] === opt ? (opt === 'Pass' ? '#16a34a' : opt === 'Fail' ? '#dc2626' : '#6b7280') : '#ddd'),
                          background: checks[item.id] === opt ? (opt === 'Pass' ? '#dcfce7' : opt === 'Fail' ? '#fee2e2' : '#f3f4f6') : '#fff',
                          color: checks[item.id] === opt ? (opt === 'Pass' ? '#16a34a' : opt === 'Fail' ? '#dc2626' : '#374151') : '#888',
                          fontSize: 11,
                          fontWeight: checks[item.id] === opt ? 700 : 400,
                          cursor: 'pointer',
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* DEFECTS */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={{ ...sHdr, background: failCount > 0 ? '#991b1b' : '#1a2332' }}>
          Defects / Notes {failCount > 0 ? '(REQUIRED)' : '(Optional)'}
        </div>
        <div style={sBody}>
          <textarea
            style={{ ...inp, minHeight: 80, resize: 'vertical', border: failCount > 0 && !defects ? '2px solid #dc2626' : '1px solid #ddd' }}
            value={defects}
            onChange={e => setDefects(e.target.value)}
            placeholder={failCount > 0 ? 'REQUIRED: Describe all failed items in detail...' : 'Any notes, concerns, or observations...'}
          />
          {failCount > 0 && !defects && (
            <div style={{ color: '#dc2626', fontSize: 12, marginTop: 4, fontWeight: 600 }}>Please describe failed items before submitting</div>
          )}
        </div>
      </div>

      {/* PHOTOS */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Photos (Optional)</div>
        <div style={sBody}>
          {photos.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
              {photos.map((photo, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={photoUrls[i]} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                  <button type="button" onClick={() => setPhotos(ps => ps.filter((_, x) => x !== i))} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>x</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, background: '#e65c00', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700, gap: 6 }}>
              Take Photo
              <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={e => addPhoto(e.target.files)} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, background: '#f5f5f5', color: '#333', borderRadius: 6, cursor: 'pointer', fontWeight: 700, border: '1px solid #ddd', gap: 6 }}>
              Choose Files
              <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => addPhoto(e.target.files)} />
            </label>
          </div>
          <div style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 4 }}>{photos.length}/10 photos</div>
        </div>
      </div>

      {/* SUBMIT */}
      <div>
        <div style={{ marginBottom: 8 }}>
          <button type="button" onClick={saveDraft} style={{ width: '100%', padding: 10, background: draftSaved ? '#16a34a' : '#f5f5f5', color: draftSaved ? '#fff' : '#555', border: '1px solid ' + (draftSaved ? '#16a34a' : '#ddd'), borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            {draftSaved ? '✅ Draft Saved!' : '💾 Save Draft'}
          </button>
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || (failCount > 0 && !defects)}
          style={{ width: '100%', padding: 14, background: saving ? '#ccc' : failCount > 0 && !defects ? '#aaa' : allPass ? '#16a34a' : '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 16, cursor: (saving || (failCount > 0 && !defects)) ? 'not-allowed' : 'pointer' }}
        >
          {saving ? 'Saving...' : failCount > 0 && !defects ? 'Describe Defects to Submit' : allPass ? '✓ Submit — All Pass' : '⚠️ Submit with ' + failCount + ' Defect' + (failCount !== 1 ? 's' : '')}
        </button>
      </div>
    </div>
  )
}
