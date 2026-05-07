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
const nowStr = () => new Date().toTimeString().slice(0,5)

export default function FormPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const jobTypeParam = searchParams.get('type') === 'service' ? 'Service Call' : 'PM'

  const [pmNumber, setPmNumber] = useState(null)
  const [jobType] = useState(jobTypeParam)
  const [warrantyWork, setWarrantyWork] = useState(false)
  const [customerName, setCustomerName] = useState(CUSTOMERS[0])
  const [truckNumber, setTruckNumber] = useState(TRUCKS[2])
  const [locationName, setLocationName] = useState('')
  const [customerContact, setCustomerContact] = useState('')
  const [customerWorkOrder, setCustomerWorkOrder] = useState('')
  const [typeOfWork, setTypeOfWork] = useState(WORK_TYPES[6])
  const [glCode, setGlCode] = useState('')
  const [assetTag, setAssetTag] = useState('')
  const [workArea, setWorkArea] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [startTime, setStartTime] = useState(nowStr())
  const [sitePhoto, setSitePhoto] = useState(null)
  const [description, setDescription] = useState('')
  const [techs, setTechs] = useState([])
  const [photos, setPhotos] = useState([])
  const [equipment, setEquipment] = useState([])
  const [parts, setParts] = useState([])
  const [partSearch, setPartSearch] = useState('')
  const [partCategory, setPartCategory] = useState('All')
  const [miles, setMiles] = useState('')
  const [costPerMile, setCostPerMile] = useState('1.34')
  const [laborHours, setLaborHours] = useState('')
  const [hourlyRate, setHourlyRate] = useState('123.62')
  const [departureTime, setDepartureTime] = useState(nowStr())
  const [billableTechs, setBillableTechs] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const sitePhotoRef = useRef()

  useEffect(() => { getNextPmNumber().then(setPmNumber) }, [])

  const partsTotal = parts.reduce((sum, p) => sum + p.price * p.qty, 0)
  const mileageTotal = (parseFloat(miles) || 0) * (parseFloat(costPerMile) || 1.34)
  const techsOnsite = techs.length || 1
  const effectiveBillable = billableTechs !== '' ? parseInt(billableTechs) : techsOnsite
  const laborTotal = warrantyWork ? 0 : (parseFloat(laborHours) || 0) * (parseFloat(hourlyRate) || 123.62) * effectiveBillable
  const grandTotal = warrantyWork ? 0 : partsTotal + mileageTotal + laborTotal
  const fmt = n => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  const categories = ['All', ...new Set(PARTS_CATALOG.map(p => p.category))]
  const filteredParts = PARTS_CATALOG.filter(p => {
    const matchCat = partCategory === 'All' || p.category === partCategory
    const q = partSearch.toLowerCase()
    return matchCat && (!q || p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
  })

  const addPart = (part) => setParts(prev => {
    const idx = prev.findIndex(p => p.sku === part.sku)
    if (idx >= 0) { const u=[...prev]; u[idx]={...u[idx],qty:u[idx].qty+1}; return u }
    return [...prev, { ...part, qty: 1 }]
  })
  const updateQty = (sku, delta) => setParts(prev =>
    prev.map(p => p.sku===sku ? {...p, qty:Math.max(0,p.qty+delta)} : p).filter(p=>p.qty>0)
  )
  const handlePhotoCapture = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setPhotos(prev => prev.length >= 20 ? prev : [...prev, { dataUrl: ev.target.result, caption: '' }])
    reader.readAsDataURL(file); e.target.value = ''
  }
  const handleSitePhoto = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setSitePhoto(ev.target.result)
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    if (!locationName.trim()) { setSaveError('Please enter a Location Name.'); return }
    setSaving(true); setSaveError(null)
    try {
      const submission = await saveSubmission({
        pmNumber, jobType, warrantyWork, customerName, truckNumber,
        locationName, customerContact, customerWorkOrder, typeOfWork,
        glCode, assetTag, workArea, date, startTime, departureTime,
        description, techs, equipment, parts, miles, costPerMile,
        laborHours, hourlyRate, billableTechs: billableTechs !== '' ? billableTechs : techsOnsite,
      }, user.id)
      if (sitePhoto) uploadPhotos(submission.id, [{ dataUrl: sitePhoto, caption: 'Site sign-in photo' }], 'site').catch(console.error)
      if (photos.length > 0) uploadPhotos(submission.id, photos, 'work').catch(console.error)
      navigate('/view/' + submission.id)
    } catch (err) {
      console.error('Save error:', err)
      setSaveError('Save failed: ' + (err.message || 'Unknown error'))
    } finally { setSaving(false) }
  }

  if (pmNumber === null) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}>
      <p style={{ color:'#666' }}>Loading…</p>
    </div>
  )

  return (
    <div style={{ maxWidth:700, margin:'0 auto', padding:'16px 16px 120px' }}>
      <h1 style={{ fontSize:24, fontWeight:700, margin:'0 0 4px' }}>{jobType}</h1>
      <p style={{ color:'#888', margin:'0 0 20px', fontSize:14 }}>{jobType === 'PM' ? 'PM' : 'SC'} #{pmNumber}</p>

      <Section title="Job Details" icon="📋">
        <Row>
          <Field label="Job Type"><input value={jobType} readOnly style={{ ...inp, background:'#f0f0f0' }} /></Field>
          <Field label="Warranty Work">
            <label style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px',
              background: warrantyWork ? '#fff3e8' : '#f8f9fa', borderRadius:8,
              border: warrantyWork ? '2px solid #e65c00' : '1px solid #ddd', cursor:'pointer' }}>
              <input type="checkbox" checked={warrantyWork} onChange={e=>setWarrantyWork(e.target.checked)} style={{ width:18, height:18 }} />
              <span style={{ fontSize:14, color: warrantyWork ? '#e65c00' : '#666' }}>{warrantyWork ? 'Yes (warranty)' : 'No (standard billing)'}</span>
            </label>
          </Field>
        </Row>
      </Section>

      <Section title="Customer Information" icon="🏢">
        <Row>
          <Field label="Customer Name"><select value={customerName} onChange={e=>setCustomerName(e.target.value)} style={sel}>{CUSTOMERS.map(c=><option key={c}>{c}</option>)}</select></Field>
          <Field label="ROS Truck Number"><select value={truckNumber} onChange={e=>setTruckNumber(e.target.value)} style={sel}>{TRUCKS.map(t=><option key={t}>{t}</option>)}</select></Field>
        </Row>
        <Row>
          <Field label="Location Name *"><input value={locationName} onChange={e=>setLocationName(e.target.value)} placeholder="e.g. Cerberus 11-23" style={inp} /></Field>
          <Field label="Customer Contact"><input value={customerContact} onChange={e=>setCustomerContact(e.target.value)} placeholder="e.g. Ty Fisher" style={inp} /></Field>
        </Row>
        <Row>
          <Field label="Customer Work Order"><input value={customerWorkOrder} onChange={e=>setCustomerWorkOrder(e.target.value)} placeholder="WO#" style={inp} /></Field>
          <Field label="Type of Work"><select value={typeOfWork} onChange={e=>setTypeOfWork(e.target.value)} style={sel}>{WORK_TYPES.map(w=><option key={w}>{w}</option>)}</select></Field>
        </Row>
        <Row>
          <Field label="GL Code"><input value={glCode} onChange={e=>setGlCode(e.target.value)} style={inp} /></Field>
          <Field label="Equipment Asset Tag"><input value={assetTag} onChange={e=>setAssetTag(e.target.value)} style={inp} /></Field>
        </Row>
        <Row>
          <Field label="Work Area"><input value={workArea} onChange={e=>setWorkArea(e.target.value)} style={inp} /></Field>
          <Field label="Date"><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inp} /></Field>
        </Row>
        <Row>
          <Field label="Start Time">
            <div style={{ display:'flex', gap:8 }}>
              <input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} style={{ ...inp, flex:1 }} />
              <button onClick={()=>setStartTime(nowStr())} style={nowBtn}>Now</button>
            </div>
          </Field>
          <Field label="Site Sign Photo">
            <input type="file" accept="image/*" capture="environment" ref={sitePhotoRef} onChange={handleSitePhoto} style={{ display:'none' }} />
            <button onClick={()=>sitePhotoRef.current?.click()} style={camBtn}>{sitePhoto ? '📷 Retake' : '📷 Capture'}</button>
            {sitePhoto && <img src={sitePhoto} alt="Site" style={{ marginTop:8, width:'100%', borderRadius:8, maxHeight:160, objectFit:'cover' }} />}
          </Field>
        </Row>
      </Section>

      <Section title="Description of Work" icon="📝">
        <Field label="Summary"><textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Describe the work performed…" style={{ ...inp, minHeight:100, resize:'vertical' }} /></Field>
        <Field label="Technicians On Site">
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:4 }}>
            {TECHS_LIST.map(tech => (
              <label key={tech} style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px',
                background: techs.includes(tech) ? '#fff3e8' : '#f8f9fa',
                border: techs.includes(tech) ? '2px solid #e65c00' : '1px solid #ddd',
                borderRadius:8, cursor:'pointer', fontSize:14 }}>
                <input type="checkbox" checked={techs.includes(tech)}
                  onChange={e=>setTechs(prev=>e.target.checked?[...prev,tech]:prev.filter(t=>t!==tech))}
                  style={{ width:16, height:16 }} />
                {tech}
              </label>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Completed Work Photos" icon="📸">
        <p style={{ color:'#888', fontSize:13, margin:'0 0 12px' }}>{photos.length}/20 photos</p>
        <input type="file" accept="image/*" capture="environment" id="photo-input" onChange={handlePhotoCapture} style={{ display:'none' }} />
        {photos.length < 20 && <label htmlFor="photo-input" style={{ ...camBtn, display:'inline-flex', cursor:'pointer' }}>📷 Add Photo</label>}
        {photos.map((photo, idx) => (
          <div key={idx} style={{ marginTop:12, padding:12, background:'#f8f9fa', borderRadius:8, border:'1px solid #ddd' }}>
            <img src={photo.dataUrl} alt={'Photo ' + (idx+1)} style={{ width:'100%', borderRadius:6, maxHeight:200, objectFit:'cover' }} />
            <div style={{ display:'flex', gap:8, marginTop:8 }}>
              <input value={photo.caption} onChange={e=>setPhotos(prev=>prev.map((p,i)=>i===idx?{...p,caption:e.target.value}:p))}
                placeholder={'Caption for photo ' + (idx+1) + '…'} style={{ ...inp, flex:1 }} />
              <button onClick={()=>setPhotos(prev=>prev.filter((_,i)=>i!==idx))}
                style={{ background:'#ffeaea', border:'1px solid #f99', borderRadius:8, padding:'0 14px', cursor:'pointer', color:'#c00', fontWeight:700 }}>✕</button>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Equipment Inspected" icon="🔧">
        <button onClick={()=>setEquipment(prev=>[...prev,{tag:'',type:'',notes:''}])} style={addBtn}>+ Add Unit</button>
        {equipment.length === 0 && <p style={{ color:'#aaa', fontSize:13, marginTop:12 }}>No equipment added yet.</p>}
        {equipment.map((eq,idx) => (
          <div key={idx} style={{ marginTop:12, padding:12, background:'#f8f9fa', borderRadius:8, border:'1px solid #ddd' }}>
            <Row>
              <Field label="Asset Tag"><input value={eq.tag} onChange={e=>setEquipment(prev=>prev.map((e2,i)=>i===idx?{...e2,tag:e.target.value}:e2))} style={inp} /></Field>
              <Field label="Type"><input value={eq.type} onChange={e=>setEquipment(prev=>prev.map((e2,i)=>i===idx?{...e2,type:e.target.value}:e2))} style={inp} /></Field>
            </Row>
            <Field label="Notes"><input value={eq.notes} onChange={e=>setEquipment(prev=>prev.map((e2,i)=>i===idx?{...e2,notes:e.target.value}:e2))} style={inp} /></Field>
            <button onClick={()=>setEquipment(prev=>prev.filter((_,i)=>i!==idx))} style={{ background:'none', border:'none', color:'#c00', cursor:'pointer', fontSize:13 }}>Remove</button>
          </div>
        ))}
      </Section>

      <Section title="Parts & Services" icon="🔩">
        <p style={{ color:'#888', fontSize:13, margin:'0 0 12px' }}>247 SKUs — scroll or type to filter</p>
        <input value={partSearch} onChange={e=>setPartSearch(e.target.value)} placeholder="Search parts…" style={{ ...inp, marginBottom:8 }} />
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:12 }}>
          {categories.map(cat => (
            <button key={cat} onClick={()=>setPartCategory(cat)} style={{
              padding:'4px 10px', borderRadius:20, fontSize:12, cursor:'pointer', border:'none',
              background: partCategory===cat ? '#e65c00' : '#f0f0f0',
              color: partCategory===cat ? '#fff' : '#333', fontWeight: partCategory===cat ? 700 : 400,
            }}>{cat}</button>
          ))}
        </div>
        <div style={{ maxHeight:280, overflowY:'auto', border:'1px solid #ddd', borderRadius:8 }}>
          {filteredParts.map(part => (
            <div key={part.sku} onClick={()=>addPart(part)} style={{
              padding:'10px 14px', borderBottom:'1px solid #f0f0f0', cursor:'pointer',
              display:'flex', justifyContent:'space-between', alignItems:'center', background:'#fff' }}>
              <div><span style={{ fontSize:12, color:'#888', marginRight:8 }}>{part.sku}</span><span style={{ fontSize:13 }}>{part.name}</span></div>
              <span style={{ fontSize:13, color:'#e65c00', fontWeight:600, whiteSpace:'nowrap', marginLeft:8 }}>{fmt(part.price)}</span>
            </div>
          ))}
        </div>
        {parts.length > 0 && (
          <div style={{ marginTop:16 }}>
            <p style={{ fontWeight:600, fontSize:14, margin:'0 0 8px' }}>Selected Parts</p>
            {parts.map(part => (
              <div key={part.sku} style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px',
                background:'#fff3e8', borderRadius:8, marginBottom:8, border:'1px solid #ffd4a8' }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{part.name}</div>
                  <div style={{ fontSize:12, color:'#888' }}>{fmt(part.price)} each</div>
                </div>
                <button onClick={()=>updateQty(part.sku,-1)} style={qtyBtn}>−</button>
                <span style={{ minWidth:24, textAlign:'center', fontWeight:700 }}>{part.qty}</span>
                <button onClick={()=>updateQty(part.sku,1)} style={qtyBtn}>+</button>
                <span style={{ fontSize:13, fontWeight:700, color:'#e65c00', minWidth:70, textAlign:'right' }}>{fmt(part.price*part.qty)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Mileage & Labor" icon="🚛">
        <Row>
          <Field label="Miles"><input type="number" value={miles} onChange={e=>setMiles(e.target.value)} placeholder="0" style={inp} /></Field>
          <Field label="Cost / Mile"><input type="number" value={costPerMile} onChange={e=>setCostPerMile(e.target.value)} step="0.01" style={inp} /></Field>
        </Row>
        <Row>
          <Field label="Labor Hours"><input type="number" value={laborHours} onChange={e=>setLaborHours(e.target.value)} placeholder="e.g. 2.5" step="0.25" style={inp} /></Field>
          <Field label="Hourly Rate"><input type="number" value={hourlyRate} onChange={e=>setHourlyRate(e.target.value)} step="0.01" style={inp} /></Field>
        </Row>
        <Row>
          <Field label="Departure Time">
            <div style={{ display:'flex', gap:8 }}>
              <input type="time" value={departureTime} onChange={e=>setDepartureTime(e.target.value)} style={{ ...inp, flex:1 }} />
              <button onClick={()=>setDepartureTime(nowStr())} style={nowBtn}>Now</button>
            </div>
          </Field>
          <Field label="Billable Techs">
            <input type="number" value={billableTechs} onChange={e=>setBillableTechs(e.target.value)} placeholder={'Default: ' + techsOnsite} min="0" style={inp} />
          </Field>
        </Row>
      </Section>

      <Section title="Cost Summary" icon="💰">
        {warrantyWork ? (
          <div style={{ textAlign:'center', padding:20, background:'#fff3cd', borderRadius:8, border:'2px solid #ffc107' }}>
            <p style={{ fontSize:20, fontWeight:900, color:'#856404', letterSpacing:2, margin:0 }}>WARRANTY — NO CHARGE</p>
          </div>
        ) : (
          <div style={{ background:'#f8f9fa', borderRadius:8, padding:16 }}>
            {[['Parts Cost',fmt(partsTotal)],['Mileage Cost',fmt(mileageTotal)],['Labor Cost',fmt(laborTotal)]].map(([l,v])=>(
              <div key={l} style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                <span style={{ color:'#666', fontSize:14 }}>{l}</span><span style={{ fontWeight:600, fontSize:14 }}>{v}</span>
              </div>
            ))}
            <div style={{ borderTop:'2px solid #333', paddingTop:12, marginTop:8, display:'flex', justifyContent:'space-between' }}>
              <span style={{ fontWeight:700, fontSize:16 }}>TOTAL</span>
              <span style={{ fontWeight:700, fontSize:16, color:'#e65c00' }}>{fmt(grandTotal)}</span>
            </div>
          </div>
        )}
      </Section>

      {saveError && <div style={{ background:'#ffeaea', border:'1px solid #f88', borderRadius:8, padding:'12px 16px', marginBottom:16, color:'#c00', fontSize:14 }}>{saveError}</div>}

      <div style={{ position:'fixed', bottom:0, left:0, right:0, padding:'12px 16px', background:'#fff', borderTop:'1px solid #eee', zIndex:100 }}>
        <button onClick={handleSave} disabled={saving} style={{
          width:'100%', background: saving ? '#aaa' : '#e65c00', color:'#fff',
          border:'none', borderRadius:12, padding:18, fontSize:16, fontWeight:700,
          cursor: saving ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
          {saving ? '⏳ Saving…' : '💾 SAVE & VIEW'}
        </button>
      </div>
    </div>
  )
}

function Section({ title, icon, children }) {
  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ background:'#1a2332', color:'#fff', padding:'10px 16px', borderRadius:'8px 8px 0 0', display:'flex', alignItems:'center', gap:8 }}>
        <span>{icon}</span><span style={{ fontWeight:700, fontSize:13, letterSpacing:1 }}>{title.toUpperCase()}</span>
      </div>
      <div style={{ background:'#fff', border:'1px solid #ddd', borderTop:'none', borderRadius:'0 0 8px 8px', padding:16 }}>{children}</div>
    </div>
  )
}
function Row({ children }) { return <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>{children}</div> }
function Field({ label, children }) {
  return (
    <div>
      <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#888', letterSpacing:1, marginBottom:4, textTransform:'uppercase' }}>{label}</label>
      {children}
    </div>
  )
}
const inp = { width:'100%', boxSizing:'border-box', padding:'12px 14px', border:'1px solid #ddd', borderRadius:8, fontSize:14, background:'#fafafa', marginBottom:0 }
const sel = { ...inp }
const nowBtn = { padding:'0 14px', background:'#1a2332', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600, whiteSpace:'nowrap' }
const camBtn = { display:'inline-flex', alignItems:'center', gap:6, padding:'10px 18px', background:'#1a2332', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:14, fontWeight:600 }
const addBtn = { padding:'10px 18px', background:'#1a2332', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:14, fontWeight:600 }
const qtyBtn = { width:36, height:36, background:'#1a2332', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:18, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }
