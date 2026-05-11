// src/pages/FormPage.jsx  —  Unified Job Ticket Form
// Replaces separate PM + SC forms.
// URL backward-compat: /form?type=pm  /form?type=sc  /form?type=job
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import NavBar from '../components/NavBar'
import {
  saveSubmission, uploadPhotos,
  getNextPmNumber, getNextWoNumber,
  fetchSettings,
  DEFAULT_CUSTOMERS, DEFAULT_TRUCKS, DEFAULT_TECHS,
  queueOfflineSubmission,
} from '../lib/submissions'
import { PARTS_CATALOG } from '../data/catalog'

// ─── Constants ─────────────────────────────────────────────────────────────────

const JOB_TYPES = [
  { value: 'PM',           label: 'Preventive\nMaintenance', icon: '🔧', template: 'pm_flare_combustor', short: 'PM'  },
  { value: 'Service Call', label: 'Service\nCall',           icon: '🚨', template: 'service_call',       short: 'SC'  },
  { value: 'Repair',       label: 'Repair /\nTroubleshooting',icon:'🛠️', template: 'service_call',       short: 'RPR' },
  { value: 'Other',        label: 'Other',                    icon: '📋', template: 'service_call',       short: 'OTH' },
]

const URL_PARAM_MAP = {
  pm: 'PM', sc: 'Service Call', service: 'Service Call',
  repair: 'Repair', job: 'Service Call', other: 'Other',
}

const WORK_TYPES = [
  'Billable Pm','Warranty Kalos','Warranty ROS','Material Drop Off Billable',
  'Install Billable','Billable Service','Billable Material Pickup',
  'PM Flare/Combustor Flame Arrester','PM Flare','PM BMS',
  'Billable Theif Hatch','Billable PRV','Billable PSV',
]

const CONDITION_OPTS = ['Good','Fair','Poor','Replaced']

const SC_EQUIP_TYPES = [
  'BMS / Controller','Flame Arrestor','Flare / Combustor','Heater Treater',
  'Pilot Assembly','Pressure Vessel','Pump','Regulator','Separator',
  'Solar / Battery','Thermocouple / Thermowell','Valve','Wiring / Electrical','Other',
]

const PERMIT_TYPES = [
  'Hot Work','Confined Space','Lockout / Tagout','H₂S / Gas Monitor',
  'Elevated Work','Excavation','Electrical','Pressure Test',
]

// ─── Visibility helpers ────────────────────────────────────────────────────────
const showsVideos      = jt => ['Service Call','Repair','Other'].includes(jt)
const showsPMEquipment = jt => jt === 'PM'
const showsSCEquipment = jt => ['Service Call','Repair','Other'].includes(jt)
const showsIssueFields = jt => ['Service Call','Repair'].includes(jt)

// ─── PhotoPicker ───────────────────────────────────────────────────────────────
function PhotoPicker({ label, value, onChange }) {
  return (
    <div style={{ marginTop:4 }}>
      <div style={{ fontSize:10, color:'#888', marginBottom:2 }}>{label}</div>
      {value ? (
        <div style={{ position:'relative', display:'inline-block' }}>
          <img src={URL.createObjectURL(value)} alt="" style={{ width:110, height:82, objectFit:'cover', borderRadius:5, border:'1px solid #ddd', display:'block' }} />
          <button type="button" onClick={()=>onChange(null)} style={{ position:'absolute', top:2, right:2, background:'rgba(0,0,0,0.55)', color:'#fff', border:'none', borderRadius:'50%', width:18, height:18, fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', padding:0 }}>✕</button>
        </div>
      ) : (
        <label style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'5px 8px', background:'#f2f2f2', border:'1px dashed #bbb', borderRadius:5, cursor:'pointer', fontSize:12, color:'#555' }}>
          + Photo
          <input type="file" accept="image/*" capture="environment" style={{ display:'none' }} onChange={e=>onChange(e.target.files[0]||null)} />
        </label>
      )}
    </div>
  )
}

// ─── SignaturePad ──────────────────────────────────────────────────────────────
function SignaturePad({ label, required=false, onSave, onClear, isSigned=false }) {
  const canvasRef = useRef(null)
  const drawing   = useRef(false)

  const getPos = (e, c) => {
    const r = c.getBoundingClientRect()
    const src = e.touches ? e.touches[0] : e
    return { x:(src.clientX-r.left)*(c.width/r.width), y:(src.clientY-r.top)*(c.height/r.height) }
  }
  const start = e => {
    drawing.current = true
    const c = canvasRef.current, ctx = c.getContext('2d')
    ctx.lineWidth=2; ctx.strokeStyle='#1a2332'; ctx.lineJoin='round'; ctx.lineCap='round'
    const p = getPos(e,c); ctx.beginPath(); ctx.moveTo(p.x,p.y); e.preventDefault()
  }
  const move = e => {
    if (!drawing.current) return
    const c = canvasRef.current, ctx = c.getContext('2d'), p = getPos(e,c)
    ctx.lineTo(p.x,p.y); ctx.stroke(); e.preventDefault()
  }
  const stop = () => { drawing.current = false }

  const handleSave = () => { onSave(canvasRef.current.toDataURL('image/png')) }
  const handleClear = () => {
    const c = canvasRef.current
    c.getContext('2d').clearRect(0,0,c.width,c.height)
    onClear()
  }

  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:13, fontWeight:600, marginBottom:6, color:'#1a2332', display:'flex', alignItems:'center', gap:6 }}>
        {label}
        {required && <span style={{ color:'#c00', fontSize:11 }}>*required</span>}
        {isSigned && <span style={{ color:'#16a34a', fontSize:12, fontWeight:700 }}>✓ Signed</span>}
      </div>
      <canvas
        ref={canvasRef} width={560} height={110}
        style={{ border: isSigned ? '2px solid #16a34a' : '2px dashed #ccc', borderRadius:6, touchAction:'none', background:'#fafafa', width:'100%', maxWidth:560, display:'block', cursor:'crosshair' }}
        onMouseDown={start} onMouseMove={move} onMouseUp={stop} onMouseLeave={stop}
        onTouchStart={start} onTouchMove={move} onTouchEnd={stop}
      />
      <div style={{ display:'flex', gap:8, marginTop:6 }}>
        <button type="button" onClick={handleSave} style={{ fontSize:12, padding:'5px 14px', background:'#1a2332', color:'#fff', border:'none', borderRadius:5, cursor:'pointer', fontWeight:600 }}>Save Signature</button>
        <button type="button" onClick={handleClear} style={{ fontSize:12, padding:'5px 14px', background:'#f5f5f5', color:'#555', border:'1px solid #ddd', borderRadius:5, cursor:'pointer' }}>Clear</button>
      </div>
    </div>
  )
}

// ─── Section card wrapper ──────────────────────────────────────────────────────
function Section({ icon, title, children, accent='#1a2332', collapsible=false }) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ background:'#fff', borderRadius:10, boxShadow:'0 1px 6px rgba(0,0,0,0.08)', marginBottom:16, overflow:'hidden' }}>
      <div
        onClick={collapsible ? ()=>setOpen(o=>!o) : undefined}
        style={{ background:accent, color:'#fff', padding:'10px 14px', fontWeight:700, fontSize:13, letterSpacing:0.5, display:'flex', alignItems:'center', gap:8, cursor:collapsible?'pointer':'default', userSelect:'none' }}
      >
        <span style={{ fontSize:16 }}>{icon}</span>
        <span style={{ textTransform:'uppercase', letterSpacing:1, flex:1 }}>{title}</span>
        {collapsible && <span style={{ fontSize:16, opacity:0.8 }}>{open?'▲':'▼'}</span>}
      </div>
      {open && <div style={{ padding:'14px 14px' }}>{children}</div>}
    </div>
  )
}

// ─── nowStr ────────────────────────────────────────────────────────────────────
const nowStr = () => new Date().toTimeString().slice(0,5)

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function FormPage() {
  const { user, profile, isAdmin, logout } = useAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const handleLogout = useCallback(async () => {
    setLoggingOut(true)
    try { await logout() } catch(e) {}
    setLoggingOut(false)
  }, [logout])

  const [searchParams] = useSearchParams()
  const initType = URL_PARAM_MAP[searchParams.get('type')||''] || 'PM'

  // ── Sequential numbers ──────────────────────────────────────────────────────
  const [pmNumber, setPmNumber] = useState(null)
  const [woNumber, setWoNumber] = useState(null)

  // ── Dynamic lists ───────────────────────────────────────────────────────────
  const [CUSTOMERS,  setCUSTOMERS]  = useState(DEFAULT_CUSTOMERS)
  const [TRUCKS,     setTRUCKS]     = useState(DEFAULT_TRUCKS)
  const [TECHS_LIST, setTECHS_LIST] = useState(DEFAULT_TECHS)

  // ── Job Type ────────────────────────────────────────────────────────────────
  const [jobType, setJobType] = useState(initType)

  // Derived visibility flags
  const showVideos      = showsVideos(jobType)
  const showPMEquipment = showsPMEquipment(jobType)
  const showSCEquip     = showsSCEquipment(jobType)
  const showIssueFields = showsIssueFields(jobType)

  // ── Job info ────────────────────────────────────────────────────────────────
  const [warrantyWork,      setWarrantyWork]      = useState(false)
  const [customerName,      setCustomerName]      = useState('')
  const [truckNumber,       setTruckNumber]       = useState(TRUCKS[2]||'')
  const [locationName,      setLocationName]      = useState('')
  const [customerContact,   setCustomerContact]   = useState('')
  const [customerWorkOrder, setCustomerWorkOrder] = useState('')
  const [typeOfWork,        setTypeOfWork]        = useState(WORK_TYPES[0])
  const [glCode,            setGlCode]            = useState('')
  const [assetTag,          setAssetTag]          = useState('')
  const [workArea,          setWorkArea]          = useState('')
  const [date,              setDate]              = useState(new Date().toISOString().split('T')[0])
  const [startTime,         setStartTime]         = useState(nowStr())
  const [departureTime,     setDepartureTime]     = useState(nowStr())
  const [lastServiceDate,   setLastServiceDate]   = useState('')
  const [description,       setDescription]       = useState('')
  const [reportedIssue,     setReportedIssue]     = useState('')
  const [rootCause,         setRootCause]         = useState('')
  const [techs,             setTechs]             = useState([])
  const [equipment,         setEquipment]         = useState('')
  const [permitsRequired,   setPermitsRequired]   = useState([])

  // ── Parts ───────────────────────────────────────────────────────────────────
  const [parts,       setParts]       = useState([])
  const [partPhotos,  setPartPhotos]  = useState({})
  const [partSearch,  setPartSearch]  = useState('')
  const [showCatalog, setShowCatalog] = useState(false)

  // ── Financials ──────────────────────────────────────────────────────────────
  const [miles,         setMiles]         = useState('')
  const [costPerMile,   setCostPerMile]   = useState('1.50')
  const [laborHours,    setLaborHours]    = useState('')
  const [hourlyRate,    setHourlyRate]    = useState('115.00')
  const [billableTechs, setBillableTechs] = useState('')

  // ── Media ───────────────────────────────────────────────────────────────────
  const [photos,         setPhotos]         = useState([])
  const [photoCaptions,  setPhotoCaptions]  = useState({})
  const [arrivalVideo,   setArrivalVideo]   = useState(null)
  const [departureVideo, setDepartureVideo] = useState(null)

  // ── Signatures ──────────────────────────────────────────────────────────────
  const [techSignatures, setTechSignatures] = useState({})
  const [customerSig,    setCustomerSig]    = useState(null)

  // ── PM Equipment ────────────────────────────────────────────────────────────
  const mkArr   = () => ({ arrestorId:'', condition:'Good', filterChanged:false, notes:'', before1:null, before2:null, after1:null, after2:null })
  const mkFlare = () => ({ flareId:'', pilotLit:true, lastIgnition:'', condition:'Good', notes:'', photo1:null, photo2:null })
  const mkFT    = () => ({ condition:'Good', photo1:null, photo2:null })
  const mkHT    = () => ({ heaterId:'', lastCleanDate:'', condition:'Good', notes:'', firetubes:[mkFT()] })

  const [arrestors, setArrestors] = useState([mkArr()])
  const [flares,    setFlares]    = useState([mkFlare()])
  const [heaters,   setHeaters]   = useState([mkHT()])

  // ── SC Equipment ────────────────────────────────────────────────────────────
  const [scEquipment, setScEquipment] = useState([])

  // ── GPS ─────────────────────────────────────────────────────────────────────
  const [gpsLat,      setGpsLat]      = useState(null)
  const [gpsLng,      setGpsLng]      = useState(null)
  const [gpsAccuracy, setGpsAccuracy] = useState(null)
  const [gpsLoading,  setGpsLoading]  = useState(false)
  const [gpsError,    setGpsError]    = useState(null)

  // ── UI ──────────────────────────────────────────────────────────────────────
  const [saving,     setSaving]    = useState(false)
  const [saveError,  setSaveError] = useState(null)
  const [draftSaved, setDraftSaved]= useState(false)
  const [hasDraft,   setHasDraft]  = useState(false)
  const draftTimerRef = useRef(null)

  // ── Derived totals ───────────────────────────────────────────────────────────
  const effBill      = parseInt(billableTechs) || techs.length || 1
  const partsTotal   = parts.reduce((s,p)=>s+(parseFloat(p.price||0)*parseInt(p.qty||1)),0)
  const mileageTotal = parseFloat(miles||0)*parseFloat(costPerMile||1.50)
  const laborTotal   = warrantyWork ? 0 : parseFloat(laborHours||0)*parseFloat(hourlyRate||115)*effBill
  const grandTotal   = warrantyWork ? 0 : partsTotal+mileageTotal+laborTotal

  const filteredParts = PARTS_CATALOG.filter(p=>{
    if (!partSearch) return true
    const q = partSearch.toLowerCase()
    return (p.name||p.desc||'').toLowerCase().includes(q)||(p.sku||p.code||'').toLowerCase().includes(q)
  })

  // ── PM field updaters ────────────────────────────────────────────────────────
  const updArr   = (i,k,v) => setArrestors(a=>a.map((x,idx)=>idx===i?{...x,[k]:v}:x))
  const updFlare = (i,k,v) => setFlares(f=>f.map((x,idx)=>idx===i?{...x,[k]:v}:x))
  const updHT    = (i,k,v) => setHeaters(h=>h.map((x,idx)=>idx===i?{...x,[k]:v}:x))
  const updFT    = (hi,fi,k,v) => setHeaters(h=>h.map((ht,hi2)=>hi2!==hi?ht:{
    ...ht, firetubes:ht.firetubes.map((ft,fi2)=>fi2!==fi?ft:{...ft,[k]:v})
  }))

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const toggleTech   = t => setTechs(ts=>ts.includes(t)?ts.filter(x=>x!==t):[...ts,t])
  const togglePermit = p => setPermitsRequired(ps=>ps.includes(p)?ps.filter(x=>x!==p):[...ps,p])

  const addPart = p => {
    const sku = p.code||p.sku
    setParts(ps=>ps.some(x=>x.sku===sku)
      ? ps.map(x=>x.sku===sku?{...x,qty:x.qty+1}:x)
      : [...ps,{sku,name:p.desc||p.name,price:parseFloat(p.price||0),qty:1}]
    )
    setShowCatalog(false)
  }
  const removePart      = sku => { setParts(ps=>ps.filter(x=>x.sku!==sku)); setPartPhotos(pp=>{const n={...pp};delete n[sku];return n}) }
  const qtyChange       = (sku,d) => setParts(ps=>ps.map(x=>x.sku===sku?{...x,qty:Math.max(0,x.qty+d)}:x).filter(x=>x.qty>0))
  const addPartPhoto    = (sku,file) => setPartPhotos(pp=>({...pp,[sku]:[...(pp[sku]||[]),{file,caption:''}]}))
  const removePartPhoto = (sku,idx) => setPartPhotos(pp=>({...pp,[sku]:(pp[sku]||[]).filter((_,i)=>i!==idx)}))
  const addPhoto        = files => { const arr=Array.from(files||[]); setPhotos(p=>[...p,...arr]) }

  // ── Job type change — reset irrelevant sections ───────────────────────────────
  const handleJobTypeChange = newType => {
    setJobType(newType)
    if (!showsPMEquipment(newType)) { setArrestors([mkArr()]); setFlares([mkFlare()]); setHeaters([mkHT()]) }
    if (!showsSCEquipment(newType)) setScEquipment([])
    if (!showsVideos(newType))      { setArrivalVideo(null); setDepartureVideo(null) }
    if (!showsIssueFields(newType)) { setReportedIssue(''); setRootCause('') }
  }

  // ── GPS ───────────────────────────────────────────────────────────────────────
  const captureGPS = () => {
    if (!navigator.geolocation) { setGpsError('GPS not supported on this device'); return }
    setGpsLoading(true); setGpsError(null)
    navigator.geolocation.getCurrentPosition(
      pos => { setGpsLat(pos.coords.latitude); setGpsLng(pos.coords.longitude); setGpsAccuracy(Math.round(pos.coords.accuracy)); setGpsLoading(false) },
      err => { setGpsError('Unable to get GPS: '+err.message); setGpsLoading(false) },
      { enableHighAccuracy:true, timeout:15000 }
    )
  }

  // ── Mount: fetch numbers + settings ──────────────────────────────────────────
  useEffect(()=>{
    getNextPmNumber().then(n=>{if(n)setPmNumber(n)}).catch(()=>{})
    getNextWoNumber().then(n=>{if(n)setWoNumber(n)}).catch(()=>{})
    fetchSettings().then(s=>{
      if(!s)return
      if(s.customers?.length) setCUSTOMERS(s.customers)
      if(s.trucks?.length)    setTRUCKS(s.trucks)
      if(s.techs?.length)     setTECHS_LIST(s.techs)
    }).catch(()=>{})
    if(profile?.full_name) setTechs(ts=>ts.includes(profile.full_name)?ts:[...ts,profile.full_name])
  },[]) // eslint-disable-line

  useEffect(()=>{
    if(CUSTOMERS.length&&!customerName) setCustomerName(CUSTOMERS[0])
  },[CUSTOMERS]) // eslint-disable-line

  // ── Draft ─────────────────────────────────────────────────────────────────────
  const draftKey = `form_draft_${user?.id}`

  const getDraftData = useCallback(()=>({
    jobType,warrantyWork,customerName,truckNumber,locationName,customerContact,
    customerWorkOrder,typeOfWork,glCode,assetTag,workArea,date,startTime,
    departureTime,lastServiceDate,description,reportedIssue,rootCause,
    techs,equipment,permitsRequired,parts,miles,costPerMile,laborHours,hourlyRate,billableTechs,
    arrestors:arrestors.map(a=>({arrestorId:a.arrestorId,condition:a.condition,filterChanged:a.filterChanged,notes:a.notes})),
    flares:flares.map(f=>({flareId:f.flareId,condition:f.condition,pilotLit:f.pilotLit,lastIgnition:f.lastIgnition,notes:f.notes})),
    heaters:heaters.map(h=>({heaterId:h.heaterId,condition:h.condition,lastCleanDate:h.lastCleanDate,notes:h.notes,firetubeCnt:h.firetubes.length})),
    scEquipment,
  }),[jobType,warrantyWork,customerName,truckNumber,locationName,customerContact,customerWorkOrder,typeOfWork,glCode,assetTag,workArea,date,startTime,departureTime,lastServiceDate,description,reportedIssue,rootCause,techs,equipment,permitsRequired,parts,miles,costPerMile,laborHours,hourlyRate,billableTechs,arrestors,flares,heaters,scEquipment])

  const saveDraft = useCallback(()=>{
    try{localStorage.setItem(draftKey,JSON.stringify(getDraftData()));setDraftSaved(true);setTimeout(()=>setDraftSaved(false),2500)}catch(e){}
  },[draftKey,getDraftData])

  const loadDraft = useCallback(d=>{
    if(d.jobType)                    handleJobTypeChange(d.jobType)
    if(d.warrantyWork!==undefined)   setWarrantyWork(d.warrantyWork)
    if(d.customerName)               setCustomerName(d.customerName)
    if(d.truckNumber)                setTruckNumber(d.truckNumber)
    if(d.locationName!==undefined)   setLocationName(d.locationName)
    if(d.customerContact!==undefined)setCustomerContact(d.customerContact)
    if(d.customerWorkOrder!==undefined)setCustomerWorkOrder(d.customerWorkOrder)
    if(d.typeOfWork)                 setTypeOfWork(d.typeOfWork)
    if(d.glCode!==undefined)         setGlCode(d.glCode)
    if(d.assetTag!==undefined)       setAssetTag(d.assetTag)
    if(d.workArea!==undefined)       setWorkArea(d.workArea)
    if(d.date)                       setDate(d.date)
    if(d.startTime)                  setStartTime(d.startTime)
    if(d.departureTime)              setDepartureTime(d.departureTime)
    if(d.lastServiceDate!==undefined)setLastServiceDate(d.lastServiceDate)
    if(d.description!==undefined)    setDescription(d.description)
    if(d.reportedIssue!==undefined)  setReportedIssue(d.reportedIssue)
    if(d.rootCause!==undefined)      setRootCause(d.rootCause)
    if(d.techs?.length)              setTechs(d.techs)
    if(d.equipment!==undefined)      setEquipment(d.equipment)
    if(d.permitsRequired?.length)    setPermitsRequired(d.permitsRequired)
    if(d.parts?.length)              setParts(d.parts)
    if(d.miles!==undefined)          setMiles(d.miles)
    if(d.costPerMile!==undefined)    setCostPerMile(d.costPerMile)
    if(d.laborHours!==undefined)     setLaborHours(d.laborHours)
    if(d.hourlyRate!==undefined)     setHourlyRate(d.hourlyRate)
    if(d.billableTechs!==undefined)  setBillableTechs(d.billableTechs)
    if(d.scEquipment?.length)        setScEquipment(d.scEquipment)
  },[]) // eslint-disable-line

  useEffect(()=>{
    try{if(localStorage.getItem(draftKey))setHasDraft(true)}catch(e){}
  },[draftKey])

  useEffect(()=>{
    draftTimerRef.current=setInterval(saveDraft,30000)
    return()=>clearInterval(draftTimerRef.current)
  },[saveDraft])

  // ── toDataUrl ─────────────────────────────────────────────────────────────────
  const toDataUrl = file=>new Promise((resolve,reject)=>{
    const r=new FileReader();r.onload=e=>resolve(e.target.result);r.onerror=reject;r.readAsDataURL(file)
  })

  // ── Submit ─────────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if(!customerName||!locationName){setSaveError('Customer and location are required');return}
    setSaving(true);setSaveError(null)
    try {
      const photoDataUrls={}

      if(photos.length>0){
        photoDataUrls['general']=await Promise.all(photos.map(async(f,i)=>({dataUrl:await toDataUrl(f),caption:photoCaptions[i]||''})))
      }
      for(const p of parts){
        const pf=partPhotos[p.sku]||[]
        if(pf.length>0) photoDataUrls[`part-${p.sku}`]=await Promise.all(pf.map(async x=>({dataUrl:await toDataUrl(x.file),caption:x.caption})))
      }
      if(showVideos){
        if(arrivalVideo){const url=await toDataUrl(arrivalVideo);if(url)photoDataUrls['arrival-video']=[{dataUrl:url,caption:'Arrival Video'}]}
        if(departureVideo){const url=await toDataUrl(departureVideo);if(url)photoDataUrls['departure-video']=[{dataUrl:url,caption:'Departure Video'}]}
      }
      if(showPMEquipment){
        for(let i=0;i<arrestors.length;i++){
          const a=arrestors[i]
          const pf=[a.before1&&{file:a.before1,caption:`Arrestor ${i+1} Before 1`},a.before2&&{file:a.before2,caption:`Arrestor ${i+1} Before 2`},a.after1&&{file:a.after1,caption:`Arrestor ${i+1} After 1`},a.after2&&{file:a.after2,caption:`Arrestor ${i+1} After 2`}].filter(Boolean)
          if(pf.length) photoDataUrls[`arrestor-${i}`]=await Promise.all(pf.map(async x=>({dataUrl:await toDataUrl(x.file),caption:x.caption})))
        }
        for(let i=0;i<flares.length;i++){
          const f=flares[i]
          const pf=[f.photo1&&{file:f.photo1,caption:`Flare ${i+1} Photo 1`},f.photo2&&{file:f.photo2,caption:`Flare ${i+1} Photo 2`}].filter(Boolean)
          if(pf.length) photoDataUrls[`flare-${i}`]=await Promise.all(pf.map(async x=>({dataUrl:await toDataUrl(x.file),caption:x.caption})))
        }
      }
      if(customerSig) photoDataUrls['customer-sig']=[{dataUrl:customerSig,caption:'Customer Signature'}]
      const techSigEntries=Object.entries(techSignatures)
      if(techSigEntries.length) photoDataUrls['tech-sigs']=techSigEntries.map(([name,dataUrl])=>({dataUrl,caption:`${name} Signature`}))

      const jtObj=JOB_TYPES.find(jt=>jt.value===jobType)
      const template=jtObj?.template||'service_call'
      const effectiveWoNumber=woNumber||customerWorkOrder||''

      const formData={
        jobType,pmNumber,woNumber:effectiveWoNumber,warrantyWork,
        customerName,truckNumber,locationName,customerContact,customerWorkOrder,
        typeOfWork,glCode,assetTag,workArea,date,startTime,departureTime,lastServiceDate,
        description,
        reportedIssue:showIssueFields?reportedIssue:'',
        rootCause:showIssueFields?rootCause:'',
        permitsRequired,
        techs,equipment,parts,miles,costPerMile,laborHours,hourlyRate,billableTechs,
        gpsLat,gpsLng,gpsAccuracy,
        arrestors:showPMEquipment?arrestors.map(a=>({arrestorId:a.arrestorId,condition:a.condition,filterChanged:a.filterChanged,notes:a.notes})):[],
        flares:showPMEquipment?flares.map(f=>({flareId:f.flareId,condition:f.condition,pilotLit:f.pilotLit,lastIgnition:f.lastIgnition,notes:f.notes})):[],
        heaters:showPMEquipment?heaters.map(h=>({heaterId:h.heaterId,condition:h.condition,lastCleanDate:h.lastCleanDate,notes:h.notes,firetubeCnt:h.firetubes.length,firetubes:h.firetubes.map(ft=>({condition:ft.condition}))})):[],
        scEquipment:showSCEquip?scEquipment:[],
      }

      const submission=await saveSubmission(formData,user.id,template)
      if(submission?.id&&Object.keys(photoDataUrls).length>0) await uploadPhotos(submission.id,photoDataUrls)
      try{localStorage.removeItem(draftKey)}catch(e){}
      navigate('/submissions')
    } catch(err) {
      console.error('Submit error:',err)
      if(!navigator.onLine){
        try{queueOfflineSubmission({jobType,customerName,locationName,date,description});navigate('/submissions');return}catch(e){}
      }
      setSaveError(err?.message||'Submission failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Shared styles ─────────────────────────────────────────────────────────────
  const inp = {padding:'8px 10px',border:'1px solid #d0d5dd',borderRadius:6,fontSize:14,width:'100%',boxSizing:'border-box',background:'#fff'}
  const lbl = {fontSize:12,color:'#555',fontWeight:600,marginBottom:3,display:'block'}
  const fld = {display:'flex',flexDirection:'column',gap:2,flex:1}
  const row = {display:'flex',gap:10,marginBottom:10}

  const jtConfig = JOB_TYPES.find(jt=>jt.value===jobType)||JOB_TYPES[0]

  // accent color per job type
  const accent = {
    'PM':'#1a6e3c',
    'Service Call':'#c25c00',
    'Repair':'#7c3d12',
    'Other':'#1a2e4a',
  }[jobType]||'#1a2332'

  // ══════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div style={{fontFamily:'system-ui,-apple-system,sans-serif',background:'#f0f2f5',minHeight:'100vh'}}>
      <NavBar user={user} isAdmin={isAdmin} onLogout={handleLogout} loggingOut={loggingOut} />
      <div style={{maxWidth:660,margin:'0 auto',padding:'16px 12px 100px'}}>

        {/* ── Offline banner ───────────────────────────────────────────────── */}
        {!navigator.onLine&&(
          <div style={{background:'#fef3c7',border:'1px solid #f59e0b',borderRadius:8,padding:'8px 14px',marginBottom:12,fontSize:13,color:'#92400e',display:'flex',alignItems:'center',gap:8}}>
            ⚠️ You are offline — form will be saved locally and submitted when back online
          </div>
        )}

        {/* ── Draft banner ─────────────────────────────────────────────────── */}
        {hasDraft&&(
          <div style={{background:'#fffbe6',border:'1px solid #f0c040',borderRadius:8,padding:'8px 14px',marginBottom:12,fontSize:13,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>📋 You have a saved draft.</span>
            <button type="button" onClick={()=>{try{const raw=localStorage.getItem(draftKey);if(raw){loadDraft(JSON.parse(raw));setHasDraft(false)}}catch(e){}}}
              style={{fontSize:13,padding:'3px 10px',background:'#e65c00',color:'#fff',border:'none',borderRadius:5,cursor:'pointer',fontWeight:600}}>
              Restore Draft
            </button>
          </div>
        )}

        {/* ── JOB NUMBER HEADER ────────────────────────────────────────────── */}
        <div style={{background:accent,color:'#fff',borderRadius:10,padding:'12px 16px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',boxShadow:'0 2px 8px rgba(0,0,0,0.15)'}}>
          <div>
            <div style={{fontSize:11,opacity:0.75,letterSpacing:1,textTransform:'uppercase'}}>Job Ticket</div>
            <div style={{fontWeight:800,fontSize:22,letterSpacing:0.5}}>
              {jtConfig.icon} {jobType}
            </div>
            <div style={{fontSize:12,opacity:0.85,marginTop:2}}>
              {jtConfig.short} #{pmNumber||'…'} &nbsp;·&nbsp; WO #{woNumber||'…'}
            </div>
          </div>
          <div style={{textAlign:'right',fontSize:12,opacity:0.85}}>
            <div>{date}</div>
            <div>{startTime}</div>
          </div>
        </div>

        {/* ── JOB TYPE SELECTOR ────────────────────────────────────────────── */}
        <Section icon="🏷️" title="Job Type">
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {JOB_TYPES.map(jt=>(
              <button key={jt.value} type="button" onClick={()=>handleJobTypeChange(jt.value)}
                style={{
                  padding:'14px 10px',borderRadius:8,textAlign:'center',cursor:'pointer',
                  border:jobType===jt.value?`3px solid ${accent}`:'2px solid #e0e0e0',
                  background:jobType===jt.value?accent:'#f8f9fb',
                  color:jobType===jt.value?'#fff':'#333',
                  fontWeight:jobType===jt.value?700:500,fontSize:14,
                  boxShadow:jobType===jt.value?'0 2px 8px rgba(0,0,0,0.18)':'none',
                  transition:'all 0.15s',lineHeight:1.4,
                }}>
                <div style={{fontSize:22,marginBottom:4}}>{jt.icon}</div>
                <div>{jt.label.replace('\\n','\n').split('\n').map((l,i)=><span key={i}>{l}{i===0&&jt.label.includes('\n')&&<br/>}</span>)}</div>
              </button>
            ))}
          </div>
        </Section>

        {/* ── JOB INFORMATION ──────────────────────────────────────────────── */}
        <Section icon="📋" title="Job Information" accent={accent}>
          <div style={row}>
            <div style={fld}><label style={lbl}>Customer *</label>
              <select style={inp} value={customerName} onChange={e=>setCustomerName(e.target.value)}>
                {CUSTOMERS.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={fld}><label style={lbl}>Truck</label>
              <select style={inp} value={truckNumber} onChange={e=>setTruckNumber(e.target.value)}>
                {TRUCKS.map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div style={{marginBottom:10}}>
            <label style={lbl}>Location / Well Name *</label>
            <input style={inp} value={locationName} onChange={e=>setLocationName(e.target.value)} placeholder="e.g. Pad A - Well 12" />
          </div>

          {/* GPS */}
          <div style={{marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <button type="button" onClick={captureGPS} disabled={gpsLoading}
                style={{padding:'7px 14px',borderRadius:6,border:'1px solid '+(gpsLat?'#16a34a':'#d0d5dd'),background:gpsLat?'#f0fdf4':'#f8f9fb',color:gpsLat?'#15803d':'#444',fontSize:13,cursor:gpsLoading?'wait':'pointer',fontWeight:600,display:'flex',alignItems:'center',gap:5}}>
                {gpsLoading?'⏳ Getting GPS…':gpsLat?'📍 GPS Captured':'📍 Capture GPS Location'}
              </button>
              {gpsLat&&(
                <span style={{fontSize:12,color:'#15803d',fontWeight:500}}>
                  {gpsLat.toFixed(4)}, {gpsLng.toFixed(4)} (&plusmn;{gpsAccuracy}m)
                </span>
              )}
              {gpsLat&&(
                <a href={`https://www.google.com/maps?q=${gpsLat},${gpsLng}`} target="_blank" rel="noreferrer"
                  style={{fontSize:12,color:'#2563eb',textDecoration:'none'}}>View on Map ↗</a>
              )}
            </div>
            {gpsError&&<div style={{fontSize:12,color:'#c00',marginTop:4}}>{gpsError}</div>}
          </div>

          <div style={row}>
            <div style={fld}><label style={lbl}>Contact</label><input style={inp} value={customerContact} onChange={e=>setCustomerContact(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Customer W/O #</label><input style={inp} value={customerWorkOrder} onChange={e=>setCustomerWorkOrder(e.target.value)} placeholder="Optional" /></div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Type of Work</label>
              <select style={inp} value={typeOfWork} onChange={e=>setTypeOfWork(e.target.value)}>
                {WORK_TYPES.map(w=><option key={w}>{w}</option>)}
              </select>
            </div>
            <div style={fld}><label style={lbl}>GL Code</label><input style={inp} value={glCode} onChange={e=>setGlCode(e.target.value)} /></div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Asset Tag</label><input style={inp} value={assetTag} onChange={e=>setAssetTag(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Work Area</label><input style={inp} value={workArea} onChange={e=>setWorkArea(e.target.value)} /></div>
          </div>
          <div style={{marginBottom:10}}><label style={lbl}>Last Service Date</label>
            <input type="date" style={inp} value={lastServiceDate} onChange={e=>setLastServiceDate(e.target.value)} />
          </div>
          <label style={{fontSize:13,display:'flex',alignItems:'center',gap:6,marginBottom:4,userSelect:'none',cursor:'pointer'}}>
            <input type="checkbox" checked={warrantyWork} onChange={e=>setWarrantyWork(e.target.checked)} />
            Warranty Work (no charge to customer)
          </label>
        </Section>

        {/* ── PERMIT REQUIREMENTS ──────────────────────────────────────────── */}
        <Section icon="⚠️" title="Permit Requirements" accent={accent} collapsible>
          <div style={{fontSize:12,color:'#666',marginBottom:8}}>Tap any permits required for this job:</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
            {PERMIT_TYPES.map(p=>{
              const active=permitsRequired.includes(p)
              return(
                <button key={p} type="button" onClick={()=>togglePermit(p)}
                  style={{padding:'6px 12px',borderRadius:16,fontSize:12,fontWeight:600,cursor:'pointer',
                    border:'2px solid '+(active?'#c25c00':'#ddd'),
                    background:active?'#c25c00':'#f8f9fb',
                    color:active?'#fff':'#444',
                    transition:'all 0.12s'}}>
                  {p}
                </button>
              )
            })}
          </div>
          {permitsRequired.length>0&&(
            <div style={{marginTop:8,fontSize:12,color:'#c25c00',fontWeight:600}}>
              Active: {permitsRequired.join(' · ')}
            </div>
          )}
        </Section>

        {/* ── TECHNICIANS ──────────────────────────────────────────────────── */}
        <Section icon="👷" title="Technicians" accent={accent}>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
            {TECHS_LIST.map(t=>(
              <button key={t} type="button" onClick={()=>toggleTech(t)}
                style={{padding:'8px 14px',borderRadius:20,border:'2px solid '+(techs.includes(t)?accent:'#ddd'),
                  background:techs.includes(t)?accent:'#fff',color:techs.includes(t)?'#fff':'#333',
                  fontWeight:600,fontSize:13,cursor:'pointer',transition:'all 0.12s'}}>
                {t}
              </button>
            ))}
          </div>
          {techs.length>0&&(
            <div style={{marginBottom:8}}>
              {techs.map(t=>(
                <div key={t} style={{marginBottom:6}}>
                  <SignaturePad
                    label={`Technician Signature — ${t}`}
                    required
                    isSigned={!!techSignatures[t]}
                    onSave={dataUrl=>setTechSignatures(s=>({...s,[t]:dataUrl}))}
                    onClear={()=>setTechSignatures(s=>{const n={...s};delete n[t];return n})}
                  />
                </div>
              ))}
            </div>
          )}
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4}}>
            <label style={{fontSize:12,color:'#555',fontWeight:600}}>Billable Techs:</label>
            <input style={{...inp,width:90}} type="number" min="0" value={billableTechs} onChange={e=>setBillableTechs(e.target.value)} placeholder={techs.length||0} />
          </div>
        </Section>

        {/* ── DATE & TIME ──────────────────────────────────────────────────── */}
        <Section icon="🕐" title="Date & Time" accent={accent}>
          <div style={row}>
            <div style={fld}><label style={lbl}>Date</label><input type="date" style={inp} value={date} onChange={e=>setDate(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Start</label><input type="time" style={inp} value={startTime} onChange={e=>setStartTime(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Depart</label><input type="time" style={inp} value={departureTime} onChange={e=>setDepartureTime(e.target.value)} /></div>
          </div>
        </Section>

        {/* ── WORK DESCRIPTION ─────────────────────────────────────────────── */}
        <Section icon="📝" title="Work Description" accent={accent}>
          {/* SC/Repair only: Reported Issue + Root Cause */}
          {showIssueFields&&(
            <>
              <div style={{marginBottom:10}}>
                <label style={lbl}>Reported Issue *</label>
                <textarea style={{...inp,minHeight:70,resize:'vertical'}} value={reportedIssue} onChange={e=>setReportedIssue(e.target.value)} placeholder="What was the customer-reported problem?" />
              </div>
              <div style={{marginBottom:10}}>
                <label style={lbl}>Root Cause</label>
                <textarea style={{...inp,minHeight:70,resize:'vertical'}} value={rootCause} onChange={e=>setRootCause(e.target.value)} placeholder="Root cause identified..." />
              </div>
            </>
          )}
          <div style={{marginBottom:10}}>
            <label style={lbl}>{showIssueFields?'Work Performed':'Description'}</label>
            <textarea style={{...inp,minHeight:90,resize:'vertical'}} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Describe all work performed..." />
          </div>
          <div style={{marginBottom:6}}>
            <label style={lbl}>Equipment / Serial Numbers</label>
            <input style={inp} value={equipment} onChange={e=>setEquipment(e.target.value)} placeholder="Compressor SN, Tank ID, etc." />
          </div>
        </Section>

        {/* ── SC EQUIPMENT (SC / Repair / Other) ────────────────────────── */}
        {showSCEquip&&(
          <Section icon="🔩" title="Equipment Worked On" accent={accent}>
            <div style={{fontSize:12,color:'#666',marginBottom:8}}>Select all equipment types worked on this call:</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:7,marginBottom:10}}>
              {SC_EQUIP_TYPES.map(type=>{
                const active=scEquipment.some(e=>e.type===type)
                return(
                  <button key={type} type="button"
                    onClick={()=>{
                      if(active) setScEquipment(prev=>prev.filter(e=>e.type!==type))
                      else setScEquipment(prev=>[...prev,{type,notes:''}])
                    }}
                    style={{padding:'6px 12px',borderRadius:16,fontSize:12,fontWeight:600,cursor:'pointer',
                      border:'2px solid '+(active?accent:'#ddd'),
                      background:active?accent:'#f8f9fb',
                      color:active?'#fff':'#333',transition:'all 0.12s'}}>
                    {type}
                  </button>
                )
              })}
            </div>
            {scEquipment.map((item,i)=>(
              <div key={item.type} style={{marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:accent,marginBottom:3}}>{item.type} — Notes</div>
                <input style={inp} placeholder={`Notes for ${item.type} (optional)...`}
                  value={item.notes||''}
                  onChange={e=>setScEquipment(prev=>prev.map((x,xi)=>xi===i?{...x,notes:e.target.value}:x))} />
              </div>
            ))}
            {scEquipment.length===0&&(
              <div style={{fontSize:12,color:'#aaa',textAlign:'center',padding:'8px 0'}}>No equipment selected</div>
            )}
          </Section>
        )}

        {/* ── PM EQUIPMENT (PM only) ────────────────────────────────────────── */}
        {showPMEquipment&&(
          <>
            {/* FLAME ARRESTORS */}
            <Section icon="🔥" title="Flame Arrestors" accent={accent}>
              {arrestors.map((a,i)=>(
                <div key={i} style={{border:'1px solid #e0e0e0',borderRadius:8,padding:10,marginBottom:10,background:'#fafafa'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <div style={{fontWeight:700,color:'#1a2332',fontSize:13}}>Arrestor #{i+1}</div>
                    {arrestors.length>1&&<button type="button" onClick={()=>setArrestors(a=>a.filter((_,idx)=>idx!==i))} style={{background:'none',border:'none',color:'#c00',cursor:'pointer',fontSize:18,padding:0}}>✕</button>}
                  </div>
                  <div style={row}>
                    <div style={fld}><label style={lbl}>Arrestor ID / Tag #</label>
                      <input style={inp} value={a.arrestorId} onChange={e=>updArr(i,'arrestorId',e.target.value)} placeholder="ARR-001" /></div>
                    <div style={fld}><label style={lbl}>Condition</label>
                      <select style={inp} value={a.condition} onChange={e=>updArr(i,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select>
                    </div>
                  </div>
                  <label style={{fontSize:13,display:'flex',alignItems:'center',gap:6,marginBottom:8,cursor:'pointer'}}>
                    <input type="checkbox" checked={a.filterChanged} onChange={e=>updArr(i,'filterChanged',e.target.checked)} />
                    Filter / Element Changed
                  </label>
                  <div style={{marginBottom:8}}><label style={lbl}>Notes</label>
                    <input style={inp} value={a.notes} onChange={e=>updArr(i,'notes',e.target.value)} placeholder="Notes..." /></div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                    <PhotoPicker label="Before - Photo 1" value={a.before1} onChange={v=>updArr(i,'before1',v)} />
                    <PhotoPicker label="Before - Photo 2" value={a.before2} onChange={v=>updArr(i,'before2',v)} />
                    <PhotoPicker label="After - Photo 1"  value={a.after1}  onChange={v=>updArr(i,'after1',v)} />
                    <PhotoPicker label="After - Photo 2"  value={a.after2}  onChange={v=>updArr(i,'after2',v)} />
                  </div>
                </div>
              ))}
              {arrestors.length<5&&(
                <button type="button" onClick={()=>setArrestors(a=>[...a,mkArr()])} style={{width:'100%',padding:8,background:'#f5f5f5',border:'1px dashed #ccc',borderRadius:6,cursor:'pointer',color:'#333',fontSize:13}}>
                  + Add Arrestor ({arrestors.length}/5)
                </button>
              )}
            </Section>

            {/* FLARES */}
            <Section icon="🔦" title="Flares" accent={accent}>
              {flares.map((f,i)=>(
                <div key={i} style={{border:'1px solid #e0e0e0',borderRadius:8,padding:10,marginBottom:10,background:'#fafafa'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <div style={{fontWeight:700,color:'#1a2332',fontSize:13}}>Flare #{i+1}</div>
                    {flares.length>1&&<button type="button" onClick={()=>setFlares(f=>f.filter((_,idx)=>idx!==i))} style={{background:'none',border:'none',color:'#c00',cursor:'pointer',fontSize:18,padding:0}}>✕</button>}
                  </div>
                  <div style={row}>
                    <div style={fld}><label style={lbl}>Flare ID / Tag #</label>
                      <input style={inp} value={f.flareId} onChange={e=>updFlare(i,'flareId',e.target.value)} placeholder="FLR-001" /></div>
                    <div style={fld}><label style={lbl}>Condition</label>
                      <select style={inp} value={f.condition} onChange={e=>updFlare(i,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select>
                    </div>
                  </div>
                  <div style={row}>
                    <label style={{fontSize:13,display:'flex',alignItems:'center',gap:6}}>
                      <input type="checkbox" checked={f.pilotLit} onChange={e=>updFlare(i,'pilotLit',e.target.checked)} />
                      Pilot Lit on Departure
                    </label>
                    <div style={fld}><label style={lbl}>Last Ignition Date</label>
                      <input type="date" style={inp} value={f.lastIgnition} onChange={e=>updFlare(i,'lastIgnition',e.target.value)} /></div>
                  </div>
                  <div style={{marginBottom:8}}><label style={lbl}>Notes</label>
                    <input style={inp} value={f.notes} onChange={e=>updFlare(i,'notes',e.target.value)} placeholder="Notes..." /></div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                    <PhotoPicker label="Flare Photo 1" value={f.photo1} onChange={v=>updFlare(i,'photo1',v)} />
                    <PhotoPicker label="Flare Photo 2" value={f.photo2} onChange={v=>updFlare(i,'photo2',v)} />
                  </div>
                </div>
              ))}
              {flares.length<3&&(
                <button type="button" onClick={()=>setFlares(f=>[...f,mkFlare()])} style={{width:'100%',padding:8,background:'#f5f5f5',border:'1px dashed #ccc',borderRadius:6,cursor:'pointer',color:'#333',fontSize:13}}>
                  + Add Flare ({flares.length}/3)
                </button>
              )}
            </Section>

            {/* HEATER TREATERS */}
            <Section icon="🌡️" title="Heater Treaters" accent={accent}>
              {heaters.map((h,hi)=>(
                <div key={hi} style={{border:'1px solid #e0e0e0',borderRadius:8,padding:10,marginBottom:10,background:'#fafafa'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <div style={{fontWeight:700,color:'#1a2332',fontSize:13}}>Heater Treater #{hi+1}</div>
                    {heaters.length>1&&<button type="button" onClick={()=>setHeaters(h=>h.filter((_,idx)=>idx!==hi))} style={{background:'none',border:'none',color:'#c00',cursor:'pointer',fontSize:18,padding:0}}>✕</button>}
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
                  <div style={{marginBottom:8}}><label style={lbl}>Notes</label>
                    <input style={inp} value={h.notes} onChange={e=>updHT(hi,'notes',e.target.value)} placeholder="Notes..." /></div>
                  <div style={{marginBottom:6}}>
                    <div style={{fontWeight:600,fontSize:12,marginBottom:4}}>Firetubes ({h.firetubes.length}/10)</div>
                    {h.firetubes.map((ft,fi)=>(
                      <div key={fi} style={{border:'1px solid #e8e8e8',borderRadius:6,padding:8,marginBottom:6,background:'#fff'}}>
                        <div style={{fontWeight:600,fontSize:12,marginBottom:6}}>Firetube #{fi+1}</div>
                        <div style={{marginBottom:4}}><label style={lbl}>Condition</label>
                          <select style={{...inp,padding:'5px 8px',fontSize:12}} value={ft.condition} onChange={e=>updFT(hi,fi,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select>
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                          <PhotoPicker label="Photo 1" value={ft.photo1} onChange={v=>updFT(hi,fi,'photo1',v)} />
                          <PhotoPicker label="Photo 2" value={ft.photo2} onChange={v=>updFT(hi,fi,'photo2',v)} />
                        </div>
                      </div>
                    ))}
                    {h.firetubes.length<10&&(
                      <button type="button" onClick={()=>updHT(hi,'firetubes',[...h.firetubes,mkFT()])} style={{width:'100%',padding:6,background:'#f5f5f5',border:'1px dashed #ccc',borderRadius:6,cursor:'pointer',color:'#333',fontSize:12}}>
                        + Add Firetube
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {heaters.length<5&&(
                <button type="button" onClick={()=>setHeaters(h=>[...h,mkHT()])} style={{width:'100%',padding:8,background:'#f5f5f5',border:'1px dashed #ccc',borderRadius:6,cursor:'pointer',color:'#333',fontSize:13}}>
                  + Add Heater Treater ({heaters.length}/5)
                </button>
              )}
            </Section>
          </>
        )}

        {/* ── PARTS USED ────────────────────────────────────────────────── */}
        <Section icon="🧰" title="Parts Used" accent={accent}>
          <div style={{marginBottom:10}}>
            {parts.map(p=>(
              <div key={p.sku} style={{padding:'6px 0',borderBottom:'1px solid #f0f0f0'}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600}}>{p.name}</div>
                    <div style={{fontSize:11,color:'#888'}}>{p.sku} - ${(p.price||0).toFixed(2)}/ea</div>
                  </div>
                  <button type="button" onClick={()=>qtyChange(p.sku,-1)} style={{width:30,height:30,borderRadius:'50%',border:'1px solid #ddd',background:'#f5f5f5',cursor:'pointer',fontSize:16,color:'#333'}}>-</button>
                  <span style={{width:24,textAlign:'center',fontWeight:700}}>{p.qty}</span>
                  <button type="button" onClick={()=>qtyChange(p.sku,1)} style={{width:30,height:30,borderRadius:'50%',border:'1px solid #ddd',background:'#f5f5f5',cursor:'pointer',fontSize:16,color:'#333'}}>+</button>
                  <button type="button" onClick={()=>removePart(p.sku)} style={{color:'#c00',background:'none',border:'none',cursor:'pointer',fontSize:18,padding:'0 4px'}}>✕</button>
                </div>
                {/* Part photos */}
                <div style={{marginTop:6}}>
                  <div style={{display:'flex',gap:6,marginBottom:6,flexWrap:'wrap'}}>
                    {(partPhotos[p.sku]||[]).map((ph,idx)=>(
                      <div key={idx} style={{position:'relative'}}>
                        <img src={URL.createObjectURL(ph.file)} alt="" style={{width:80,height:60,objectFit:'cover',borderRadius:4,border:'1px solid #ddd'}} />
                        <button type="button" onClick={()=>removePartPhoto(p.sku,idx)} style={{position:'absolute',top:1,right:1,background:'rgba(0,0,0,0.55)',color:'#fff',border:'none',borderRadius:'50%',width:16,height:16,fontSize:10,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>✕</button>
                      </div>
                    ))}
                  </div>
                  <label style={{display:'inline-flex',alignItems:'center',gap:3,padding:'4px 8px',background:'#f2f2f2',border:'1px dashed #bbb',borderRadius:5,cursor:'pointer',fontSize:12,color:'#555'}}>
                    + Part Photo
                    <input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{if(e.target.files[0])addPartPhoto(p.sku,e.target.files[0])}} />
                  </label>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={()=>setShowCatalog(v=>!v)}
            style={{width:'100%',padding:9,background:showCatalog?accent:'#f5f5f5',color:showCatalog?'#fff':'#333',border:'1px solid '+(showCatalog?accent:'#ddd'),borderRadius:6,cursor:'pointer',fontWeight:600,fontSize:13}}>
            {showCatalog?'▲ Close Catalog':'+ Add Part from Catalog'}
          </button>
          {showCatalog&&(
            <div style={{marginTop:8}}>
              <input style={{...inp,marginBottom:8}} placeholder="Search by name or SKU..." value={partSearch} onChange={e=>setPartSearch(e.target.value)} />
              <div style={{maxHeight:280,overflowY:'auto',border:'1px solid #e0e0e0',borderRadius:6}}>
                {filteredParts.slice(0,80).map(p=>(
                  <button key={p.code||p.sku} type="button" onClick={()=>addPart(p)} style={{display:'block',width:'100%',textAlign:'left',padding:'7px 10px',background:'none',borderBottom:'1px solid #f0f0f0',borderTop:'none',borderLeft:'none',borderRight:'none',cursor:'pointer',color:'#333'}}>
                    <div style={{fontSize:13,fontWeight:600,color:'#222'}}>{p.desc||p.name}</div>
                    <div style={{fontSize:11,color:'#888'}}>{p.code||p.sku}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* ── ARRIVAL / DEPARTURE VIDEOS (SC / Repair / Other) ────────────── */}
        {showVideos&&(
          <Section icon="🎥" title="Arrival & Departure Videos" accent={accent}>
            <div style={{fontSize:12,color:'#555',marginBottom:10}}>Record a short video before and after the work is completed.</div>
            <div style={row}>
              {/* Arrival */}
              <div style={fld}>
                <label style={lbl}>Arrival Video</label>
                {arrivalVideo?(
                  <div>
                    <video src={URL.createObjectURL(arrivalVideo)} controls style={{width:'100%',borderRadius:6,marginBottom:4}} />
                    <button type="button" onClick={()=>setArrivalVideo(null)} style={{fontSize:12,color:'#c00',background:'none',border:'none',cursor:'pointer',padding:0}}>✕ Remove arrival video</button>
                  </div>
                ):(
                  <label style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,padding:'18px 10px',background:'#f8f9fb',border:'2px dashed #ccc',borderRadius:8,cursor:'pointer',fontSize:13,color:'#555',minHeight:80}}>
                    📹 Record / Upload Arrival
                    <input type="file" accept="video/*" capture="environment" style={{display:'none'}} onChange={e=>setArrivalVideo(e.target.files[0]||null)} />
                  </label>
                )}
              </div>
              {/* Departure */}
              <div style={fld}>
                <label style={lbl}>Departure Video</label>
                {departureVideo?(
                  <div>
                    <video src={URL.createObjectURL(departureVideo)} controls style={{width:'100%',borderRadius:6,marginBottom:4}} />
                    <button type="button" onClick={()=>setDepartureVideo(null)} style={{fontSize:12,color:'#c00',background:'none',border:'none',cursor:'pointer',padding:0}}>✕ Remove departure video</button>
                  </div>
                ):(
                  <label style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,padding:'18px 10px',background:'#f8f9fb',border:'2px dashed #ccc',borderRadius:8,cursor:'pointer',fontSize:13,color:'#555',minHeight:80}}>
                    📹 Record / Upload Departure
                    <input type="file" accept="video/*" capture="environment" style={{display:'none'}} onChange={e=>setDepartureVideo(e.target.files[0]||null)} />
                  </label>
                )}
              </div>
            </div>
          </Section>
        )}

        {/* ── GENERAL JOB PHOTOS ───────────────────────────────────────────── */}
        <Section icon="📷" title="Job Photos" accent={accent}>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
            {photos.map((ph,i)=>(
              <div key={i} style={{position:'relative'}}>
                <img src={URL.createObjectURL(ph)} alt="" style={{width:90,height:68,objectFit:'cover',borderRadius:6,border:'1px solid #ddd'}} />
                <button type="button" onClick={()=>setPhotos(p=>p.filter((_,pi)=>pi!==i))} style={{position:'absolute',top:2,right:2,background:'rgba(0,0,0,0.55)',color:'#fff',border:'none',borderRadius:'50%',width:18,height:18,fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>✕</button>
                <input
                  style={{width:90,marginTop:3,padding:'3px 5px',fontSize:11,border:'1px solid #ddd',borderRadius:4,boxSizing:'border-box'}}
                  placeholder="Caption..."
                  value={photoCaptions[i]||''}
                  onChange={e=>setPhotoCaptions(c=>({...c,[i]:e.target.value}))}
                />
              </div>
            ))}
          </div>
          <label style={{display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',background:'#f5f5f5',border:'1px dashed #bbb',borderRadius:6,cursor:'pointer',fontSize:13,color:'#444',fontWeight:600}}>
            + Add Photos
            <input type="file" accept="image/*" capture="environment" multiple style={{display:'none'}} onChange={e=>addPhoto(e.target.files)} />
          </label>
        </Section>

        {/* ── CUSTOMER SIGN-OFF ─────────────────────────────────────────────── */}
        <Section icon="✍️" title="Customer Sign-Off" accent={accent}>
          <p style={{fontSize:13,color:'#555',margin:'0 0 12px'}}>Customer signature acknowledges satisfactory completion of work described above.</p>
          <SignaturePad
            label="Customer Signature"
            isSigned={!!customerSig}
            onSave={dataUrl=>setCustomerSig(dataUrl)}
            onClear={()=>setCustomerSig(null)}
          />
          {customerSig&&(
            <div style={{marginTop:4,fontSize:12,color:'#16a34a',fontWeight:600}}>✓ Customer signature saved</div>
          )}
        </Section>

        {/* ── COST SUMMARY ─────────────────────────────────────────────────── */}
        <Section icon="💰" title="Cost Summary" accent={accent}>
          <div style={row}>
            <div style={fld}><label style={lbl}>Miles</label><input style={inp} type="number" min="0" value={miles} onChange={e=>setMiles(e.target.value)} placeholder="0" /></div>
            <div style={fld}><label style={lbl}>$/Mile</label><input style={inp} type="number" min="0" step="0.01" value={costPerMile} onChange={e=>setCostPerMile(e.target.value)} /></div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Labor Hours</label><input style={inp} type="number" min="0" step="0.25" value={laborHours} onChange={e=>setLaborHours(e.target.value)} placeholder="0" /></div>
            <div style={fld}><label style={lbl}>$/Hour</label><input style={inp} type="number" min="0" value={hourlyRate} onChange={e=>setHourlyRate(e.target.value)} /></div>
          </div>
          {warrantyWork?(
            <div style={{textAlign:'center',padding:12,color:'#c00',fontWeight:800,fontSize:16,border:'2px solid #c00',borderRadius:6}}>WARRANTY - NO CHARGE</div>
          ):(
            <div style={{marginTop:8,borderTop:'2px solid #f0f0f0',paddingTop:8}}>
              <div style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid #f0f0f0',fontSize:14}}>
                <span>Parts</span><span>${partsTotal.toFixed(2)}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid #f0f0f0',fontSize:14}}>
                <span>Mileage ({miles||0} mi × ${costPerMile}/mi)</span><span>${mileageTotal.toFixed(2)}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid #f0f0f0',fontSize:14}}>
                <span>Labor ({laborHours||0} hrs × ${hourlyRate}/hr × {effBill} tech{effBill!==1?'s':''})</span><span>${laborTotal.toFixed(2)}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0',fontWeight:800,fontSize:18,color:accent}}>
                <span>TOTAL</span><span>${grandTotal.toFixed(2)}</span>
              </div>
            </div>
          )}
        </Section>

        {/* ── ERROR ────────────────────────────────────────────────────────── */}
        {saveError&&(
          <div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:14,color:'#dc2626',fontWeight:500}}>
            ⚠️ {saveError}
          </div>
        )}

        {/* ── SUBMIT ───────────────────────────────────────────────────────── */}
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <button type="button" onClick={saveDraft}
            style={{width:'100%',padding:12,background:draftSaved?'#16a34a':'#f5f5f5',color:draftSaved?'#fff':'#555',border:'1px solid '+(draftSaved?'#16a34a':'#ddd'),borderRadius:8,fontWeight:600,fontSize:14,cursor:'pointer',transition:'all 0.2s'}}>
            {draftSaved?'✅ Draft Saved!':'💾 Save Draft'}
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving}
            style={{width:'100%',padding:16,background:saving?'#ccc':accent,color:'#fff',border:'none',borderRadius:8,fontWeight:800,fontSize:16,cursor:saving?'not-allowed':'pointer',boxShadow:saving?'none':'0 2px 8px rgba(0,0,0,0.18)',transition:'all 0.15s'}}>
            {saving?'Saving…':`Submit ${jtConfig.short} — ${jtConfig.icon} ${jobType}`}
          </button>
        </div>

      </div>
    </div>
  )
}
