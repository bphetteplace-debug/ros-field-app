import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { saveSubmission, uploadPhotos, fetchSettings, DEFAULT_TRUCKS, DEFAULT_TECHS } from '../lib/submissions'

const EXPENSE_CATEGORIES = ['Fuel', 'Meals', 'Lodging', 'Tools / Supplies', 'Repairs', 'Parking / Tolls', 'Miscellaneous']

function PhotoPicker({ label, value, onChange }) {
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>{label}</div>
      {value ? (
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <img src={URL.createObjectURL(value)} alt="" style={{ width: 110, height: 82, objectFit: 'cover', borderRadius: 5, border: '1px solid #ddd', display: 'block' }} />
          <button type="button" onClick={() => onChange(null)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>x</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '5px 8px', background: '#1a2332', border: '1px solid #1a2332', borderRadius: 5, cursor: 'pointer', fontSize: 12, color: '#fff', fontWeight: 600 }}>
            📷 Camera
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => onChange(e.target.files[0] || null)} />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '5px 8px', background: '#f2f2f2', border: '1px dashed #bbb', borderRadius: 5, cursor: 'pointer', fontSize: 12, color: '#555' }}>
            🖼️ Gallery
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => onChange(e.target.files[0] || null)} />
          </label>
        </div>
      )}
    </div>
  )
}

export default function ExpenseReportPageexport default function ExpenseReportPage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [TRUCKS, setTRUCKS] = useState(DEFAULT_TRUCKS)
  const [TECHS_LIST, setTECHS_LIST] = useState(DEFAULT_TECHS)
  const [techName, setTechName] = useState('')
  const [truckNumber, setTruckNumber] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [expenses, setExpenses] = useState([mkExp()])
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
  const DRAFT_KEY = 'ros_expense_draft'
  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ techName, truckNumber, date, notes, expenses: expenses.map(e => ({...e, receipt: null, itemPhoto: null})) }))
      setDraftSaved(true); setTimeout(() => setDraftSaved(false), 2000)
    } catch(e) {}
  }
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY) } catch(e) {} }

  function mkExp() { return { category: EXPENSE_CATEGORIES[0], description: '', amount: '', receipt: null, itemPhoto: null } }

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
    // Load saved draft
    try {
      const saved = JSON.parse(localStorage.getItem('ros_expense_draft') || 'null')
      if (saved) {
        if (saved.techName) setTechName(saved.techName)
        if (saved.truckNumber) setTruckNumber(saved.truckNumber)
        if (saved.date) setDate(saved.date)
        if (saved.notes) setNotes(saved.notes)
        if (saved.expenses && saved.expenses.length > 0) setExpenses(saved.expenses.map(e => ({...e, receipt: null, itemPhoto: null})))
      }
    } catch(e) {}
  }, [profile?.full_name, profile?.truck_number])

  const updExp = (i, k, v) => setExpenses(es => es.map((e, idx) => idx === i ? { ...e, [k]: v } : e))
  const removeExp = (i) => setExpenses(es => es.filter((_, idx) => idx !== i))
  const addExp = () => setExpenses(es => [...es, mkExp()])
  const grandTotal = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)

  const handleSubmit = async () => {
    if (!techName) { setSaveError('Tech name is required'); return }
    if (expenses.length === 0) { setSaveError('Add at least one expense'); return }
    setSaving(true); setSaveError(null)
    try {
      const formData = {
        // Standard fields that saveSubmission expects
        truckNumber,
        customerName: '',
        locationName: '',
        date,
        techs: techName ? [techName] : [],
        description: notes,
        // Cost fields (zero for expense reports)
        miles: 0,
        costPerMile: 0,
        laborHours: 0,
        hourlyRate: 0,
        parts: [],
        billableTechs: 0,
        warrantyWork: false,
        // Expense-specific fields (go into data JSONB)
        jobType: 'Expense Report',
        expenseItems: expenses.map(function(e){return {category:e.category,description:e.description,amount:parseFloat(e.amount||0)}}),
        expenseTotal: expenses.reduce(function(s,e){return s+parseFloat(e.amount||0)},0),
        gpsLat: gpsLat,
        gpsLng: gpsLng,
        gpsAccuracy: gpsAccuracy,
      }
      const submission = await saveSubmission(formData, user.id, 'expense_report')

      // Upload receipt and item photos for each expense
      for (let i = 0; i < expenses.length; i++) {
        const exp = expenses[i]
        const photos = []
        if (exp.receipt) photos.push({ file: exp.receipt, caption: 'Receipt: ' + exp.category + (exp.description ? ' - ' + exp.description : '') })
        if (exp.itemPhoto) photos.push({ file: exp.itemPhoto, caption: 'Item: ' + exp.category + (exp.description ? ' - ' + exp.description : '') })
        if (photos.length > 0) {
          await uploadPhotos(submission.id, photos, 'expense-' + i)
        }
      }

      // Fire email
      try {
        const token = Object.keys(localStorage).map(k => k.startsWith('sb-') && k.endsWith('-auth-token') ? JSON.parse(localStorage.getItem(k))?.access_token : null).find(Boolean)
        fetch('/api/send-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId: submission.id, userToken: token }) }).catch(() => {})
      } catch (_) {}
      clearDraft()
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
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>Expense Report</div>
      </div>

      {saveError && <div style={{ margin: '0 0 10px', background: '#fee', border: '1px solid #faa', borderRadius: 6, padding: '8px 12px', color: '#c00', fontSize: 13 }}>{saveError}</div>}

      {/* TECH INFO */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Tech & Date</div>
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
              <label style={lbl}>Truck #</label>
              <select style={inp} value={truckNumber} onChange={e => setTruckNumber(e.target.value)}>
                <option value="">-- Select --</option>
                {TRUCKS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={fld}>
            <label style={lbl}>Date</label>
            <input type="date" style={inp} value={date} onChange={e => setDate(e.target.value)} />
          </div>
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

      {/* EXPENSES */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Expense Items</div>
        <div style={sBody}>
          {expenses.map((exp, i) => (
            <div key={i} style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 10, marginBottom: 10, background: '#fafafa' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 700, color: '#1a2332', fontSize: 13 }}>Expense #{i + 1}</div>
                {expenses.length > 1 && (
                  <button type="button" onClick={() => removeExp(i)} style={{ color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>x</button>
                )}
              </div>
              <div style={row}>
                <div style={fld}>
                  <label style={lbl}>Category</label>
                  <select style={inp} value={exp.category} onChange={e => updExp(i, 'category', e.target.value)}>
                    {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ ...fld, maxWidth: 120 }}>
                  <label style={lbl}>Amount ($)</label>
                  <input type="number" step="0.01" min="0" style={inp} value={exp.amount} onChange={e => updExp(i, 'amount', e.target.value)} placeholder="0.00" />
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={lbl}>Description / Vendor</label>
                <input style={inp} value={exp.description} onChange={e => updExp(i, 'description', e.target.value)} placeholder="e.g. Shell Station, McDonald's, Hampton Inn..." />
              </div>
              {/* DUAL PHOTO PICKERS */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                <PhotoPicker label="Receipt Photo" value={exp.receipt} onChange={v => updExp(i, 'receipt', v)} />
                <PhotoPicker label="Item / Purchase Photo" value={exp.itemPhoto} onChange={v => updExp(i, 'itemPhoto', v)} />
              </div>
            </div>
          ))}
          <button type="button" onClick={addExp} style={{ width: '100%', padding: 8, background: '#f5f5f5', border: '1px dashed #ccc', borderRadius: 6, cursor: 'pointer', color: '#333', fontSize: 13 }}>
            + Add Expense
          </button>
        </div>
      </div>

      {/* NOTES */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Notes</div>
        <div style={sBody}>
          <textarea style={{ ...inp, minHeight: 70, resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Trip purpose, project, or other notes..." />
        </div>
      </div>

      {/* TOTAL */}
      <div style={{ margin: '0 0 10px' }}>
        <div style={sHdr}>Total</div>
        <div style={{ ...sBody, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1a2332' }}>Expense Total</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#e65c00' }}>${grandTotal.toFixed(2)}</span>
        </div>
      </div>

      {/* SUBMIT */}
      <div style={{ padding: '0 0' }}>
        <div style={{ padding: '0 0 8px' }}>
        <button type="button" onClick={saveDraft} style={{ width: '100%', padding: 10, background: draftSaved ? '#16a34a' : '#f5f5f5', color: draftSaved ? '#fff' : '#555', border: '1px solid ' + (draftSaved ? '#16a34a' : '#ddd'), borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
          {draftSaved ? '✅ Draft Saved!' : '💾 Save Draft'}
        </button>
      </div>
      <button type="button" onClick={handleSubmit} disabled={saving} style={{ width: '100%', padding: 14, background: saving ? '#ccc' : '#e65c00', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 16, cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Saving...' : 'Submit Expense Report'}
        </button>
      </div>
    </div>
  )
}
