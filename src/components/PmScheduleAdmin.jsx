// PmScheduleAdmin — admin tab for the multi-customer monthly PM
// schedule. Reads/writes pm_schedule_entries via src/lib/pmSchedule.js.
// Designed for the Diamondback workbook shape but reusable for any
// future customer that drops in a similar CSV.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { toast } from '../lib/toast'
import { logAudit } from '../lib/submissions'
import {
  PM_STATUSES,
  PM_STATUS_STYLES,
  fetchPmScheduleCustomers,
  fetchPmScheduleEntries,
  createPmScheduleEntry,
  updatePmScheduleEntry,
  deletePmScheduleEntry,
} from '../lib/pmSchedule'

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15, 31, 56, 0.65)',
  zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16,
}
const panel = {
  background: '#fff', borderRadius: 14, maxWidth: 560, width: '100%',
  boxShadow: '0 12px 40px rgba(0,0,0,0.3)', overflow: 'hidden',
  maxHeight: '90vh', display: 'flex', flexDirection: 'column',
}

const inp = { border: '1px solid #cbd5e1', borderRadius: 6, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }
const lbl = { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'block' }

function StatusPill({ value, onChange, disabled }) {
  const s = PM_STATUS_STYLES[value] || PM_STATUS_STYLES['Open']
  if (!onChange) {
    return (
      <span style={{ background: s.bg, color: s.fg, fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 12, letterSpacing: 0.3, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />
        {value || 'Open'}
      </span>
    )
  }
  return (
    <select
      value={value || 'Open'}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      style={{
        background: s.bg, color: s.fg, border: '1px solid ' + s.dot, borderRadius: 12,
        fontSize: 11, fontWeight: 800, padding: '3px 22px 3px 10px', letterSpacing: 0.3,
        cursor: disabled ? 'wait' : 'pointer', appearance: 'menulist', fontFamily: 'inherit',
      }}
    >
      {PM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}

function EditEntryModal({ entry, customerOptions, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(entry)
  const [saving, setSaving] = useState(false)

  useEffect(() => setForm(entry), [entry?.id])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.location_name?.trim()) { toast.warning('Location is required'); return }
    if (!form.customer?.trim()) { toast.warning('Customer is required'); return }
    setSaving(true)
    try {
      await onSave(form)
      onClose()
    } catch (e) {
      toast.error('Save failed: ' + (e.message || e))
    } finally {
      setSaving(false)
    }
  }

  if (!entry) return null
  const isNew = !entry.id

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={{ background: '#0f1f38', color: '#fff', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.7, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
              {isNew ? 'New PM entry' : 'Edit PM entry'}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
              {form.location_name || '(new entry)'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ padding: 18, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={lbl}>Customer *</label>
              <input list='customer-options' value={form.customer || ''} onChange={e => set('customer', e.target.value)} style={{ ...inp, width: '100%' }} />
              <datalist id='customer-options'>
                {customerOptions.map(c => <option key={c.name || c} value={c.name || c} />)}
              </datalist>
            </div>
            <div>
              <label style={lbl}>Status</label>
              <StatusPill value={form.status} onChange={(v) => set('status', v)} />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Location Name *</label>
            <input value={form.location_name || ''} onChange={e => set('location_name', e.target.value)} style={{ ...inp, width: '100%' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={lbl}>Service Type</label>
              <input value={form.service_type || ''} onChange={e => set('service_type', e.target.value)} placeholder='Flame Arrestor / Combustor' style={{ ...inp, width: '100%' }} />
            </div>
            <div>
              <label style={lbl}>Area</label>
              <input value={form.area || ''} onChange={e => set('area', e.target.value)} placeholder='Bryant Ranch' style={{ ...inp, width: '100%' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={lbl}>Well Type</label>
              <select value={form.well_type || ''} onChange={e => set('well_type', e.target.value)} style={{ ...inp, width: '100%' }}>
                <option value=''>—</option>
                <option value='Horizontal'>Horizontal</option>
                <option value='Vertical'>Vertical</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Latitude</label>
              <input value={form.latitude ?? ''} onChange={e => set('latitude', e.target.value)} placeholder='31.798183' style={{ ...inp, width: '100%' }} />
            </div>
            <div>
              <label style={lbl}>Longitude</label>
              <input value={form.longitude ?? ''} onChange={e => set('longitude', e.target.value)} placeholder='-102.077259' style={{ ...inp, width: '100%' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={lbl}>Shut-In Date</label>
              <input type='date' value={form.shut_in_date || ''} onChange={e => set('shut_in_date', e.target.value || null)} style={{ ...inp, width: '100%' }} />
            </div>
            <div>
              <label style={lbl}>Date Completed</label>
              <input type='date' value={form.date_completed || ''} onChange={e => set('date_completed', e.target.value || null)} style={{ ...inp, width: '100%' }} />
            </div>
            <div>
              <label style={lbl}>Ticket #</label>
              <input value={form.ticket_number || ''} onChange={e => set('ticket_number', e.target.value)} style={{ ...inp, width: '100%' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={lbl}>Customer Foreman</label>
              <input value={form.foreman || ''} onChange={e => set('foreman', e.target.value)} placeholder='Chris Alvarado' style={{ ...inp, width: '100%' }} />
            </div>
            <div>
              <label style={lbl}>Assets</label>
              <input value={form.assets || ''} onChange={e => set('assets', e.target.value)} placeholder={'2 Arrestors  |  1 60\''} style={{ ...inp, width: '100%' }} />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Notes</label>
            <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={3} style={{ ...inp, width: '100%', resize: 'vertical', minHeight: 60 }} />
          </div>
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div>
            {!isNew && (
              <button
                onClick={() => onDelete(entry)}
                disabled={saving}
                style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 6, padding: '8px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
              >
                🗑️ Delete
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={{ background: 'transparent', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 6, padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving} style={{ background: saving ? '#9ca3af' : '#0f1f38', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 22px', fontWeight: 800, fontSize: 13, cursor: saving ? 'wait' : 'pointer' }}>
              {saving ? 'Saving…' : (isNew ? 'Create' : 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function monthLabel(monthYear) {
  if (!monthYear) return ''
  const [y, m] = monthYear.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function monthOptions() {
  const opts = []
  for (let m = 1; m <= 12; m++) {
    const k = '2026-' + String(m).padStart(2, '0')
    opts.push({ value: k, label: monthLabel(k) })
  }
  return opts
}

function fmtDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const MONTH_OPTIONS = monthOptions()
const DEFAULT_MONTH = (() => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
})()

export default function PmScheduleAdmin() {
  const { user, profile } = useAuth()
  const [customers, setCustomers] = useState([])
  const [customer, setCustomer] = useState('Diamondback')
  const [monthYear, setMonthYear] = useState(DEFAULT_MONTH)
  const [statusFilter, setStatusFilter] = useState('')
  const [foremanFilter, setForemanFilter] = useState('')
  const [search, setSearch] = useState('')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // entry object or null

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchPmScheduleEntries({ customer, monthYear })
      setEntries(list || [])
    } catch (e) {
      console.error('[PmScheduleAdmin] load failed:', e)
      toast.error('Could not load PM schedule: ' + (e.message || e))
    } finally {
      setLoading(false)
    }
  }, [customer, monthYear])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetchPmScheduleCustomers().then(list => {
      setCustomers(list || [])
      if (list && list.length && !list.find(c => c.name === customer)) {
        setCustomer(list[0].name)
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    let pool = entries
    if (statusFilter) pool = pool.filter(e => e.status === statusFilter)
    if (foremanFilter) pool = pool.filter(e => (e.foreman || '') === foremanFilter)
    if (search) {
      const q = search.toLowerCase()
      pool = pool.filter(e =>
        (e.location_name || '').toLowerCase().includes(q) ||
        (e.notes || '').toLowerCase().includes(q) ||
        (e.ticket_number || '').toLowerCase().includes(q) ||
        (e.assets || '').toLowerCase().includes(q)
      )
    }
    return pool
  }, [entries, statusFilter, foremanFilter, search])

  const statusCounts = useMemo(() => {
    const out = {}
    for (const e of entries) out[e.status] = (out[e.status] || 0) + 1
    return out
  }, [entries])

  const foremenInMonth = useMemo(() => {
    const set = new Set()
    for (const e of entries) {
      const f = (e.foreman || '').trim()
      if (f) set.add(f)
    }
    return Array.from(set).sort()
  }, [entries])

  const handleStatusChange = async (entry, newStatus) => {
    const prev = entry.status
    if (prev === newStatus) return
    // Optimistic update
    setEntries(list => list.map(e => e.id === entry.id ? { ...e, status: newStatus } : e))
    try {
      const patch = { status: newStatus }
      // Auto-stamp completion date when flipping to Completed
      if (newStatus === 'Completed' && !entry.date_completed) {
        patch.date_completed = new Date().toISOString().slice(0, 10)
      }
      await updatePmScheduleEntry(entry.id, patch)
      logAudit({
        userId: user?.id, userName: profile?.full_name || user?.email,
        action: 'pm_schedule_status_changed',
        targetType: 'pm_schedule', targetId: entry.id,
        details: { from: prev, to: newStatus, location: entry.location_name, customer: entry.customer },
      })
    } catch (e) {
      toast.error('Update failed: ' + (e.message || e))
      setEntries(list => list.map(x => x.id === entry.id ? { ...x, status: prev } : x))
    }
  }

  const handleSave = async (form) => {
    const payload = {
      customer: form.customer,
      location_name: form.location_name,
      service_type: form.service_type || null,
      area: form.area || null,
      well_type: form.well_type || null,
      latitude: form.latitude !== '' && form.latitude != null ? Number(form.latitude) : null,
      longitude: form.longitude !== '' && form.longitude != null ? Number(form.longitude) : null,
      assets: form.assets || null,
      ticket_number: form.ticket_number || null,
      shut_in_date: form.shut_in_date || null,
      foreman: form.foreman || null,
      status: form.status || 'Needs Scheduling',
      notes: form.notes || null,
      date_completed: form.date_completed || null,
    }
    if (form.id) {
      await updatePmScheduleEntry(form.id, payload)
      logAudit({
        userId: user?.id, userName: profile?.full_name || user?.email,
        action: 'pm_schedule_updated', targetType: 'pm_schedule', targetId: form.id,
        details: { location: payload.location_name, customer: payload.customer },
      })
    } else {
      const row = await createPmScheduleEntry(payload)
      logAudit({
        userId: user?.id, userName: profile?.full_name || user?.email,
        action: 'pm_schedule_created', targetType: 'pm_schedule', targetId: row?.id,
        details: { location: payload.location_name, customer: payload.customer },
      })
    }
    await load()
    toast.success(form.id ? 'Entry updated' : 'Entry created')
  }

  const handleDelete = async (entry) => {
    if (!window.confirm('Delete this entry?\n\n' + entry.location_name + '\n' + (entry.shut_in_date || ''))) return
    try {
      await deletePmScheduleEntry(entry.id)
      logAudit({
        userId: user?.id, userName: profile?.full_name || user?.email,
        action: 'pm_schedule_deleted', targetType: 'pm_schedule', targetId: entry.id,
        details: { location: entry.location_name, customer: entry.customer },
      })
      setEntries(list => list.filter(e => e.id !== entry.id))
      setEditing(null)
      toast.success('Entry deleted')
    } catch (e) {
      toast.error('Delete failed: ' + (e.message || e))
    }
  }

  const newEntryDraft = () => ({
    customer: customer || 'Diamondback',
    location_name: '',
    service_type: '',
    area: '',
    well_type: '',
    latitude: '',
    longitude: '',
    assets: '',
    ticket_number: '',
    shut_in_date: monthYear ? monthYear + '-01' : '',
    foreman: '',
    status: 'Needs Scheduling',
    notes: '',
    date_completed: '',
  })

  const mapUrl = (e) => {
    if (e.latitude == null || e.longitude == null) return null
    return 'https://www.google.com/maps?q=' + e.latitude + ',' + e.longitude
  }

  const cell = { padding: '8px 10px', borderTop: '1px solid #f1f5f9', verticalAlign: 'top', fontSize: 12 }
  const th = { padding: '10px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, background: '#f8fafc', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#1a2332', marginBottom: 4 }}>📅 PM Schedule</div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>
        Per-customer monthly preventive-maintenance plan. Pick a month, change statuses inline, edit details, add entries as new work comes in. Techs can see the schedule too.
      </div>

      {/* Filter bar */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 12, display: 'grid', gridTemplateColumns: 'minmax(160px, 200px) minmax(140px, 180px) 1fr', gap: 10, alignItems: 'end' }}>
        <div>
          <label style={lbl}>Customer</label>
          <select value={customer} onChange={e => setCustomer(e.target.value)} style={{ ...inp, width: '100%' }}>
            {customers.length === 0 && <option value='Diamondback'>Diamondback</option>}
            {customers.map(c => (
              <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
            ))}
          </select>
        </div>
        <div>
          <label style={lbl}>Month</label>
          <select value={monthYear} onChange={e => setMonthYear(e.target.value)} style={{ ...inp, width: '100%' }}>
            {MONTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Search</label>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Location, notes, ticket#, assets…' style={{ ...inp, width: '100%' }} />
        </div>
      </div>

      {/* Status chips + foreman filter */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' }}>
        <button onClick={() => setStatusFilter('')} style={{ border: '1px solid ' + (statusFilter === '' ? '#1a2332' : '#cbd5e1'), background: statusFilter === '' ? '#1a2332' : '#fff', color: statusFilter === '' ? '#fff' : '#475569', borderRadius: 16, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          All ({entries.length})
        </button>
        {PM_STATUSES.filter(s => statusCounts[s]).map(s => {
          const active = statusFilter === s
          const sty = PM_STATUS_STYLES[s]
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(active ? '' : s)}
              style={{
                border: '1px solid ' + (active ? sty.dot : sty.bg),
                background: active ? sty.dot : sty.bg,
                color: active ? '#fff' : sty.fg,
                borderRadius: 16, padding: '4px 10px', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {s} ({statusCounts[s]})
            </button>
          )
        })}
        {foremenInMonth.length > 0 && (
          <select value={foremanFilter} onChange={e => setForemanFilter(e.target.value)} style={{ ...inp, marginLeft: 'auto', minWidth: 180 }}>
            <option value=''>All foremen</option>
            {foremenInMonth.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        <button
          onClick={() => setEditing(newEntryDraft())}
          style={{ background: '#0f1f38', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          + Add entry
        </button>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 18 }}>
            {[1,2,3,4,5].map(i => (
              <div key={i} style={{ height: 36, background: 'linear-gradient(90deg,#f1f5f9 25%,#e5e7eb 50%,#f1f5f9 75%)', backgroundSize: '200% 100%', borderRadius: 6, marginBottom: 6, animation: 'pulse 1.6s ease-in-out infinite' }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 4 }}>No entries for {monthLabel(monthYear)}.</div>
            <div style={{ fontSize: 12 }}>
              {entries.length === 0
                ? 'No entries this month yet — click + Add entry, or run a one-time import from the workbook.'
                : 'No entries match the current filters — clear filters above.'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={th}>Status</th>
                  <th style={th}>Shut-In</th>
                  <th style={th}>Location</th>
                  <th style={th}>Service</th>
                  <th style={th}>Area</th>
                  <th style={th}>Foreman</th>
                  <th style={th}>Assets</th>
                  <th style={th}>Ticket#</th>
                  <th style={th}>Map</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id} onClick={() => setEditing(e)} style={{ cursor: 'pointer' }}>
                    <td style={cell} onClick={(ev) => ev.stopPropagation()}>
                      <StatusPill value={e.status} onChange={(v) => handleStatusChange(e, v)} />
                    </td>
                    <td style={cell}>{fmtDate(e.shut_in_date)}</td>
                    <td style={{ ...cell, fontWeight: 700, color: '#1a2332' }}>
                      {e.location_name}
                      {e.notes && <div style={{ fontSize: 11, color: '#64748b', fontWeight: 400, marginTop: 2 }}>{e.notes}</div>}
                    </td>
                    <td style={cell}>{e.service_type || '—'}</td>
                    <td style={cell}>{e.area || '—'}</td>
                    <td style={cell}>{e.foreman || '—'}</td>
                    <td style={cell}>{e.assets || '—'}</td>
                    <td style={{ ...cell, fontFamily: 'ui-monospace, Menlo, monospace' }}>{e.ticket_number || '—'}</td>
                    <td style={cell} onClick={(ev) => ev.stopPropagation()}>
                      {mapUrl(e) ? (
                        <a href={mapUrl(e)} target='_blank' rel='noopener noreferrer' style={{ color: '#0369a1', fontWeight: 700, textDecoration: 'none' }}>📍</a>
                      ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }} onClick={(ev) => ev.stopPropagation()}>
                      <button
                        onClick={() => setEditing(e)}
                        title='Edit entry'
                        style={{ background: '#f8fafc', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 5, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        ✏️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EditEntryModal
          entry={editing}
          customerOptions={customers}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
