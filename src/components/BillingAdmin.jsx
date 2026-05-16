// BillingAdmin — admin tab that adds office-side billing/payment
// tracking on top of every PM/SC submission. Reads from the submissions
// prop AdminPage already loads, writes billing fields into the existing
// submissions.data JSONB column (no schema migration).
//
// Auto-fill design: every new tech submission appears here the moment
// it lands in the DB. The field-side data (customer/site/tech/hours/
// miles/cost/WO#) is pre-populated; office staff edits the four
// new-to-billing fields here as approvals + payments come in.
import { useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { toast } from '../lib/toast'
import { logAudit, getAuthToken } from '../lib/submissions'
import {
  PAYMENT_TERMS,
  BILLING_STATUSES,
  BILLING_STATUS_STYLES,
  DEFAULT_TERMS_BY_CUSTOMER,
  deriveBillingStatus,
  agingBucket,
  billedAmount,
  collectedAmount,
  openAmount,
  isWorkOrder,
} from '../lib/billing'

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function patchSubmissionData(id, mergedData) {
  const token = getAuthToken()
  const res = await fetch(SUPA_URL + '/rest/v1/submissions?id=eq.' + id, {
    method: 'PATCH',
    headers: {
      apikey: SUPA_KEY,
      Authorization: 'Bearer ' + (token || SUPA_KEY),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ data: mergedData, updated_at: new Date().toISOString() }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error('Save failed: HTTP ' + res.status + ' ' + t.slice(0, 200))
  }
  return true
}

const inp = { border: '1px solid #cbd5e1', borderRadius: 6, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }
const lbl = { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'block' }

function fmtMoney(n) {
  return '$' + (Math.round(n || 0)).toLocaleString('en-US')
}
function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function StatusPill({ status }) {
  const s = BILLING_STATUS_STYLES[status] || BILLING_STATUS_STYLES['Open']
  return (
    <span style={{ background: s.bg, color: s.fg, fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 12, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  )
}

function EditBillingModal({ submission, onClose, onSave }) {
  const initial = submission?.data || {}
  const defaultTerms = DEFAULT_TERMS_BY_CUSTOMER[submission?.customer_name] || 'Net 30'
  const [form, setForm] = useState({
    dbWoNumber: initial.dbWoNumber || '',
    foreman: initial.foreman || '',
    approvedDate: initial.approvedDate || '',
    paidDate: initial.paidDate || '',
    paidReference: initial.paidReference || '',
    paymentTerms: initial.paymentTerms || defaultTerms,
    billable: initial.billable !== false,
  })
  const [saving, setSaving] = useState(false)

  if (!submission) return null

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(submission, form)
      onClose()
    } catch (e) {
      toast.error('Save failed: ' + (e.message || e))
    } finally {
      setSaving(false)
    }
  }

  const wo = submission.work_order || submission.pm_number || '—'

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,31,56,0.65)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, maxWidth: 540, width: '100%', boxShadow: '0 12px 40px rgba(0,0,0,0.3)', overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ background: '#0f1f38', color: '#fff', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.7, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Billing details</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
              WO #{wo} · {submission.customer_name || '—'}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
              {submission.location_name || ''} · {fmtMoney(billedAmount(submission))}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: 18, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={lbl}>DB / Customer WO #</label>
              <input value={form.dbWoNumber} onChange={e => set('dbWoNumber', e.target.value)} placeholder='Diamondback ticket #' style={{ ...inp, width: '100%' }} />
            </div>
            <div>
              <label style={lbl}>Customer Foreman</label>
              <input value={form.foreman} onChange={e => set('foreman', e.target.value)} placeholder='Noel / Pat / etc.' style={{ ...inp, width: '100%' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={lbl}>Approved Date</label>
              <input type='date' value={form.approvedDate} onChange={e => set('approvedDate', e.target.value)} style={{ ...inp, width: '100%' }} />
            </div>
            <div>
              <label style={lbl}>Payment Terms</label>
              <select value={form.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} style={{ ...inp, width: '100%' }}>
                {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={lbl}>Paid Date</label>
              <input type='date' value={form.paidDate} onChange={e => set('paidDate', e.target.value)} style={{ ...inp, width: '100%' }} />
            </div>
            <div>
              <label style={lbl}>Payment Reference</label>
              <input value={form.paidReference} onChange={e => set('paidReference', e.target.value)} placeholder='Invoice / check #' style={{ ...inp, width: '100%' }} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
            <input type='checkbox' checked={form.billable} onChange={e => set('billable', e.target.checked)} />
            Billable (uncheck to exclude from totals + aging)
          </label>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} disabled={saving} style={{ background: 'transparent', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 6, padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{ background: saving ? '#9ca3af' : '#0f1f38', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 22px', fontWeight: 800, fontSize: 13, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function monthOptions(allWOs) {
  const set = new Set()
  for (const s of allWOs) {
    const d = s.date || s.created_at
    if (d) set.add(String(d).slice(0, 7))
  }
  // Add current month even if no rows yet
  const now = new Date()
  set.add(now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'))
  return Array.from(set).sort().reverse()
}

function monthLabel(ym) {
  if (!ym) return ''
  const [y, m] = ym.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function BillingAdmin({ submissions }) {
  const { user, profile, isDemo } = useAuth()
  const [editing, setEditing] = useState(null)
  const [monthYear, setMonthYear] = useState(() => {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  })
  const [customerFilter, setCustomerFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const allWOs = useMemo(() => (submissions || []).filter(isWorkOrder), [submissions])
  const months = useMemo(() => monthOptions(allWOs), [allWOs])

  const customers = useMemo(() => {
    const set = new Set()
    for (const s of allWOs) if (s.customer_name) set.add(s.customer_name)
    return Array.from(set).sort()
  }, [allWOs])

  const inMonth = useMemo(() => {
    if (!monthYear) return allWOs
    return allWOs.filter(s => {
      const d = s.date || s.created_at
      return d && String(d).startsWith(monthYear)
    })
  }, [allWOs, monthYear])

  const rows = useMemo(() => {
    return inMonth.map(s => ({
      ...s,
      _status: deriveBillingStatus(s),
      _aging: agingBucket(s),
      _billed: billedAmount(s),
      _collected: collectedAmount(s),
      _open: openAmount(s),
    }))
  }, [inMonth])

  const filtered = useMemo(() => {
    let pool = rows
    if (customerFilter) pool = pool.filter(r => r.customer_name === customerFilter)
    if (statusFilter) pool = pool.filter(r => r._status === statusFilter)
    if (search) {
      const q = search.toLowerCase()
      pool = pool.filter(r =>
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.location_name || '').toLowerCase().includes(q) ||
        String(r.work_order || r.pm_number || '').includes(q) ||
        (r.data?.dbWoNumber || '').toLowerCase().includes(q)
      )
    }
    return pool
  }, [rows, customerFilter, statusFilter, search])

  const summary = useMemo(() => {
    return {
      tickets: rows.length,
      billed: rows.reduce((s, r) => s + r._billed, 0),
      collected: rows.reduce((s, r) => s + r._collected, 0),
      open: rows.reduce((s, r) => s + r._open, 0),
    }
  }, [rows])

  // Aging across all open WOs (any month, not just this one)
  const aging = useMemo(() => {
    const buckets = { '0-7 days': 0, '8-30 days': 0, '31-60 days': 0, '61-90 days': 0, '90+ days': 0, 'Not yet due': 0 }
    for (const s of allWOs) {
      if (s.data?.paidDate || s.data?.billable === false) continue
      const b = agingBucket(s)
      if (!b) continue
      buckets[b] = (buckets[b] || 0) + billedAmount(s)
    }
    return buckets
  }, [allWOs])

  const statusCounts = useMemo(() => {
    const out = {}
    for (const r of rows) out[r._status] = (out[r._status] || 0) + 1
    return out
  }, [rows])

  const handleSave = async (submission, formFields) => {
    const merged = {
      ...(submission.data || {}),
      dbWoNumber: formFields.dbWoNumber || null,
      foreman: formFields.foreman || null,
      approvedDate: formFields.approvedDate || null,
      paidDate: formFields.paidDate || null,
      paidReference: formFields.paidReference || null,
      paymentTerms: formFields.paymentTerms || null,
      billable: formFields.billable,
    }
    await patchSubmissionData(submission.id, merged)
    logAudit({
      userId: user?.id, userName: profile?.full_name || user?.email,
      action: 'billing_updated',
      targetType: 'submission', targetId: submission.id,
      details: {
        wo: submission.work_order || submission.pm_number,
        customer: submission.customer_name,
        approved: formFields.approvedDate || null,
        paid: formFields.paidDate || null,
      },
    })
    toast.success('Billing updated')
    // Optimistic local update so the row reflects change before realtime
    submission.data = merged
  }

  const card = (label, value, color) => (
    <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '2px solid ' + color, flex: '1 1 140px', minWidth: 140 }}>
      <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#888', fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  )

  const th = { padding: '10px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, background: '#f8fafc', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }
  const cell = { padding: '8px 10px', borderTop: '1px solid #f1f5f9', verticalAlign: 'top', fontSize: 12 }

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#1a2332', marginBottom: 4 }}>💵 Billing</div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>
        Every PM and Service Call submission shows up here as soon as it's submitted. Add approval dates, payment dates, customer WO# and foreman as those things happen. Aging + collections are derived from those fields.
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        {card('Tickets', summary.tickets, '#1a2332')}
        {!isDemo && card('Billed', fmtMoney(summary.billed), '#0891b2')}
        {!isDemo && card('Collected', fmtMoney(summary.collected), '#16a34a')}
        {!isDemo && card('Open', fmtMoney(summary.open), '#ea580c')}
        {!isDemo && card('Coll %', summary.billed > 0 ? Math.round((summary.collected / summary.billed) * 100) + '%' : '—', '#7c3aed')}
      </div>

      {/* Filter bar */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 12, display: 'grid', gridTemplateColumns: 'minmax(140px,180px) minmax(140px,180px) minmax(140px,180px) 1fr', gap: 10, alignItems: 'end' }}>
        <div>
          <label style={lbl}>Month</label>
          <select value={monthYear} onChange={e => setMonthYear(e.target.value)} style={{ ...inp, width: '100%' }}>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Customer</label>
          <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)} style={{ ...inp, width: '100%' }}>
            <option value=''>All</option>
            {customers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inp, width: '100%' }}>
            <option value=''>All</option>
            {BILLING_STATUSES.map(s => statusCounts[s] ? <option key={s} value={s}>{s} ({statusCounts[s]})</option> : null)}
          </select>
        </div>
        <div>
          <label style={lbl}>Search</label>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Customer, site, WO#, DB#' style={{ ...inp, width: '100%' }} />
        </div>
      </div>

      {/* Aging panel (open across all months) */}
      {!isDemo && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#1a2332', marginBottom: 10 }}>📊 Aging — Approved & Unpaid (all months)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {['Not yet due', '0-7 days', '8-30 days', '31-60 days', '61-90 days', '90+ days'].map(b => {
              const v = aging[b] || 0
              const colors = {
                'Not yet due': '#16a34a',
                '0-7 days':    '#65a30d',
                '8-30 days':   '#ca8a04',
                '31-60 days':  '#ea580c',
                '61-90 days':  '#dc2626',
                '90+ days':    '#b91c1c',
              }
              return (
                <div key={b} style={{ background: '#f8fafc', borderLeft: '3px solid ' + colors[b], borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{b}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: colors[b], marginTop: 2 }}>{fmtMoney(v)}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 4 }}>No work orders for {monthLabel(monthYear)}.</div>
            <div style={{ fontSize: 12 }}>
              {rows.length === 0
                ? 'Tech-submitted PMs and Service Calls will appear here automatically.'
                : 'No rows match the current filters — clear filters above.'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={th}>Status</th>
                  <th style={th}>Date</th>
                  <th style={th}>WO#</th>
                  <th style={th}>DB#</th>
                  <th style={th}>Customer / Site</th>
                  <th style={th}>Tech</th>
                  <th style={th}>Foreman</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cost</th>
                  <th style={th}>Approved</th>
                  <th style={th}>Paid</th>
                  <th style={th}>Aging</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const tech = (Array.isArray(r.data?.techs) && r.data.techs[0]) || r.profiles?.full_name || '—'
                  return (
                    <tr key={r.id} onClick={() => setEditing(r)} style={{ cursor: 'pointer' }}>
                      <td style={cell}><StatusPill status={r._status} /></td>
                      <td style={cell}>{fmtDate(r.date)}</td>
                      <td style={{ ...cell, fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 700, color: '#1a2332' }}>#{r.work_order || r.pm_number || '—'}</td>
                      <td style={{ ...cell, fontFamily: 'ui-monospace, Menlo, monospace', color: '#64748b' }}>{r.data?.dbWoNumber || '—'}</td>
                      <td style={cell}>
                        <div style={{ fontWeight: 700, color: '#1a2332' }}>{r.customer_name || '—'}</div>
                        {r.location_name && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{r.location_name}</div>}
                      </td>
                      <td style={cell}>{tech}</td>
                      <td style={cell}>{r.data?.foreman || '—'}</td>
                      <td style={{ ...cell, textAlign: 'right', fontWeight: 700, color: '#16a34a', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                        {!isDemo ? fmtMoney(r._billed) : '—'}
                      </td>
                      <td style={cell}>{fmtDate(r.data?.approvedDate)}</td>
                      <td style={cell}>
                        {r.data?.paidDate ? (
                          <div>
                            <div>{fmtDate(r.data.paidDate)}</div>
                            {r.data?.paidReference && <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'ui-monospace, Menlo, monospace', marginTop: 1 }}>{r.data.paidReference}</div>}
                          </div>
                        ) : '—'}
                      </td>
                      <td style={cell}>
                        {r._aging && r._aging !== 'Not yet due' ? <span style={{ color: '#dc2626', fontWeight: 700 }}>{r._aging}</span> : (r._aging || '—')}
                      </td>
                      <td style={{ ...cell, textAlign: 'right' }} onClick={ev => ev.stopPropagation()}>
                        <button
                          onClick={() => setEditing(r)}
                          style={{ background: '#f8fafc', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 5, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                        >
                          ✏️
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EditBillingModal
          submission={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
