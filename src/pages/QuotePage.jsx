import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import NavBar from '../components/NavBar'
import { toast } from '../lib/toast'
import { getAuthToken } from '../lib/submissions'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function supaRest(path, opts) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
  }, opts))
  if (!res.ok) { var e = await res.json(); throw new Error(e.message || res.statusText) }
  return res.status === 204 ? null : res.json()
}

var LABOR_RATE = 125

var PARTS_CATALOG = [
  { code: '41000', description: 'ROS BMS Diamondback', price: 2150.0, category: 'BMS' },
  { code: '41004', description: 'ROS BMS QCU HEATER', price: 7650.21, category: 'BMS' },
  { code: '41006', description: 'CABLE, FLAT RIBBON, KEYPAD, BMS', price: 59.61, category: 'BMS' },
  { code: '41007', description: 'CABLE, FLAT RIBBON, SMALL, INTERCONNECTION, BMS', price: 74.65, category: 'BMS' },
  { code: '41008', description: 'CABLE, GROUND, 6\', BLACK, -BMS', price: 57.53, category: 'BMS' },
  { code: '41009', description: 'CABLE, 4 CONDUCTOR, 20\', GRAY,BMS', price: 136.35, category: 'BMS' },
  { code: '41023', description: 'DOOR, FOR -600 BMS', price: 736.56, category: 'BMS' },
  { code: '41061', description: 'MOUNTING BRACKET, WITH HOOD, FOR BMS', price: 417.07, category: 'BMS' },
  { code: '41084', description: 'STAND FOR BMS OR CQCU, SINGLE, NO WIRE TROUGH', price: 661.09, category: 'BMS' },
  { code: '70000', description: 'FLAME ARRESTOR 2"', price: 145.0, category: 'Flame Arrestor' },
  { code: '70001', description: 'FLAME ARRESTOR 3"', price: 195.0, category: 'Flame Arrestor' },
  { code: '70002', description: 'FLAME ARRESTOR 4"', price: 245.0, category: 'Flame Arrestor' },
  { code: '80000', description: 'PILOT ASSEMBLY', price: 325.0, category: 'Pilot' },
  { code: '80001', description: 'PILOT ORIFICE', price: 45.0, category: 'Pilot' },
  { code: '80002', description: 'PILOT IGNITER', price: 85.0, category: 'Pilot' },
]

export default function QuotePage() {
  var { user, isAdmin, signOut } = useAuth()
  var navigate = useNavigate()
  var [loggingOut, setLoggingOut] = useState(false)
  var [customers, setCustomers] = useState([])
  var [customerName, setCustomerName] = useState('')
  var [newCustomer, setNewCustomer] = useState('')
  var [customerEmail, setCustomerEmail] = useState('')
  var [locationName, setLocationName] = useState('')
  var [contact, setContact] = useState('')
  var [laborHours, setLaborHours] = useState(0)
  var [parts, setParts] = useState([])
  var [notes, setNotes] = useState('')
  var [sending, setSending] = useState(false)
  var [partSearch, setPartSearch] = useState('')
  var [showCatalog, setShowCatalog] = useState(false)
  var [addingNew, setAddingNew] = useState(false)

  var handleLogout = useCallback(async function() {
    setLoggingOut(true)
    try { await signOut() } catch(e) {}
    setLoggingOut(false)
  }, [signOut])

  useEffect(function() {
    supaRest('submissions?select=customer_name&status=neq.draft', {})
      .then(function(rows) {
        if (!rows) return
        var names = [...new Set(rows.map(function(r) { return r.customer_name }).filter(Boolean))].sort()
        setCustomers(names)
      })
      .catch(function() {})
  }, [])

  var laborTotal = laborHours * LABOR_RATE
  var partsTotal = parts.reduce(function(sum, p) { return sum + (parseFloat(p.qty) * parseFloat(p.unit_price)) }, 0)
  var subtotal = laborTotal + partsTotal

  function addCatalogPart(cat) {
    var existing = parts.findIndex(function(p) { return p.code === cat.code })
    if (existing >= 0) {
      setParts(parts.map(function(p, i) {
        if (i === existing) { var n = Object.assign({}, p); n.qty = (parseFloat(n.qty) || 0) + 1; return n }
        return p
      }))
    } else {
      setParts(parts.concat([{ code: cat.code, description: cat.description, qty: 1, unit_price: cat.price }]))
    }
    setShowCatalog(false)
    setPartSearch('')
  }

  function addCustomPart() {
    setParts(parts.concat([{ code: '', description: '', qty: 1, unit_price: 0 }]))
  }

  function updatePart(i, field, value) {
    setParts(parts.map(function(p, idx) {
      if (idx === i) { var n = Object.assign({}, p); n[field] = value; return n }
      return p
    }))
  }

  function removePart(i) {
    setParts(parts.filter(function(_, idx) { return idx !== i }))
  }

  var filteredCatalog = partSearch
    ? PARTS_CATALOG.filter(function(p) { return p.description.toLowerCase().includes(partSearch.toLowerCase()) || p.code.includes(partSearch) })
    : PARTS_CATALOG

  async function submitQuote() {
    var cn = addingNew ? newCustomer.trim() : customerName
    if (!cn) { toast.warning('Please select or enter a customer name'); return }
    if (!customerEmail) { toast.warning('Please enter customer email to send quote'); return }
    setSending(true)
    try {
      // Save to DB
      var saved = await supaRest('quotes', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: cn,
          customer_email: customerEmail,
          location_name: locationName,
          contact: contact,
          created_by: user.id,
          status: 'sent',
          labor_hours: laborHours,
          labor_rate: LABOR_RATE,
          parts: parts,
          notes: notes,
          subtotal: subtotal,
          total: subtotal,
          updated_at: new Date().toISOString()
        })
      })
      var quoteId = saved && saved[0] ? saved[0].id : null
      // Send email with PDF
      var res = await fetch('/api/send-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getAuthToken() || '') },
        body: JSON.stringify({
          quoteId: quoteId,
          customerName: cn,
          customerEmail: customerEmail,
          locationName: locationName,
          contact: contact,
          laborHours: laborHours,
          laborRate: LABOR_RATE,
          parts: parts,
          notes: notes,
          subtotal: subtotal,
          total: subtotal,
          createdBy: user.email
        })
      })
      if (!res.ok) throw new Error('Failed to send quote')
      toast.success('Quote sent to ' + customerEmail + '!')
      navigate('/submissions')
    } catch(e) {
      toast.error('Error: ' + e.message)
    }
    setSending(false)
  }

  var inputStyle = { border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 12px', fontSize: 14, width: '100%', boxSizing: 'border-box' }
  var labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }
  var sectionStyle = { background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 20 }

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', fontFamily: 'system-ui,sans-serif' }}>
      <NavBar user={user} isAdmin={isAdmin} onLogout={handleLogout} loggingOut={loggingOut} />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a2332', marginBottom: 20 }}>New Customer Quote</h1>

        {/* Customer Info */}
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#1a2332' }}>Customer Information</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Customer Name</label>
              {!addingNew ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={customerName} onChange={function(e) { setCustomerName(e.target.value) }} style={Object.assign({}, inputStyle, { flex: 1 })}>
                    <option value="">Select customer...</option>
                    {customers.map(function(c) { return <option key={c} value={c}>{c}</option> })}
                  </select>
                  <button onClick={function() { setAddingNew(true) }} style={{ padding: '8px 14px', background: '#e5e7eb', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ New</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={newCustomer} onChange={function(e) { setNewCustomer(e.target.value) }} placeholder="Enter new customer name" style={Object.assign({}, inputStyle, { flex: 1 })} />
                  <button onClick={function() { setAddingNew(false) }} style={{ padding: '8px 14px', background: '#e5e7eb', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>Customer Email (for PDF delivery)</label>
              <input type="email" value={customerEmail} onChange={function(e) { setCustomerEmail(e.target.value) }} placeholder="customer@example.com" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Location / Site</label>
              <input value={locationName} onChange={function(e) { setLocationName(e.target.value) }} placeholder="Site name" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Contact Person</label>
              <input value={contact} onChange={function(e) { setContact(e.target.value) }} placeholder="Contact name" style={inputStyle} />
            </div>
          </div>
        </div>

        {/* Labor */}
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#1a2332' }}>Labor</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div>
              <label style={labelStyle}>Estimated Hours</label>
              <input type="number" value={laborHours} onChange={function(e) { setLaborHours(parseFloat(e.target.value) || 0) }} style={Object.assign({}, inputStyle, { width: 120 })} />
            </div>
            <div style={{ paddingTop: 20, color: '#6b7280', fontSize: 14 }}>x ${LABOR_RATE}/hr =</div>
            <div style={{ paddingTop: 20, fontSize: 18, fontWeight: 700, color: '#1a56db' }}>${(laborTotal).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div>
          </div>
        </div>

        {/* Parts */}
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1a2332' }}>Parts</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={function() { setShowCatalog(!showCatalog) }} style={{ background: '#1a56db', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ From Catalog</button>
              <button onClick={addCustomPart} style={{ background: '#6b7280', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ Custom Part</button>
            </div>
          </div>

          {showCatalog && (
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <input value={partSearch} onChange={function(e) { setPartSearch(e.target.value) }} placeholder="Search parts by name or code..." style={Object.assign({}, inputStyle, { marginBottom: 12 })} />
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {filteredCatalog.map(function(p) {
                  return (
                    <div key={p.code} onClick={function() { addCatalogPart(p) }} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', cursor: 'pointer', borderRadius: 4, marginBottom: 2 }} onMouseEnter={function(e) { e.currentTarget.style.background='#e0e7ff' }} onMouseLeave={function(e) { e.currentTarget.style.background='' }}>
                      <span style={{ fontSize: 13 }}><strong>{p.code}</strong> — {p.description}</span>
                      <span style={{ fontSize: 13, color: '#1a56db', fontWeight: 700 }}>${p.price.toFixed(2)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {parts.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: '8px 6px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#4b5563' }}>Code</th>
                  <th style={{ padding: '8px 6px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#4b5563' }}>Description</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#4b5563' }}>Qty</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#4b5563' }}>Unit Price</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#4b5563' }}>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {parts.map(function(p, i) {
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '6px 4px' }}><input value={p.code || ''} onChange={function(e) { updatePart(i, 'code', e.target.value) }} style={{ border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 6px', fontSize: 12, width: 80 }} /></td>
                      <td style={{ padding: '6px 4px' }}><input value={p.description || ''} onChange={function(e) { updatePart(i, 'description', e.target.value) }} style={{ border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 6px', fontSize: 12, width: '100%', minWidth: 200 }} /></td>
                      <td style={{ padding: '6px 4px', textAlign: 'center' }}><input type="number" value={p.qty || 1} onChange={function(e) { updatePart(i, 'qty', parseFloat(e.target.value) || 0) }} style={{ border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 6px', fontSize: 12, width: 60, textAlign: 'center' }} /></td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}><input type="number" value={p.unit_price || 0} onChange={function(e) { updatePart(i, 'unit_price', parseFloat(e.target.value) || 0) }} style={{ border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 6px', fontSize: 12, width: 90, textAlign: 'right' }} /></td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 600 }}>${((parseFloat(p.qty)||0) * (parseFloat(p.unit_price)||0)).toFixed(2)}</td>
                      <td style={{ padding: '6px 4px' }}><button onClick={function() { removePart(i) }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 700 }}>X</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {parts.length === 0 && <p style={{ color: '#9ca3af', fontSize: 13 }}>No parts added yet.</p>}
        </div>

        {/* Notes */}
        <div style={sectionStyle}>
          <label style={labelStyle}>Notes / Scope of Work</label>
          <textarea value={notes} onChange={function(e) { setNotes(e.target.value) }} rows={4} placeholder="Describe the work to be performed..." style={Object.assign({}, inputStyle, { resize: 'vertical' })} />
        </div>

        {/* Totals */}
        <div style={Object.assign({}, sectionStyle, { background: '#1a2332', color: '#fff' })}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ fontSize: 14 }}>Labor: <strong>${laborTotal.toFixed(2)}</strong></div>
            <div style={{ fontSize: 14 }}>Parts: <strong>${partsTotal.toFixed(2)}</strong></div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#f59e0b' }}>TOTAL: ${subtotal.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button onClick={function() { navigate('/submissions') }} style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 6, padding: '12px 24px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Cancel</button>
          <button onClick={submitQuote} disabled={sending} style={{ background: sending ? '#9ca3af' : '#1a56db', color: '#fff', border: 'none', borderRadius: 6, padding: '12px 28px', fontWeight: 700, fontSize: 15, cursor: sending ? 'not-allowed' : 'pointer' }}>
            {sending ? 'Sending...' : 'Send Quote to Customer'}
          </button>
        </div>
      </div>
    </div>
  )
}
