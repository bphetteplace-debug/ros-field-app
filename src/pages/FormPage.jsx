// src/pages/FormPage.jsx  —  Unified Job Ticket Form  (UI v2)
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
  fetchPartsCatalog,
} from '../lib/submissions'
import { PARTS_CATALOG as PARTS_CATALOG_STATIC } from '../data/catalog'

// ─── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  navy:    '#0f1f38',
  navyMid: '#1a2e4a',
  orange:  '#e65c00',
  orangeHov:'#cc5200',
  green:   '#16a34a',
  red:     '#dc2626',
  bg:      '#eef1f6',
  card:    '#ffffff',
  border:  '#d8dde6',
  text:    '#1a1f2e',
  muted:   '#6b7280',
  inputBg: '#f8f9fc',
  radius:  10,
  shadow:  '0 1px 3px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)',
  shadowSm:'0 1px 3px rgba(0,0,0,0.10)',
}

const ACCENT = {
  'PM':           '#1a6e3c',
  'Service Call': '#c25c00',
  'Repair':       '#7c3d12',
  'Other':        '#374151',
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const JOB_TYPES = [
  { value:'PM',           label:'Preventive\nMaintenance', icon:'🔧', template:'pm_flare_combustor', short:'PM'  },
  { value:'Service Call', label:'Service\nCall',           icon:'🚨', template:'service_call',       short:'SC'  },
  { value:'Repair',       label:'Repair /\nTroubleshooting',icon:'🛠️',template:'service_call',       short:'RPR' },
  { value:'Other',        label:'Other',                   icon:'📋', template:'service_call',        short:'OTH' },
]
const URL_PARAM_MAP = { pm:'PM', sc:'Service Call', service:'Service Call', repair:'Repair', job:'Service Call', other:'Other' }
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
const nowStr = () => new Date().toTimeString().slice(0,5)

// ─── Shared style helpers ──────────────────────────────────────────────────────
const cardStyle = {
  background: T.card,
  borderRadius: T.radius,
  boxShadow: T.shadow,
  marginBottom: 20,
  overflow: 'hidden',
}
const sectionHeaderStyle = (accent) => ({
  background: accent,
  color: '#fff',
  padding: '13px 18px',
  fontWeight: 700,
  fontSize: 13,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  display: 'flex',
  alignItems: 'center',
  gap: 9,
})
const sectionBodyStyle = { padding: '18px 18px' }
const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: `1.5px solid ${T.border}`,
  borderRadius: 7,
  fontSize: 14,
  color: T.text,
  background: T.inputBg,
  boxSizing: 'border-box',
  outline: 'none',
  transition: 'border-color 0.15s',
  fontFamily: 'inherit',
}
const labelStyle = {
  display: 'block',
  fontSize: 11.5,
  fontWeight: 700,
  color: T.muted,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 5,
}
const rowStyle = { display: 'flex', gap: 12, marginBottom: 14 }
const fieldStyle = { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }

// ─── PhotoPicker ───────────────────────────────────────────────────────────────
function PhotoPicker({ label, value, onChange }) {
  return (
    <div>
      <div style={{ fontSize:11, color:T.muted, marginBottom:4, fontWeight:600 }}>{label}</div>
      {value ? (
        <div style={{ position:'relative', display:'inline-block' }}>
          <img src={URL.createObjectURL(value)} alt=""
            style={{ width:108, height:80, objectFit:'cover', borderRadius:7, border:`1.5px solid ${T.border}`, display:'block' }} />
          <button type="button" onClick={()=>onChange(null)}
            style={{ position:'absolute', top:4, right:4, background:'rgba(15,31,56,0.75)', color:'#fff', border:'none', borderRadius:'50%', width:20, height:20, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', padding:0 }}>✕</button>
        </div>
      ) : (
        <label style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'8px 12px', background:T.inputBg, border:`1.5px dashed ${T.border}`, borderRadius:7, cursor:'pointer', fontSize:12, color:T.muted, fontWeight:600 }}>
          📷 Add Photo
          <input type="file" accept="image/*" capture="environment" style={{ display:'none' }} onChange={e=>onChange(e.target.files[0]||null)} />
        </label>
      )}
    </div>
  )
}

// --- PhotoLightbox ---
function PhotoLightbox({ photos, idx, onClose, onPrev, onNext }) {
  if (idx < 0 || idx >= photos.length) return null;
  const ph = photos[idx];
  const src = URL.createObjectURL(ph);
  const savePhoto = () => { const a = document.createElement('a'); a.href = src; a.download = 'photo-' + (idx+1) + '.jpg'; a.click(); };
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div onClick={e=>e.stopPropagation()} style={{position:'relative',maxWidth:'95vw',maxHeight:'90vh',display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
        <img src={src} alt="" style={{maxWidth:'90vw',maxHeight:'78vh',objectFit:'contain',borderRadius:8}} />
        <div style={{color:'#ccc',fontSize:12}}>{idx+1} / {photos.length}</div>
        <div style={{display:'flex',gap:8}}>
          {idx > 0 && <button type="button" onClick={onPrev} style={{background:'#334',color:'#fff',border:'none',borderRadius:6,padding:'8px 16px',cursor:'pointer',fontWeight:700}}>Prev</button>}
          <button type="button" onClick={savePhoto} style={{background:'#0891b2',color:'#fff',border:'none',borderRadius:6,padding:'8px 16px',cursor:'pointer',fontWeight:700}}>Save to Device</button>
          {idx < photos.length-1 && <button type="button" onClick={onNext} style={{background:'#334',color:'#fff',border:'none',borderRadius:6,padding:'8px 16px',cursor:'pointer',fontWeight:700}}>Next</button>}
        </div>
        <button type="button" onClick={onClose} style={{position:'absolute',top:-36,right:0,background:'transparent',color:'#fff',border:'none',fontSize:22,cursor:'pointer',fontWeight:700}}>Close X</button>
      </div>
    </div>
  );
}

// ─── SignaturePad ───────────────────────────────────────────────────────────────
function SignaturePad({ label, required=false, onSave, onClear, isSigned=false }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const getPos = (e,c) => {
    const r=c.getBoundingClientRect(), src=e.touches?e.touches[0]:e
    return { x:(src.clientX-r.left)*(c.width/r.width), y:(src.clientY-r.top)*(c.height/r.height) }
  }
  const start = e => {
    drawing.current=true
    const c=canvasRef.current, ctx=c.getContext('2d')
    ctx.lineWidth=2.5; ctx.strokeStyle=T.navy; ctx.lineJoin='round'; ctx.lineCap='round'
    const p=getPos(e,c); ctx.beginPath(); ctx.moveTo(p.x,p.y); e.preventDefault()
  }
  const move = e => {
    if (!drawing.current) return
    const c=canvasRef.current, ctx=c.getContext('2d'), p=getPos(e,c)
    ctx.lineTo(p.x,p.y); ctx.stroke(); e.preventDefault()
  }
  const stop = () => { drawing.current=false }
  const handleSave  = () => onSave(canvasRef.current.toDataURL('image/png'))
  const handleClear = () => { canvasRef.current.getContext('2d').clearRect(0,0,560,110); onClear() }

  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:13, fontWeight:700, marginBottom:7, color:T.navyMid, display:'flex', alignItems:'center', gap:7 }}>
        {label}
        {required && <span style={{ fontSize:10, fontWeight:800, color:T.red, textTransform:'uppercase', letterSpacing:0.5, background:'#fef2f2', padding:'2px 6px', borderRadius:4 }}>Required</span>}
        {isSigned && <span style={{ fontSize:11, fontWeight:800, color:T.green, background:'#f0fdf4', padding:'2px 8px', borderRadius:4 }}>✓ Signed</span>}
      </div>
      <canvas ref={canvasRef} width={560} height={110}
        style={{ border: isSigned?`2px solid ${T.green}`:`2px dashed ${T.border}`, borderRadius:8, touchAction:'none', background:isSigned?'#f0fdf4':'#fafbfd', width:'100%', maxWidth:560, display:'block', cursor:'crosshair' }}
        onMouseDown={start} onMouseMove={move} onMouseUp={stop} onMouseLeave={stop}
        onTouchStart={start} onTouchMove={move} onTouchEnd={stop} />
      <div style={{ display:'flex', gap:8, marginTop:8 }}>
        <button type="button" onClick={handleSave}
          style={{ fontSize:12, padding:'6px 16px', background:T.navy, color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontWeight:700 }}>Save</button>
        <button type="button" onClick={handleClear}
          style={{ fontSize:12, padding:'6px 14px', background:'transparent', color:T.muted, border:`1px solid ${T.border}`, borderRadius:6, cursor:'pointer' }}>Clear</button>
      </div>
    </div>
  )
}

// ─── Section card ───────────────────────────────────────────────────────────────
function Section({ icon, title, children, accent=T.navyMid, collapsible=false, defaultOpen=true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={cardStyle}>
      <div onClick={collapsible?()=>setOpen(o=>!o):undefined}
        style={{ ...sectionHeaderStyle(accent), cursor:collapsible?'pointer':'default', userSelect:'none' }}>
        <span style={{ fontSize:18, lineHeight:1 }}>{icon}</span>
        <span style={{ flex:1 }}>{title}</span>
        {collapsible && <span style={{ fontSize:13, opacity:0.8 }}>{open?'▲':'▼'}</span>}
      </div>
      {open && <div style={sectionBodyStyle}>{children}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function FormPage() {
  const { user, profile, isAdmin, isDemo, signOut } = useAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const handleLogout = useCallback(async () => {
    setLoggingOut(true); try { await signOut() } catch(e) {}; setLoggingOut(false)
  }, [signOut])

  const [searchParams] = useSearchParams()
  const initType = URL_PARAM_MAP[searchParams.get('type')||''] || 'PM'

  const [pmNumber,  setPmNumber]  = useState(null)
  const [woNumber,  setWoNumber]  = useState(null)
  const [CUSTOMERS, setCUSTOMERS] = useState(DEFAULT_CUSTOMERS)
  const [TRUCKS,    setTRUCKS]    = useState(DEFAULT_TRUCKS)
  const [TECHS_LIST,setTECHS_LIST]= useState(DEFAULT_TECHS)

  const [jobType,    setJobType]    = useState(initType)
  const showVideos      = showsVideos(jobType)
  const showPMEquipment = showsPMEquipment(jobType)
  const showSCEquip     = showsSCEquipment(jobType)
  const showIssueFields = showsIssueFields(jobType)

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

  const [parts,       setParts]       = useState([])
  const [partPhotos,  setPartPhotos]  = useState({})
  const [partSearch,  setPartSearch]  = useState('')
  const [partsCatalog, setPartsCatalog] = useState(PARTS_CATALOG_STATIC)
  const [showCatalog, setShowCatalog] = useState(false)

  const [miles,         setMiles]         = useState('')
  const [costPerMile,   setCostPerMile]   = useState('1.50')
  const [laborHours,    setLaborHours]    = useState('')
  const [hourlyRate,    setHourlyRate]    = useState('115.00')
  const [billableTechs, setBillableTechs] = useState('')

  const [photos,         setPhotos]         = useState([])
  const [photoCaptions,  setPhotoCaptions]  = useState({})
  const [arrivalVideo,   setArrivalVideo]   = useState(null)
  const [departureVideo, setDepartureVideo] = useState(null)
  const [lightboxIdx, setLightboxIdx]   = useState(-1)

  const [techSignatures, setTechSignatures] = useState({})
  const [customerSig,    setCustomerSig]    = useState(null)

  const mkArr   = () => ({ arrestorId:'', condition:'Good', filterChanged:false, notes:'', before1:null, before2:null, after1:null, after2:null })
  const mkFlare = () => ({ flareId:'', pilotLit:true, lastIgnition:'', condition:'Good', notes:'', photo1:null, photo2:null })
  const mkFT    = () => ({ condition:'Good', photo1:null, photo2:null })
  const mkHT    = () => ({ heaterId:'', lastCleanDate:'', condition:'Good', notes:'', firetubes:[mkFT()] })
  const [arrestors, setArrestors] = useState([mkArr()])
  const [flares,    setFlares]    = useState([mkFlare()])
  const [heaters,   setHeaters]   = useState([mkHT()])
  const [scEquipment,setScEquipment]=useState([])

  const [gpsLat,      setGpsLat]      = useState(null)
  const [gpsLng,      setGpsLng]      = useState(null)
  const [gpsAccuracy, setGpsAccuracy] = useState(null)
  const [gpsLoading,  setGpsLoading]  = useState(false)
  const [gpsError,    setGpsError]    = useState(null)

  const [saving,     setSaving]    = useState(false)
  const [saveError,  setSaveError] = useState(null)
  const [draftSaved, setDraftSaved]= useState(false)
  const [hasDraft,   setHasDraft]  = useState(false)
  const draftTimerRef = useRef(null)

  const effBill      = parseInt(billableTechs)||techs.length||1
  const partsTotal   = parts.reduce((s,p)=>s+(parseFloat(p.price||0)*parseInt(p.qty||1)),0)
  const mileageTotal = parseFloat(miles||0)*parseFloat(costPerMile||1.50)
  const laborTotal   = warrantyWork?0:parseFloat(laborHours||0)*parseFloat(hourlyRate||115)*effBill
  const grandTotal   = warrantyWork?0:partsTotal+mileageTotal+laborTotal

  const filteredParts = partsCatalog.filter(p=>{
    if(!partSearch) return true
    const q=partSearch.toLowerCase()
    return (p.name||p.desc||'').toLowerCase().includes(q)||(p.sku||p.code||'').toLowerCase().includes(q)
  })

  const updArr   = (i,k,v)=>setArrestors(a=>a.map((x,idx)=>idx===i?{...x,[k]:v}:x))
  const updFlare = (i,k,v)=>setFlares(f=>f.map((x,idx)=>idx===i?{...x,[k]:v}:x))
  const updHT    = (i,k,v)=>setHeaters(h=>h.map((x,idx)=>idx===i?{...x,[k]:v}:x))
  const updFT    = (hi,fi,k,v)=>setHeaters(h=>h.map((ht,hi2)=>hi2!==hi?ht:{...ht,firetubes:ht.firetubes.map((ft,fi2)=>fi2!==fi?ft:{...ft,[k]:v})}))

  const toggleTech   = t=>setTechs(ts=>ts.includes(t)?ts.filter(x=>x!==t):[...ts,t])
  const togglePermit = p=>setPermitsRequired(ps=>ps.includes(p)?ps.filter(x=>x!==p):[...ps,p])

  const addPart = p=>{
    const sku=p.code||p.sku
    setParts(ps=>ps.some(x=>x.sku===sku)?ps.map(x=>x.sku===sku?{...x,qty:x.qty+1}:x):[...ps,{sku,name:p.desc||p.name,price:parseFloat(p.price||0),qty:1}])
    setShowCatalog(false)
  }
  const removePart      = sku=>{ setParts(ps=>ps.filter(x=>x.sku!==sku)); setPartPhotos(pp=>{const n={...pp};delete n[sku];return n}) }
  const qtyChange       = (sku,d)=>setParts(ps=>ps.map(x=>x.sku===sku?{...x,qty:Math.max(0,x.qty+d)}:x).filter(x=>x.qty>0))
  const addPartPhoto    = (sku,file)=>setPartPhotos(pp=>({...pp,[sku]:[...(pp[sku]||[]),{file,caption:''}]}))
  const removePartPhoto = (sku,idx)=>setPartPhotos(pp=>({...pp,[sku]:(pp[sku]||[]).filter((_,i)=>i!==idx)}))
  const addPhoto        = files=>{ setPhotos(p=>[...p,...Array.from(files||[])]) }

  const handleJobTypeChange = newType => {
    setJobType(newType)
    if(!showsPMEquipment(newType)){setArrestors([mkArr()]);setFlares([mkFlare()]);setHeaters([mkHT()])}
    if(!showsSCEquipment(newType)) setScEquipment([])
    if(!showsVideos(newType)){ setArrivalVideo(null); setDepartureVideo(null) }
    if(!showsIssueFields(newType)){ setReportedIssue(''); setRootCause('') }
  }

  const captureGPS = ()=>{
    if(!navigator.geolocation){setGpsError('GPS not supported');return}
    setGpsLoading(true); setGpsError(null)
    navigator.geolocation.getCurrentPosition(
      pos=>{ setGpsLat(pos.coords.latitude); setGpsLng(pos.coords.longitude); setGpsAccuracy(Math.round(pos.coords.accuracy)); setGpsLoading(false) },
      err=>{ setGpsError('GPS error: '+err.message); setGpsLoading(false) },
      {enableHighAccuracy:true,timeout:15000}
    )
  }

  // ── Presence heartbeat ──────────────────────────────────────────────────
  useEffect(()=>{
    if (!user) return
    const SUPA_URL = import.meta.env.VITE_SUPABASE_URL
    const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
    const headers = { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' }
    const formLabel = jobType || 'Work Order'
    const upsertPresence = () => {
      fetch(SUPA_URL + '/rest/v1/user_presence', {
        method: 'POST', headers,
        body: JSON.stringify({ user_id: user.id, user_name: profile?.full_name || user.email, form_type: jobType || 'form', form_label: formLabel, started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      }).catch(()=>{})
    }
    upsertPresence()
    const interval = setInterval(upsertPresence, 30000)
    return () => {
      clearInterval(interval)
      fetch(SUPA_URL + '/rest/v1/user_presence?user_id=eq.' + user.id, { method: 'DELETE', headers }).catch(()=>{})
    }
  }, [user, jobType])

  useEffect(()=>{
    getNextPmNumber().then(n=>{if(n)setPmNumber(n)}).catch(()=>{})
    getNextWoNumber().then(n=>{if(n)setWoNumber(n)}).catch(()=>{})
    fetchPartsCatalog().then(p=>{if(p&&p.length)setPartsCatalog(p.map(r=>({code:r.code||'',desc:r.description,name:r.description,price:parseFloat(r.price||0),category:r.category||''})))}).catch(()=>{})
    fetchSettings().then(s=>{
      if(!s)return
      if(s.customers?.length)setCUSTOMERS(s.customers)
      if(s.trucks?.length)setTRUCKS(s.trucks)
      if(s.techs?.length)setTECHS_LIST(s.techs)
    }).catch(()=>{})
    if(profile?.full_name)setTechs(ts=>ts.includes(profile.full_name)?ts:[...ts,profile.full_name])
  },[]) // eslint-disable-line

  useEffect(()=>{
    if(CUSTOMERS.length&&!customerName)setCustomerName(CUSTOMERS[0])
  },[CUSTOMERS]) // eslint-disable-line

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
    if(d.jobType)handleJobTypeChange(d.jobType)
    const sets=[['warrantyWork',setWarrantyWork],['customerName',setCustomerName],['truckNumber',setTruckNumber],['locationName',setLocationName],['customerContact',setCustomerContact],['customerWorkOrder',setCustomerWorkOrder],['typeOfWork',setTypeOfWork],['glCode',setGlCode],['assetTag',setAssetTag],['workArea',setWorkArea],['date',setDate],['startTime',setStartTime],['departureTime',setDepartureTime],['lastServiceDate',setLastServiceDate],['description',setDescription],['reportedIssue',setReportedIssue],['rootCause',setRootCause],['equipment',setEquipment],['miles',setMiles],['costPerMile',setCostPerMile],['laborHours',setLaborHours],['hourlyRate',setHourlyRate],['billableTechs',setBillableTechs]]
    sets.forEach(([k,fn])=>{ if(d[k]!==undefined)fn(d[k]) })
    if(d.techs?.length)setTechs(d.techs)
    if(d.permitsRequired?.length)setPermitsRequired(d.permitsRequired)
    if(d.parts?.length)setParts(d.parts)
    if(d.scEquipment?.length)setScEquipment(d.scEquipment)
  },[]) // eslint-disable-line

  useEffect(()=>{ try{if(localStorage.getItem(draftKey))setHasDraft(true)}catch(e){} },[draftKey])
  useEffect(()=>{ draftTimerRef.current=setInterval(saveDraft,30000); return()=>clearInterval(draftTimerRef.current) },[saveDraft])

  const toDataUrl = file=>new Promise((res,rej)=>{ const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsDataURL(file) })

  const handleSubmit = async () => {
    if (isDemo) { setSaveError('Demo mode — read only'); return }
    if(!customerName||!locationName){setSaveError('Customer and location are required');return}
    setSaving(true);setSaveError(null)
    try{
      const photoDataUrls={}
      if(photos.length>0) photoDataUrls['general']=await Promise.all(photos.map(async(f,i)=>({dataUrl:await toDataUrl(f),caption:photoCaptions[i]||''})))
      for(const p of parts){ const pf=partPhotos[p.sku]||[]; if(pf.length) photoDataUrls[`part-${p.sku}`]=await Promise.all(pf.map(async x=>({dataUrl:await toDataUrl(x.file),caption:x.caption}))) }
      if(showVideos){
        if(arrivalVideo){const u=await toDataUrl(arrivalVideo);if(u)photoDataUrls['arrival-video']=[{dataUrl:u,caption:'Arrival Video'}]}
        if(departureVideo){const u=await toDataUrl(departureVideo);if(u)photoDataUrls['departure-video']=[{dataUrl:u,caption:'Departure Video'}]}
      }
      if(showPMEquipment){
        for(let i=0;i<arrestors.length;i++){
          const a=arrestors[i], pf=[a.before1&&{file:a.before1,caption:`Arrestor ${i+1} Before 1`},a.before2&&{file:a.before2,caption:`Arrestor ${i+1} Before 2`},a.after1&&{file:a.after1,caption:`Arrestor ${i+1} After 1`},a.after2&&{file:a.after2,caption:`Arrestor ${i+1} After 2`}].filter(Boolean)
          if(pf.length) photoDataUrls[`arrestor-${i}`]=await Promise.all(pf.map(async x=>({dataUrl:await toDataUrl(x.file),caption:x.caption})))
        }
        for(let i=0;i<flares.length;i++){
          const f=flares[i], pf=[f.photo1&&{file:f.photo1,caption:`Flare ${i+1} P1`},f.photo2&&{file:f.photo2,caption:`Flare ${i+1} P2`}].filter(Boolean)
          if(pf.length) photoDataUrls[`flare-${i}`]=await Promise.all(pf.map(async x=>({dataUrl:await toDataUrl(x.file),caption:x.caption})))
        }
      }
      if(customerSig) photoDataUrls['customer-sig']=[{dataUrl:customerSig,caption:'Customer Signature'}]
      const tse=Object.entries(techSignatures)
      if(tse.length) photoDataUrls['tech-sigs']=tse.map(([name,dataUrl])=>({dataUrl,caption:`${name} Signature`}))

      const jtObj=JOB_TYPES.find(jt=>jt.value===jobType)
      const template=jtObj?.template||'service_call'
      const effectiveWoNumber=woNumber||''
      const formData={
        jobType,pmNumber,woNumber:effectiveWoNumber,warrantyWork,customerName,truckNumber,locationName,
        customerContact,customerWorkOrder,typeOfWork,glCode,assetTag,workArea,date,startTime,departureTime,
        lastServiceDate,description,reportedIssue:showIssueFields?reportedIssue:'',rootCause:showIssueFields?rootCause:'',
        permitsRequired,techs,equipment,parts,miles,costPerMile,laborHours,hourlyRate,billableTechs,
        gpsLat,gpsLng,gpsAccuracy,
        arrestors:showPMEquipment?arrestors.map(a=>({arrestorId:a.arrestorId,condition:a.condition,filterChanged:a.filterChanged,notes:a.notes})):[],
        flares:showPMEquipment?flares.map(f=>({flareId:f.flareId,condition:f.condition,pilotLit:f.pilotLit,lastIgnition:f.lastIgnition,notes:f.notes})):[],
        heaters:showPMEquipment?heaters.map(h=>({heaterId:h.heaterId,condition:h.condition,lastCleanDate:h.lastCleanDate,notes:h.notes,firetubeCnt:h.firetubes.length,firetubes:h.firetubes.map(ft=>({condition:ft.condition}))})):[],
        scEquipment:showSCEquip?scEquipment:[],
      }
      const submission=await saveSubmission(formData,user.id,template)
      if(submission?.id&&Object.keys(photoDataUrls).length>0) await uploadPhotos(submission.id,photoDataUrls)
      if(submission?.id){
        fetch('/api/send-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({submissionId:submission.id})})
          .catch(err=>console.warn('Email send failed:',err))
      }
      try{localStorage.removeItem(draftKey)}catch(e){}
      navigate('/submissions')
    }catch(err){
      console.error('Submit error:',err)
      if(!navigator.onLine){ try{queueOfflineSubmission({jobType,customerName,locationName,date,description});navigate('/submissions');return}catch(e){} }
      setSaveError(err?.message||'Submission failed. Please try again.')
    }finally{ setSaving(false) }
  }

  // ─── Accent color for current job type ────────────────────────────────────
  const accent = ACCENT[jobType]||T.navyMid
  const jtConfig = JOB_TYPES.find(jt=>jt.value===jobType)||JOB_TYPES[0]

  // ─── Reusable styled input + select ──────────────────────────────────────
  const inp = inputStyle
  const lbl = labelStyle
  const row = rowStyle
  const fld = fieldStyle

  // ═════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════
  return (
    <div style={{fontFamily:"'Inter', system-ui, -apple-system, sans-serif",background:T.bg,minHeight:'100vh'}}>
      <NavBar user={user} isAdmin={isAdmin} onLogout={handleLogout} loggingOut={loggingOut} />

      <div style={{maxWidth:680,margin:'0 auto',padding:'20px 14px 110px'}}>

        {/* ── Offline banner ─── */}
        {!navigator.onLine&&(
          <div style={{background:'#fffbeb',border:`1.5px solid #f59e0b`,borderRadius:9,padding:'10px 16px',marginBottom:16,fontSize:13,color:'#92400e',display:'flex',alignItems:'center',gap:8,boxShadow:T.shadowSm}}>
            ⚠️ <strong>Offline</strong> — will auto-submit when connection returns
          </div>
        )}

        {/* ── Draft banner ─── */}
        {hasDraft&&(
          <div style={{background:'#fff7ed',border:`1.5px solid ${T.orange}`,borderRadius:9,padding:'10px 16px',marginBottom:16,fontSize:13,display:'flex',justifyContent:'space-between',alignItems:'center',boxShadow:T.shadowSm}}>
            <span style={{color:'#92400e'}}>📋 <strong>Draft saved</strong> — restore your last entry?</span>
            <button type="button" onClick={()=>{ try{const r=localStorage.getItem(draftKey);if(r){loadDraft(JSON.parse(r));setHasDraft(false)}}catch(e){} }}
              style={{fontSize:12,padding:'5px 14px',background:T.orange,color:'#fff',border:'none',borderRadius:6,cursor:'pointer',fontWeight:700}}>
              Restore
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            JOB NUMBER HERO BANNER
        ══════════════════════════════════════════════════════════ */}
        <div style={{background:`linear-gradient(135deg, ${T.navy} 0%, ${accent} 100%)`,borderRadius:14,padding:'20px 22px',marginBottom:20,boxShadow:'0 4px 20px rgba(0,0,0,0.22)',color:'#fff',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
          <div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:2,opacity:0.65,textTransform:'uppercase',marginBottom:4}}>Job Ticket</div>
            <div style={{fontSize:30,fontWeight:900,lineHeight:1.1,marginBottom:4,letterSpacing:'-0.5px'}}>WO #{woNumber||'…'}</div>
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4}}>
              <span style={{background:'rgba(255,255,255,0.18)',backdropFilter:'blur(4px)',padding:'3px 12px',borderRadius:20,fontSize:13,fontWeight:700}}>{jtConfig.icon} {jobType}</span>
            </div>
          </div>
          <div style={{textAlign:'right',fontSize:12,opacity:0.8,flexShrink:0}}>
            <div style={{fontWeight:700,fontSize:13}}>{date}</div>
            <div>{startTime}</div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            JOB TYPE SELECTOR
        ══════════════════════════════════════════════════════════ */}
        <div style={{...cardStyle,marginBottom:20}}>
          <div style={{...sectionHeaderStyle(T.navy)}}>
            <span style={{fontSize:18}}>🏷️</span>
            <span>Job Type</span>
          </div>
          <div style={{padding:'16px 14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            {JOB_TYPES.map(jt=>{
              const ac=ACCENT[jt.value]||T.navyMid
              const active=jobType===jt.value
              return(
                <button key={jt.value} type="button" onClick={()=>handleJobTypeChange(jt.value)}
                  style={{
                    padding:'16px 12px',borderRadius:10,cursor:'pointer',textAlign:'center',
                    border:active?`2.5px solid ${ac}`:`2px solid ${T.border}`,
                    background:active?ac:T.inputBg,
                    color:active?'#fff':T.text,
                    fontWeight:active?800:500,
                    boxShadow:active?'0 4px 14px rgba(0,0,0,0.2)':T.shadowSm,
                    transform:active?'translateY(-1px)':'none',
                    transition:'all 0.18s cubic-bezier(.4,0,.2,1)',
                    fontFamily:'inherit',
                    outline:'none',
                  }}>
                  <div style={{fontSize:28,marginBottom:6,lineHeight:1}}>{jt.icon}</div>
                  <div style={{fontSize:13,lineHeight:1.35}}>
                    {jt.label.split('\n').map((l,i)=><span key={i}>{l}{i===0&&jt.label.includes('\n')&&<br/>}</span>)}
                  </div>
                  {active&&<div style={{marginTop:6,fontSize:10,fontWeight:800,letterSpacing:1,opacity:0.85,textTransform:'uppercase'}}>Selected ✓</div>}
                </button>
              )
            })}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            JOB INFORMATION
        ══════════════════════════════════════════════════════════ */}
        <Section icon="📋" title="Job Information" accent={accent}>
          <div style={row}>
            <div style={fld}>
              <label style={lbl}>Customer *</label>
              <select style={inp} value={customerName} onChange={e=>setCustomerName(e.target.value)}>
                {CUSTOMERS.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={fld}>
              <label style={lbl}>Truck</label>
              <select style={inp} value={truckNumber} onChange={e=>setTruckNumber(e.target.value)}>
                {TRUCKS.map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div style={{marginBottom:14}}>
            <label style={lbl}>Location / Well Name *</label>
            <input style={inp} value={locationName} onChange={e=>setLocationName(e.target.value)} placeholder="e.g. Pad A — Well 12" />
          </div>

          {/* GPS capture */}
          <div style={{marginBottom:14,padding:'12px 14px',background:gpsLat?'#f0fdf4':'#f8f9fc',border:`1.5px solid ${gpsLat?T.green:T.border}`,borderRadius:9,transition:'all 0.2s'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              <button type="button" onClick={captureGPS} disabled={gpsLoading}
                style={{display:'flex',alignItems:'center',gap:6,padding:'8px 16px',borderRadius:7,border:'none',background:gpsLat?T.green:accent,color:'#fff',fontSize:13,fontWeight:700,cursor:gpsLoading?'wait':'pointer',transition:'all 0.15s',fontFamily:'inherit'}}>
                {gpsLoading?<>⏳ Getting GPS…</>:gpsLat?<>✅ GPS Captured</>:<>📍 Capture GPS</>}
              </button>
              {gpsLat&&(
                <div style={{fontSize:12,color:'#15803d',fontWeight:600}}>
                  {gpsLat.toFixed(5)}, {gpsLng.toFixed(5)}
                  <span style={{color:'#4ade80',marginLeft:6}}>± {gpsAccuracy}m</span>
                </div>
              )}
              {gpsLat&&(
                <a href={`https://maps.google.com/?q=${gpsLat},${gpsLng}`} target="_blank" rel="noreferrer"
                  style={{fontSize:12,color:T.navyMid,fontWeight:600,textDecoration:'none',display:'flex',alignItems:'center',gap:3}}>
                  🗺️ View Map ↗
                </a>
              )}
            </div>
            {gpsError&&<div style={{fontSize:12,color:T.red,marginTop:6,fontWeight:500}}>⚠️ {gpsError}</div>}
          </div>

          <div style={row}>
            <div style={fld}><label style={lbl}>Contact</label><input style={inp} value={customerContact} onChange={e=>setCustomerContact(e.target.value)} placeholder="Name / phone" /></div>
            <div style={fld}><label style={lbl}>Customer Work Order / PO #</label><input style={inp} value={customerWorkOrder} onChange={e=>setCustomerWorkOrder(e.target.value)} placeholder="Optional" /></div>
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
          <div style={{marginBottom:14}}>
            <label style={lbl}>Last Service Date</label>
            <input type="date" style={inp} value={lastServiceDate} onChange={e=>setLastServiceDate(e.target.value)} />
          </div>
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:14,color:T.text,cursor:'pointer',userSelect:'none',padding:'8px 12px',background:warrantyWork?'#fef2f2':'transparent',borderRadius:7,border:warrantyWork?`1.5px solid ${T.red}`:'1.5px solid transparent',transition:'all 0.15s'}}>
            <input type="checkbox" checked={warrantyWork} onChange={e=>setWarrantyWork(e.target.checked)} style={{width:16,height:16,cursor:'pointer'}} />
            <span style={{fontWeight:warrantyWork?700:500,color:warrantyWork?T.red:T.text}}>
              {warrantyWork?'⚠️ Warranty Work — No Charge':'Warranty Work (no charge to customer)'}
            </span>
          </label>
        </Section>

        {/* ══ PERMIT REQUIREMENTS ══ */}
        <Section icon="⚠️" title="Permit Requirements" accent={accent} collapsible defaultOpen={false}>
          <div style={{fontSize:12,color:T.muted,marginBottom:10,fontWeight:500}}>Tap permits required for this job:</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
            {PERMIT_TYPES.map(p=>{
              const active=permitsRequired.includes(p)
              return(
                <button key={p} type="button" onClick={()=>togglePermit(p)}
                  style={{padding:'7px 14px',borderRadius:20,fontSize:12,fontWeight:700,cursor:'pointer',
                    border:`2px solid ${active?accent:T.border}`,
                    background:active?accent:T.inputBg, color:active?'#fff':T.text,
                    transition:'all 0.14s',fontFamily:'inherit'}}>
                  {p}
                </button>
              )
            })}
          </div>
          {permitsRequired.length>0&&(
            <div style={{marginTop:10,padding:'8px 12px',background:'#fff7ed',border:`1px solid ${T.orange}`,borderRadius:7,fontSize:12,color:'#92400e',fontWeight:700}}>
              ⚠️ Active: {permitsRequired.join(' · ')}
            </div>
          )}
        </Section>

        {/* ══ TECHNICIANS ══ */}
        <Section icon="👷" title="Technicians" accent={accent}>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
            {TECHS_LIST.map(t=>{
              const active=techs.includes(t)
              return(
                <button key={t} type="button" onClick={()=>toggleTech(t)}
                  style={{padding:'8px 16px',borderRadius:22,border:`2px solid ${active?accent:T.border}`,
                    background:active?accent:T.inputBg, color:active?'#fff':T.text,
                    fontWeight:700,fontSize:13,cursor:'pointer',transition:'all 0.14s',fontFamily:'inherit',
                    boxShadow:active?'0 2px 8px rgba(0,0,0,0.15)':'none'}}>
                  {active?'✓ ':''}{t}
                </button>
              )
            })}
          </div>
          {techs.length>0&&(
            <div style={{borderTop:`1px solid ${T.border}`,paddingTop:14,marginTop:4}}>
              {techs.map(t=>(
                <div key={t} style={{marginBottom:12,padding:'12px 14px',background:T.inputBg,borderRadius:8,border:`1px solid ${T.border}`}}>
                  <SignaturePad
                    label={`Technician: ${t}`}
                    required
                    isSigned={!!techSignatures[t]}
                    onSave={d=>setTechSignatures(s=>({...s,[t]:d}))}
                    onClear={()=>setTechSignatures(s=>{const n={...s};delete n[t];return n})}
                  />
                </div>
              ))}
            </div>
          )}
          <div style={{display:'flex',alignItems:'center',gap:10,marginTop:techs.length?12:0}}>
            <label style={{...lbl,marginBottom:0,whiteSpace:'nowrap'}}>Billable Techs:</label>
            <input style={{...inp,width:80,flex:'none'}} type="number" min="0" value={billableTechs} onChange={e=>setBillableTechs(e.target.value)} placeholder={String(techs.length||0)} />
            {techs.length>0&&<span style={{fontSize:12,color:T.muted}}>(default: {techs.length} selected)</span>}
          </div>
        </Section>

        {/* ══ DATE & TIME ══ */}
        <Section icon="🕐" title="Date & Time" accent={accent}>
          <div style={row}>
            <div style={fld}><label style={lbl}>Date</label><input type="date" style={inp} value={date} onChange={e=>setDate(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Arrival Time</label><input type="time" style={inp} value={startTime} onChange={e=>setStartTime(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Departure Time</label><input type="time" style={inp} value={departureTime} onChange={e=>setDepartureTime(e.target.value)} /></div>
          </div>
        </Section>

        {/* ══ WORK DESCRIPTION ══ */}
        <Section icon="📝" title="Work Description" accent={accent}>
          {showIssueFields&&(
            <>
              <div style={{marginBottom:14}}>
                <label style={lbl}>Reported Issue *</label>
                <textarea style={{...inp,minHeight:72,resize:'vertical'}} value={reportedIssue} onChange={e=>setReportedIssue(e.target.value)} placeholder="What was the customer-reported problem?" />
              </div>
              <div style={{marginBottom:14}}>
                <label style={lbl}>Root Cause</label>
                <textarea style={{...inp,minHeight:72,resize:'vertical'}} value={rootCause} onChange={e=>setRootCause(e.target.value)} placeholder="Identified root cause..." />
              </div>
            </>
          )}
          <div style={{marginBottom:14}}>
            <label style={lbl}>{showIssueFields?'Work Performed':'Description'}</label>
            <textarea style={{...inp,minHeight:88,resize:'vertical'}} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Describe all work performed..." />
          </div>
          <div>
            <label style={lbl}>Equipment / Serial Numbers</label>
            <input style={inp} value={equipment} onChange={e=>setEquipment(e.target.value)} placeholder="Compressor SN, Tank ID, etc." />
          </div>
        </Section>

        {/* ══ SC EQUIPMENT ══ */}
        {showSCEquip&&(
          <Section icon="🔩" title="Equipment Worked On" accent={accent}>
            <div style={{fontSize:12,color:T.muted,marginBottom:10,fontWeight:500}}>Select all equipment types worked on this call:</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}}>
              {SC_EQUIP_TYPES.map(type=>{
                const active=scEquipment.some(e=>e.type===type)
                return(
                  <button key={type} type="button"
                    onClick={()=>{ if(active)setScEquipment(p=>p.filter(e=>e.type!==type)); else setScEquipment(p=>[...p,{type,notes:''}]) }}
                    style={{padding:'7px 13px',borderRadius:18,fontSize:12,fontWeight:700,cursor:'pointer',
                      border:`2px solid ${active?accent:T.border}`,background:active?accent:T.inputBg,color:active?'#fff':T.text,transition:'all 0.13s',fontFamily:'inherit'}}>
                    {type}
                  </button>
                )
              })}
            </div>
            {scEquipment.map((item,i)=>(
              <div key={item.type} style={{marginBottom:8,padding:'10px 12px',background:T.inputBg,borderRadius:7,border:`1px solid ${T.border}`}}>
                <div style={{fontSize:12,fontWeight:800,color:accent,marginBottom:5,textTransform:'uppercase',letterSpacing:0.5}}>{item.type}</div>
                <input style={inp} placeholder={`Notes for ${item.type}…`} value={item.notes||''}
                  onChange={e=>setScEquipment(p=>p.map((x,xi)=>xi===i?{...x,notes:e.target.value}:x))} />
              </div>
            ))}
            {scEquipment.length===0&&<div style={{fontSize:13,color:T.muted,textAlign:'center',padding:'10px 0',fontStyle:'italic'}}>No equipment selected yet</div>}
          </Section>
        )}

        {/* ══ PM EQUIPMENT ══ */}
        {showPMEquipment&&(
          <>
            {/* FLAME ARRESTORS */}
            <Section icon="🔥" title="Flame Arrestors" accent={accent}>
              {arrestors.map((a,i)=>(
                <div key={i} style={{border:`1.5px solid ${T.border}`,borderRadius:9,padding:14,marginBottom:12,background:T.inputBg}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                    <span style={{fontWeight:800,color:T.navyMid,fontSize:13,textTransform:'uppercase',letterSpacing:0.5}}>Arrestor #{i+1}</span>
                    {arrestors.length>1&&<button type="button" onClick={()=>setArrestors(a=>a.filter((_,idx)=>idx!==i))} style={{background:'none',border:'none',color:T.red,cursor:'pointer',fontSize:18,padding:0,fontWeight:700}}>✕</button>}
                  </div>
                  <div style={row}>
                    <div style={fld}><label style={lbl}>ID / Tag #</label><input style={inp} value={a.arrestorId} onChange={e=>updArr(i,'arrestorId',e.target.value)} placeholder="ARR-001" /></div>
                    <div style={fld}><label style={lbl}>Condition</label><select style={inp} value={a.condition} onChange={e=>updArr(i,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select></div>
                  </div>
                  <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer',marginBottom:10,userSelect:'none'}}>
                    <input type="checkbox" checked={a.filterChanged} onChange={e=>updArr(i,'filterChanged',e.target.checked)} style={{width:15,height:15}} />
                    Filter / Element Changed
                  </label>
                  <div style={{marginBottom:10}}><label style={lbl}>Notes</label><input style={inp} value={a.notes} onChange={e=>updArr(i,'notes',e.target.value)} placeholder="Notes…" /></div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <PhotoPicker label="Before — Photo 1" value={a.before1} onChange={v=>updArr(i,'before1',v)} />
                    <PhotoPicker label="Before — Photo 2" value={a.before2} onChange={v=>updArr(i,'before2',v)} />
                    <PhotoPicker label="After — Photo 1"  value={a.after1}  onChange={v=>updArr(i,'after1',v)} />
                    <PhotoPicker label="After — Photo 2"  value={a.after2}  onChange={v=>updArr(i,'after2',v)} />
                  </div>
                </div>
              ))}
              {arrestors.length<5&&(
                <button type="button" onClick={()=>setArrestors(a=>[...a,mkArr()])}
                  style={{width:'100%',padding:10,background:'transparent',border:`1.5px dashed ${T.border}`,borderRadius:8,cursor:'pointer',color:T.muted,fontSize:13,fontWeight:600,fontFamily:'inherit',transition:'all 0.13s'}}>
                  + Add Arrestor ({arrestors.length}/5)
                </button>
              )}
            </Section>

            {/* FLARES */}
            <Section icon="🔦" title="Flares" accent={accent}>
              {flares.map((f,i)=>(
                <div key={i} style={{border:`1.5px solid ${T.border}`,borderRadius:9,padding:14,marginBottom:12,background:T.inputBg}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                    <span style={{fontWeight:800,color:T.navyMid,fontSize:13,textTransform:'uppercase',letterSpacing:0.5}}>Flare #{i+1}</span>
                    {flares.length>1&&<button type="button" onClick={()=>setFlares(f=>f.filter((_,idx)=>idx!==i))} style={{background:'none',border:'none',color:T.red,cursor:'pointer',fontSize:18,padding:0}}>✕</button>}
                  </div>
                  <div style={row}>
                    <div style={fld}><label style={lbl}>Flare ID / Tag #</label><input style={inp} value={f.flareId} onChange={e=>updFlare(i,'flareId',e.target.value)} placeholder="FLR-001" /></div>
                    <div style={fld}><label style={lbl}>Condition</label><select style={inp} value={f.condition} onChange={e=>updFlare(i,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select></div>
                  </div>
                  <div style={{...row,alignItems:'center'}}>
                    <label style={{display:'flex',alignItems:'center',gap:7,fontSize:13,cursor:'pointer',userSelect:'none',flex:1}}>
                      <input type="checkbox" checked={f.pilotLit} onChange={e=>updFlare(i,'pilotLit',e.target.checked)} style={{width:15,height:15}} />
                      Pilot Lit on Departure
                    </label>
                    <div style={fld}><label style={lbl}>Last Ignition</label><input type="date" style={inp} value={f.lastIgnition} onChange={e=>updFlare(i,'lastIgnition',e.target.value)} /></div>
                  </div>
                  <div style={{marginBottom:10}}><label style={lbl}>Notes</label><input style={inp} value={f.notes} onChange={e=>updFlare(i,'notes',e.target.value)} placeholder="Notes…" /></div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <PhotoPicker label="Photo 1" value={f.photo1} onChange={v=>updFlare(i,'photo1',v)} />
                    <PhotoPicker label="Photo 2" value={f.photo2} onChange={v=>updFlare(i,'photo2',v)} />
                  </div>
                </div>
              ))}
              {flares.length<3&&(
                <button type="button" onClick={()=>setFlares(f=>[...f,mkFlare()])} style={{width:'100%',padding:10,background:'transparent',border:`1.5px dashed ${T.border}`,borderRadius:8,cursor:'pointer',color:T.muted,fontSize:13,fontWeight:600,fontFamily:'inherit'}}>
                  + Add Flare ({flares.length}/3)
                </button>
              )}
            </Section>

            {/* HEATER TREATERS */}
            <Section icon="🌡️" title="Heater Treaters" accent={accent}>
              {heaters.map((h,hi)=>(
                <div key={hi} style={{border:`1.5px solid ${T.border}`,borderRadius:9,padding:14,marginBottom:12,background:T.inputBg}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                    <span style={{fontWeight:800,color:T.navyMid,fontSize:13,textTransform:'uppercase',letterSpacing:0.5}}>Heater Treater #{hi+1}</span>
                    {heaters.length>1&&<button type="button" onClick={()=>setHeaters(h=>h.filter((_,idx)=>idx!==hi))} style={{background:'none',border:'none',color:T.red,cursor:'pointer',fontSize:18,padding:0}}>✕</button>}
                  </div>
                  <div style={row}>
                    <div style={fld}><label style={lbl}>ID / Tag #</label><input style={inp} value={h.heaterId} onChange={e=>updHT(hi,'heaterId',e.target.value)} placeholder="HT-001" /></div>
                    <div style={fld}><label style={lbl}>Condition</label><select style={inp} value={h.condition} onChange={e=>updHT(hi,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select></div>
                  </div>
                  <div style={{marginBottom:10}}><label style={lbl}>Last Tube Clean Date</label><input type="date" style={inp} value={h.lastCleanDate} onChange={e=>updHT(hi,'lastCleanDate',e.target.value)} /></div>
                  <div style={{marginBottom:10}}><label style={lbl}>Notes</label><input style={inp} value={h.notes} onChange={e=>updHT(hi,'notes',e.target.value)} placeholder="Notes…" /></div>
                  <div>
                    <div style={{fontWeight:700,fontSize:12,color:T.navyMid,marginBottom:8,textTransform:'uppercase',letterSpacing:0.5}}>Firetubes ({h.firetubes.length}/10)</div>
                    {h.firetubes.map((ft,fi)=>(
                      <div key={fi} style={{border:`1px solid ${T.border}`,borderRadius:7,padding:10,marginBottom:8,background:T.card}}>
                        <div style={{fontWeight:700,fontSize:12,marginBottom:7,color:T.navyMid}}>Firetube #{fi+1}</div>
                        <div style={{marginBottom:8}}><label style={lbl}>Condition</label>
                          <select style={{...inp,fontSize:13,padding:'7px 10px'}} value={ft.condition} onChange={e=>updFT(hi,fi,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select>
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                          <PhotoPicker label="Photo 1" value={ft.photo1} onChange={v=>updFT(hi,fi,'photo1',v)} />
                          <PhotoPicker label="Photo 2" value={ft.photo2} onChange={v=>updFT(hi,fi,'photo2',v)} />
                        </div>
                      </div>
                    ))}
                    {h.firetubes.length<10&&(
                      <button type="button" onClick={()=>updHT(hi,'firetubes',[...h.firetubes,mkFT()])} style={{width:'100%',padding:8,background:'transparent',border:`1px dashed ${T.border}`,borderRadius:6,cursor:'pointer',color:T.muted,fontSize:12,fontWeight:600,fontFamily:'inherit'}}>
                        + Add Firetube
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {heaters.length<5&&(
                <button type="button" onClick={()=>setHeaters(h=>[...h,mkHT()])} style={{width:'100%',padding:10,background:'transparent',border:`1.5px dashed ${T.border}`,borderRadius:8,cursor:'pointer',color:T.muted,fontSize:13,fontWeight:600,fontFamily:'inherit'}}>
                  + Add Heater Treater ({heaters.length}/5)
                </button>
              )}
            </Section>
          </>
        )}

        {/* ══ PARTS USED ══ */}
        <Section icon="🧰" title="Parts Used" accent={accent}>
          {parts.length>0&&(
            <div style={{marginBottom:14}}>
              {parts.map(p=>(
                <div key={p.sku} style={{display:'flex',flexDirection:'column',gap:0,padding:'10px 0',borderBottom:`1px solid ${T.border}`}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:T.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.name}</div>
                      <div style={{fontSize:11,color:T.muted,marginTop:1}}>{p.sku} · ${(p.price||0).toFixed(2)}/ea · Subtotal: <strong>${((p.price||0)*p.qty).toFixed(2)}</strong></div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                      <button type="button" onClick={()=>qtyChange(p.sku,-1)} style={{width:32,height:32,borderRadius:'50%',border:`1.5px solid ${T.border}`,background:T.card,cursor:'pointer',fontSize:18,fontWeight:700,color:T.text,display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1}}>−</button>
                      <span style={{width:26,textAlign:'center',fontWeight:800,fontSize:15,color:T.text}}>{p.qty}</span>
                      <button type="button" onClick={()=>qtyChange(p.sku,1)} style={{width:32,height:32,borderRadius:'50%',border:`1.5px solid ${T.border}`,background:T.card,cursor:'pointer',fontSize:18,fontWeight:700,color:T.text,display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1}}>+</button>
                      <button type="button" onClick={()=>removePart(p.sku)} style={{width:28,height:28,borderRadius:'50%',border:'none',background:'#fef2f2',cursor:'pointer',fontSize:14,color:T.red,display:'flex',alignItems:'center',justifyContent:'center',marginLeft:2}}>✕</button>
                    </div>
                  </div>
                  <div style={{marginTop:8}}>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:partPhotos[p.sku]?.length?6:0}}>
                      {(partPhotos[p.sku]||[]).map((ph,idx)=>(
                        <div key={idx} style={{position:'relative'}}>
                          <img src={URL.createObjectURL(ph.file)} alt="" style={{width:72,height:54,objectFit:'cover',borderRadius:6,border:`1.5px solid ${T.border}`}} />
                          <button type="button" onClick={()=>removePartPhoto(p.sku,idx)} style={{position:'absolute',top:2,right:2,background:'rgba(15,31,56,0.7)',color:'#fff',border:'none',borderRadius:'50%',width:17,height:17,fontSize:10,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>✕</button>
                        </div>
                      ))}
                    </div>
                    <label style={{display:'inline-flex',alignItems:'center',gap:4,padding:'4px 10px',background:T.inputBg,border:`1px dashed ${T.border}`,borderRadius:6,cursor:'pointer',fontSize:11,color:T.muted,fontWeight:600}}>
                      📷 Part Photo
                      <input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{if(e.target.files[0])addPartPhoto(p.sku,e.target.files[0])}} />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button type="button" onClick={()=>setShowCatalog(v=>!v)}
            style={{width:'100%',padding:11,background:showCatalog?accent:T.inputBg,color:showCatalog?'#fff':T.text,border:`1.5px solid ${showCatalog?accent:T.border}`,borderRadius:8,cursor:'pointer',fontWeight:700,fontSize:13,transition:'all 0.15s',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'center',gap:7}}>
            {showCatalog?'▲ Close Catalog':'🔍 Add Part from Catalog'}
          </button>

          {showCatalog&&(
            <div style={{marginTop:10,border:`1.5px solid ${T.border}`,borderRadius:9,overflow:'hidden',background:T.card}}>
              <div style={{padding:'10px 12px',borderBottom:`1px solid ${T.border}`,background:T.inputBg}}>
                <input style={inp} placeholder="Search by name or SKU…" value={partSearch} onChange={e=>setPartSearch(e.target.value)} autoFocus />
              </div>
              <div style={{maxHeight:260,overflowY:'auto'}}>
                {filteredParts.slice(0,80).map(p=>(
                  <button key={p.code||p.sku} type="button" onClick={()=>addPart(p)}
                    style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',textAlign:'left',padding:'9px 14px',background:'none',borderBottom:`1px solid ${T.border}`,borderTop:'none',borderLeft:'none',borderRight:'none',cursor:'pointer',color:T.text,fontFamily:'inherit',transition:'background 0.1s'}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:600}}>{p.desc||p.name}</div>
                      <div style={{fontSize:11,color:T.muted}}>{p.code||p.sku}</div>
                    </div>
                    <div style={{fontSize:13,fontWeight:700,color:accent,flexShrink:0,marginLeft:10}}>${parseFloat(p.price||0).toFixed(2)}</div>
                  </button>
                ))}
                {filteredParts.length===0&&<div style={{padding:'16px',fontSize:13,color:T.muted,textAlign:'center',fontStyle:'italic'}}>No parts found</div>}
              </div>
            </div>
          )}
        </Section>

        {/* ══ VIDEOS ══ */}
        {showVideos&&(
          <Section icon="🎥" title="Arrival & Departure Videos" accent={accent}>
            <div style={{fontSize:13,color:T.muted,marginBottom:14,fontWeight:500}}>Record a short video on arrival and after completing the work.</div>
            <div style={row}>
              <div style={fld}>
                <label style={lbl}>Arrival Video</label>
                {arrivalVideo?(
                  <div style={{background:T.inputBg,borderRadius:9,padding:8,border:`1.5px solid ${T.green}`}}>
                    <video src={URL.createObjectURL(arrivalVideo)} controls style={{width:'100%',borderRadius:6,marginBottom:6}} />
                    <button type="button" onClick={()=>setArrivalVideo(null)} style={{fontSize:12,color:T.red,background:'none',border:'none',cursor:'pointer',padding:0,fontWeight:600}}>✕ Remove</button>
                  </div>
                ):(
                  <label style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:5,padding:'22px 10px',background:T.inputBg,border:`2px dashed ${T.border}`,borderRadius:9,cursor:'pointer',minHeight:90,textAlign:'center'}}>
                    <span style={{fontSize:24}}>🎬</span>
                    <span style={{fontSize:12,color:T.muted,fontWeight:600}}>Record / Upload Arrival</span>
                    <input type="file" accept="video/*" capture="environment" style={{display:'none'}} onChange={e=>setArrivalVideo(e.target.files[0]||null)} />
                  </label>
                )}
              </div>
              <div style={fld}>
                <label style={lbl}>Departure Video</label>
                {departureVideo?(
                  <div style={{background:T.inputBg,borderRadius:9,padding:8,border:`1.5px solid ${T.green}`}}>
                    <video src={URL.createObjectURL(departureVideo)} controls style={{width:'100%',borderRadius:6,marginBottom:6}} />
                    <button type="button" onClick={()=>setDepartureVideo(null)} style={{fontSize:12,color:T.red,background:'none',border:'none',cursor:'pointer',padding:0,fontWeight:600}}>✕ Remove</button>
                  </div>
                ):(
                  <label style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:5,padding:'22px 10px',background:T.inputBg,border:`2px dashed ${T.border}`,borderRadius:9,cursor:'pointer',minHeight:90,textAlign:'center'}}>
                    <span style={{fontSize:24}}>🎬</span>
                    <span style={{fontSize:12,color:T.muted,fontWeight:600}}>Record / Upload Departure</span>
                    <input type="file" accept="video/*" capture="environment" style={{display:'none'}} onChange={e=>setDepartureVideo(e.target.files[0]||null)} />
                  </label>
                )}
              </div>
            </div>
          </Section>
        )}

        {/* == JOB PHOTOS == */}
        <Section icon="photo" title="Job Photos" accent={accent}>
          {photos.length>0&&(
            <div style={{display:'flex',flexWrap:'wrap',gap:10,marginBottom:14}}>
              {photos.map((ph,i)=>(
                <div key={i} style={{position:'relative',display:'flex',flexDirection:'column',gap:4}}>
                  <img src={URL.createObjectURL(ph)} alt="" onClick={()=>setLightboxIdx(i)}
                    style={{width:100,height:75,objectFit:'cover',borderRadius:8,border:'2px solid '+T.border,cursor:'zoom-in'}} />
                  <button type="button" onClick={()=>setPhotos(p=>p.filter((_,pi)=>pi!==i))}
                    style={{position:'absolute',top:4,right:4,background:'rgba(15,31,56,0.75)',color:'#fff',border:'none',borderRadius:'50%',width:20,height:20,fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>X</button>
                  <button type="button" title="Save to gallery" onClick={()=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(ph); a.download='photo-'+(i+1)+'.jpg'; a.click(); }}
                    style={{position:'absolute',top:4,left:4,background:'rgba(15,31,56,0.75)',color:'#fff',border:'none',borderRadius:'50%',width:20,height:20,fontSize:10,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>DL</button>
                  <input style={{...inp,width:100,padding:'3px 6px',fontSize:11,borderRadius:5}} placeholder="Caption"
                    value={photoCaptions[i]||''} onChange={e=>setPhotoCaptions(c=>({...c,[i]:e.target.value}))} />
                </div>
              ))}
            </div>
          )}
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <label style={{display:'inline-flex',alignItems:'center',gap:6,padding:'10px 16px',background:T.inputBg,border:'1.5px dashed '+T.border,borderRadius:8,cursor:'pointer',fontSize:13,color:T.muted,fontWeight:700}}>
              Take Photo
              <input type="file" accept="image/*" capture="environment" multiple style={{display:'none'}} onChange={e=>addPhoto(e.target.files)} />
            </label>
            <label style={{display:'inline-flex',alignItems:'center',gap:6,padding:'10px 16px',background:T.inputBg,border:'1.5px dashed '+T.border,borderRadius:8,cursor:'pointer',fontSize:13,color:T.muted,fontWeight:700}}>
              From Gallery{photos.length>0&&' ('+photos.length+' added)'}
              <input type="file" accept="image/*" multiple style={{display:'none'}} onChange={e=>addPhoto(e.target.files)} />
            </label>
          </div>
        </Section>

        {/* ══ CUSTOMER SIGN-OFF ══ */}
        <Section icon="✍️" title="Customer Sign-Off" accent={accent}>
          <p style={{fontSize:13,color:T.muted,margin:'0 0 14px',lineHeight:1.5}}>
            Customer signature confirms satisfactory completion of the work described above.
          </p>
          <SignaturePad
            label="Customer Signature"
            isSigned={!!customerSig}
            onSave={d=>setCustomerSig(d)}
            onClear={()=>setCustomerSig(null)}
          />
        </Section>

        {/* ══ COST SUMMARY ══ */}
        <Section icon="💰" title="Cost Summary" accent={accent}>
          <div style={row}>
            <div style={fld}><label style={lbl}>Miles Driven</label><input style={inp} type="number" min="0" value={miles} onChange={e=>setMiles(e.target.value)} placeholder="0" /></div>
            <div style={fld}><label style={lbl}>Rate ($/mile)</label><input style={inp} type="number" min="0" step="0.01" value={costPerMile} onChange={e=>setCostPerMile(e.target.value)} /></div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Labor Hours</label><input style={inp} type="number" min="0" step="0.25" value={laborHours} onChange={e=>setLaborHours(e.target.value)} placeholder="0.0" /></div>
            <div style={fld}><label style={lbl}>Rate ($/hour)</label><input style={inp} type="number" min="0" value={hourlyRate} onChange={e=>setHourlyRate(e.target.value)} /></div>
          </div>

          {warrantyWork?(
            <div style={{textAlign:'center',padding:'16px',color:T.red,fontWeight:800,fontSize:16,border:`2.5px solid ${T.red}`,borderRadius:9,background:'#fef2f2',letterSpacing:1}}>
              ⚠️ WARRANTY — NO CHARGE
            </div>
          ):(
            <div style={{background:T.inputBg,borderRadius:9,border:`1.5px solid ${T.border}`,overflow:'hidden'}}>
              {[
                ['🔩 Parts',`${parts.length} item${parts.length!==1?'s':''}`,partsTotal],
                ['🚗 Mileage',`${miles||0} mi × $${costPerMile}/mi`,mileageTotal],
                ['⏱️ Labor',`${laborHours||0} hrs × $${hourlyRate}/hr × ${effBill} tech${effBill!==1?'s':''}`,laborTotal],
              ].map(([label,detail,amount])=>(
                <div key={label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',borderBottom:`1px solid ${T.border}`}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:T.text}}>{label}</div>
                    <div style={{fontSize:11,color:T.muted,marginTop:1}}>{detail}</div>
                  </div>
                  <div style={{fontSize:14,fontWeight:700,color:T.text}}>${amount.toFixed(2)}</div>
                </div>
              ))}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 16px',background:`linear-gradient(135deg, ${T.navy} 0%, ${accent} 100%)`}}>
                <span style={{fontSize:14,fontWeight:800,color:'rgba(255,255,255,0.9)',textTransform:'uppercase',letterSpacing:1}}>Total</span>
                <span style={{fontSize:22,fontWeight:900,color:'#fff'}}>${grandTotal.toFixed(2)}</span>
              </div>
            </div>
          )}
        </Section>

        {/* ══ ERROR ══ */}
        {saveError&&(
          <div style={{background:'#fef2f2',border:`1.5px solid ${T.red}`,borderRadius:9,padding:'12px 16px',marginBottom:14,fontSize:13,color:T.red,fontWeight:600,display:'flex',alignItems:'center',gap:8,boxShadow:T.shadowSm}}>
            ⚠️ {saveError}
          </div>
        )}

        {/* ══ SUBMIT BAR ══ */}
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <button type="button" onClick={saveDraft}
            style={{width:'100%',padding:13,background:draftSaved?T.green:T.inputBg,color:draftSaved?'#fff':T.muted,border:`1.5px solid ${draftSaved?T.green:T.border}`,borderRadius:9,fontWeight:700,fontSize:14,cursor:'pointer',transition:'all 0.2s',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
            {draftSaved?'✅ Draft Saved!':'💾 Save Draft'}
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving}
            style={{width:'100%',padding:18,background:saving?'#9ca3af':`linear-gradient(135deg, ${accent} 0%, ${T.orange} 100%)`,color:'#fff',border:'none',borderRadius:10,fontWeight:900,fontSize:17,cursor:saving?'not-allowed':'pointer',boxShadow:saving?'none':'0 4px 18px rgba(0,0,0,0.22)',transition:'all 0.18s',fontFamily:'inherit',letterSpacing:0.3}}>
            {saving?'⏳ Saving…':`Submit ${jtConfig.short} — ${jtConfig.icon} ${jobType}`}
          </button>
        </div>

      <PhotoLightbox photos={photos} idx={lightboxIdx} onClose={()=>setLightboxIdx(-1)} onPrev={()=>setLightboxIdx(i=>i-1)} onNext={()=>setLightboxIdx(i=>i+1)} />
      </div>
    </div>
  )
}
