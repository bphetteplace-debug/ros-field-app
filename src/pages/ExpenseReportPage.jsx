import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { saveSubmission, uploadPhotos, fetchSettings, DEFAULT_TRUCKS, DEFAULT_TECHS } from '../lib/submissions'

const EXPENSE_CATEGORIES = ['Fuel', 'Meals', 'Lodging', 'Tools / Supplies', 'Repairs', 'Parking / Tolls', 'Miscellaneous']

function PhotoPicker({ label, value, onChange }) {
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>{label}</div>
      {value ? (
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <img src={URL.createObjectURL(value)} alt="" style={{ width: 110, height: 82, objectFit: 'cover', borderRadius: 5, border: '1px solid #ddd', display: 'block' }} />
          <button type="button" onClick={() => onChange(null)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>x</button>
        </div>
      ) : (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '5px 8px', background: '#f2f2f2', border: '1px dashed #bbb', borderRadius: 5, cursor: 'pointer', fontSize: 12, color: '#555' }}>
          + Receipt
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => onChange(e.target.files[0] || null)} />
        </label>
      )}
    </div>
  )
}

export default function ExpenseReportPage() {
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
  const [saveError, setSaveError] = useState(null)

  function mkExp() {
    return { category: EXPENSE_CATEGORIES[0], description: '', amount: '', receipt: null }
  }

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
        pmNumber: null,
        jobType: 'Expense Report',
        warrantyWork: false,
        customerName: 'Internal',
        truckNumber,
        locationName: techName,
        customerContact: '',
        customerWorkOrder: '',
        typeOfWork: 'Expense Report',
        glCode: '',
        assetTag: '',
        workArea: '',
        date,
        startTime: '',
        departureTime: '',
        lastServiceDate: '',
        description: notes,
        techs: [techName],
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
        expenseItems: expenses.map(e => ({ category: e.category, description: e.description, amount: parseFloat(e.amount) || 0 })),
        expenseTotal: grandTotal,
      }
      const submission = await saveSubmission(formData, user.id, 'expense_report')
      // Upload receipt photos
      for (let i = 0; i < expenses.length; i++) {
        const exp = expenses[i]
        if (exp.receipt) {
          await uploadPhotos(submission.id, [{ file: exp.receipt, caption: exp.category + (exp.description ? ' - ' + exp.description : '') }], 'receipt-' + i)
        }
      }
      // Fire email
      try {
        const token = Object.keys(localStorage).map(k => k.startsWith('sb-') && k.endsWith('-auth-token') ? JSON.parse(localStorage.getItem(k))?.access_token : null).find(Boolean)
        fetch('/api/send-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId: submission.id, userToken: token }) }).catch(() => {})
      } catch (_) {}
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
              <PhotoPicker label="Receipt Photo" value={exp.receipt} onChange={v => updExp(i, 'receipt', v)} />
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
        <button type="button" onClick={handleSubmit} disabled={saving} style={{ width: '100%', padding: 14, background: saving ? '#ccc' : '#e65c00', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 16, cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Saving...' : 'Submit Expense Report'}
        </button>
      </div>
    </div>
  )
}
