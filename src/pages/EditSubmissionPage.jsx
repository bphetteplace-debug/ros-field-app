import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { fetchSubmission, updateSubmission, fetchSettings, DEFAULT_CUSTOMERS, DEFAULT_TRUCKS, DEFAULT_TECHS } from '../lib/submissions'
import { PARTS_CATALOG } from '../data/catalog'

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
  'Solar / Battery','Thermocouple / Thermowell','Valve','Wiring / Electrical','Other'
]

export default function EditSubmissionPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [sub, setSub] = useState(null)

  // Dynamic lists
  const [CUSTOMERS, setCUSTOMERS] = useState(DEFAULT_CUSTOMERS)
  const [TRUCKS, setTRUCKS] = useState(DEFAULT_TRUCKS)
  const [TECHS_LIST, setTECHS_LIST] = useState(DEFAULT_TECHS)

  // Form fields
  const [jobType, setJobType] = useState('PM')
  const [warrantyWork, setWarrantyWork] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [truckNumber, setTruckNumber] = useState('')
  const [locationName, setLocationName] = useState('')
  const [customerContact, setCustomerContact] = useState('')
  const [customerWorkOrder, setCustomerWorkOrder] = useState('')
  const [typeOfWork, setTypeOfWork] = useState(WORK_TYPES[0])
  const [glCode, setGlCode] = useState('')
  const [assetTag, setAssetTag] = useState('')
  const [workArea, setWorkArea] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [departureTime, setDepartureTime] = useState('')
  const [lastServiceDate, setLastServiceDate] = useState('')
  const [description, setDescription] = useState('')
  const [techs, setTechs] = useState([])
  const [equipment, setEquipment] = useState('')
  const [parts, setParts] = useState([])
  const [miles, setMiles] = useState('')
  const [costPerMile, setCostPerMile] = useState('1.50')
  const [laborHours, setLaborHours] = useState('')
  const [hourlyRate, setHourlyRate] = useState('115.00')
  const [billableTechs, setBillableTechs] = useState('')
  const [arrestors, setArrestors] = useState([])
  const [flares, setFlares] = useState([])
  const [heaters, setHeaters] = useState([])
  const [scEquipment, setScEquipment] = useState([])
  const [partSearch, setPartSearch] = useState('')
  const [showCatalog, setShowCatalog] = useState(false)

  // Load settings
  useEffect(() => {
    fetchSettings().then(s => {
      if (!s) return
      if (s.customers?.length) setCUSTOMERS(s.customers)
      if (s.trucks?.length) setTRUCKS(s.trucks)
      if (s.techs?.length) setTECHS_LIST(s.techs)
    }).catch(() => {})
  }, [])

  // Load submission
  useEffect(() => {
    if (!id) return
    fetchSubmission(id).then(data => {
      if (!data) { setSaveError('Submission not found'); setLoading(false); return }
      setSub(data)
      const d = data.data || {}
      setJobType(d.jobType || (data.template === 'pm_flare_combustor' ? 'PM' : 'Service Call'))
      setWarrantyWork(d.warrantyWork || false)
      setCustomerName(data.customer_name || '')
      setTruckNumber(data.truck_number || '')
      setLocationName(data.location_name || '')
      setCustomerContact(data.contact || d.customerContact || '')
      setCustomerWorkOrder(data.work_order || d.customerWorkOrder || '')
      setTypeOfWork(data.work_type || d.typeOfWork || WORK_TYPES[0])
      setGlCode(data.gl_code || d.glCode || '')
      setAssetTag(data.asset_tag || d.assetTag || '')
      setWorkArea(data.work_area || d.workArea || '')
      setDate(data.date || '')
      setStartTime(data.start_time || d.startTime || '')
      setDepartureTime(data.departure_time || d.departureTime || '')
      setLastServiceDate(d.lastServiceDate || '')
      setDescription(data.summary || d.description || '')
      setTechs(Array.isArray(d.techs) ? d.techs : [])
      setEquipment(d.equipment || '')
      setParts(Array.isArray(d.parts) ? d.parts : [])
      setMiles(data.miles != null ? String(data.miles) : '')
      setCostPerMile(data.cost_per_mile != null ? String(data.cost_per_mile) : '1.50')
      setLaborHours(data.labor_hours != null ? String(data.labor_hours) : '')
      setHourlyRate(data.labor_rate != null ? String(data.labor_rate) : '115.00')
      setBillableTechs(d.billableTechs != null ? String(d.billableTechs) : '')
      setArrestors(Array.isArray(d.arrestors) ? d.arrestors : [])
      setFlares(Array.isArray(d.flares) ? d.flares : [])
      setHeaters(Array.isArray(d.heaters) ? d.heaters.map(h => ({ ...h, firetubes: Array.isArray(h.firetubes) ? h.firetubes : [] })) : [])
      setScEquipment(Array.isArray(d.scEquipment) ? d.scEquipment : [])
      setLoading(false)
    }).catch(e => { setSaveError(e.message); setLoading(false) })
  }, [id])

  if (!isAdmin) return <div style={{ padding: 40 }}>Access denied.</div>
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>

  const isPM = jobType === 'PM'
  const partsTotal = parts.reduce((s, p) => s + (p.price || 0) * (p.qty || 0), 0)
  const mileageTotal = parseFloat(miles || 0) * parseFloat(costPerMile || 1.50)
  const effBill = parseInt(billableTechs) || techs.length
  const laborTotal = warrantyWork ? 0 : parseFloat(laborHours || 0) * parseFloat(hourlyRate || 115) * effBill
  const grandTotal = warrantyWork ? 0 : partsTotal + mileageTotal + laborTotal

  const toggleTech = t => setTechs(ts => ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t])
  const addPart = p => {
    const sku = p.code || p.sku
    setParts(ps => { const ex = ps.find(x => x.sku === sku); return ex ? ps.map(x => x.sku === sku ? { ...x, qty: x.qty + 1 } : x) : [...ps, { sku, name: p.desc || p.name, qty: 1, price: p.price || 0 }] })
    setShowCatalog(false)
  }
  const qtyChange = (sku, d) => setParts(ps => ps.map(x => x.sku === sku ? { ...x, qty: Math.max(0, x.qty + d) } : x).filter(x => x.qty > 0))
  const updArr = (i, k, v) => setArrestors(a => a.map((x, idx) => idx === i ? { ...x, [k]: v } : x))
  const updFlare = (i, k, v) => setFlares(f => f.map((x, idx) => idx === i ? { ...x, [k]: v } : x))
  const updHT = (i, k, v) => setHeaters(h => h.map((x, idx) => idx === i ? { ...x, [k]: v } : x))
  const mkArr = () => ({ arrestorId: '', condition: 'Good', filterChanged: false, notes: '' })
  const mkFlare = () => ({ flareId: '', pilotLit: true, lastIgnition: '', condition: 'Good', notes: '' })
  const mkHT = () => ({ heaterId: '', lastCleanDate: '', condition: 'Good', notes: '', firetubes: [] })

  const filteredParts = PARTS_CATALOG.filter(p => {
    if (!partSearch) return true
    const q = partSearch.toLowerCase()
    return (p.code || p.sku || '').toLowerCase().includes(q) || (p.desc || p.name || '').toLowerCase().includes(q)
  })

  const handleSave = async () => {
    if (!customerName || !locationName) { setSaveError('Customer and location are required'); return }
    setSaving(true); setSaveError('')
    try {
      await updateSubmission(id, {
        jobType, warrantyWork, customerName, truckNumber, locationName,
        customerContact, customerWorkOrder, typeOfWork, glCode, assetTag, workArea,
        date, startTime, departureTime, lastServiceDate, description, techs, equipment,
        parts, miles, costPerMile, laborHours, hourlyRate, billableTechs,
        arrestors: isPM ? arrestors : [],
        flares: isPM ? flares : [],
        heaters: isPM ? heaters.map(h => ({ ...h, firetubeCnt: h.firetubes?.length || 0 })) : [],
        scEquipment: !isPM ? scEquipment : [],
      })
      navigate('/view/' + id)
    } catch(e) {
      setSaveError('Save failed: ' + e.message)
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
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 0 60px', fontFamily: 'system-ui,sans-serif' }}>
      {/* HEADER */}
      <div style={{ background: '#1a2332', padding: '14px 16px', position: 'sticky', top: 0, zIndex: 100, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: '#e65c00', fontWeight: 800, fontSize: 17 }}>✏️ Edit Submission</div>
            <div style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>{sub?.customer_name} — {sub?.location_name} | {isPM ? 'PM' : 'SC'} #{sub?.pm_number}</div>
          </div>
          <button onClick={() => navigate('/view/' + id)}
            style={{ background: 'none', border: '1px solid #555', color: '#aaa', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>

      {saveError && <div style={{ margin: '0 0 10px', background: '#fee', border: '1px solid #faa', borderRadius: 6, padding: '8px 12px', color: '#c00', fontSize: 13 }}>{saveError}</div>}

      {/* JOB INFO */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Job Information</div>
        <div style={sBody}>
          <div style={row}>
            <div style={fld}><label style={lbl}>Customer *</label>
              <select style={inp} value={customerName} onChange={e => setCustomerName(e.target.value)}>
                {CUSTOMERS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={fld}><label style={lbl}>Truck</label>
              <select style={inp} value={truckNumber} onChange={e => setTruckNumber(e.target.value)}>
                {TRUCKS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 10 }}><label style={lbl}>Location / Well Name *</label>
            <input style={inp} value={locationName} onChange={e => setLocationName(e.target.value)} />
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Contact</label><input style={inp} value={customerContact} onChange={e => setCustomerContact(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Work Order #</label><input style={inp} value={customerWorkOrder} onChange={e => setCustomerWorkOrder(e.target.value)} /></div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Type of Work</label>
              <select style={inp} value={typeOfWork} onChange={e => setTypeOfWork(e.target.value)}>
                {WORK_TYPES.map(w => <option key={w}>{w}</option>)}
              </select>
            </div>
            <div style={fld}><label style={lbl}>GL Code</label><input style={inp} value={glCode} onChange={e => setGlCode(e.target.value)} /></div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Asset Tag</label><input style={inp} value={assetTag} onChange={e => setAssetTag(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Work Area</label><input style={inp} value={workArea} onChange={e => setWorkArea(e.target.value)} /></div>
          </div>
          <div style={{ marginBottom: 10 }}><label style={lbl}>Last Service Date</label>
            <input type="date" style={inp} value={lastServiceDate} onChange={e => setLastServiceDate(e.target.value)} />
          </div>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <input type="checkbox" checked={warrantyWork} onChange={e => setWarrantyWork(e.target.checked)} />
            Warranty Work (no charge to customer)
          </label>
        </div>
      </div>

      {/* TECHS */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Technicians</div>
        <div style={sBody}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {TECHS_LIST.map(t => (
              <button key={t} type="button" onClick={() => toggleTech(t)}
                style={{ padding: '8px 14px', borderRadius: 20, border: '2px solid ' + (techs.includes(t) ? '#1a2332' : '#ddd'), background: techs.includes(t) ? '#1a2332' : '#fff', color: techs.includes(t) ? '#fff' : '#333', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                {t}
              </button>
            ))}
          </div>
          <div><label style={lbl}>Billable Techs (override)</label>
            <input style={{ ...inp, width: 120 }} type="number" min="0" value={billableTechs} onChange={e => setBillableTechs(e.target.value)} placeholder={techs.length || 0} />
          </div>
        </div>
      </div>

      {/* DATE & TIME */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Date & Time</div>
        <div style={sBody}>
          <div style={row}>
            <div style={fld}><label style={lbl}>Date</label><input type="date" style={inp} value={date} onChange={e => setDate(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Start</label><input type="time" style={inp} value={startTime} onChange={e => setStartTime(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Depart</label><input type="time" style={inp} value={departureTime} onChange={e => setDepartureTime(e.target.value)} /></div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Mileage</label><input style={inp} type="number" min="0" value={miles} onChange={e => setMiles(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>$/Mile</label><input style={inp} type="number" step="0.01" value={costPerMile} onChange={e => setCostPerMile(e.target.value)} /></div>
          </div>
          <div style={row}>
            <div style={fld}><label style={lbl}>Hours on Site</label><input style={inp} type="number" step="0.25" min="0" value={laborHours} onChange={e => setLaborHours(e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Hourly Rate</label><input style={inp} type="number" step="0.01" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} /></div>
          </div>
        </div>
      </div>

      {/* DESCRIPTION */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Work Description</div>
        <div style={sBody}>
          <textarea style={{ ...inp, minHeight: 90, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe all work performed..." />
          <div style={{ marginTop: 8 }}><label style={lbl}>Equipment / Serial Numbers</label>
            <input style={inp} value={equipment} onChange={e => setEquipment(e.target.value)} />
          </div>
        </div>
      </div>

      {/* SC EQUIPMENT */}
      {!isPM && (
        <div style={{ margin: '0 0 10px' }}>
          <div style={sHdr}>Equipment Worked On</div>
          <div style={sBody}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {SC_EQUIP_TYPES.map(type => {
                const active = scEquipment.some(e => e.type === type)
                return (
                  <button key={type} type="button" onClick={() => { if (active) setScEquipment(prev => prev.filter(e => e.type !== type)); else setScEquipment(prev => [...prev, { type, notes: '' }]) }}
                    style={{ padding: '6px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '2px solid ' + (active ? '#1a2332' : '#ddd'), background: active ? '#1a2332' : '#fff', color: active ? '#fff' : '#333' }}>
                    {type}
                  </button>
                )
              })}
            </div>
            {scEquipment.map((item, i) => (
              <div key={item.type} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1a2332', marginBottom: 3 }}>{item.type}</div>
                <input style={inp} placeholder="Notes..." value={item.notes} onChange={e => setScEquipment(prev => prev.map((x, xi) => xi === i ? { ...x, notes: e.target.value } : x))} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PM EQUIPMENT: FLAME ARRESTORS */}
      {isPM && (
        <div style={{ margin: '0 0 10px' }}>
          <div style={sHdr}>Flame Arrestors</div>
          <div style={sBody}>
            {arrestors.map((a, i) => (
              <div key={i} style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 10, marginBottom: 10, background: '#fafafa' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Arrestor #{i + 1}</div>
                  {arrestors.length > 1 && <button type="button" onClick={() => setArrestors(a => a.filter((_, x) => x !== i))} style={{ color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>}
                </div>
                <div style={row}>
                  <div style={fld}><label style={lbl}>ID/Tag</label><input style={inp} value={a.arrestorId || ''} onChange={e => updArr(i, 'arrestorId', e.target.value)} /></div>
                  <div style={fld}><label style={lbl}>Condition</label>
                    <select style={inp} value={a.condition || 'Good'} onChange={e => updArr(i, 'condition', e.target.value)}>{CONDITION_OPTS.map(c => <option key={c}>{c}</option>)}</select>
                  </div>
                </div>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <input type="checkbox" checked={a.filterChanged || false} onChange={e => updArr(i, 'filterChanged', e.target.checked)} /> Filter Changed
                </label>
                <input style={inp} placeholder="Notes..." value={a.notes || ''} onChange={e => updArr(i, 'notes', e.target.value)} />
              </div>
            ))}
            {arrestors.length < 5 && <button type="button" onClick={() => setArrestors(a => [...a, mkArr()])}
              style={{ width: '100%', padding: 8, background: '#f5f5f5', border: '1px dashed #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>+ Add Arrestor</button>}
          </div>
        </div>
      )}

      {/* PM EQUIPMENT: FLARES */}
      {isPM && (
        <div style={{ margin: '0 0 10px' }}>
          <div style={sHdr}>Flares</div>
          <div style={sBody}>
            {flares.map((f, i) => (
              <div key={i} style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 10, marginBottom: 10, background: '#fafafa' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Flare #{i + 1}</div>
                  {flares.length > 1 && <button type="button" onClick={() => setFlares(f => f.filter((_, x) => x !== i))} style={{ color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>}
                </div>
                <div style={row}>
                  <div style={fld}><label style={lbl}>ID/Tag</label><input style={inp} value={f.flareId || ''} onChange={e => updFlare(i, 'flareId', e.target.value)} /></div>
                  <div style={fld}><label style={lbl}>Condition</label>
                    <select style={inp} value={f.condition || 'Good'} onChange={e => updFlare(i, 'condition', e.target.value)}>{CONDITION_OPTS.map(c => <option key={c}>{c}</option>)}</select>
                  </div>
                </div>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={f.pilotLit !== false} onChange={e => updFlare(i, 'pilotLit', e.target.checked)} /> Pilot Lit on Departure
                </label>
                <input style={{ ...inp, marginTop: 6 }} placeholder="Notes..." value={f.notes || ''} onChange={e => updFlare(i, 'notes', e.target.value)} />
              </div>
            ))}
            {flares.length < 3 && <button type="button" onClick={() => setFlares(f => [...f, mkFlare()])}
              style={{ width: '100%', padding: 8, background: '#f5f5f5', border: '1px dashed #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>+ Add Flare</button>}
          </div>
        </div>
      )}

      {/* PM EQUIPMENT: HEATER TREATERS */}
      {isPM && (
        <div style={{ margin: '0 0 10px' }}>
          <div style={sHdr}>Heater Treaters</div>
          <div style={sBody}>
            {heaters.map((h, i) => (
              <div key={i} style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 10, marginBottom: 10, background: '#fafafa' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Heater Treater #{i + 1}</div>
                  {heaters.length > 1 && <button type="button" onClick={() => setHeaters(h => h.filter((_, x) => x !== i))} style={{ color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>}
                </div>
                <div style={row}>
                  <div style={fld}><label style={lbl}>ID/Tag</label><input style={inp} value={h.heaterId || ''} onChange={e => updHT(i, 'heaterId', e.target.value)} /></div>
                  <div style={fld}><label style={lbl}>Condition</label>
                    <select style={inp} value={h.condition || 'Good'} onChange={e => updHT(i, 'condition', e.target.value)}>{CONDITION_OPTS.map(c => <option key={c}>{c}</option>)}</select>
                  </div>
                </div>
                <input style={{ ...inp, marginBottom: 6 }} placeholder="Notes..." value={h.notes || ''} onChange={e => updHT(i, 'notes', e.target.value)} />
              </div>
            ))}
            {heaters.length < 5 && <button type="button" onClick={() => setHeaters(h => [...h, mkHT()])}
              style={{ width: '100%', padding: 8, background: '#f5f5f5', border: '1px dashed #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>+ Add Heater Treater</button>}
          </div>
        </div>
      )}

      {/* PARTS */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Parts Used</div>
        <div style={sBody}>
          {parts.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {parts.map(p => (
                <div key={p.sku} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{p.sku} — ${(p.price || 0).toFixed(2)}/ea</div>
                  </div>
                  <button type="button" onClick={() => qtyChange(p.sku, -1)} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #ddd', background: '#f5f5f5', cursor: 'pointer', fontSize: 16 }}>-</button>
                  <span style={{ width: 24, textAlign: 'center', fontWeight: 700 }}>{p.qty}</span>
                  <button type="button" onClick={() => qtyChange(p.sku, 1)} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #ddd', background: '#f5f5f5', cursor: 'pointer', fontSize: 16 }}>+</button>
                  <button type="button" onClick={() => setParts(ps => ps.filter(x => x.sku !== p.sku))} style={{ color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>×</button>
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setShowCatalog(!showCatalog)}
            style={{ width: '100%', padding: 10, background: '#e65c00', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
            {showCatalog ? 'Close Catalog' : '+ Add Part from Catalog'}
          </button>
          {showCatalog && (
            <div style={{ marginTop: 8 }}>
              <input style={{ ...inp, marginBottom: 8 }} placeholder="Search by name or SKU..." value={partSearch} onChange={e => setPartSearch(e.target.value)} />
              <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 6 }}>
                {filteredParts.slice(0, 60).map(p => (
                  <button key={p.code || p.sku} type="button" onClick={() => addPart(p)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', background: 'none', borderBottom: '1px solid #f0f0f0', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.desc || p.name}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{p.code || p.sku}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* COST SUMMARY */}
      <div style={{ margin: '0 0 16px' }}>
        <div style={sHdr}>Cost Summary (Preview)</div>
        <div style={sBody}>
          {warrantyWork ? (
            <div style={{ textAlign: 'center', padding: 12, color: '#c00', fontWeight: 800, fontSize: 16, border: '2px solid #c00', borderRadius: 6 }}>WARRANTY — NO CHARGE</div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}><span>Parts</span><span>${partsTotal.toFixed(2)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}><span>Mileage</span><span>${mileageTotal.toFixed(2)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}><span>Labor</span><span>${laborTotal.toFixed(2)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontWeight: 800, fontSize: 16 }}><span>TOTAL</span><span style={{ color: '#e65c00' }}>${grandTotal.toFixed(2)}</span></div>
            </div>
          )}
        </div>
      </div>

      {/* SAVE BUTTON */}
      <button type="button" onClick={handleSave} disabled={saving}
        style={{ width: '100%', padding: 14, background: saving ? '#ccc' : '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 16, cursor: saving ? 'not-allowed' : 'pointer' }}>
        {saving ? 'Saving Changes...' : '✅ Save Changes'}
      </button>
    </div>
  )
}
