import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { saveSubmission, uploadPhotos, getNextPmNumber } from '../lib/submissions'
import { PARTS_CATALOG } from '../data/catalog'

const CUSTOMERS = ['Diamondback','High Peak Energy','ExTex','A8 Oilfield Services','Pristine Alliance','KOS']
const TRUCKS = ['0001','0002','0003','0004','0005','0006','0007']
const WORK_TYPES = [
  'Billable Pm','Warranty Kalos','Warranty ROS','Material Drop Off Billable',
  'Install Billable','Billable Service','Billable Material Pickup',
  'PM Flare/Combustor Flame Arrester','PM Flare','PM BMS',
  'Billable Theif Hatch','Billable PRV','Billable PSV',
]
const TECHS_LIST = ['Matthew Reid','Vladimir Rivero','Pedro Perez']
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
  const startDraw = (e) => { e.preventDefault(); drawing.current = true; lastPos.current = getPos(e, canvasRef.current) }
  const draw = (e) => {
    e.preventDefault()
    if (!drawing.current) return
    const canvas = canvasRef.current; const ctx = canvas.getContext('2d')
    const pos = getPos(e, canvas)
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = '#1a2332'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke()
    lastPos.current = pos
  }
  const stopDraw = () => { drawing.current = false; if (canvasRef.current) onSave(canvasRef.current.toDataURL('image/png')) }
  const clear = () => { const ctx = canvasRef.current.getContext('2d'); ctx.clearRect(0,0,300,80); onSave(null) }
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Sign here â {techName}</div>
      <canvas ref={canvasRef} width={300} height={80}
        style={{ border: '1px solid #ccc', borderRadius: 6, background: '#fafafa', touchAction: 'none', display: 'block', width: '100%', maxWidth: 360 }}
        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
        onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw} />
      <button type="button" onClick={clear} style={{ fontSize: 11, color: '#e65c00', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}>Clear Signature</button>
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
          <button type="button" onClick={() => onChange(null)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 11, lineHeight: '18px', textAlign: 'center', padding: 0 }}>x</button>
        </div>
      ) : (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '5px 8px', background: '#f2f2f2', border: '1px dashed #bbb', borderRadius: 5, cursor: 'pointer', fontSize: 11, color: '#555' }}>
          + Photo
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => onChange(e.target.files[0] || null)} />
        </label>
      )}
    </div>
  )
}

export default function FormPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const typeParam = searchParams.get('type') || 'pm'
  const jobTypeParam = (typeParam === 'sc' || typeParam === 'service') ? 'Service Call' : 'PM'

  const [pmNumber, setPmNumber] = useState(null)
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
  const [miles, setMiles] = useState('')
  const [costPerMile, setCostPerMile] = useState('1.50')
  const [laborHours, setLaborHours] = useState('')
  const [hourlyRate, setHourlyRate] = useState('115.00')
  const [billableTechs, setBillableTechs] = useState('')
  const [partSearch, setPartSearch] = useState('')
  const [showCatalog, setShowCatalog] = useState(false)
  const [photos, setPhotos] = useState([])
  const [photoCaptions, setPhotoCaptions] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  // PM equipment state
  const mkArr = () => ({ arrestorId: '', condition: 'Good', filterChanged: false, notes: '', before1: null, before2: null, after1: null, after2: null })
  const mkFlare = () => ({ flareId: '', pilotLit: true, lastIgnition: '', condition: 'Good', notes: '', photo1: null, photo2: null })
  const mkFT = () => ({ condition: 'Good', photo1: null, photo2: null })
  const mkHT = () => ({ heaterId: '', lastCleanDate: '', condition: 'Good', notes: '', firetubes: [mkFT()] })
  const [arrestors, setArrestors] = useState([mkArr()])
  const [flares, setFlares] = useState([mkFlare()])
  const [heaters, setHeaters] = useState([mkHT()])

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

  const toggleTech = (t) => setTechs(ts => ts.includes(t) ? ts.filter(x=>x!==t) : [...ts,t])
  const addPart = (p) => {
    const sku = p.code||p.sku
    setParts(ps => { const ex = ps.find(x=>x.sku===sku); return ex ? ps.map(x=>x.sku===sku?{...x,qty:x.qty+1}:x) : [...ps,{sku,name:p.desc||p.name,qty:1,price:p.price||0}] })
    setShowCatalog(false)
  }
  const qtyChange = (sku, d) => setParts(ps => ps.map(x=>x.sku===sku?{...x,qty:Math.max(0,x.qty+d)}:x).filter(x=>x.qty>0))
  const removePart = (sku) => setParts(ps => ps.filter(x=>x.sku!==sku))
  const addPhoto = (files) => { const arr = Array.from(files); setPhotos(ps => [...ps,...arr].slice(0,20)) }
  const removePhoto = (i) => { setPhotos(ps=>ps.filter((_,idx)=>idx!==i)); setPhotoCaptions(c=>{const n={...c};delete n[i];return n}) }

  const handleSubmit = async () => {
    if (!customerName || !locationName) { setSaveError('Customer and location are required'); return }
    setSaving(true); setSaveError(null)
    try {
      const formData = {
        pmNumber, jobType, warrantyWork, customerName, truckNumber,
        locationName, customerContact, customerWorkOrder, typeOfWork,
        glCode, assetTag, workArea, date, startTime, departureTime,
        lastServiceDate, description, techs, equipment, parts,
        miles, costPerMile, laborHours, hourlyRate, billableTechs,
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

      // Upload tech signatures
      for (const [name, dataUrl] of Object.entries(signatures)) {
        if (!dataUrl) continue
        try {
          const blob = await fetch(dataUrl).then(r=>r.blob())
          await uploadPhotos(submission.id, [{ file: blob, caption: 'Signature: '+name }], 'sig-'+name.split(' ')[0].toLowerCase())
        } catch(e) { console.warn('Sig upload err:', e) }
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
          const pf = [f.photo1&&{file:f.photo1,caption:'Flare '+(i+1)+' Photo 1'}, f.photo2&&{file:f.photo2,caption:'Flare '+(i+1)+' Photo 2'}].filter(Boolean)
          if (pf.length) await uploadPhotos(submission.id, pf.map(p=>({file:p.file,caption:p.caption})), 'flare-'+i)
        }
        for (let i=0; i<heaters.length; i++) {
          const h = heaters[i]
          for (let j=0; j<h.firetubes.length; j++) {
            const ft = h.firetubes[j]
            const pf = [ft.photo1&&{file:ft.photo1,caption:'HT '+(i+1)+' FT '+(j+1)+' 1'}, ft.photo2&&{file:ft.photo2,caption:'HT '+(i+1)+' FT '+(j+1)+' 2'}].filter(Boolean)
            if (pf.length) await uploadPhotos(submission.id, pf.map(p=>({file:p.file,caption:p.caption})), 'ht-'+i+'-ft-'+j)
          }
        }
      }

      fetch('/api/send-report', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ submissionId: submission.id })
      }).catch(e => console.warn('Email err:', e))

      navigate('/view/' + submission.id)
    } catch (err) {
      console.error('Save error:', err)
      setSaveError(err.message || 'Save failed. Please try again.')
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
        <div style={{ color:'#fff', fontSize:14, fontWeight:700 }}>{jobType==='PM'?'PM':'SC'} #{pmNumber||'...'} â {jobType}</div>
      </div>

      {saveError && <div style={{ margin:'0 16px 10px', background:'#fee', border:'1px solid #faa', borderRadius:6, padding:'8px 12px', color:'#c00', fontSize:13 }}>{saveError}</div>}

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
          <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6, color:warrantyWork?'#e65c00':'#333', fontWeight:warrantyWork?700:400 }}>
            <input type="checkbox" checked={warrantyWork} onChange={e=>setWarrantyWork(e.target.checked)} />
            Warranty Work (no charge to customer)
          </label>
        </div>
      </div>

      {/* TECHS + SIGNATURES */}
      <div style={{ margin:'0 0 10px' }}>
        <div style={sHdr}>Technicians & Signatures</div>
        <div style={sBody}>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
            {TECHS_LIST.map(t => (
              <button key={t} type="button" onClick={()=>toggleTech(t)} style={{ padding:'8px 14px', borderRadius:20, border:'2px solid', borderColor:techs.includes(t)?'#e65c00':'#ddd', background:techs.includes(t)?'#fff5f0':'#fff', color:techs.includes(t)?'#e65c00':'#333', fontWeight:600, cursor:'pointer' }}>
                {t}
              </button>
            ))}
          </div>
          {techs.map(t => <SignaturePad key={t} techName={t} onSave={dataUrl=>setSignatures(s=>({...s,[t]:dataUrl}))} />)}
          {techs.length > 0 && (
            <div style={{ marginTop:12 }}>
              <label style={lbl}>Billable Techs (override â leave blank to charge all {techs.length})</label>
              <input type="number" style={{...inp,width:80,marginTop:4}} min={0} max={10} value={billableTechs} onChange={e=>setBillableTechs(e.target.value)} placeholder={techs.length} />
            </div>
          )}
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
            <div style={fld}><label style={lbl}>Mileage</label><input type="number" style={inp} value={miles} onChange={e=>setMiles(e.target.value)} placeholder="0" /></div>
            <div style={fld}><label style={lbl}>$/Mile</label><input type="number" step="0.01" style={inp} value={costPerMile} onChange={e=>setCostPerMile(e.target.value)} /></div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Hours on Site</label><input type="number" step="0.25" style={inp} value={laborHours} onChange={e=>setLaborHours(e.target.value)} placeholder="0.0" /></div>
            <div style={fld}><label style={lbl}>Hourly Rate</label><input type="number" step="0.01" style={inp} value={hourlyRate} onChange={e=>setHourlyRate(e.target.value)} /></div>
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

      {/* ââ PM-ONLY SECTIONS ââââââââââââââââââââââââââââââââââââââââââââââ */}
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
                    {arrestors.length>1 && <button type="button" onClick={()=>setArrestors(a=>a.filter((_,x)=>x!==i))} style={{ color:'#c00', background:'none', border:'none', cursor:'pointer', fontSize:12 }}>Remove</button>}
                  </div>
                  <div style={row}>
                    <div style={fld}><label style={lbl}>Arrestor ID / Tag #</label>
                      <input style={inp} value={a.arrestorId} onChange={e=>updArr(i,'arrestorId',e.target.value)} placeholder="ARR-001" /></div>
                    <div style={fld}><label style={lbl}>Condition</label>
                      <select style={inp} value={a.condition} onChange={e=>updArr(i,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select></div>
                  </div>
                  <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                    <input type="checkbox" checked={a.filterChanged} onChange={e=>updArr(i,'filterChanged',e.target.checked)} />
                    Filter / Element Changed
                  </label>
                  <div style={{ marginBottom:8 }}><label style={lbl}>Notes</label>
                    <input style={inp} value={a.notes} onChange={e=>updArr(i,'notes',e.target.value)} placeholder="Notes..." /></div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    <PhotoPicker label="Before â Photo 1" value={a.before1} onChange={v=>updArr(i,'before1',v)} />
                    <PhotoPicker label="Before â Photo 2" value={a.before2} onChange={v=>updArr(i,'before2',v)} />
                    <PhotoPicker label="After â Photo 1"  value={a.after1}  onChange={v=>updArr(i,'after1',v)} />
                    <PhotoPicker label="After â Photo 2"  value={a.after2}  onChange={v=>updArr(i,'after2',v)} />
                  </div>
                </div>
              ))}
              {arrestors.length < 5 && (
                <button type="button" onClick={()=>setArrestors(a=>[...a,mkArr()])} style={{ width:'100%', padding:8, background:'#f5f5f5', border:'1px dashed #ccc', borderRadius:6, color:'#555', cursor:'pointer', fontSize:13 }}>
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
                    {flares.length>1 && <button type="button" onClick={()=>setFlares(f=>f.filter((_,x)=>x!==i))} style={{ color:'#c00', background:'none', border:'none', cursor:'pointer', fontSize:12 }}>Remove</button>}
                  </div>
                  <div style={row}>
                    <div style={fld}><label style={lbl}>Flare ID / Tag #</label>
                      <input style={inp} value={f.flareId} onChange={e=>updFlare(i,'flareId',e.target.value)} placeholder="FLR-001" /></div>
                    <div style={fld}><label style={lbl}>Condition</label>
                      <select style={inp} value={f.condition} onChange={e=>updFlare(i,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select></div>
                  </div>
                  <div style={row}>
                    <div style={fld}><label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6 }}>
                      <input type="checkbox" checked={f.pilotLit} onChange={e=>updFlare(i,'pilotLit',e.target.checked)} />
                      Pilot Lit on Departure
                    </label></div>
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
                <button type="button" onClick={()=>setFlares(f=>[...f,mkFlare()])} style={{ width:'100%', padding:8, background:'#f5f5f5', border:'1px dashed #ccc', borderRadius:6, color:'#555', cursor:'pointer', fontSize:13 }}>
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
                    {heaters.length>1 && <button type="button" onClick={()=>setHeaters(h=>h.filter((_,x)=>x!==hi))} style={{ color:'#c00', background:'none', border:'none', cursor:'pointer', fontSize:12 }}>Remove</button>}
                  </div>
                  <div style={row}>
                    <div style={fld}><label style={lbl}>Heater ID / Tag #</label>
                      <input style={inp} value={h.heaterId} onChange={e=>updHT(hi,'heaterId',e.target.value)} placeholder="HT-001" /></div>
                    <div style={fld}><label style={lbl}>Condition</label>
                      <select style={inp} value={h.condition} onChange={e=>updHT(hi,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select></div>
                  </div>
                  <div style={{ marginBottom:8, ...row }}>
                    <div style={fld}><label style={lbl}>Last Tube Clean Date</label>
                      <input type="date" style={inp} value={h.lastCleanDate} onChange={e=>updHT(hi,'lastCleanDate',e.target.value)} /></div>
                    <div style={fld}></div>
                  </div>
                  <div style={{ marginBottom:8 }}><label style={lbl}>Notes</label>
                    <input style={inp} value={h.notes} onChange={e=>updHT(hi,'notes',e.target.value)} placeholder="Notes..." /></div>

                  <div style={{ borderTop:'1px solid #e8e8e8', paddingTop:8, marginTop:4 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'#1a2332', marginBottom:6 }}>Firetubes ({h.firetubes.length}/10)</div>
                    {h.firetubes.map((ft,fi) => (
                      <div key={fi} style={{ background:'#fff', border:'1px solid #ebebeb', borderRadius:6, padding:8, marginBottom:6 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                          <div style={{ fontSize:12, fontWeight:600, color:'#444' }}>Firetube #{fi+1}</div>
                          {h.firetubes.length>1 && <button type="button" onClick={()=>updHT(hi,'firetubes',h.firetubes.filter((_,x)=>x!==fi))} style={{ color:'#c00', background:'none', border:'none', cursor:'pointer', fontSize:11 }}>Remove</button>}
                        </div>
                        <div style={{ marginBottom:6 }}><label style={{...lbl,fontSize:11}}>Condition</label>
                          <select style={{...inp,padding:'5px 8px',fontSize:12}} value={ft.condition} onChange={e=>updFT(hi,fi,'condition',e.target.value)}>{CONDITION_OPTS.map(c=><option key={c}>{c}</option>)}</select>
                        </div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                          <PhotoPicker label="Photo 1" value={ft.photo1} onChange={v=>updFT(hi,fi,'photo1',v)} />
                          <PhotoPicker label="Photo 2" value={ft.photo2} onChange={v=>updFT(hi,fi,'photo2',v)} />
                        </div>
                      </div>
                    ))}
                    {h.firetubes.length < 10 && (
                      <button type="button" onClick={()=>updHT(hi,'firetubes',[...h.firetubes,mkFT()])} style={{ width:'100%', padding:6, background:'#eef2fa', border:'1px dashed #99b', borderRadius:5, color:'#1a2332', cursor:'pointer', fontSize:12 }}>
                        + Add Firetube
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {heaters.length < 5 && (
                <button type="button" onClick={()=>setHeaters(h=>[...h,mkHT()])} style={{ width:'100%', padding:8, background:'#f5f5f5', border:'1px dashed #ccc', borderRadius:6, color:'#555', cursor:'pointer', fontSize:13 }}>
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
                <div key={p.sku} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0', borderBottom:'1px solid #f0f0f0' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:600 }}>{p.name}</div>
                    <div style={{ fontSize:11, color:'#888' }}>{p.sku} · ${(p.price||0).toFixed(2)}/ea</div>
                  </div>
                  <button type="button" onClick={()=>qtyChange(p.sku,-1)} style={{ width:30,height:30,borderRadius:'50%',border:'1px solid #ddd',background:'#f5f5f5',cursor:'pointer',fontSize:16,fontWeight:700 }}>-</button>
                  <span style={{ width:24,textAlign:'center',fontWeight:700 }}>{p.qty}</span>
                  <button type="button" onClick={()=>qtyChange(p.sku,1)} style={{ width:30,height:30,borderRadius:'50%',border:'1px solid #ddd',background:'#f5f5f5',cursor:'pointer',fontSize:16,fontWeight:700 }}>+</button>
                  <button type="button" onClick={()=>removePart(p.sku)} style={{ color:'#c00',background:'none',border:'none',cursor:'pointer',fontSize:18,padding:'0 4px' }}>x</button>
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
                  <button key={p.code||p.sku} type="button" onClick={()=>addPart(p)} style={{ display:'block',width:'100%',textAlign:'left',padding:'7px 10px',background:'none',border:'none',borderBottom:'1px solid #f0f0f0',cursor:'pointer' }}>
                    <div style={{ fontSize:13,fontWeight:600 }}>{p.desc||p.name}</div>
                    <div style={{ fontSize:11,color:'#888' }}>{p.code||p.sku}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* GENERAL JOB PHOTOS */}
      <div style={{ margin:'0 0 10px' }}>
        <div style={sHdr}>Job Photos (General)</div>
        <div style={sBody}>
          {photos.length > 0 && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:10 }}>
              {photos.map((photo,i) => (
                <div key={i} style={{ position:'relative' }}>
                  <img src={URL.createObjectURL(photo)} alt="" style={{ width:'100%',aspectRatio:'1',objectFit:'cover',borderRadius:6,border:'1px solid #ddd' }} />
                  <button type="button" onClick={()=>removePhoto(i)} style={{ position:'absolute',top:2,right:2,background:'rgba(0,0,0,0.6)',color:'#fff',border:'none',borderRadius:'50%',width:20,height:20,cursor:'pointer',fontSize:12,lineHeight:'20px',textAlign:'center',padding:0 }}>x</button>
                  <input style={{...inp,marginTop:4,fontSize:11,padding:'3px 6px'}} placeholder="Caption..." value={photoCaptions[i]||''} onChange={e=>setPhotoCaptions(c=>({...c,[i]:e.target.value}))} />
                </div>
              ))}
            </div>
          )}
          {photos.length < 20 && (
            <div style={{ display:'flex', gap:8 }}>
              <label style={{ flex:1,padding:10,background:'#e65c00',color:'#fff',border:'none',borderRadius:6,cursor:'pointer',fontWeight:700,fontSize:14,textAlign:'center' }}>
                Take Photo
                <input type="file" accept="image/*" capture="environment" style={{ display:'none' }} onChange={e=>addPhoto(e.target.files)} />
              </label>
              <label style={{ flex:1,padding:10,background:'#f5f5f5',color:'#333',border:'1px solid #ddd',borderRadius:6,cursor:'pointer',fontWeight:700,fontSize:14,textAlign:'center' }}>
                Choose Files
                <input type="file" accept="image/*" multiple style={{ display:'none' }} onChange={e=>addPhoto(e.target.files)} />
              </label>
            </div>
          )}
          <div style={{ color:'#aaa',fontSize:11,marginTop:6,textAlign:'center' }}>{photos.length}/20 photos</div>
        </div>
      </div>

      {/* CUSTOMER SIGN-OFF */}
      <div style={{ margin:'0 0 10px' }}>
        <div style={sHdr}>Customer Sign-Off</div>
        <div style={sBody}>
          <div style={{ fontSize:12,color:'#666',marginBottom:8 }}>Customer signature acknowledges satisfactory completion of work described above.</div>
          <SignaturePad techName="Customer" onSave={setCustomerSig} />
        </div>
      </div>

      {/* COST SUMMARY */}
      <div style={{ margin:'0 0 10px' }}>
        <div style={sHdr}>Cost Summary</div>
        <div style={sBody}>
          {warrantyWork ? (
            <div style={{ background:'#e65c00',color:'#fff',fontWeight:800,fontSize:16,textAlign:'center',padding:14,borderRadius:6 }}>WARRANTY - NO CHARGE</div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* SUBMIT */}
      <div style={{ padding:'0 16px' }}>
        <button type="button" onClick={handleSubmit} disabled={saving} style={{ width:'100%',padding:14,background:saving?'#ccc':'#e65c00',color:'#fff',border:'none',borderRadius:8,fontWeight:800,fontSize:16,cursor:saving?'not-allowed':'pointer' }}>
          {saving ? 'Saving...' : 'Submit ' + (jobType==='PM'?'PM':'Service Call')}
        </button>
      </div>

    </div>
  )
}
