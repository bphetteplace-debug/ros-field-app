import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { saveSubmission, uploadPhotos, getNextPmNumber, fetchSettings, DEFAULT_CUSTOMERS, DEFAULT_TRUCKS, DEFAULT_TECHS, queueOfflineSubmission } from '../lib/submissions'
import { PARTS_CATALOG } from '../data/catalog'

// Customers loaded dynamically from app_settings (fallback to DEFAULT_CUSTOMERS)
// Trucks loaded dynamically from app_settings (fallback to DEFAULT_TRUCKS)
const WORK_TYPES = [
  'Billable Pm','Warranty Kalos','Warranty ROS','Material Drop Off Billable',
  'Install Billable','Billable Service','Billable Material Pickup',
  'PM Flare/Combustor Flame Arrester','PM Flare','PM BMS',
  'Billable Theif Hatch','Billable PRV','Billable PSV',
]
// Techs loaded dynamically from app_settings (fallback to DEFAULT_TECHS)
const CONDITION_OPTS = ['Good','Fair','Poor','Replaced']
const nowStr = () => new Date().toTimeString().slice(0, 5)

function SignaturePad({ techName, onSave }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const lastPos = useRef(null)
  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect()
    const src = e.touches ? e.touches[0] : e
    return { x: (src.clientX - rect.left) * (canvas.width / rect.width), y: (src.clientY - rect.top) * (canvas.height / rect.height) }
  }
  const start = (e) => { e.preventDefault(); drawing.current = true; lastPos.current = getPos(e, canvasRef.current) }
  const move = (e) => {
    e.preventDefault()
    if (!drawing.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e, canvas)
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke()
    lastPos.current = pos
  }
  const end = (e) => { e.preventDefault(); drawing.current = false; onSave(canvasRef.current.toDataURL('image/png')) }
  const clear = () => {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    onSave(null)
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>{techName}</div>
      <canvas ref={canvasRef} width={300} height={80}
        style={{ border: '1px solid #ccc', borderRadius: 4, background: '#fff', touchAction: 'none', display: 'block' }}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      <button type="button" onClick={clear} style={{ fontSize: 11, color: '#e65c00', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginTop: 2 }}>Clear Signature</button>
    </div>
  )
}

function PhotoPicker({ label, value, onChange }) {
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>{label}</div>
      {value ? (
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <img src={URL.createObjectURL(value)} alt="" style={{ width: 110, height: 82, objectFit: 'cover', borderRadius: 5, border: '1px solid #ddd', display: 'block' }} />
          <button type="button" onClick={() => onChange(null)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
            borderRadius: '50%', width: 18, height: 18, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>x</button>
        </div>
      ) : (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '5px 8px', background: '#f2f2f2', border: '1px dashed #bbb', borderRadius: 5, cursor: 'pointer', fontSize: 12, color: '#555' }}>
          + Photo
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => onChange(e.target.files[0] || null)} />
        </label>
      )}
    </div>
  )
}
const SC_EQUIP_TYPES = [
  'BMS / Controller','Flame Arrestor','Flare / Combustor','Heater Treater',
  'Pilot Assembly','Pressure Vessel','Pump','Regulator','Separator',
  'Solar / Battery','Thermocouple / Thermowell','Valve','Wiring / Electrical','Other'
]

export default function FormPage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const typeParam = searchParams.get('type') || 'pm'
  const jobTypeParam = (typeParam === 'sc' || typeParam === 'service') ? 'Service Call' : 'PM'

  const [pmNumber, setPmNumber] = useState(null)
  // Dynamic lists from app_settings table (fallback to hardcoded defaults)
  const [CUSTOMERS, setCUSTOMERS] = useState(DEFAULT_CUSTOMERS)
  const [TRUCKS,    setTRUCKS]    = useState(DEFAULT_TRUCKS)
  const [TECHS_LIST, setTECHS_LIST] = useState(DEFAULT_TECHS)
  const [jobType] = useState(jobTypeParam)
  const [warrantyWork, setWarrantyWork] = useState(false)
  const [customerName, setCustomerName] = useState(CUSTOMERS[0])
  const [truckNumber, setTruckNumber] = useState(TRUCKS[2])
  const [locationName, setLocationName] = useState('')
  const [customerContact, setCustomerContact] = useState('')
  const [customerWorkOrder, setCustomerWorkOrder] = useState('')
  const [typeOfWork, setTypeOfWork] = useState(WORK_TYPES[0])
  const [glCode, setGlCode] = useState('')
  const [assetTag, setAssetTag] = useState('')
  const [workArea, setWorkArea] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [startTime, setStartTime] = useState(nowStr())
  const [departureTime, setDepartureTime] = useState(nowStr())
  const [lastServiceDate, setLastServiceDate] = useState('')
  const [description, setDescription] = useState('')
  const [techs, setTechs] = useState([])
  const [signatures, setSignatures] = useState({})
  const [customerSig, setCustomerSig] = useState(null)
  const [equipment, setEquipment] = useState('')
  const [parts, setParts] = useState([])
  const [partPhotos, setPartPhotos] = useState({})
  const [miles, setMiles] = useState('')
  const [costPerMile, setCostPerMile] = useState('1.50')
  const [laborHours, setLaborHours] = useState('')
  const [hourlyRate, setHourlyRate] = useState('115.00')
  const [billableTechs, setBillableTechs] = useState('')
  const [partSearch, setPartSearch] = useState('')
  const [showCatalog, setShowCatalog] = useState(false)
  const [photos, setPhotos] = useState([])
  const [arrivalVideo, setArrivalVideo] = useState(null)
  const [departureVideo, setDepartureVideo] = useState(null)
  const [photoCaptions, setPhotoCaptions] = useState({})
  const [saving, setSaving] = useState(false)
  // Draft saving
  const DRAFT_KEY = 'ros_draft_' + jobTypeParam
  const [draftSaved, setDraftSaved] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const draftTimerRef = useRef(null)

  const [saveError, setSaveError] = useState(null)
  // GPS location state
  const [gpsLat, setGpsLat] = useState(null)
  const [gpsLng, setGpsLng] = useState(null)
  const [gpsAccuracy, setGpsAccuracy] = useState(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [gpsError, setGpsError] = useState(null)
  const captureGPS = () => {
    if (!navigator.geolocation) { setGpsError('GPS not supported on this device'); return }
    setGpsLoading(true); setGpsError(null)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGpsLat(pos.coords.latitude)
        setGpsLng(pos.coords.longitude)
        setGpsAccuracy(Math.round(pos.coords.accuracy))
        setGpsLoading(false)
      },
      err => { setGpsError('GPS error: ' + err.message); setGpsLoading(false) },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  // PM equipment state
  const mkArr = () => ({ arrestorId: '', condition: 'Good', filterChanged: false, notes: '', before1: null, before2: null, after1: null, after2: null })
  const mkFlare = () => ({ flareId: '', pilotLit: true, lastIgnition: '', condition: 'Good', notes: '', photo1: null, photo2: null })
  const mkFT = () => ({ condition: 'Good', photo1: null, photo2: null })
  const mkHT = () => ({ heaterId: '', lastCleanDate: '', condition: 'Good', notes: '', firetubes: [mkFT()] })
  const [arrestors, setArrestors] = useState([mkArr()])
  const [flares, setFlares] = useState([mkFlare()])
  const [heaters, setHeaters] = useState([mkHT()])
  const [scEquipment, setScEquipment] = useState([])

  const updArr = (i, k, v) => setArrestors(a => a.map((x,idx) => idx===i ? {...x,[k]:v} : x))
  const updFlare = (i, k, v) => setFlares(f => f.map((x,idx) => idx===i ? {...x,[k]:v} : x))
  const updHT = (i, k, v) => setHeaters(h => h.map((x,idx) => idx===i ? {...x,[k]:v} : x))
  const updFT = (hi, fi, k, v) => setHeaters(h => h.map((x,idx) => idx===hi ? {...x, firetubes: x.firetubes.map((ft,fIdx) => fIdx===fi ? {...ft,[k]:v} : ft)} : x))

  const partsTotal = parts.reduce((s,p) => s + (p.price||0)*(p.qty||0), 0)
  const mileageTotal = parseFloat(miles||0) * parseFloat(costPerMile||1.50)
  const effBill = parseInt(billableTechs) || techs.length
  const laborTotal = warrantyWork ? 0 : parseFloat(laborHours||0) * parseFloat(hourlyRate||115) * effBill
  const grandTotal = warrantyWork ? 0 : partsTotal + mileageTotal + laborTotal

  const filteredParts = PARTS_CATALOG.filter(p => {
    if (!partSearch) return true
    const q = partSearch.toLowerCase()
    return (p.code||p.sku||'').toLowerCase().includes(q) || (p.desc||p.name||'').toLowerCase().includes(q)
  })

  useEffect(() => { getNextPmNumber().then(setPmNumber).catch(() => setPmNumber(9136)) }, [])
  // Load dynamic lists from app_settings
  useEffect(() => {
    fetchSettings().then(s => {
      if (!s) return
      if (s.customers && s.customers.length > 0) setCUSTOMERS(s.customers)
      if (s.trucks    && s.trucks.length > 0)    setTRUCKS(s.trucks)
      if (s.techs     && s.techs.length > 0)     setTECHS_LIST(s.techs)
    }).catch(() => {})
  }, [])
  // Check for draft on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const d = JSON.parse(raw)
        // Only offer resume if there's meaningful content
        if (d.locationName || d.description || (d.parts && d.parts.length > 0)) {
          setHasDraft(true)
        }
      }
    } catch(e) {}
  }, [DRAFT_KEY])


  // Apply copy-prefill from sessionStorage (set by ViewSubmissionPage "Copy" button)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('ros_copy_prefill')
      if (!raw) return
      sessionStorage.removeItem('ros_copy_prefill')
      const prefill = JSON.parse(raw)
      loadDraft(prefill)
    } catch(e) {
      console.warn('Copy prefill failed:', e)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-select logged-in tech name and truck from profile (#7)
  useEffect(() => {
    if (!profile?.full_name) return
    // Auto-select this tech if not already selected and not coming from a copy prefill
    if (!sessionStorage.getItem('ros_copy_prefill')) {
      setTechs(ts => ts.includes(profile.full_name) ? ts : [...ts, profile.full_name])
    }
    // Auto-set truck number from profile if field is still default
    if (profile.truck_number) {
      setTruckNumber(tn => tn === TRUCKS[2] ? profile.truck_number : tn)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.full_name, profile?.truck_number])


  const toggleTech = (t) => setTechs(ts => ts.includes(t) ? ts.filter(x=>x!==t) : [...ts,t])
  const addPart = (p) => {
    const sku = p.code||p.sku
    setParts(ps => { const ex = ps.find(x=>x.sku===sku); return ex ? ps.map(x=>x.sku===sku?{...x,qty:x.qty+1}:x) : [...ps,{sku,name:p.desc||p.name,qty:1,price:p.price||0}] })
    setShowCatalog(false)
  }
  const qtyChange = (sku, d) => setParts(ps => ps.map(x=>x.sku===sku?{...x,qty:Math.max(0,x.qty+d)}:x).filter(x=>x.qty>0))
  const removePart = (sku) => { setParts(ps => ps.filter(x=>x.sku!==sku)); setPartPhotos(pp => { const n={...pp}; delete n[sku]; return n; }) }
  const addPartPhoto = (sku, files) => { const arr = Array.from(files); setPartPhotos(pp => ({ ...pp, [sku]: [...(pp[sku]||[]), ...arr].slice(0,3) })) }
  const removePartPhoto = (sku, idx) => setPartPhotos(pp => ({ ...pp, [sku]: (pp[sku]||[]).filter((_,i)=>i!==idx) }))
  const addPhoto = (files) => { const arr = Array.from(files); setPhotos(ps => [...ps,...arr].slice(0,20)) }


  // Collect all serializable form state into an object
  const getDraftData = useCallback(() => ({
    warrantyWork, customerName, truckNumber, locationName, customerContact,
    customerWorkOrder, typeOfWork, glCode, assetTag, workArea, date,
    startTime, departureTime, lastServiceDate, description, techs,
    equipment, miles, costPerMile, laborHours, hourlyRate, billableTechs,
    parts,
    arrestors: arrestors.map(a => ({ arrestorId: a.arrestorId, condition: a.condition, filterChanged: a.filterChanged, notes: a.notes })),
    flares: flares.map(f => ({ flareId: f.flareId, pilotLit: f.pilotLit, lastIgnition: f.lastIgnition, condition: f.condition, notes: f.notes })),
    heaters: heaters.map(h => ({ heaterId: h.heaterId, lastCleanDate: h.lastCleanDate, condition: h.condition, notes: h.notes, firetubes: h.firetubes.map(ft => ({ condition: ft.condition })) })),
  }), [warrantyWork, customerName, truckNumber, locationName, customerContact, customerWorkOrder, typeOfWork, glCode, assetTag, workArea, date, startTime, departureTime, lastServiceDate, description, techs, equipment, miles, costPerMile, laborHours, hourlyRate, billableTechs, parts, arrestors, flares, heaters])

  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...getDraftData(), savedAt: new Date().toISOString() }))
      setDraftSaved(true)
      setTimeout(() => setDraftSaved(false), 2000)
    } catch(e) { console.warn('Draft save failed:', e) }
  }, [DRAFT_KEY, getDraftData])

  // Auto-save draft on field changes (debounced 2s)
  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(saveDraft, 2000)
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current) }
  }, [warrantyWork, customerName, truckNumber, locationName, customerContact, customerWorkOrder, typeOfWork, glCode, assetTag, workArea, date, startTime, departureTime, lastServiceDate, description, techs, equipment, miles, costPerMile, laborHours, hourlyRate, billableTechs, parts, arrestors, flares, heaters, saveDraft])

  const loadDraft = useCallback((d) => {
    if (d.warrantyWork !== undefined) setWarrantyWork(d.warrantyWork)
    if (d.customerName) setCustomerName(d.customerName)
    if (d.truckNumber) setTruckNumber(d.truckNumber)
    if (d.locationName !== undefined) setLocationName(d.locationName)
    if (d.customerContact !== undefined) setCustomerContact(d.customerContact)
    if (d.customerWorkOrder !== undefined) setCustomerWorkOrder(d.customerWorkOrder)
    if (d.typeOfWork) setTypeOfWork(d.typeOfWork)
    if (d.glCode !== undefined) setGlCode(d.glCode)
    if (d.assetTag !== undefined) setAssetTag(d.assetTag)
    if (d.workArea !== undefined) setWorkArea(d.workArea)
    if (d.date) setDate(d.date)
    if (d.startTime) setStartTime(d.startTime)
    if (d.departureTime) setDepartureTime(d.departureTime)
    if (d.lastServiceDate !== undefined) setLastServiceDate(d.lastServiceDate)
    if (d.description !== undefined) setDescription(d.description)
    if (d.techs) setTechs(d.techs)
    if (d.equipment !== undefined) setEquipment(d.equipment)
    if (d.parts) setParts(d.parts)
    if (d.miles !== undefined) setMiles(d.miles)
    if (d.costPerMile !== undefined) setCostPerMile(d.costPerMile)
    if (d.laborHours !== undefined) setLaborHours(d.laborHours)
    if (d.hourlyRate !== undefined) setHourlyRate(d.hourlyRate)
    if (d.billableTechs !== undefined) setBillableTechs(d.billableTechs)
    if (d.arrestors && d.arrestors.length > 0) setArrestors(d.arrestors.map(a => ({ ...mkArr(), ...a })))
    if (d.flares && d.flares.length > 0) setFlares(d.flares.map(f => ({ ...mkFlare(), ...f })))
    if (d.heaters && d.heaters.length > 0) setHeaters(d.heaters.map(h => ({ ...mkHT(), ...h, firetubes: (h.firetubes||[{condition:'Good'}]).map(ft => ({ ...mkFT(), ...ft })) })))
  }, [])

  const handleSubmit = async () => {
    if (!customerName || !locationName) { setSaveError('Customer and location are required'); return }
    setSaving(true); setSaveError(null)

    // OFFLINE PATH: save to IndexedDB queue if no network
    if (!navigator.onLine) {
      try {
        // Helper: convert File/Blob to base64 data URL for safe IDB storage
        const toDataUrl = (file) => new Promise((resolve) => {
          if (!file) return resolve(null)
          const reader = new FileReader()
          reader.onload = e => resolve(e.target.result)
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(file)
        })

        const formData = {
          pmNumber, jobType, warrantyWork, customerName, truckNumber, locationName,
          customerContact, customerWorkOrder, typeOfWork, glCode, assetTag, workArea,
          date, startTime, departureTime, description, techs, equipment, parts,
          miles, costPerMile, laborHours, hourlyRate, billableTechs,
          arrestors: jobType === 'PM' ? arrestors.map(a =>({arrestorId:a.arrestorId,condition:a.condition,filterChanged:a.filterChanged,notes:a.notes})) : [],
          flares: jobType === 'PM' ? flares.map(f =>({flareId:f.flareId,condition:f.condition,pilotLit:f.pilotLit,lastIgnition:f.lastIgnition,notes:f.notes})) : [],
          heaters: jobType === 'PM' ? heaters.map(h =>({heaterId:h.heaterId,condition:h.condition,lastCleanDate:h.lastCleanDate,notes:h.notes,firetubeCnt:h.firetubes.length,firetubes:h.firetubes.map(ft =>({condition:ft.condition}))})) : [],
          scEquipment: jobType === 'Service Call' ? scEquipment : [],
        }

        // Convert all photos/videos/signatures to data URLs for safe IDB storage
        const photoDataUrls = {}

        // General work photos
        if (photos.length > 0) {
          photoDataUrls['work'] = await Promise.all(
            photos.map(async (f, i) => ({ dataUrl: await toDataUrl(f), caption: photoCaptions[i] || '' }))
          )
        }

        // SC arrival/departure videos
        if (jobType === 'Service Call') {
          if (arrivalVideo) {
            const url = await toDataUrl(arrivalVideo)
            if (url) photoDataUrls['arrival-video'] = [{ dataUrl: url, caption: 'Arrival Video' }]
          }
          if (departureVideo) {
            const url = await toDataUrl(departureVideo)
            if (url) photoDataUrls['departure-video'] = [{ dataUrl: url, caption: 'Departure Video' }]
          }
        }

        // Part photos
        for (const p of parts) {
          const pf = partPhotos[p.sku] || []
          if (pf.length > 0) {
            photoDataUrls['part-' + p.sku] = await Promise.all(
              pf.map(async (f, i) => ({ dataUrl: await toDataUrl(f), caption: 'Part ' + p.name + ' Photo ' + (i + 1) }))
            )
          }
        }

        // Tech signatures (canvas toDataURL — already data URLs)
        for (const name of techs) {
          if (signatures[name]) {
            photoDataUrls['sig-' + name.split(' ')[0].toLowerCase()] = [{ dataUrl: signatures[name], caption: 'Signature: ' + name }]
          }
        }
        if (customerSig) {
          photoDataUrls['customer-sig'] = [{ dataUrl: customerSig, caption: 'Customer Signature' }]
        }

        // PM equipment photos
        if (jobType === 'PM') {
          for (let i = 0; i < arrestors.length; i++) {
            const a = arrestors[i]
            const pf = [
              a.before1 && { file: a.before1, caption: 'Arrestor ' + (i+1) + ' Before 1' },
              a.before2 && { file: a.before2, caption: 'Arrestor ' + (i+1) + ' Before 2' },
              a.after1  && { file: a.after1,  caption: 'Arrestor ' + (i+1) + ' After 1' },
              a.after2  && { file: a.after2,  caption: 'Arrestor ' + (i+1) + ' After 2' },
            ].filter(Boolean)
            if (pf.length) {
              photoDataUrls['arrestor-' + i] = await Promise.all(
                pf.map(async x => ({ dataUrl: await toDataUrl(x.file), caption: x.caption }))
              )
            }
          }
          for (let i = 0; i < flares.length; i++) {
            const f = flares[i]
            const pf = [
              f.photo1 && { file: f.photo1, caption: 'Flare ' + (i+1) + ' Photo 1' },
              f.photo2 && { file: f.photo2, caption: 'Flare ' + (i+1) + ' Photo 2' },
            ].filter(Boolean)
            if (pf.length) {
              photoDataUrls['flare-' + i] = await Promise.all(
                pf.map(async x => ({ dataUrl: await toDataUrl(x.file), caption: x.caption }))
              )
            }
          }
          for (let hi = 0; hi < heaters.length; hi++) {
            const h = heaters[hi]
            for (let fi = 0; fi < h.firetubes.length; fi++) {
              const ft = h.firetubes[fi]
              const pf = [
                ft.photo1 && { file: ft.photo1, caption: 'HT ' + (hi+1) + ' FT ' + (fi+1) + ' Photo 1' },
                ft.photo2 && { file: ft.photo2, caption: 'HT ' + (hi+1) + ' FT ' + (fi+1) + ' Photo 2' },
              ].filter(Boolean)
              if (pf.length) {
                photoDataUrls['ht-' + hi + '-ft-' + fi] = await Promise.all(
                  pf.map(async x => ({ dataUrl: await toDataUrl(x.file), caption: x.caption }))
                )
              }
            }
          }
        }

        await queueOfflineSubmission({ formData, userId: user.id, photoDataUrls })
        localStorage.removeItem(DRAFT_KEY)
        navigate('/submissions?offline=1')
      } catch(e) {
        setSaveError('Failed to save offline: ' + e.message)
      } finally {
        setSaving(false)
      }
      return
    }
    try {
      const formData = {
        pmNumber, jobType, warrantyWork, customerName, truckNumber,
        locationName, customerContact, customerWorkOrder, typeOfWork,
        glCode, assetTag, workArea, date, startTime, departureTime,
        lastServiceDate, description, techs, equipment, parts,
        miles, costPerMile, laborHours, hourlyRate, billableTechs,
        gpsLat, gpsLng, gpsAccuracy,
        arrestors: jobType==='PM' ? arrestors.map(a=>({arrestorId:a.arrestorId,condition:a.condition,filterChanged:a.filterChanged,notes:a.notes})) : [],
        flares: jobType==='PM' ? flares.map(f=>({flareId:f.flareId,condition:f.condition,pilotLit:f.pilotLit,lastIgnition:f.lastIgnition,notes:f.notes})) : [],
        heaters: jobType==='PM' ? heaters.map(h=>({heaterId:h.heaterId,condition:h.condition,lastCleanDate:h.lastCleanDate,notes:h.notes,firetubeCnt:h.firetubes.length})) : [],
      }
      const submission = await saveSubmission(formData, user.id)

      // Upload general photos with captions
      if (photos.length > 0) {
        const photoObjs = photos.map((f,i) => ({ dataUrl: null, file: f, caption: photoCaptions[i]||'' }))
        await uploadPhotos(submission.id, photoObjs, 'work')
      }

            // Upload SC arrival/departure videos
      if (jobType === 'Service Call') {
        if (arrivalVideo) {
          try {
            await uploadPhotos(submission.id, [{ file: arrivalVideo, caption: 'Arrival Video', dataUrl: null }], 'arrival-video')
          } catch(e) { console.warn('Arrival video upload err:', e) }
        }
        if (departureVideo) {
          try {
            await uploadPhotos(submission.id, [{ file: departureVideo, caption: 'Departure Video', dataUrl: null }], 'departure-video')
          } catch(e) { console.warn('Departure video upload err:', e) }
        }
      }

      // Upload part photos
      for (const p of parts) {
        const pf = (partPhotos[p.sku]||[]);
        if (pf.length > 0) {
          await uploadPhotos(submission.id, pf.map((f,i)=>({ file:f, caption:'Part '+p.name+' Photo '+(i+1) })), 'part-'+p.sku);
        }
      }

      // Upload tech signatures
      for (const name of techs) {
        if (signatures[name]) {
          try {
            const blob = await fetch(signatures[name]).then(r=>r.blob())
            await uploadPhotos(submission.id, [{ file: blob, caption: 'Signature: '+name }], 'sig-'+name.split(' ')[0].toLowerCase())
          } catch(e) { console.warn('Sig upload err:', e) }
        }
      }
      if (customerSig) {
        try {
          const blob = await fetch(customerSig).then(r=>r.blob())
          await uploadPhotos(submission.id, [{ file: blob, caption: 'Customer Signature' }], 'customer-sig')
        } catch(e) { console.warn('Customer sig err:', e) }
      }

      // Upload PM equipment photos
      if (jobType === 'PM') {
        for (let i=0; i<arrestors.length; i++) {
          const a = arrestors[i]
          const pf = [
            a.before1 && {file:a.before1, caption:'Arrestor '+(i+1)+' Before 1'},
            a.before2 && {file:a.before2, caption:'Arrestor '+(i+1)+' Before 2'},
            a.after1  && {file:a.after1,  caption:'Arrestor '+(i+1)+' After 1'},
            a.after2  && {file:a.after2,  caption:'Arrestor '+(i+1)+' After 2'},
          ].filter(Boolean)
          if (pf.length) await uploadPhotos(submission.id, pf.map(p=>({file:p.file,caption:p.caption})), 'arrestor-'+i)
        }
        for (let i=0; i<flares.length; i++) {
          const f = flares[i]
          const pf = [
            f.photo1 && {file:f.photo1, caption:'Flare '+(i+1)+' Photo 1'},
            f.photo2 && {file:f.photo2, caption:'Flare '+(i+1)+' Photo 2'},
          ].filter(Boolean)
          if (pf.length) await uploadPhotos(submission.id, pf.map(p=>({file:p.file,caption:p.caption})), 'flare-'+i)
        }
        for (let hi=0; hi<heaters.length; hi++) {
          const h = heaters[hi]
          for (let fi=0; fi<h.firetubes.length; fi++) {
            const ft = h.firetubes[fi]
            const pf = [
              ft.photo1 && {file:ft.photo1, caption:'HT '+(hi+1)+' FT '+(fi+1)+' Photo 1'},
              ft.photo2 && {file:ft.photo2, caption:'HT '+(hi+1)+' FT '+(fi+1)+' Photo 2'},
            ].filter(Boolean)
            if (pf.length) await uploadPhotos(submission.id, pf.map(p=>({file:p.file,caption:p.caption})), 'ht-'+hi+'-ft-'+fi)
          }
        }
      }

      // Fire-and-forget email
      try {
        const token = Object.keys(localStorage).map(k=>k.startsWith('sb-')&&k.endsWith('-auth-token')?JSON.parse(localStorage.getItem(k))?.access_token:null).find(Boolean)
        fetch('/api/send-report', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ submissionId: submission.id, userToken: token }),
        }).catch(()=>{})
      } catch(_) {}

      localStorage.removeItem(DRAFT_KEY)
    navigate('/submissions')
    } catch(e) {
      setSaveError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }
  const sHdr = { background:'#1a2332', color:'#fff', padding:'8px 12px', fontSize:13, fontWeight:700, letterSpacing:1, textTransform:'uppercase', borderRadius:'6px 6px 0 0' }
  const sBody = { background:'#fff', padding:'12px', border:'1px solid #e0e0e0', borderTop:'none', borderRadius:'0 0 6px 6px' }
  const fld = { display:'flex', flexDirection:'column', gap:4, flex:1 }
  const lbl = { fontSize:12, color:'#555', fontWeight:600 }
  const inp = { padding:'8px 10px', border:'1px solid #ddd', borderRadius:6, fontSize:14, width:'100%', boxSizing:'border-box' }
  const row = { display:'flex', gap:12, marginBottom:10 }

  return (
    <div style={{ maxWidth:600, margin:'0 auto', padding:'0 0 40px', fontFamily:'system-ui,sans-serif' }}>

      {/* STICKY HEADER */}
      <div style={{ background:'#1a2332', padding:'12px 16px', position:'sticky', top:0, zIndex:100, marginBottom:12 }}>
        <div style={{ color:'#e65c00', fontWeight:800, fontSize:17 }}>ReliableTrack</div>
          <div style={{ color:'#aaa', fontSize:10, fontWeight:400, letterSpacing:0.3 }}>Built for Reliable Oilfield Services</div>
        <div style={{ color:'#fff', fontSize:14, fontWeight:700 }}>{jobType==='PM'?'PM':'SC'} #{pmNumber||'...'} - {jobType}</div>
      </div>

      {!navigator.onLine && (
        <div style={{ margin:'0 16px 10px', background:'#dc2626', color:'#fff', borderRadius:6, padding:'8px 12px', fontSize:13, fontWeight:700, textAlign:'center' }}>
          You are offline — form will be saved locally and submitted when you're back online
        </div>
      )}
      {saveError && <div style={{ margin:'0 16px 10px', background:'#fee', border:'1px solid #faa', borderRadius:6, padding:'8px 12px', color:'#c00', fontSize:13 }}>{saveError}</div>}
      {hasDraft && (
        <div style={{ margin:'0 16px 10px', background:'#fffbe6', border:'1px solid #f0c040', borderRadius:6, padding:'10px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
          <span style={{ fontSize:13, color:'#7a5c00', fontWeight:600 }}>📝 Draft restored (text only — photos are not saved in drafts)</span>
          <div style={{ display:'flex', gap:6, flexShrink:0 }}>
            <button type="button" onClick={() => { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY)); loadDraft(d); } catch(e){} setHasDraft(false) }} style={{ padding:'5px 12px', background:'#e65c00', color:'#fff', border:'none', borderRadius:5, fontWeight:700, fontSize:12, cursor:'pointer' }}>Resume</button>
            <button type="button" onClick={() => { localStorage.removeItem(DRAFT_KEY); setHasDraft(false) }} style={{ padding:'5px 10px', background:'#f5f5f5', color:'#555', border:'1px solid #ddd', borderRadius:5, fontSize:12, cursor:'pointer' }}>Discard</button>
          </div>
        </div>
      )}
      {draftSaved && (
        <div style={{ margin:'0 16px 6px', background:'#f0fdf4', border:'1px solid #86efac', borderRadius:5, padding:'5px 10px', fontSize:12, color:'#15803d', fontWeight:600 }}>✓ Draft saved (photos not included)</div>
      )}

      {/* JOB INFORMATION */}
      <div style={{ margin:'0 0 10px' }}>
        <div style={sHdr}>Job Information</div>
        <div style={sBody}>
          <div style={row}>
            <div style={fld}><label style={lbl}>Customer *</label>
              <select style={inp} value={customerName} onChange={e=>setCustomerName(e.target.value)}>{CUSTOMERS.map(c=><option key={c}>{c}</option>)}</select>
            </div>
            <div style={fld}><label style={lbl}>Truck</label>
              <select style={inp} value={truckNumber} onChange={e=>setTruckNumber(e.target.value)}>{TRUCKS.map(t=><option key={t}>{t}</option>)}</select>
            </div>
          </div>
          <div style={{ marginBottom:10 }}><label style={lbl}>Location / Well Name *</label>
            <input style={inp} value={locationName} onChange={e=>setLocationName(e.target.value)} placeholder="e.g. Pad A - Well 12" />
          {/* GPS CAPTURE */}
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={captureGPS} disabled={gpsLoading}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: gpsLat ? '#16a34a' : '#1a2332', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: gpsLoading ? 'not-allowed' : 'pointer' }}>
              {gpsLoading ? '⏳ Getting GPS...' : gpsLat ? '📍 GPS Captured' : '📍 Capture GPS Location'}
            </button>
            {gpsLat && (
              <a href={'https://maps.google.com/?q=' + gpsLat + ',' + gpsLng} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}>
                View on Map ↗
              </a>
            )}
            {gpsLat && <span style={{ fontSize: 11, color: '#888' }}>±{gpsAccuracy}m accuracy</span>}
            {gpsError && <span style={{ fontSize: 11, color: '#c00' }}>{gpsError}</span>}
          </div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Contact</label><input style={inp} value={customerContact} onChange={e=>setCustomerContact(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Work Order #</label><input style={inp} value={customerWorkOrder} onChange={e=>setCustomerWorkOrder(e.target.value)} /></div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Type of Work</label>
              <select style={inp} value={typeOfWork} onChange={e=>setTypeOfWork(e.target.value)}>{WORK_TYPES.map(w=><option key={w}>{w}</option>)}</select>
            </div>
            <div style={fld}><label style={lbl}>GL Code</label><input style={inp} value={glCode} onChange={e=>setGlCode(e.target.value)} /></div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Asset Tag</label><input style={inp} value={assetTag} onChange={e=>setAssetTag(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Work Area</label><input style={inp} value={workArea} onChange={e=>setWorkArea(e.target.value)} /></div>
          </div>
          <div style={{ marginBottom:10 }}><label style={lbl}>Last Service Date</label>
            <input type="date" style={inp} value={lastServiceDate} onChange={e=>setLastServiceDate(e.target.value)} />
          </div>
          <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
            <input type="checkbox" checked={warrantyWork} onChange={e=>setWarrantyWork(e.target.checked)} />
            Warranty Work (no charge to customer)
          </label>
        </div>
      </div>

      {/* TECHS */}
      <div style={{ margin:'0 0 10px' }}>
        <div style={sHdr}>Technicians</div>
        <div style={sBody}>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
            {TECHS_LIST.map(t => (
              <button key={t} type="button" onClick={()=>toggleTech(t)}
                style={{ padding:'8px 14px', borderRadius:20, border:'2px solid '+(techs.includes(t)?'#1a2332':'#ddd'),
                  background:techs.includes(t)?'#1a2332':'#fff', color:techs.includes(t)?'#fff':'#333',
                  fontWeight:600, fontSize:13, cursor:'pointer' }}>
                {t}
              </button>
            ))}
          </div>
          {techs.length > 0 && (
            <div style={{ marginBottom:8 }}>
              <div style={{ fontSize:12, color:'#555', fontWeight:600, marginBottom:6 }}>Signatures</div>
              {techs.map(name => (
                <SignaturePad key={name} techName={name} onSave={v => setSignatures(s=>({...s,[name]:v}))} />
              ))}
            </div>
          )}
          <div style={{ marginBottom:8 }}>
            <label style={lbl}>Billable Techs (override)</label>
            <input style={{...inp, width:120}} type="number" min="0" value={billableTechs} onChange={e=>setBillableTechs(e.target.value)} placeholder={techs.length||0} />
          </div>
        </div>
      </div>

      {/* DATE & TIME */}
      <div style={{ margin:'0 0 10px' }}>
        <div style={sHdr}>Date & Time</div>
        <div style={sBody}>
          <div style={row}>
            <div style={fld}><label style={lbl}>Date</label><input type="date" style={inp} value={date} onChange={e=>setDate(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Start</label><input type="time" style={inp} value={startTime} onChange={e=>setStartTime(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Depart</label><input type="time" style={inp} value={departureTime} onChange={e=>setDepartureTime(e.target.value)} /></div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Mileage</label><input style={inp} type="number" min="0" value={miles} onChange={e=>setMiles(e.target.value)} placeholder="0" /></div>
            <div style={fld}><label style={lbl}>$/Mile</label><input style={inp} type="number" step="0.01" value={costPerMile} onChange={e=>setCostPerMile(e.target.value)} /></div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Hours on Site</label><input style={inp} type="number" step="0.25" min="0" value={laborHours} onChange={e=>setLaborHours(e.target.value)} placeholder="0.0" /></div>
            <div style={fld}><label style={lbl}>Hourly Rate</label><input style={inp} type="number" step="0.01" value={hourlyRate} onChange={e=>setHourlyRate(e.target.value)} /></div>
          </div>
        </div>
      </div>

      {/* WORK DESCRIPTION */}
      <div style={{ margin:'0 0 10px' }}>
        <div style={sHdr}>Work Description</div>
        <div style={sBody}>
          <textarea style={{...inp,minHeight:90,resize:'vertical'}} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Describe all work performed..." />
          <div style={{ marginTop:8 }}><label style={lbl}>Equipment / Serial Numbers</label>
            <input style={inp} value={equipment} onChange={e=>setEquipment(e.target.value)} placeholder="Compressor SN, Tank ID, etc." />
          </div>
        </div>
      </div>
      {/* SC-ONLY: EQUIPMENT WORKED ON */}
      {jobType === 'Service Call' && (
        <div style={{ margin:'0 0 10px' }}>
          <div style={sHdr}>Equipment Worked On</div>
          <div style={sBody}>
            <div style={{ fontSize:12, color:'#666', marginBottom:8 }}>Select all equipment types worked on this call:</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12 }}>
              {SC_EQUIP_TYPES.map(type => {
                const active = scEquipment.some(e => e.type === type)
                return (
                  <button key={type} type="button"
                    onClick={() => {
                      if (active) setScEquipment(prev => prev.filter(e => e.type !== type))
                      else setScEquipment(prev => [...prev, { type, notes: '' }])
                    }}
                    style={{ padding:'6px 12px', borderRadius:16, fontSize:12, fontWeight:600, cursor:'pointer',
                      border:'2px solid '+(active?'#1a2332':'#ddd'),
                      background:active?'#1a2332':'#fff', color:active?'#fff':'#333' }}>
                    {type}
                  </button>
                )
              })}
            </div>
            {scEquipment.map((item, i) => (
              <div key={item.type} style={{ marginBottom:8 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#1a2332', marginBottom:3 }}>{item.type} — Notes</div>
                <input style={inp} placeholder={"Notes for " + item.type + " (optional)..."}
                  value={item.notes}
                  onChange={e => setScEquipment(prev => prev.map((x,xi) => xi===i ? {...x,notes:e.target.value} : x))} />
              </div>
            ))}
            {scEquipment.length === 0 && (
              <div style={{ fontSize:12, color:'#aaa', textAlign:'center', padding:'8px 0' }}>No equipment selected</div>
            )}
          </div>
        </div>
      )}

            {/* PM-ONLY SECTIONS */}
      {jobType === 'PM' && (
        <>
          {/* FLAME ARRESTORS */}
          <div style={{ margin:'0 0 10px' }}>
            <div style={sHdr}>Flame Arrestors</div>
            <div style={sBody}>
              {arrestors.map((a,i) => (
                <div key={i} style={{ border:'1px solid #e0e0e0', borderRadius:8, padding:10, marginBottom:10, background:'#fafafa' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                    <div style={{ fontWeight:700, color:'#1a2332', fontSize:13 }}>Arrestor #{i+1}</div>
                    {arrestors.length>1 && <button type="button" onClick={()=>setArrestors(a=>a.filter((_,x)=>x!==i))} style={{ color:'#c00',background:'none',border:'none',cursor:'pointer',fontSize:18,padding:'0 4px' }}>x</button>}
                  </div>
                  <div style={row}>
                    <div style={fld}><label style={lbl}>Arrestor ID / Tag #</label>
                      <input style={inp} value={a.arrestorId} onChange={e=>updArr(i,'arrestorId',e.target.value)} placeholder="ARR-001" /></div>
                    <div style={fld}><label style={lbl}>Condition</label>
                      <select style={inp} value={a.condition} onChange={e=>updArr(i,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select>
                    </div>
                  </div>
                  <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                    <input type="checkbox" checked={a.filterChanged} onChange={e=>updArr(i,'filterChanged',e.target.checked)} />
                    Filter / Element Changed
                  </label>
                  <div style={{ marginBottom:8 }}><label style={lbl}>Notes</label>
                    <input style={inp} value={a.notes} onChange={e=>updArr(i,'notes',e.target.value)} placeholder="Notes..." /></div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    <PhotoPicker label="Before - Photo 1" value={a.before1} onChange={v=>updArr(i,'before1',v)} />
                    <PhotoPicker label="Before - Photo 2" value={a.before2} onChange={v=>updArr(i,'before2',v)} />
                    <PhotoPicker label="After - Photo 1"  value={a.after1}  onChange={v=>updArr(i,'after1',v)} />
                    <PhotoPicker label="After - Photo 2"  value={a.after2}  onChange={v=>updArr(i,'after2',v)} />
                  </div>
                </div>
              ))}
              {arrestors.length < 5 && (
                <button type="button" onClick={()=>setArrestors(a=>[...a,mkArr()])} style={{ width:'100%', padding:8, background:'#f5f5f5', border:'1px dashed #ccc', borderRadius:6, cursor:'pointer', color:'#333', fontSize:13 }}>
                  + Add Arrestor ({arrestors.length}/5)
                </button>
              )}
            </div>
          </div>

          {/* FLARES */}
          <div style={{ margin:'0 0 10px' }}>
            <div style={sHdr}>Flares</div>
            <div style={sBody}>
              {flares.map((f,i) => (
                <div key={i} style={{ border:'1px solid #e0e0e0', borderRadius:8, padding:10, marginBottom:10, background:'#fafafa' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                    <div style={{ fontWeight:700, color:'#1a2332', fontSize:13 }}>Flare #{i+1}</div>
                    {flares.length>1 && <button type="button" onClick={()=>setFlares(f=>f.filter((_,x)=>x!==i))} style={{ color:'#c00',background:'none',border:'none',cursor:'pointer',fontSize:18,padding:'0 4px' }}>x</button>}
                  </div>
                  <div style={row}>
                    <div style={fld}><label style={lbl}>Flare ID / Tag #</label>
                      <input style={inp} value={f.flareId} onChange={e=>updFlare(i,'flareId',e.target.value)} placeholder="FLR-001" /></div>
                    <div style={fld}><label style={lbl}>Condition</label>
                      <select style={inp} value={f.condition} onChange={e=>updFlare(i,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select>
                    </div>
                  </div>
                  <div style={row}>
                    <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6 }}>
                      <input type="checkbox" checked={f.pilotLit} onChange={e=>updFlare(i,'pilotLit',e.target.checked)} />
                      Pilot Lit on Departure
                    </label>
                    <div style={fld}><label style={lbl}>Last Ignition Date</label>
                      <input type="date" style={inp} value={f.lastIgnition} onChange={e=>updFlare(i,'lastIgnition',e.target.value)} /></div>
                  </div>
                  <div style={{ marginBottom:8 }}><label style={lbl}>Notes</label>
                    <input style={inp} value={f.notes} onChange={e=>updFlare(i,'notes',e.target.value)} placeholder="Notes..." /></div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    <PhotoPicker label="Flare Photo 1" value={f.photo1} onChange={v=>updFlare(i,'photo1',v)} />
                    <PhotoPicker label="Flare Photo 2" value={f.photo2} onChange={v=>updFlare(i,'photo2',v)} />
                  </div>
                </div>
              ))}
              {flares.length < 3 && (
                <button type="button" onClick={()=>setFlares(f=>[...f,mkFlare()])} style={{ width:'100%', padding:8, background:'#f5f5f5', border:'1px dashed #ccc', borderRadius:6, cursor:'pointer', color:'#333', fontSize:13 }}>
                  + Add Flare ({flares.length}/3)
                </button>
              )}
            </div>
          </div>

          {/* HEATER TREATERS */}
          <div style={{ margin:'0 0 10px' }}>
            <div style={sHdr}>Heater Treaters</div>
            <div style={sBody}>
              {heaters.map((h,hi) => (
                <div key={hi} style={{ border:'1px solid #e0e0e0', borderRadius:8, padding:10, marginBottom:10, background:'#fafafa' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                    <div style={{ fontWeight:700, color:'#1a2332', fontSize:13 }}>Heater Treater #{hi+1}</div>
                    {heaters.length>1 && <button type="button" onClick={()=>setHeaters(h=>h.filter((_,x)=>x!==hi))} style={{ color:'#c00',background:'none',border:'none',cursor:'pointer',fontSize:18,padding:'0 4px' }}>x</button>}
                  </div>
                  <div style={row}>
                    <div style={fld}><label style={lbl}>Heater ID / Tag #</label>
                      <input style={inp} value={h.heaterId} onChange={e=>updHT(hi,'heaterId',e.target.value)} placeholder="HT-001" /></div>
                    <div style={fld}><label style={lbl}>Condition</label>
                      <select style={inp} value={h.condition} onChange={e=>updHT(hi,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select>
                    </div>
                  </div>
                  <div style={row}>
                    <div style={fld}><label style={lbl}>Last Tube Clean Date</label>
                      <input type="date" style={inp} value={h.lastCleanDate} onChange={e=>updHT(hi,'lastCleanDate',e.target.value)} /></div>
                  </div>
                  <div style={{ marginBottom:8 }}><label style={lbl}>Notes</label>
                    <input style={inp} value={h.notes} onChange={e=>updHT(hi,'notes',e.target.value)} placeholder="Notes..." /></div>
                  <div style={{ marginBottom:6 }}>
                    <div style={{ fontWeight:600, fontSize:12, marginBottom:4 }}>Firetubes ({h.firetubes.length}/10)</div>
                    {h.firetubes.map((ft,fi) => (
                      <div key={fi} style={{ border:'1px solid #e8e8e8', borderRadius:6, padding:8, marginBottom:6, background:'#fff' }}>
                        <div style={{ fontWeight:600, fontSize:12, marginBottom:6 }}>Firetube #{fi+1}</div>
                        <div style={{ marginBottom:4 }}><label style={lbl}>Condition</label>
                          <select style={{...inp,padding:'5px 8px',fontSize:12}} value={ft.condition} onChange={e=>updFT(hi,fi,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select>
                        </div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                          <PhotoPicker label="Photo 1" value={ft.photo1} onChange={v=>updFT(hi,fi,'photo1',v)} />
                          <PhotoPicker label="Photo 2" value={ft.photo2} onChange={v=>updFT(hi,fi,'photo2',v)} />
                        </div>
                      </div>
                    ))}
                    {h.firetubes.length < 10 && (
                      <button type="button" onClick={()=>updHT(hi,'firetubes',[...h.firetubes,mkFT()])} style={{ width:'100%', padding:6, background:'#eef2fa', border:'1px dashed #aac', borderRadius:5, cursor:'pointer', color:'#1a2332', fontSize:12 }}>
                        + Add Firetube
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {heaters.length < 5 && (
                <button type="button" onClick={()=>setHeaters(h=>[...h,mkHT()])} style={{ width:'100%', padding:8, background:'#f5f5f5', border:'1px dashed #ccc', borderRadius:6, cursor:'pointer', color:'#333', fontSize:13 }}>
                  + Add Heater Treater ({heaters.length}/5)
                </button>
              )}
            </div>
          </div>
        </>
      )}
      {/* PARTS USED */}
      <div style={{ margin:'0 0 10px' }}>
        <div style={sHdr}>Parts Used</div>
        <div style={sBody}>
          {parts.length > 0 && (
            <div style={{ marginBottom:10 }}>
              {parts.map(p => (
                <div key={p.sku} style={{ padding:'6px 0', borderBottom:'1px solid #f0f0f0' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:600 }}>{p.name}</div>
                      <div style={{ fontSize:11, color:'#888' }}>{p.sku} - ${(p.price||0).toFixed(2)}/ea</div>
                    </div>
                    <button type="button" onClick={()=>qtyChange(p.sku,-1)} style={{ width:30,height:30,borderRadius:'50%',border:'1px solid #ddd',background:'#f5f5f5',cursor:'pointer',fontSize:16,color:'#333' }}>-</button>
                    <span style={{ width:24,textAlign:'center',fontWeight:700 }}>{p.qty}</span>
                    <button type="button" onClick={()=>qtyChange(p.sku,1)} style={{ width:30,height:30,borderRadius:'50%',border:'1px solid #ddd',background:'#f5f5f5',cursor:'pointer',fontSize:16,color:'#333' }}>+</button>
                    <button type="button" onClick={()=>removePart(p.sku)} style={{ color:'#c00',background:'none',border:'none',cursor:'pointer',fontSize:18,padding:'0 4px' }}>x</button>
                  </div>
                  {/* Part photos */}
                  <div style={{ marginTop:6 }}>
                    {(partPhotos[p.sku]||[]).length > 0 && (
                      <div style={{ display:'flex', gap:6, marginBottom:6, flexWrap:'wrap' }}>
                        {(partPhotos[p.sku]||[]).map((ph,pi) => (
                          <div key={pi} style={{ position:'relative', width:60 }}>
                            <img src={URL.createObjectURL(ph)} alt="" style={{ width:60, height:60, objectFit:'cover', borderRadius:4, display:'block' }} />
                            <button type="button" onClick={()=>removePartPhoto(p.sku,pi)} style={{ position:'absolute',top:1,right:1,background:'rgba(0,0,0,0.6)',color:'#fff',border:'none',borderRadius:'50%',width:16,height:16,fontSize:10,cursor:'pointer',padding:0,lineHeight:'16px',textAlign:'center' }}>x</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {(partPhotos[p.sku]||[]).length < 3 && (
                      <label style={{ display:'inline-flex',alignItems:'center',gap:4,fontSize:11,color:'#e65c00',cursor:'pointer',padding:'3px 8px',border:'1px solid #e65c00',borderRadius:4 }}>
                        + Photo
                        <input type="file" accept="image/*" capture="environment" multiple style={{ display:'none' }} onChange={e=>addPartPhoto(p.sku,e.target.files)} />
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={()=>setShowCatalog(!showCatalog)} style={{ width:'100%',padding:10,background:'#e65c00',color:'#fff',border:'none',borderRadius:6,cursor:'pointer',fontWeight:700,fontSize:14 }}>
            {showCatalog ? 'Close Catalog' : '+ Add Part from Catalog'}
          </button>
          {showCatalog && (
            <div style={{ marginTop:8 }}>
              <input style={{...inp,marginBottom:8}} placeholder="Search by name or SKU..." value={partSearch} onChange={e=>setPartSearch(e.target.value)} />
              <div style={{ maxHeight:280,overflowY:'auto',border:'1px solid #e0e0e0',borderRadius:6 }}>
                {filteredParts.slice(0,80).map(p => (
                  <button key={p.code||p.sku} type="button" onClick={()=>addPart(p)} style={{ display:'block',width:'100%',textAlign:'left',padding:'7px 10px',background:'none',borderBottom:'1px solid #f0f0f0',borderTop:'none',borderLeft:'none',borderRight:'none',cursor:'pointer',color:'#333' }}>
                    <div style={{ fontSize:13,fontWeight:600,color:'#222' }}>{p.desc||p.name}</div>
                    <div style={{ fontSize:11,color:'#888' }}>{p.code||p.sku}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SC-ONLY: ARRIVAL / DEPARTURE VIDEOS */}
      {jobType === 'Service Call' && (
        <div style={{ margin:'0 0 10px' }}>
          <div style={sHdr}>Arrival &amp; Departure Videos (SC)</div>
          <div style={sBody}>
            <div style={{ fontSize:12, color:'#555', marginBottom:10 }}>Record a short video before and after the work is completed.</div>
            {/* Arrival Video */}
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:13, fontWeight:700, color:'#1a2332', display:'block', marginBottom:4 }}>📹 Arrival Video — Before Work</label>
              {arrivalVideo ? (
                <div style={{ position:'relative', marginBottom:6 }}>
                  <video src={URL.createObjectURL(arrivalVideo)} controls style={{ width:'100%', borderRadius:6, maxHeight:200 }} />
                  <button type="button" onClick={()=>setArrivalVideo(null)} style={{ marginTop:4, fontSize:12, color:'#c00', background:'none', border:'none', cursor:'pointer', padding:0 }}>✕ Remove arrival video</button>
                </div>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <label style={{ display:'flex',alignItems:'center',justifyContent:'center',padding:12,background:'#1a2332',color:'#fff',borderRadius:6,cursor:'pointer',fontWeight:700,gap:6,fontSize:13 }}>
                    📹 Record
                    <input type="file" accept="video/*" capture="environment" style={{ display:'none' }} onChange={e=>e.target.files[0]&&setArrivalVideo(e.target.files[0])} />
                  </label>
                  <label style={{ display:'flex',alignItems:'center',justifyContent:'center',padding:12,background:'#f5f5f5',color:'#333',borderRadius:6,cursor:'pointer',fontWeight:700,border:'1px solid #ddd',gap:6,fontSize:13 }}>
                    📂 Choose
                    <input type="file" accept="video/*" style={{ display:'none' }} onChange={e=>e.target.files[0]&&setDepartureVideo(e.target.files[0])} />
                  </label>
                </div>
              )}
            </div>
            {/* Departure Video */}
            <div>
              <label style={{ fontSize:13, fontWeight:700, color:'#1a2332', display:'block', marginBottom:4 }}>🎬 Departure Video — After Work</label>
              {departureVideo ? (
                <div style={{ position:'relative', marginBottom:6 }}>
                  <video src={URL.createObjectURL(departureVideo)} controls style={{ width:'100%', borderRadius:6, maxHeight:200 }} />
                  <button type="button" onClick={()=>setDepartureVideo(null)} style={{ marginTop:4, fontSize:12, color:'#c00', background:'none', border:'none', cursor:'pointer', padding:0 }}>✕ Remove departure video</button>
                </div>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <label style={{ display:'flex',alignItems:'center',justifyContent:'center',padding:12,background:'#e65c00',color:'#fff',borderRadius:6,cursor:'pointer',fontWeight:700,gap:6,fontSize:13 }}>
                    🎬 Record
                    <input type="file" accept="video/*" capture="environment" style={{ display:'none' }} onChange={e=>e.target.files[0]&&setDepartureVideo(e.target.files[0])} />
                  </label>
                  <label style={{ display:'flex',alignItems:'center',justifyContent:'center',padding:12,background:'#f5f5f5',color:'#333',borderRadius:6,cursor:'pointer',fontWeight:700,border:'1px solid #ddd',gap:6,fontSize:13 }}>
                    📂 Choose
                    <input type="file" accept="video/*" style={{ display:'none' }} onChange={e=>e.target.files[0]&&setDepartureVideo(e.target.files[0])} />
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* GENERAL JOB PHOTOS */}
      <div style={{ margin:'0 0 10px' }}>
        <div style={sHdr}>Job Photos (General)</div>
        <div style={sBody}>
          {photos.length > 0 && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:10 }}>
              {photos.map((photo,i) => (
                <div key={i} style={{ position:'relative' }}>
                  <img src={URL.createObjectURL(photo)} alt="" style={{ width:'100%', aspectRatio:'1', objectFit:'cover', borderRadius:6, display:'block' }} />
                  <button type="button" onClick={()=>setPhotos(ps=>ps.filter((_,x)=>x!==i))} style={{ position:'absolute',top:2,right:2,background:'rgba(0,0,0,0.6)',color:'#fff',border:'none',borderRadius:'50%',width:20,height:20,fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0 }}>x</button>
                  <input style={{...inp,marginTop:4,fontSize:11,padding:'3px 6px'}} placeholder="Caption..." value={photoCaptions[i]||''} onChange={e=>setPhotoCaptions(c=>({...c,[i]:e.target.value}))} />
                </div>
              ))}
            </div>
          )}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <label style={{ display:'flex',alignItems:'center',justifyContent:'center',padding:12,background:'#e65c00',color:'#fff',borderRadius:6,cursor:'pointer',fontWeight:700,gap:6 }}>
              Take Photo
              <input type="file" accept="image/*" capture="environment" multiple style={{ display:'none' }} onChange={e=>addPhoto(e.target.files)} />
            </label>
            <label style={{ display:'flex',alignItems:'center',justifyContent:'center',padding:12,background:'#f5f5f5',color:'#333',borderRadius:6,cursor:'pointer',fontWeight:700,border:'1px solid #ddd',gap:6 }}>
              Choose Files
              <input type="file" accept="image/*" multiple style={{ display:'none' }} onChange={e=>addPhoto(e.target.files)} />
            </label>
          </div>
          <div style={{ fontSize:11,color:'#888',textAlign:'center',marginTop:4 }}>{photos.length}/20 photos</div>
        </div>
      </div>

      {/* CUSTOMER SIGN-OFF */}
      <div style={{ margin:'0 0 10px' }}>
        <div style={sHdr}>Customer Sign-Off</div>
        <div style={sBody}>
          <p style={{ fontSize:13,color:'#555',margin:'0 0 8px' }}>Customer signature acknowledges satisfactory completion of work described above.</p>
          <div style={{ fontSize:12, color:'#555', marginBottom:4 }}>Sign here - Customer</div>
          <canvas id="customer-sig-canvas" width={300} height={80}
            style={{ border:'1px solid #ccc', borderRadius:4, background:'#fff', touchAction:'none', display:'block' }}
            onMouseDown={e=>{ const c=e.currentTarget; const ctx=c.getContext('2d'); let drawing=true; let last={x:0,y:0};
              const rect=c.getBoundingClientRect();
              last={x:(e.clientX-rect.left)*(c.width/rect.width),y:(e.clientY-rect.top)*(c.height/rect.height)};
              const mm=ev=>{if(!drawing)return;const r=c.getBoundingClientRect();const p={x:(ev.clientX-r.left)*(c.width/r.width),y:(ev.clientY-r.top)*(c.height/r.height)};ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.strokeStyle='#000';ctx.lineWidth=2;ctx.stroke();last=p};
              const mu=()=>{drawing=false;setCustomerSig(c.toDataURL('image/png'));document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu)};
              document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu)}}
          />
          <button type="button" onClick={()=>{const c=document.getElementById('customer-sig-canvas');c.getContext('2d').clearRect(0,0,c.width,c.height);setCustomerSig(null)}}
            style={{ fontSize:11,color:'#e65c00',background:'none',border:'none',cursor:'pointer',padding:'2px 0',marginTop:2 }}>Clear Signature</button>
        </div>
      </div>

      {/* COST SUMMARY */}
      <div style={{ margin:'0 0 10px' }}>
        <div style={sHdr}>Cost Summary</div>
        <div style={sBody}>
          {warrantyWork ? (
            <div style={{ textAlign:'center',padding:12,color:'#c00',fontWeight:800,fontSize:16,border:'2px solid #c00',borderRadius:6 }}>WARRANTY - NO CHARGE</div>
          ) : (
            <div>
              <div style={{ display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #f0f0f0' }}>
                <span>Parts</span><span>${partsTotal.toFixed(2)}</span>
              </div>
              <div style={{ display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #f0f0f0' }}>
                <span>Mileage ({miles||0} mi x {costPerMile}/mi)</span><span>${mileageTotal.toFixed(2)}</span>
              </div>
              <div style={{ display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #f0f0f0' }}>
                <span>Labor ({laborHours||0} hrs x {hourlyRate}/hr x {effBill} tech{effBill!==1?'s':''})</span><span>${laborTotal.toFixed(2)}</span>
              </div>
              <div style={{ display:'flex',justifyContent:'space-between',padding:'8px 0',fontWeight:800,fontSize:16,color:'#1a2332' }}>
                <span>TOTAL</span><span>${grandTotal.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SUBMIT */}
      <div style={{ padding:'0 16px' }}>
        <button type="button" onClick={saveDraft} style={{ width: '100%', padding: 12, marginBottom: 8, background: draftSaved ? '#16a34a' : '#f5f5f5', color: draftSaved ? '#fff' : '#555', border: '1px solid ' + (draftSaved ? '#16a34a' : '#ddd'), borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
          {draftSaved ? '✅ Draft Saved!' : '💾 Save Draft'}
        </button>
        <button type="button" onClick={handleSubmit} disabled={saving} style={{ width:'100%',padding:14,background:saving?'#ccc':'#e65c00',color:'#fff',border:'none',borderRadius:8,fontWeight:800,fontSize:16,cursor:saving?'not-allowed':'pointer' }}>
          {saving ? 'Saving...' : 'Submit ' + (jobType==='PM'?'PM':'Service Call')}
        </button>
      </div>

    </div>
  )
}
