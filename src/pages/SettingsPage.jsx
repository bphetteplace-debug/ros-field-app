import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { fetchSettings, saveSettings, DEFAULT_CUSTOMERS, DEFAULT_TRUCKS, DEFAULT_TECHS } from '../lib/submissions'

// Generic editable list component
function EditableList({ title, items, onSave, placeholder }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(items.join('\n'))
  const [saving, setSaving]   = useState(false)

  useEffect(() => { setDraft(items.join('\n')) }, [items])

  const handleSave = async () => {
    setSaving(true)
    const parsed = draft.split('\n').map(s => s.trim()).filter(Boolean)
    await onSave(parsed)
    setSaving(false)
    setEditing(false)
  }

  const inp = { padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14,
    width: '100%', boxSizing: 'border-box', fontFamily: 'system-ui,sans-serif' }

  return (
    <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
      <div style={{ background: '#1a2332', color: '#fff', padding: '10px 14px', display: 'flex',
        justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
        {!editing && (
          <button onClick={() => setEditing(true)}
            style={{ background: '#e65c00', color: '#fff', border: 'none', borderRadius: 5,
              padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Edit
          </button>
        )}
      </div>
      <div style={{ padding: 14 }}>
        {editing ? (
          <>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>One entry per line</div>
            <textarea style={{ ...inp, minHeight: 100, resize: 'vertical' }} value={draft}
              onChange={e => setDraft(e.target.value)} placeholder={placeholder} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={handleSave} disabled={saving}
                style={{ padding: '8px 20px', background: saving ? '#ccc' : '#16a34a', color: '#fff',
                  border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setDraft(items.join('\n')); setEditing(false) }}
                style={{ padding: '8px 16px', background: '#f5f5f5', border: '1px solid #ddd',
                  borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {items.map((item, i) => (
              <span key={i} style={{ padding: '4px 12px', background: '#f0f2f5', borderRadius: 16,
                fontSize: 13, fontWeight: 500, color: '#1a2332' }}>{item}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { isAdmin } = useAuth()
  const navigate    = useNavigate()
  const [customers, setCustomers] = useState(DEFAULT_CUSTOMERS)
  const [trucks,    setTrucks]    = useState(DEFAULT_TRUCKS)
  const [techs,     setTechs]     = useState(DEFAULT_TECHS)
  const [status,    setStatus]    = useState('')
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    if (!isAdmin) { navigate('/submissions'); return }
    fetchSettings().then(s => {
      if (s) {
        if (s.customers) setCustomers(s.customers)
        if (s.trucks)    setTrucks(s.trucks)
        if (s.techs)     setTechs(s.techs)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [isAdmin, navigate])

  const save = async (key, value, setter) => {
    try {
      await saveSettings(key, value)
      setter(value)
      setStatus('Saved!')
      setTimeout(() => setStatus(''), 2000)
    } catch (e) {
      setStatus('Error: ' + e.message)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading settings...</div>

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '16px 16px 60px',
      fontFamily: 'system-ui,sans-serif', background: '#f0f2f5', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ background: '#1a2332', borderRadius: 8, padding: '16px 18px', marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: '#e65c00', fontWeight: 800, fontSize: 17 }}>App Settings</div>
          <div style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>Manage lists used in forms (admin only)</div>
        </div>
        <button onClick={() => navigate('/admin')}
          style={{ color: '#aaa', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer' }}>
          Back to Admin
        </button>
      </div>

      {status && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6,
          padding: '8px 14px', marginBottom: 12, fontSize: 13, fontWeight: 700, color: '#15803d' }}>
          {status}
        </div>
      )}

      {/* SETUP NOTE */}
      <div style={{ background: '#fffbe6', border: '1px solid #f0c040', borderRadius: 6,
        padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#7a5c00' }}>
        <strong>First-time setup:</strong> These settings are stored in a Supabase table called{' '}
        <code>app_settings</code>. If you see the defaults, run the setup SQL first (see DEPLOYMENT.md).
      </div>

      <EditableList
        title='Customers'
        items={customers}
        placeholder='One customer name per line...'
        onSave={v => save('customers', v, setCustomers)}
      />
      <EditableList
        title='Truck Numbers'
        items={trucks}
        placeholder='One truck number per line (e.g. 0001)...'
        onSave={v => save('trucks', v, setTrucks)}
      />
      <EditableList
        title='Field Technicians'
        items={techs}
        placeholder='One technician full name per line...'
        onSave={v => save('techs', v, setTechs)}
      />
    </div>
  )
}
