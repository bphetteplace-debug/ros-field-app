import { useState, useEffect } from 'react'
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
const nowStr = () => new Date().toTimeString().slice(0, 5)

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
  const [departureTime, setDepartureTime] = useState(nowStr())
  const [description, setDescription] = useState('')
  const [techs, setTechs] = useState([TECHS_LIST[0]])
  const [equipment, setEquipment] = useState('')
  const [parts, setParts] = useState([])
  const [miles, setMiles] = useState('')
  const [costPerMile, setCostPerMile] = useState('1.34')
  const [laborHours, setLaborHours] = useState('')
  const [hourlyRate, setHourlyRate] = useState('123.62')
  const [billableTechs, setBillableTechs] = useState('')
  const [photos, setPhotos] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [partSearch, setPartSearch] = useState('')
  const [showCatalog, setShowCatalog] = useState(false)

  useEffect(() => {
    getNextPmNumber().then(setPmNumber).catch(() => setPmNumber(9136))
  }, [])

  // Parts math
  const partsTotal = parts.reduce((s, p) => s + (p.price || 0) * (p.qty || 0), 0)
  const mileageTotal = parseFloat(miles || 0) * parseFloat(costPerMile || 1.34)
  const effectiveBillable = parseInt(billableTechs) || techs.length
  const laborTotal = warrantyWork ? 0 :
    parseFloat(laborHours || 0) * parseFloat(hourlyRate || 123.62) * effectiveBillable
  const grandTotal = warrantyWork ? 0 : partsTotal + mileageTotal + laborTotal

  function addPart(catalogItem) {
    // catalog uses {code, desc, price, category} — map to {sku, name, qty, price}
    const sku = catalogItem.sku || catalogItem.code
    const name = catalogItem.name || catalogItem.desc
    const price = catalogItem.price

    const existing = parts.find(p => p.sku === sku)
    if (existing) {
      setParts(parts.map(p => p.sku === sku ? { ...p, qty: p.qty + 1 } : p))
    } else {
      setParts([...parts, { sku, name, qty: 1, price }])
    }
    setShowCatalog(false)
    setPartSearch('')
  }

  function updatePartQty(sku, qty) {
    if (qty <= 0) {
      setParts(parts.filter(p => p.sku !== sku))
    } else {
      setParts(parts.map(p => p.sku === sku ? { ...p, qty } : p))
    }
  }

  function toggleTech(name) {
    setTechs(prev => prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name])
  }

  async function handleSave() {
    if (!locationName.trim()) {
      setSaveError('Location Name is required')
      return
    }
    if (!user) {
      setSaveError('Not signed in')
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const formData = {
        pmNumber, jobType, warrantyWork, customerName, truckNumber,
        locationName, customerContact, customerWorkOrder, typeOfWork,
        glCode, assetTag, workArea, date, startTime, departureTime,
        description, techs, equipment, parts, miles, costPerMile,
        laborHours, hourlyRate, billableTechs,
      }
      const submission = await saveSubmission(formData, user.id)
      if (photos.length > 0) {
        await uploadPhotos(submission.id, photos, 'work')
      }
      navigate('/view/' + submission.id)
    } catch (err) {
      console.error('Save error:', err)
      setSaveError(err.message || 'Save failed. Please try again.')
      setSaving(false)
    }
  }

  // catalog filter: supports both {name,sku} and {desc,code} formats
  const filteredParts = PARTS_CATALOG.filter(p => {
    if (!partSearch) return true
    const search = partSearch.toLowerCase()
    const name = (p.name || p.desc || '').toLowerCase()
    const sku = (p.sku || p.code || '').toLowerCase()
    return name.includes(search) || sku.includes(search)
  }).slice(0, 50)

  const s = { fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '0 auto', padding: '0 0 100px 0', background: '#f0f2f5', minHeight: '100vh' }
  const sectionHeader = { background: '#1a2332', color: '#fff', padding: '10px 16px', borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' }
  const sectionBody = { background: '#fff', border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: 16 }
  const field = { marginBottom: 14 }
  const label = { display: 'block', fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }
  const input = { width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 15, boxSizing: 'border-box' }
  const row2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }

  return (
    <div style={s}>
      {/* Header */}
      <div style={{ padding: '16px 16px 8px', background: '#fff', borderBottom: '1px solid #eee', marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 20 }}>{jobType}</div>
        <div style={{ color: '#888', fontSize: 13 }}>{jobType === 'PM' ? 'PM' : 'SC'} #{pmNumber || '...'}</div>
      </div>

      {saveError && (
        <div style={{ margin: '0 16px 12px', background: '#fee', border: '1px solid #f88', borderRadius: 8, padding: '10px 14px', color: '#c00', fontSize: 14 }}>
          ⚠️ {saveError}
        </div>
      )}

      {/* JOB DETAILS */}
      <div style={{ margin: '0 0 12px' }}>
        <div style={sectionHeader}>📋 Job Details</div>
        <div style={sectionBody}>
          <div style={row2}>
            <div style={field}>
              <label style={label}>Job Type</label>
              <input style={{ ...input, background: '#f5f5f5' }} value={jobType} readOnly />
            </div>
            <div style={field}>
              <label style={label}>Warranty Work</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={warrantyWork} onChange={e => setWarrantyWork(e.target.checked)} style={{ width: 18, height: 18 }} />
                No (standard billing)
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* CUSTOMER INFORMATION */}
      <div style={{ margin: '0 0 12px' }}>
        <div style={sectionHeader}>🏢 Customer Information</div>
        <div style={sectionBody}>
          <div style={row2}>
            <div style={field}>
              <label style={label}>Customer Name</label>
              <select style={input} value={customerName} onChange={e => setCustomerName(e.target.value)}>
                {CUSTOMERS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={field}>
              <label style={label}>ROS Truck Number</label>
              <select style={input} value={truckNumber} onChange={e => setTruckNumber(e.target.value)}>
                {TRUCKS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={field}>
            <label style={label}>Location Name *</label>
            <input style={input} value={locationName} onChange={e => setLocationName(e.target.value)} placeholder="e.g. Cerberus 11-23" />
          </div>
          <div style={row2}>
            <div style={field}>
              <label style={label}>Customer Contact</label>
              <input style={input} value={customerContact} onChange={e => setCustomerContact(e.target.value)} placeholder="e.g. Ty Fisher" />
            </div>
            <div style={field}>
              <label style={label}>Customer Work Order</label>
              <input style={input} value={customerWorkOrder} onChange={e => setCustomerWorkOrder(e.target.value)} />
            </div>
          </div>
          <div style={row2}>
            <div style={field}>
              <label style={label}>Type of Work</label>
              <select style={input} value={typeOfWork} onChange={e => setTypeOfWork(e.target.value)}>
                {WORK_TYPES.map(w => <option key={w}>{w}</option>)}
              </select>
            </div>
            <div style={field}>
              <label style={label}>GL Code</label>
              <input style={input} value={glCode} onChange={e => setGlCode(e.target.value)} />
            </div>
          </div>
          <div style={row2}>
            <div style={field}>
              <label style={label}>Asset Tag</label>
              <input style={input} value={assetTag} onChange={e => setAssetTag(e.target.value)} />
            </div>
            <div style={field}>
              <label style={label}>Work Area</label>
              <input style={input} value={workArea} onChange={e => setWorkArea(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* FIELD TECHS */}
      <div style={{ margin: '0 0 12px' }}>
        <div style={sectionHeader}>👷 Field Techs</div>
        <div style={sectionBody}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TECHS_LIST.map(t => (
              <button key={t} onClick={() => toggleTech(t)} style={{ padding: '8px 14px', borderRadius: 20, border: '2px solid', borderColor: techs.includes(t) ? '#e65c00' : '#ddd', background: techs.includes(t) ? '#fff5f0' : '#fff', color: techs.includes(t) ? '#e65c00' : '#333', fontWeight: 600, cursor: 'pointer' }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* DATE & TIME */}
      <div style={{ margin: '0 0 12px' }}>
        <div style={sectionHeader}>🕐 Date & Time</div>
        <div style={sectionBody}>
          <div style={row2}>
            <div style={field}>
              <label style={label}>Date</label>
              <input type="date" style={input} value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div style={field}>
              <label style={label}>Start Time</label>
              <input type="time" style={input} value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
          </div>
          <div style={row2}>
            <div style={field}>
              <label style={label}>Miles Driven</label>
              <input type="number" style={input} value={miles} onChange={e => setMiles(e.target.value)} placeholder="0" />
            </div>
            <div style={field}>
              <label style={label}>Cost Per Mile</label>
              <input type="number" style={input} value={costPerMile} onChange={e => setCostPerMile(e.target.value)} />
            </div>
          </div>
          <div style={row2}>
            <div style={field}>
              <label style={label}>Labor Hours</label>
              <input type="number" style={input} value={laborHours} onChange={e => setLaborHours(e.target.value)} placeholder="0" step="0.25" />
            </div>
            <div style={field}>
              <label style={label}>Hourly Rate</label>
              <input type="number" style={input} value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} />
            </div>
          </div>
          <div style={row2}>
            <div style={field}>
              <label style={label}>Departure Time</label>
              <input type="time" style={input} value={departureTime} onChange={e => setDepartureTime(e.target.value)} />
            </div>
            <div style={field}>
              <label style={label}>Billable Techs</label>
              <input type="number" style={input} value={billableTechs} onChange={e => setBillableTechs(e.target.value)} placeholder={'Default: ' + techs.length} />
            </div>
          </div>
        </div>
      </div>

      {/* DESCRIPTION */}
      <div style={{ margin: '0 0 12px' }}>
        <div style={sectionHeader}>📝 Description of Work</div>
        <div style={sectionBody}>
          <textarea style={{ ...input, minHeight: 100, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe work performed..." />
        </div>
      </div>

      {/* PARTS */}
      <div style={{ margin: '0 0 12px' }}>
        <div style={sectionHeader}>🔧 Parts Used</div>
        <div style={sectionBody}>
          {parts.map(p => (
            <div key={p.sku} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#222' }}>{p.name}</div>
                <div style={{ color: '#888', fontSize: 12 }}>{p.sku} · ${p.price.toFixed(2)} ea</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => updatePartQty(p.sku, p.qty - 1)} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #ddd', background: '#fff', fontSize: 18, cursor: 'pointer' }}>−</button>
                <span style={{ fontWeight: 700, minWidth: 24, textAlign: 'center', color: '#222' }}>{p.qty}</span>
                <button onClick={() => updatePartQty(p.sku, p.qty + 1)} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #e65c00', background: '#e65c00', color: '#fff', fontSize: 18, cursor: 'pointer' }}>+</button>
                <span style={{ fontWeight: 700, minWidth: 60, textAlign: 'right', color: '#222' }}>${(p.price * p.qty).toFixed(2)}</span>
              </div>
            </div>
          ))}
          <button onClick={() => setShowCatalog(true)} style={{ marginTop: 12, width: '100%', padding: '10px', borderRadius: 8, border: '2px dashed #e65c00', background: '#fff', color: '#e65c00', fontWeight: 700, cursor: 'pointer' }}>
            + Add Part
          </button>
        </div>
      </div>

      {/* CATALOG MODAL */}
      {showCatalog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: '#fff', width: '100%', maxHeight: '70vh', borderRadius: '16px 16px 0 0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #eee', display: 'flex', gap: 8 }}>
              <input autoFocus style={{ ...input, flex: 1 }} value={partSearch} onChange={e => setPartSearch(e.target.value)} placeholder="Search parts..." />
              <button onClick={() => { setShowCatalog(false); setPartSearch('') }} style={{ padding: '0 14px', borderRadius: 8, border: '1px solid #ddd', background: '#f5f5f5', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              {filteredParts.map(item => {
                const itemName = item.name || item.desc || ''
                const itemSku = item.sku || item.code || ''
                return (
                  <button key={itemSku} onClick={() => addPart(item)} style={{ width: '100%', padding: '12px 16px', border: 'none', borderBottom: '1px solid #f0f0f0', background: '#fff', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, color: '#222', fontSize: 14 }}>{itemName}</div>
                      <div style={{ color: '#888', fontSize: 12 }}>{itemSku}</div>
                    </div>
                    <div style={{ color: '#e65c00', fontWeight: 700, marginLeft: 12 }}>${item.price.toFixed(2)}</div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* COST SUMMARY */}
      <div style={{ margin: '0 0 12px' }}>
        <div style={sectionHeader}>💰 Cost Summary</div>
        <div style={sectionBody}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
            <span style={{ color: '#333' }}>Parts Cost</span><span style={{ color: '#333' }}>${partsTotal.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
            <span style={{ color: '#333' }}>Mileage Cost</span><span style={{ color: '#333' }}>${mileageTotal.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
            <span style={{ color: '#333' }}>Labor Cost</span><span style={{ color: '#333' }}>${laborTotal.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontWeight: 700, fontSize: 16 }}>
            <span>TOTAL</span>
            <span style={{ color: warrantyWork ? '#888' : '#e65c00' }}>
              {warrantyWork ? 'WARRANTY — NO CHARGE' : '$' + grandTotal.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* SAVE BUTTON */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: '#fff', borderTop: '1px solid #eee', zIndex: 100 }}>
        <button onClick={handleSave} disabled={saving} style={{ width: '100%', padding: '16px', background: saving ? '#aaa' : '#e65c00', color: '#fff', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? '⏳ Saving…' : '💾 SAVE & VIEW'}
        </button>
      </div>
    </div>
  )
    }
