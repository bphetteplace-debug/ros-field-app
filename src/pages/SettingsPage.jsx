import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { fetchSettings, saveSettings, DEFAULT_CUSTOMERS, DEFAULT_TRUCKS, DEFAULT_TECHS } from '../lib/submissions'

// Editable list with add-new input and per-item remove buttons
function EditableList({ title, items, onSave, placeholder }) {
  const [list, setList] = useState(items)
  const [newEntry, setNewEntry] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { setList(items); setDirty(false) }, [items])

  const markDirty = (updated) => { setList(updated); setDirty(true) }

  const handleAdd = () => {
    const trimmed = newEntry.trim()
    if (!trimmed || list.includes(trimmed)) return
    markDirty([...list, trimmed])
    setNewEntry('')
    inputRef.current && inputRef.current.focus()
  }

  const handleRemove = (idx) => {
    markDirty(list.filter((_, i) => i !== idx))
  }

  const handleSave = async () => {
    setSaving(true)
    await onSave(list)
    setSaving(false)
    setDirty(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
  }

  const inp = { padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box', fontFamily: 'system-ui,sans-serif' }

  return (
    <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
      {/* Section header */}
      <div style={{ background: '#1a2332', color: '#fff', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{title} <span style={{ fontWeight: 400, fontSize: 11, color: '#aaa' }}>({list.length})</span></span>
        {dirty && (
          <button onClick={handleSave} disabled={saving} style={{ background: saving ? '#aaa' : '#16a34a', color: '#fff', border: 'none', borderRadius: 5, padding: '4px 14px', fontSize: 12, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </div>

      <div style={{ padding: 14 }}>
        {/* Current items as chips with remove button */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: list.length > 0 ? 12 : 0 }}>
          {list.map((item, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: '#f0f2f5', borderRadius: 20, fontSize: 13, fontWeight: 500, color: '#1a2332', border: '1px solid #dce0e8' }}>
              {item}
              <button
                type="button"
                onClick={() => handleRemove(i)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 14, lineHeight: 1, padding: '0 0 0 2px', display: 'flex', alignItems: 'center' }}
                title={'Remove ' + item}
              >
                ×
              </button>
            </span>
          ))}
          {list.length === 0 && (
            <span style={{ fontSize: 12, color: '#aaa', fontStyle: 'italic' }}>No entries — add one below</span>
          )}
        </div>

        {/* Add new entry */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            style={{ ...inp, flex: 1 }}
            value={newEntry}
            onChange={e => setNewEntry(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newEntry.trim()}
            style={{ padding: '8px 16px', background: newEntry.trim() ? '#e65c00' : '#ddd', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: newEntry.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}
          >
            + Add
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>Press Enter or click + Add. Click × on a name to remove it. Hit Save Changes when done.</div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [customers, setCustomers] = useState(DEFAULT_CUSTOMERS)
  const [trucks, setTrucks] = useState(DEFAULT_TRUCKS)
  const [techs, setTechs] = useState(DEFAULT_TECHS)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAdmin) { navigate('/submissions'); return }
    fetchSettings().then(s => {
      if (s) {
        if (s.customers) setCustomers(s.customers)
        if (s.trucks) setTrucks(s.trucks)
        if (s.techs) setTechs(s.techs)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [isAdmin, navigate])

  const save = async (key, value, setter) => {
    try {
      await saveSettings(key, value)
      setter(value)
      setStatus('Saved!')
      setTimeout(() => setStatus(''), 2500)
    } catch (e) {
      setStatus('Error: ' + e.message)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading settings...</div>

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '16px 16px 60px', fontFamily: 'system-ui,sans-serif', background: '#f0f2f5', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ background: '#1a2332', borderRadius: 8, padding: '16px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: '#e65c00', fontWeight: 800, fontSize: 17 }}>App Settings</div>
          <div style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>Manage lists used in forms (admin only)</div>
        </div>
        <button onClick={() => navigate('/admin')} style={{ color: '#aaa', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer' }}>
          Back to Admin
        </button>
      </div>

      {status && (
        <div style={{ background: status.startsWith('Error') ? '#fef2f2' : '#f0fdf4', border: '1px solid ' + (status.startsWith('Error') ? '#fca5a5' : '#86efac'), borderRadius: 6, padding: '8px 14px', marginBottom: 12, fontSize: 13, fontWeight: 700, color: status.startsWith('Error') ? '#dc2626' : '#15803d' }}>
          {status}
        </div>
      )}

      <EditableList
        title="Customers"
        items={customers}
        placeholder="Add customer name..."
        onSave={v => save('customers', v, setCustomers)}
      />
      <EditableList
        title="Truck Numbers"
        items={trucks}
        placeholder="Add truck number (e.g. 0008)..."
        onSave={v => save('trucks', v, setTrucks)}
      />
      <EditableList
        title="Field Technicians"
        items={techs}
        placeholder="Add technician full name..."
        onSave={v => save('techs', v, setTechs)}
      />
    </div>
  )
}
