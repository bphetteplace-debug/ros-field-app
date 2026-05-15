import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { saveSubmission, uploadPhotos, fetchSettings, DEFAULT_TRUCKS, DEFAULT_TECHS } from '../lib/submissions'

const PPE_ITEMS = [
  'Hard Hat', 'Safety Glasses / Goggles', 'Face Shield', 'High-Vis Vest / Coveralls',
  'Steel-Toed Boots', 'Cut-Resistant Gloves', 'Chemical-Resistant Gloves', 'Leather Work Gloves',
  'Hearing Protection', 'Respirator / N95 Mask', 'Fall Protection / Harness',
  'Fire-Resistant Clothing (FRC)', 'Safety Harness / Lanyard', 'Gas Monitor / H2S Detector',
]

const HAZARD_RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical']
const RISK_COLORS = { Low: '#16a34a', Medium: '#d97706', High: '#dc2626', Critical: '#7c3aed' }

function mkStep() {
  return { taskStep: '', hazard: '', controls: '', risk: 'Medium', responsible: '' }
}

const DRAFT_KEY = 'ros_jha_draft'

export default function JHAPage() {
  const { user, profile, isDemo } = useAuth()
  const navigate = useNavigate()
  const draftTimerRef = useRef(null)

  const [TRUCKS, setTRUCKS] = useState(DEFAULT_TRUCKS)
  const [TECHS_LIST, setTECHS_LIST] = useState(DEFAULT_TECHS)

  // Job Info
  const [techName, setTechName] = useState('')
  const [truckNumber, setTruckNumber] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [jobLocation, setJobLocation] = useState('')
  const [workOrder, setWorkOrder] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [supervisor, setSupervisor] = useState('')
  const [crewMembers, setCrewMembers] = useState('')

  // Hazard steps
  const [steps, setSteps] = useState([mkStep()])

  // PPE
  const [selectedPPE, setSelectedPPE] = useState({})

  // Emergency info
  const [emergencyContact, setEmergencyContact] = useState('')
  const [nearestHospital, setNearestHospital] = useState('')
  const [meetingPoint, setMeetingPoint] = useState('')

  // Additional
  const [additionalHazards, setAdditionalHazards] = useState('')
  const [photos, setPhotos] = useState([])

  // GPS
  const [gpsLat, setGpsLat] = useState(null)
  const [gpsLng, setGpsLng] = useState(null)
  const [gpsAccuracy, setGpsAccuracy] = useState(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [gpsError, setGpsError] = useState(null)

  // Submit
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [draftSaved, setDraftSaved] = useState(false)

  const captureGPS = () => {
    if (!navigator.geolocation) { setGpsError('GPS not supported'); return }
    setGpsLoading(true); setGpsError(null)
    navigator.geolocation.getCurrentPosition(
      pos => { setGpsLat(pos.coords.latitude); setGpsLng(pos.coords.longitude); setGpsAccuracy(Math.round(pos.coords.accuracy)); setGpsLoading(false) },
      err => { setGpsError('GPS error: ' + err.message); setGpsLoading(false) },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  const getDraftData = useCallback(() => ({
    techName, truckNumber, date, jobLocation, workOrder, jobDescription,
    supervisor, crewMembers, steps, selectedPPE, emergencyContact,
    nearestHospital, meetingPoint, additionalHazards
  }), [techName, truckNumber, date, jobLocation, workOrder, jobDescription,
       supervisor, crewMembers, steps, selectedPPE, emergencyContact,
       nearestHospital, meetingPoint, additionalHazards])

  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...getDraftData(), savedAt: new Date().toISOString() }))
      setDraftSaved(true)
      setTimeout(() => setDraftSaved(false), 2000)
    } catch(e) {}
  }, [getDraftData])

  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY) } catch(e) {} }

  // Auto-save every 2s on changes
  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(saveDraft, 2000)
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current) }
  }, [techName, truckNumber, date, jobLocation, workOrder, jobDescription,
      supervisor, crewMembers, steps, selectedPPE, emergencyContact,
      nearestHospital, meetingPoint, additionalHazards, saveDraft])

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
    // Load draft
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
      if (saved) {
        if (saved.techName) setTechName(saved.techName)
        if (saved.truckNumber) setTruckNumber(saved.truckNumber)
        if (saved.date) setDate(saved.date)
        if (saved.jobLocation) setJobLocation(saved.jobLocation)
        if (saved.workOrder) setWorkOrder(saved.workOrder)
        if (saved.jobDescription) setJobDescription(saved.jobDescription)
        if (saved.supervisor) setSupervisor(saved.supervisor)
        if (saved.crewMembers) setCrewMembers(saved.crewMembers)
        if (saved.steps && saved.steps.length > 0) setSteps(saved.steps)
        if (saved.selectedPPE) setSelectedPPE(saved.selectedPPE)
        if (saved.emergencyContact) setEmergencyContact(saved.emergencyContact)
        if (saved.nearestHospital) setNearestHospital(saved.nearestHospital)
        if (saved.meetingPoint) setMeetingPoint(saved.meetingPoint)
        if (saved.additionalHazards) setAdditionalHazards(saved.additionalHazards)
      }
    } catch(e) {}
  }, [profile?.full_name, profile?.truck_number])

  const updStep = (i, k, v) => setSteps(ss => ss.map((s, idx) => idx === i ? { ...s, [k]: v } : s))
  const addStep = () => setSteps(ss => [...ss, mkStep()])
  const removeStep = (i) => setSteps(ss => ss.filter((_, idx) => idx !== i))

  const togglePPE = (item) => setSelectedPPE(p => ({ ...p, [item]: !p[item] }))

  const addPhoto = (files) => {
    const arr = Array.from(files)
    setPhotos(ps => [...ps, ...arr].slice(0, 10))
  }

  const highRiskCount = steps.filter(s => s.risk === 'High' || s.risk === 'Critical').length

  const handleSubmit = async () => {
    if (isDemo) { setSaveError('Demo mode — read only'); return }
    if (!techName) { setSaveError('Tech name is required'); return }
    if (!jobLocation) { setSaveError('Job location is required'); return }
    if (steps.some(s => !s.taskStep || !s.hazard || !s.controls)) {
      setSaveError('All hazard steps must have Task, Hazard, and Controls filled in'); return
    }
    setSaving(true); setSaveError(null)
    try {
      const ppeList = PPE_ITEMS.filter(item => selectedPPE[item])
      const formData = {
        pmNumber: null,
        jobType: 'JHA/JSA',
        warrantyWork: false,
        customerName: jobLocation,
        truckNumber,
        locationName: jobLocation,
        customerContact: supervisor,
        customerWorkOrder: workOrder,
        typeOfWork: 'JHA/JSA',
        glCode: '',
        assetTag: '',
        workArea: jobLocation,
        date,
        startTime: '',
        departureTime: '',
        description: jobDescription,
        techs: [techName, ...(crewMembers ? crewMembers.split(',').map(s => s.trim()).filter(Boolean) : [])],
        equipment: '',
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
        // JHA-specific (go into data JSONB via saveSubmission)
        jhaSteps: steps,
        jhaHighRiskCount: highRiskCount,
        jhaPPE: ppeList,
        jhaEmergencyContact: emergencyContact,
        jhaNearestHospital: nearestHospital,
        jhaMeetingPoint: meetingPoint,
        jhaAdditionalHazards: additionalHazards,
        jhaCrewMembers: crewMembers,
        jhaSupervisor: supervisor,
        gpsLat,
        gpsLng,
        gpsAccuracy,
      }
      const submission = await saveSubmission(formData, user.id, 'jha')
      if (photos.length > 0) {
        await uploadPhotos(submission.id, photos.map((f, i) => ({ file: f, caption: 'JHA Photo ' + (i + 1) })), 'jha')
      }
      // Fire email
      try {
        const token = Object.keys(localStorage).map(k => k.startsWith('sb-') && k.endsWith('-auth-token') ? JSON.parse(localStorage.getItem(k))?.access_token : null).find(Boolean)
        fetch('/api/send-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId: submission.id, userToken: token }) }).then(async r => { if (!r.ok) { const t = await r.text().catch(() => r.statusText || ''); throw new Error('HTTP ' + r.status + ' — ' + (t || '').slice(0, 240)); } }).catch(err => { console.error('Email send failed:', err); alert('Email failed for JHA #' + (submission.pm_number || submission.id) + '\n\n' + (err.message || err) + '\n\nThe JHA was saved. Open it from the list and use "Send Report" to retry.'); })
      } catch(_) {}
      clearDraft()
      navigate('/submissions')
    } catch(e) {
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
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>Job Hazard Analysis / JSA</div>
      </div>

      {saveError && <div style={{ margin: '0 0 10px', background: '#fee', border: '1px solid #faa', borderRadius: 6, padding: '8px 12px', color: '#c00', fontSize: 13 }}>{saveError}</div>}

      {highRiskCount > 0 && (
        <div style={{ margin: '0 0 10px', background: '#fee2e2', border: '2px solid #dc2626', borderRadius: 6, padding: '8px 12px', color: '#991b1b', fontWeight: 700, fontSize: 13, textAlign: 'center' }}>
          ⚠️ {highRiskCount} HIGH/CRITICAL RISK step{highRiskCount !== 1 ? 's' : ''} identified — supervisor approval required before starting work
        </div>
      )}

      {/* JOB INFO */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Job Information</div>
        <div style={sBody}>
          <div style={row}>
            <div style={fld}>
              <label style={lbl}>Lead Tech / Supervisor *</label>
              <select style={inp} value={techName} onChange={e => setTechName(e.target.value)}>
                <option value="">-- Select Tech --</option>
                {TECHS_LIST.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={fld}>
              <label style={lbl}>Truck #</label>
              <select style={inp} value={truckNumber} onChange={e => setTruckNumber(e.target.value)}>
                <option value="">-- Select --</option>
                {TRUCKS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={lbl}>Date</label>
            <input type="date" style={inp} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={lbl}>Job Location / Site *</label>
            <input style={inp} value={jobLocation} onChange={e => setJobLocation(e.target.value)} placeholder="Site name, lease, GPS coordinates..." />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={lbl}>Job / Task Description</label>
            <textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={jobDescription} onChange={e => setJobDescription(e.target.value)} placeholder="Briefly describe the work to be performed..." />
          </div>
          <div style={row}>
            <div style={fld}>
              <label style={lbl}>On-Site Supervisor</label>
              <input style={inp} value={supervisor} onChange={e => setSupervisor(e.target.value)} placeholder="Name" />
            </div>
          </div>
          <div style={{ marginBottom: 4 }}>
            <label style={lbl}>Crew Members (comma-separated)</label>
            <input style={inp} value={crewMembers} onChange={e => setCrewMembers(e.target.value)} placeholder="John Smith, Jane Doe..." />
          </div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={captureGPS} disabled={gpsLoading} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: gpsLat ? '#16a34a' : '#1a2332', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: gpsLoading ? 'not-allowed' : 'pointer' }}>
              {gpsLoading ? '⏳ Getting GPS...' : gpsLat ? '📍 GPS Captured' : '📍 Capture GPS Location'}
            </button>
            {gpsLat && <a href={'https://maps.google.com/?q=' + gpsLat + ',' + gpsLng} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}>View on Map ↗</a>}
            {gpsLat && <span style={{ fontSize: 11, color: '#888' }}>±{gpsAccuracy}m</span>}
            {gpsError && <span style={{ fontSize: 11, color: '#c00' }}>{gpsError}</span>}
          </div>
        </div>
      </div>

      {/* HAZARD IDENTIFICATION TABLE */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={{ ...sHdr, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Hazard Identification &amp; Controls</span>
          <button type="button" onClick={addStep} style={{ background: '#e65c00', color: '#fff', border: 'none', borderRadius: 5, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>+ Add Step</button>
        </div>
        <div style={sBody}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>List each task step, identify hazards, and define control measures.</div>
          {steps.map((step, i) => (
            <div key={i} style={{ border: '2px solid ' + (step.risk === 'High' || step.risk === 'Critical' ? RISK_COLORS[step.risk] : '#e0e0e0'), borderRadius: 8, padding: 10, marginBottom: 12, background: step.risk === 'Critical' ? '#faf5ff' : step.risk === 'High' ? '#fff5f5' : '#fafafa' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 700, color: '#1a2332', fontSize: 13 }}>Step {i + 1}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select value={step.risk} onChange={e => updStep(i, 'risk', e.target.value)} style={{ border: '2px solid ' + RISK_COLORS[step.risk], borderRadius: 5, padding: '3px 6px', fontSize: 11, fontWeight: 700, color: RISK_COLORS[step.risk], background: '#fff', cursor: 'pointer' }}>
                    {HAZARD_RISK_LEVELS.map(r => <option key={r} value={r}>{r} Risk</option>)}
                  </select>
                  {steps.length > 1 && (
                    <button type="button" onClick={() => removeStep(i)} style={{ color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>×</button>
                  )}
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={lbl}>Task Step *</label>
                <input style={inp} value={step.taskStep} onChange={e => updStep(i, 'taskStep', e.target.value)} placeholder="e.g. Connect flowline to wellhead" />
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ ...lbl, color: '#dc2626' }}>Hazard(s) *</label>
                <input style={{ ...inp, borderColor: step.risk === 'High' || step.risk === 'Critical' ? RISK_COLORS[step.risk] : '#ddd' }} value={step.hazard} onChange={e => updStep(i, 'hazard', e.target.value)} placeholder="e.g. H2S exposure, high pressure, pinch points" />
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ ...lbl, color: '#16a34a' }}>Control Measures *</label>
                <textarea style={{ ...inp, minHeight: 55, resize: 'vertical' }} value={step.controls} onChange={e => updStep(i, 'controls', e.target.value)} placeholder="e.g. Wear H2S monitor, bleed pressure before connecting, spotter required" />
              </div>
              <div style={fld}>
                <label style={lbl}>Person Responsible</label>
                <input style={inp} value={step.responsible} onChange={e => updStep(i, 'responsible', e.target.value)} placeholder="Name or 'All Crew'" />
              </div>
            </div>
          ))}
          <button type="button" onClick={addStep} style={{ width: '100%', padding: 8, background: '#f5f5f5', border: '1px dashed #ccc', borderRadius: 6, cursor: 'pointer', color: '#333', fontSize: 13 }}>
            + Add Another Step
          </button>
        </div>
      </div>

      {/* PPE REQUIRED */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Required PPE</div>
        <div style={sBody}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Select all PPE required for this job.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {PPE_ITEMS.map(item => (
              <label key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, border: '1.5px solid ' + (selectedPPE[item] ? '#1a2332' : '#e0e0e0'), background: selectedPPE[item] ? '#eef2ff' : '#fafafa', cursor: 'pointer', fontSize: 13, fontWeight: selectedPPE[item] ? 700 : 400 }}>
                <input type="checkbox" checked={!!selectedPPE[item]} onChange={() => togglePPE(item)} style={{ width: 16, height: 16, accentColor: '#1a2332' }} />
                {item}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* EMERGENCY INFO */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={{ ...sHdr, background: '#7c3aed' }}>Emergency Information</div>
        <div style={sBody}>
          <div style={{ marginBottom: 10 }}>
            <label style={lbl}>Emergency Contact (Name &amp; Phone)</label>
            <input style={inp} value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} placeholder="e.g. Dispatch: (432) 555-0100" />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={lbl}>Nearest Hospital / Medical Facility</label>
            <input style={inp} value={nearestHospital} onChange={e => setNearestHospital(e.target.value)} placeholder="Hospital name and address" />
          </div>
          <div style={{ marginBottom: 4 }}>
            <label style={lbl}>Emergency Meeting Point / Muster Area</label>
            <input style={inp} value={meetingPoint} onChange={e => setMeetingPoint(e.target.value)} placeholder="e.g. Main gate / parking area" />
          </div>
        </div>
      </div>

      {/* ADDITIONAL HAZARDS / NOTES */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Additional Hazards / Notes</div>
        <div style={sBody}>
          <textarea style={{ ...inp, minHeight: 80, resize: 'vertical' }} value={additionalHazards} onChange={e => setAdditionalHazards(e.target.value)} placeholder="Any site-specific hazards, permit requirements, weather conditions, or other notes..." />
        </div>
      </div>

      {/* PHOTOS */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Site Photos (Optional)</div>
        <div style={sBody}>
          {photos.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
              {photos.map((photo, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={URL.createObjectURL(photo)} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                  <button type="button" onClick={() => setPhotos(ps => ps.filter((_, x) => x !== i))} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, background: '#e65c00', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700, gap: 6 }}>
              📷 Take Photo
              <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={e => addPhoto(e.target.files)} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, background: '#f5f5f5', color: '#333', borderRadius: 6, cursor: 'pointer', fontWeight: 700, border: '1px solid #ddd', gap: 6 }}>
              🖼️ Choose Files
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
        <button type="button" onClick={handleSubmit} disabled={saving} style={{ width: '100%', padding: 14, background: saving ? '#ccc' : highRiskCount > 0 ? '#dc2626' : '#e65c00', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 16, cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Saving...' : highRiskCount > 0 ? '⚠️ Submit JHA — ' + highRiskCount + ' High Risk Step' + (highRiskCount !== 1 ? 's' : '') : '✓ Submit JHA / JSA'}
        </button>
      </div>
    </div>
  )
}
