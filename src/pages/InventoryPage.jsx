import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../lib/auth'
import NavBar from '../components/NavBar'
import { fetchPartsCatalog, getAuthToken } from '../lib/submissions'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function supaRest(path, opts) {
  opts = opts || {}
  var token = getAuthToken()
  var headers = Object.assign({
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY),
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  }, opts.headers || {})
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, opts, { headers: headers }))
  if (!res.ok) { var e = await res.json(); throw new Error(e.message || res.statusText) }
  return res.status === 204 ? null : res.json()
}

// Autocomplete input that searches parts catalog by code or description
function PartAutocomplete({ value, field, rowIndex, catalog, onSelect, onChange, placeholder, style, isDemo }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value || '')
  const ref = useRef(null)

  // Sync external value changes (e.g. when another field triggers a fill)
  useEffect(() => { setQuery(value || '') }, [value])

  const filtered = query.length >= 1
    ? catalog.filter(p => {
        const q = query.toLowerCase()
        return (p.code || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
      }).slice(0, 12)
    : []

  function handleChange(e) {
    const v = e.target.value
    setQuery(v)
    onChange(rowIndex, field, v)
    setOpen(true)
  }

  function handleSelect(part) {
    setQuery(field === 'code' ? (part.code || '') : part.description)
    setOpen(false)
    onSelect(rowIndex, part)
  }

  function handleBlur(e) {
    // Delay so click on dropdown registers first
    setTimeout(() => setOpen(false), 150)
  }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <input
        value={query}
        onChange={handleChange}
        onFocus={() => query.length >= 1 && setOpen(true)}
        onBlur={handleBlur}
        placeholder={placeholder}
        style={style}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 999,
          background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.13)', minWidth: 320, maxHeight: 260,
          overflowY: 'auto', marginTop: 2
        }}>
          {filtered.map((part, idx) => (
            <div
              key={part.id || idx}
              onMouseDown={() => handleSelect(part)}
              style={{
                padding: '7px 12px', cursor: 'pointer', fontSize: 13,
                borderBottom: '1px solid #f3f4f6',
                display: 'flex', gap: 10, alignItems: 'center'
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}
            >
              <span style={{ color: '#6b7280', fontSize: 11, fontWeight: 700, minWidth: 48 }}>{part.code || '—'}</span>
              <span style={{ flex: 1, color: '#1a2332', fontWeight: 500 }}>{part.description}</span>
              {!isDemo && part.price > 0 && (
                <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 12 }}>${parseFloat(part.price).toFixed(2)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function InventoryPage() {
  var { user, isAdmin, isDemo, signOut } = useAuth()
  var [tab, setTab] = useState('truck')
  var [parts, setParts] = useState([])
  var [saving, setSaving] = useState(false)
  var [saved, setSaved] = useState(false)
  var [loggingOut, setLoggingOut] = useState(false)
  var [allInventories, setAllInventories] = useState([])
  var [selectedTech, setSelectedTech] = useState(null)
  var [techProfiles, setTechProfiles] = useState([])
  var [techsLoading, setTechsLoading] = useState(false)
  var [techsError, setTechsError] = useState(null)
  var [catalog, setCatalog] = useState([])

  var handleLogout = useCallback(async function() {
    setLoggingOut(true)
    try { await signOut() } catch(e) {}
    setLoggingOut(false)
  }, [signOut])

  // Load parts catalog for autocomplete
  useEffect(function() {
    fetchPartsCatalog().then(setCatalog).catch(() => {})
  }, [])

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

  // Load tech profiles for admin's tech-selector dropdown
  useEffect(function() {
    if (!isAdmin) return
    setTechsLoading(true); setTechsError(null)
    supaRest('profiles?select=id,full_name,role&order=full_name.asc', {})
      .then(function(rows) { setTechProfiles(rows || []); setTechsLoading(false) })
      .catch(function(e) {
        console.warn('Load tech profiles error:', e)
        setTechsError(e.message || 'Failed to load technicians')
        setTechsLoading(false)
      })
  }, [isAdmin])

  async function saveParts() {
    setSaving(true)
    try {
      var ownerId = user.id
      var invType = tab
      if (tab === 'truck' && isAdmin && selectedTech) ownerId = selectedTech
      await supaRest('inventory', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
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
    setParts(function(prev) {
      return prev.map(function(p, idx) {
        if (idx !== i) return p
        var n = Object.assign({}, p)
        n[field] = value
        return n
      })
    })
  }

  // Called when user selects a part from autocomplete — fills code, description, unit_cost
  function selectCatalogPart(i, part) {
    setParts(function(prev) {
      return prev.map(function(p, idx) {
        if (idx !== i) return p
        return Object.assign({}, p, {
          code: part.code || p.code,
          description: part.description || p.description,
          unit_cost: part.price ? parseFloat(part.price) : p.unit_cost
        })
      })
    })
  }

  function addPart() {
    setParts(parts.concat([{ code: '', description: '', qty: 0, min_qty: 0, unit_cost: 0, location: '' }]))
  }

  function removePart(i) {
    var p = parts[i]
    var label = (p && (p.code || p.description)) ? '"' + (p.code || p.description) + '"' : 'this part'
    if (!window.confirm('Remove ' + label + ' from the inventory list?\n\nThis only stages the change — your inventory is not updated until you click Save Inventory.')) return
    setParts(parts.filter(function(_, idx) { return idx !== i }))
  }

  var inputStyle = { border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 6px', fontSize: 13, width: '100%' }
  var thStyle = { padding: '8px 6px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#4b5563', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }
  var tdStyle = { padding: '6px 4px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle' }

  var lowCount = parts.filter(function(p) { return p.qty <= p.min_qty && p.min_qty > 0 }).length

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
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button onClick={function() { setTab('truck') }} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', background: tab === 'truck' ? '#1a56db' : '#e5e7eb', color: tab === 'truck' ? '#fff' : '#374151' }}>My Truck</button>
          {isAdmin && (
            <button onClick={function() { setTab('shop') }} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', background: tab === 'shop' ? '#7c3aed' : '#e5e7eb', color: tab === 'shop' ? '#fff' : '#374151' }}>Shop Inventory</button>
          )}
        </div>

        {/* ADMIN TECH SELECTOR */}
        {isAdmin && tab === 'truck' && (
          <div style={{ marginBottom: 14, padding: '10px 14px', background: selectedTech ? '#fef3c7' : '#fff', border: '1px solid ' + (selectedTech ? '#fcd34d' : '#e5e7eb'), borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1a2332' }}>👤 Viewing truck:</span>
            <select
              value={selectedTech || ''}
              onChange={function(e) { setSelectedTech(e.target.value || null) }}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, fontWeight: 600, minWidth: 220, background: '#fff', cursor: 'pointer' }}
            >
              <option value="">My Truck (self)</option>
              {techProfiles
                .filter(function(p) { return p.id !== (user && user.id) })
                .map(function(p) {
                  return <option key={p.id} value={p.id}>{p.full_name || ('Tech ' + String(p.id).slice(0, 8))}</option>
                })}
            </select>
            {selectedTech && (
              <button
                onClick={function() { setSelectedTech(null) }}
                style={{ background: 'none', border: '1px solid #92400e', color: '#92400e', borderRadius: 4, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              >
                ← Back to my truck
              </button>
            )}
            {selectedTech && (
              <span style={{ fontSize: 12, color: '#92400e', fontWeight: 600 }}>
                ⚠ Editing another tech's inventory — changes save to their truck.
              </span>
            )}
            {techsLoading && (
              <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>(loading techs…)</span>
            )}
            {!techsLoading && techsError && (
              <span style={{ fontSize: 12, color: '#b91c1c' }} title={techsError}>⚠ Couldn't load tech list</span>
            )}
          </div>
        )}

        {catalog.length > 0 && (
          <div style={{ background: '#e0f2fe', border: '1px solid #7dd3fc', borderRadius: 8, padding: '8px 14px', marginBottom: 14, fontSize: 13, color: '#0369a1', fontWeight: 600 }}>
            💡 Start typing a part name or code — results from the parts catalog will appear automatically.
          </div>
        )}

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'visible' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Part Code</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Qty on Hand</th>
                <th style={thStyle}>Min Qty</th>
                {!isDemo && <th style={thStyle}>Unit Cost</th>}
                <th style={thStyle}>Location</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {parts.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>No parts yet. Click Add Part to get started.</td></tr>
              )}
              {parts.map(function(p, i) {
                var isLow = p.qty <= p.min_qty && p.min_qty > 0
                return (
                  <tr key={i} style={{ background: isLow ? '#fef9c3' : '' }}>
                    <td style={Object.assign({}, tdStyle, { minWidth: 110 })}>
                      <PartAutocomplete
                        value={p.code || ''}
                        field="code"
                        rowIndex={i}
                        catalog={catalog}
                        onSelect={selectCatalogPart}
                        onChange={updatePart}
                        placeholder="e.g. 41000"
                        style={inputStyle}
                        isDemo={isDemo}
                      />
                    </td>
                    <td style={Object.assign({}, tdStyle, { minWidth: 220 })}>
                      <PartAutocomplete
                        value={p.description || ''}
                        field="description"
                        rowIndex={i}
                        catalog={catalog}
                        onSelect={selectCatalogPart}
                        onChange={updatePart}
                        placeholder="Part description"
                        style={Object.assign({}, inputStyle, { minWidth: 200 })}
                        isDemo={isDemo}
                      />
                    </td>
                    <td style={tdStyle}><input type="number" value={p.qty || 0} onChange={function(e) { updatePart(i, 'qty', parseFloat(e.target.value) || 0) }} style={Object.assign({}, inputStyle, { width: 70 })} /></td>
                    <td style={tdStyle}><input type="number" value={p.min_qty || 0} onChange={function(e) { updatePart(i, 'min_qty', parseFloat(e.target.value) || 0) }} style={Object.assign({}, inputStyle, { width: 70 })} /></td>
                    {!isDemo && <td style={tdStyle}><input type="number" value={p.unit_cost || 0} onChange={function(e) { updatePart(i, 'unit_cost', parseFloat(e.target.value) || 0) }} style={Object.assign({}, inputStyle, { width: 90 })} /></td>}
                    <td style={tdStyle}><input value={p.location || ''} onChange={function(e) { updatePart(i, 'location', e.target.value) }} placeholder="Shelf/bin" style={Object.assign({}, inputStyle, { width: 100 })} /></td>
                    <td style={tdStyle}><button onClick={function() { removePart(i) }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>✕</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb' }}>
            <button onClick={addPart} style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>+ Add Part</button>
            {lowCount > 0 && (
              <span style={{ marginLeft: 16, color: '#d97706', fontWeight: 700, fontSize: 13 }}>⚠ {lowCount} part(s) at or below minimum quantity</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
