import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../lib/auth'
import NavBar from '../components/NavBar'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function supaRest(path, opts) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
  }, opts))
  if (!res.ok) { var e = await res.json(); throw new Error(e.message || res.statusText) }
  return res.status === 204 ? null : res.json()
}

export default function InventoryPage() {
  var { user, isAdmin, logout } = useAuth()
  var [tab, setTab] = useState('truck')
  var [parts, setParts] = useState([])
  var [saving, setSaving] = useState(false)
  var [saved, setSaved] = useState(false)
  var [loggingOut, setLoggingOut] = useState(false)
  var [allInventories, setAllInventories] = useState([])
  var [selectedTech, setSelectedTech] = useState(null)

  var handleLogout = useCallback(async function() {
    setLoggingOut(true)
    await logout()
  }, [logout])

  // Load inventory for current tab
  useEffect(function() {
    if (!user) return
    loadInventory()
  }, [user, tab, selectedTech])

  async function loadInventory() {
    try {
      var targetOwner = (tab === 'truck' && !isAdmin) ? user.id : (selectedTech || user.id)
      if (isAdmin && tab === 'truck' && selectedTech) {
        targetOwner = selectedTech
      } else if (tab === 'shop') {
        // Shop: load the single shop record (owned by first admin or generic)
        var shopRec = await supaRest('inventory?inventory_type=eq.shop&select=*', {})
        if (shopRec && shopRec.length > 0) {
          setParts(shopRec[0].parts || [])
        } else {
          setParts([])
        }
        return
      }
      var recs = await supaRest('inventory?owner_id=eq.' + targetOwner + '&inventory_type=eq.truck&select=*', {})
      if (recs && recs.length > 0) {
        setParts(recs[0].parts || [])
      } else {
        setParts([])
      }
    } catch(e) {
      console.error('Load inventory error:', e)
    }
  }

  // Load all techs inventory if admin
  useEffect(function() {
    if (!isAdmin) return
    supaRest('inventory?inventory_type=eq.truck&select=*', {})
      .then(function(recs) { setAllInventories(recs || []) })
      .catch(function(e) { console.error(e) })
  }, [isAdmin])

  async function saveParts() {
    setSaving(true)
    try {
      var ownerId = user.id
      var invType = tab
      // For truck, use current user id (techs) or selectedTech (admin viewing)
      if (tab === 'truck' && isAdmin && selectedTech) ownerId = selectedTech
      // Upsert
      await supaRest('inventory', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ owner_id: ownerId, inventory_type: invType, parts: parts, updated_at: new Date().toISOString() })
      })
      setSaved(true)
      setTimeout(function() { setSaved(false) }, 2000)
    } catch(e) {
      alert('Save error: ' + e.message)
    }
    setSaving(false)
  }

  function updatePart(i, field, value) {
    var updated = parts.map(function(p, idx) {
      if (idx === i) { var n = Object.assign({}, p); n[field] = value; return n; }
      return p
    })
    setParts(updated)
  }

  function addPart() {
    setParts(parts.concat([{ code: '', description: '', qty: 0, min_qty: 0, unit_cost: 0, location: '' }]))
  }

  function removePart(i) {
    setParts(parts.filter(function(_, idx) { return idx !== i }))
  }

  var inputStyle = { border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 6px', fontSize: 13, width: '100%' }
  var thStyle = { padding: '8px 6px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#4b5563', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }
  var tdStyle = { padding: '6px 4px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle' }

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', fontFamily: 'system-ui,sans-serif' }}>
      <NavBar user={user} isAdmin={isAdmin} onLogout={handleLogout} loggingOut={loggingOut} />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a2332' }}>Inventory Management</h1>
          <button onClick={saveParts} disabled={saving} style={{ background: saving ? '#9ca3af' : '#1a56db', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Inventory'}
          </button>
        </div>

        {/* TABS */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button onClick={function() { setTab('truck') }} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', background: tab === 'truck' ? '#1a56db' : '#e5e7eb', color: tab === 'truck' ? '#fff' : '#374151' }}>My Truck</button>
          {isAdmin && (
            <button onClick={function() { setTab('shop') }} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', background: tab === 'shop' ? '#7c3aed' : '#e5e7eb', color: tab === 'shop' ? '#fff' : '#374151' }}>Shop Inventory</button>
          )}
        </div>

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Part Code</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Qty on Hand</th>
                <th style={thStyle}>Min Qty</th>
                <th style={thStyle}>Unit Cost</th>
                <th style={thStyle}>Location</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {parts.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>No parts yet. Click Add Part to get started.</td></tr>
              )}
              {parts.map(function(p, i) {
                return (
                  <tr key={i} style={{ background: p.qty <= p.min_qty && p.min_qty > 0 ? '#fef9c3' : '' }}>
                    <td style={tdStyle}><input value={p.code || ''} onChange={function(e) { updatePart(i, 'code', e.target.value) }} placeholder="e.g. 41000" style={inputStyle} /></td>
                    <td style={tdStyle}><input value={p.description || ''} onChange={function(e) { updatePart(i, 'description', e.target.value) }} placeholder="Part description" style={Object.assign({}, inputStyle, { minWidth: 200 })} /></td>
                    <td style={tdStyle}><input type="number" value={p.qty || 0} onChange={function(e) { updatePart(i, 'qty', parseFloat(e.target.value) || 0) }} style={Object.assign({}, inputStyle, { width: 70 })} /></td>
                    <td style={tdStyle}><input type="number" value={p.min_qty || 0} onChange={function(e) { updatePart(i, 'min_qty', parseFloat(e.target.value) || 0) }} style={Object.assign({}, inputStyle, { width: 70 })} /></td>
                    <td style={tdStyle}><input type="number" value={p.unit_cost || 0} onChange={function(e) { updatePart(i, 'unit_cost', parseFloat(e.target.value) || 0) }} style={Object.assign({}, inputStyle, { width: 90 })} /></td>
                    <td style={tdStyle}><input value={p.location || ''} onChange={function(e) { updatePart(i, 'location', e.target.value) }} placeholder="Shelf/bin" style={Object.assign({}, inputStyle, { width: 100 })} /></td>
                    <td style={tdStyle}><button onClick={function() { removePart(i) }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>X</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb' }}>
            <button onClick={addPart} style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>+ Add Part</button>
            {parts.filter(function(p) { return p.qty <= p.min_qty && p.min_qty > 0 }).length > 0 && (
              <span style={{ marginLeft: 16, color: '#d97706', fontWeight: 700, fontSize: 13 }}>⚠ {parts.filter(function(p) { return p.qty <= p.min_qty && p.min_qty > 0 }).length} part(s) at or below minimum quantity</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
