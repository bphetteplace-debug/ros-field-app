// MonthlyExpensesAdmin — office-side monthly expense ledger. Separate
// from tech-side expense_report submissions (which are field expenses
// per job). This tracks Fixed (rent/insurance/leases), Payroll, and
// Other monthly office expenses imported from the 2026 Expense Tracker.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { toast } from '../lib/toast'
import { logAudit } from '../lib/submissions'
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_STYLES,
  fetchMonthlyExpenses,
  createMonthlyExpense,
  updateMonthlyExpense,
  deleteMonthlyExpense,
} from '../lib/monthlyExpenses'
import { downloadTaxExportXlsx, downloadTaxExportCsv, computeTaxExportPreview, periodRange } from '../lib/taxExport'

const inp = { border: '1px solid #cbd5e1', borderRadius: 6, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }
const lbl = { fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'block' }

function fmtMoney(n) { return '$' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function CategoryPill({ value }) {
  const s = EXPENSE_CATEGORY_STYLES[value] || EXPENSE_CATEGORY_STYLES['Other']
  return (
    <span style={{ background: s.bg, color: s.fg, fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 12, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>
      {value || 'Other'}
    </span>
  )
}

function EditExpenseModal({ entry, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(entry)
  const [saving, setSaving] = useState(false)

  useEffect(() => setForm(entry), [entry?.id])
  if (!entry) return null
  const isNew = !entry.id
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.description?.trim()) { toast.warning('Description is required'); return }
    if (form.amount === '' || form.amount == null) { toast.warning('Amount is required'); return }
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

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,31,56,0.65)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, maxWidth: 520, width: '100%', boxShadow: '0 12px 40px rgba(0,0,0,0.3)', overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ background: '#0f1f38', color: '#fff', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.7, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{isNew ? 'New expense' : 'Edit expense'}</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>{form.description || '(new)'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: 18, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Date *</label>
              <input type='date' value={form.date || ''} onChange={e => set('date', e.target.value || null)} style={{ ...inp, width: '100%' }} />
            </div>
            <div>
              <label style={lbl}>Category *</label>
              <select value={form.category || 'Other'} onChange={e => set('category', e.target.value)} style={{ ...inp, width: '100%' }}>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Description *</label>
            <input value={form.description || ''} onChange={e => set('description', e.target.value)} placeholder='Storage Unit, Verizon, Vehicle Lease, …' style={{ ...inp, width: '100%' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Amount *</label>
              <input type='number' step='0.01' value={form.amount ?? ''} onChange={e => set('amount', e.target.value === '' ? null : Number(e.target.value))} style={{ ...inp, width: '100%' }} />
            </div>
            <div>
              <label style={lbl}>Vendor</label>
              <input value={form.vendor || ''} onChange={e => set('vendor', e.target.value)} placeholder='Optional' style={{ ...inp, width: '100%' }} />
            </div>
          </div>
          <div>
            <label style={lbl}>Notes</label>
            <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={3} style={{ ...inp, width: '100%', resize: 'vertical', minHeight: 60 }} />
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div>
            {!isNew && (
              <button onClick={() => onDelete(entry)} disabled={saving} style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 6, padding: '8px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                🗑️ Delete
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={{ background: 'transparent', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 6, padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ background: saving ? '#9ca3af' : '#0f1f38', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 22px', fontWeight: 800, fontSize: 13, cursor: saving ? 'wait' : 'pointer' }}>
              {saving ? 'Saving…' : (isNew ? 'Create' : 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function monthLabel(ym) {
  if (!ym) return ''
  const [y, m] = ym.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function monthOptions(entries = []) {
  const set = new Set()
  for (const e of entries) if (e.month_year) set.add(e.month_year)
  const now = new Date()
  for (const yr of [now.getFullYear(), now.getFullYear() + 1]) {
    for (let m = 1; m <= 12; m++) set.add(yr + '-' + String(m).padStart(2, '0'))
  }
  return Array.from(set).sort().reverse()
}

const DEFAULT_MONTH = (() => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
})()

export default function MonthlyExpensesAdmin({ submissions = [], monthlyExpenses: parentExpenses }) {
  const { user, profile, isDemo } = useAuth()
  const [entries, setEntries] = useState([])
  const [monthYear, setMonthYear] = useState(DEFAULT_MONTH)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [allMonths, setAllMonths] = useState([])
  const [exporting, setExporting] = useState(false)
  const [exportYear, setExportYear] = useState(String(new Date().getFullYear()))
  const [exportPeriod, setExportPeriod] = useState('year') // year / q1 / q2 / q3 / q4 / custom
  const [exportCustomStart, setExportCustomStart] = useState('')
  const [exportCustomEnd, setExportCustomEnd] = useState('')
  const [exportFormat, setExportFormat] = useState('xlsx')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchMonthlyExpenses({ monthYear })
      setEntries(list || [])
    } catch (e) {
      console.error('[MonthlyExpensesAdmin] load failed:', e)
      toast.error('Could not load monthly expenses: ' + (e.message || e))
    } finally {
      setLoading(false)
    }
  }, [monthYear])

  useEffect(() => { load() }, [load])

  // Separately pull just month_year values once so dropdown shows every
  // month that has data (regardless of which month is currently filtered)
  useEffect(() => {
    fetchMonthlyExpenses({ limit: 5000 }).then(list => {
      setAllMonths((list || []).map(e => e.month_year).filter(Boolean))
    }).catch(() => {})
  }, [])

  const months = useMemo(() => monthOptions(allMonths.map(m => ({ month_year: m }))), [allMonths])

  const filtered = useMemo(() => {
    let pool = entries
    if (categoryFilter) pool = pool.filter(e => e.category === categoryFilter)
    if (search) {
      const q = search.toLowerCase()
      pool = pool.filter(e =>
        (e.description || '').toLowerCase().includes(q) ||
        (e.vendor || '').toLowerCase().includes(q) ||
        (e.notes || '').toLowerCase().includes(q)
      )
    }
    return pool
  }, [entries, categoryFilter, search])

  const summary = useMemo(() => {
    const out = { Fixed: 0, Payroll: 0, Other: 0, 'Debt Service': 0, total: 0 }
    for (const e of entries) {
      const amt = parseFloat(e.amount || 0) || 0
      out[e.category] = (out[e.category] || 0) + amt
      // 'Total' = deductible opex only. Debt Service stays out of the P&L total.
      if (e.category !== 'Debt Service') out.total += amt
    }
    return out
  }, [entries])

  const categoryCounts = useMemo(() => {
    const out = {}
    for (const e of entries) out[e.category] = (out[e.category] || 0) + 1
    return out
  }, [entries])

  const handleSave = async (form) => {
    const payload = {
      date: form.date || null,
      description: form.description || '',
      amount: Number(form.amount) || 0,
      category: form.category || 'Other',
      vendor: form.vendor || null,
      notes: form.notes || null,
    }
    if (form.id) {
      await updateMonthlyExpense(form.id, payload)
      logAudit({
        userId: user?.id, userName: profile?.full_name || user?.email,
        action: 'monthly_expense_updated',
        targetType: 'monthly_expense', targetId: form.id,
        details: { description: payload.description, amount: payload.amount, category: payload.category },
      })
    } else {
      const row = await createMonthlyExpense(payload)
      logAudit({
        userId: user?.id, userName: profile?.full_name || user?.email,
        action: 'monthly_expense_created',
        targetType: 'monthly_expense', targetId: row?.id,
        details: { description: payload.description, amount: payload.amount, category: payload.category },
      })
    }
    await load()
    toast.success(form.id ? 'Expense updated' : 'Expense created')
  }

  const handleDelete = async (entry) => {
    if (!window.confirm('Delete ' + entry.description + ' ' + fmtMoney(entry.amount) + '?')) return
    try {
      await deleteMonthlyExpense(entry.id)
      logAudit({
        userId: user?.id, userName: profile?.full_name || user?.email,
        action: 'monthly_expense_deleted',
        targetType: 'monthly_expense', targetId: entry.id,
        details: { description: entry.description, amount: entry.amount },
      })
      setEntries(list => list.filter(e => e.id !== entry.id))
      setEditing(null)
      toast.success('Deleted')
    } catch (e) {
      toast.error('Delete failed: ' + (e.message || e))
    }
  }

  const newDraft = () => ({
    date: monthYear ? monthYear + '-01' : '',
    description: '',
    amount: '',
    category: 'Fixed',
    vendor: '',
    notes: '',
  })

  // Full data sources for the export (separate from the table's
  // month-scoped fetch). Falls back to the parent prop, otherwise the
  // local entries (current month only).
  const fullExpensesForExport = useMemo(
    () => (Array.isArray(parentExpenses) && parentExpenses.length ? parentExpenses : entries),
    [parentExpenses, entries]
  )

  const exportRange = useMemo(
    () => periodRange(exportYear, exportPeriod, exportCustomStart, exportCustomEnd),
    [exportYear, exportPeriod, exportCustomStart, exportCustomEnd]
  )

  const exportPreview = useMemo(
    () => computeTaxExportPreview(submissions, fullExpensesForExport, exportRange),
    [submissions, fullExpensesForExport, exportRange]
  )

  const handleExport = async () => {
    setExporting(true)
    try {
      const args = {
        year: parseInt(exportYear, 10),
        period: exportPeriod,
        customStart: exportCustomStart,
        customEnd: exportCustomEnd,
        submissions,
        monthlyExpenses: fullExpensesForExport,
      }
      if (exportFormat === 'xlsx') {
        await downloadTaxExportXlsx(args)
        toast.success('Tax export downloaded (XLSX) — open in Excel')
      } else {
        await downloadTaxExportCsv(args)
        toast.success('Tax export downloaded (CSV)')
      }
    } catch (e) {
      toast.error('Export failed: ' + (e.message || e))
    } finally {
      setExporting(false)
    }
  }

  const exportYearOptions = (() => {
    const opts = new Set()
    for (const e of entries) if (e.month_year) opts.add(e.month_year.slice(0, 4))
    for (const m of allMonths) if (m) opts.add(m.slice(0, 4))
    for (const s of submissions) {
      const d = s.date || s.created_at
      if (d) opts.add(String(d).slice(0, 4))
    }
    const now = new Date().getFullYear()
    opts.add(String(now - 1))
    opts.add(String(now))
    return Array.from(opts).sort().reverse()
  })()

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
      <div style={{ fontSize: 16, fontWeight: 800, color: '#1a2332', marginBottom: 4 }}>💸 Monthly Expenses</div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>
        Office-side ledger for fixed costs, payroll, and other monthly outflows. Separate from tech-side expense reports (those track per-job fuel, meals, lodging).
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        {!isDemo && card('Fixed', fmtMoney(summary.Fixed), '#1d4ed8')}
        {!isDemo && card('Payroll', fmtMoney(summary.Payroll), '#6d28d9')}
        {!isDemo && card('Other', fmtMoney(summary.Other), '#475569')}
        {!isDemo && card('Debt Service', fmtMoney(summary['Debt Service']), '#92400e')}
        {!isDemo && card('Total (deductible)', fmtMoney(summary.total), '#1a2332')}
        {card('Entries', entries.length, '#0891b2')}
      </div>

      {/* Tax export panel */}
      <div style={{ background: '#0f1f38', borderRadius: 12, padding: 16, marginBottom: 12, color: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 2 }}>📄 Year-end tax export</div>
            <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.4 }}>
              Multi-sheet XLSX (recommended for your CPA) or single CSV. Includes revenue, tech-side expenses, office expenses, customer summary, 1099-NEC candidate vendors, and mileage deduction estimate. Each sheet has Excel filters and a frozen header.
            </div>
          </div>
        </div>

        {/* Control row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr)) auto', gap: 10, alignItems: 'end', marginBottom: 12 }}>
          <div>
            <label style={{ ...lbl, color: '#cbd5e1' }}>Year</label>
            <select value={exportYear} onChange={e => setExportYear(e.target.value)} style={{ ...inp, width: '100%', color: '#1a2332' }}>
              {exportYearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label style={{ ...lbl, color: '#cbd5e1' }}>Period</label>
            <select value={exportPeriod} onChange={e => setExportPeriod(e.target.value)} style={{ ...inp, width: '100%', color: '#1a2332' }}>
              <option value='year'>Full year</option>
              <option value='q1'>Q1 (Jan–Mar)</option>
              <option value='q2'>Q2 (Apr–Jun)</option>
              <option value='q3'>Q3 (Jul–Sep)</option>
              <option value='q4'>Q4 (Oct–Dec)</option>
              <option value='custom'>Custom range</option>
            </select>
          </div>
          <div>
            <label style={{ ...lbl, color: '#cbd5e1' }}>Format</label>
            <select value={exportFormat} onChange={e => setExportFormat(e.target.value)} style={{ ...inp, width: '100%', color: '#1a2332' }}>
              <option value='xlsx'>XLSX (Excel, recommended)</option>
              <option value='csv'>CSV (single file)</option>
            </select>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            style={{
              background: exporting ? '#475569' : '#e65c00',
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '10px 22px', fontSize: 13, fontWeight: 800,
              cursor: exporting ? 'wait' : 'pointer',
              boxShadow: '0 4px 12px rgba(230,92,0,0.35)',
              whiteSpace: 'nowrap',
            }}
          >
            {exporting ? 'Building…' : '📥 Download'}
          </button>
        </div>

        {exportPeriod === 'custom' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ ...lbl, color: '#cbd5e1' }}>From</label>
              <input type='date' value={exportCustomStart} onChange={e => setExportCustomStart(e.target.value)} style={{ ...inp, width: '100%', color: '#1a2332' }} />
            </div>
            <div>
              <label style={{ ...lbl, color: '#cbd5e1' }}>To</label>
              <input type='date' value={exportCustomEnd} onChange={e => setExportCustomEnd(e.target.value)} style={{ ...inp, width: '100%', color: '#1a2332' }} />
            </div>
          </div>
        )}

        {/* Preview */}
        <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: 12, fontSize: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: '#94a3b8', marginBottom: 8 }}>
            What you'll get — {exportRange.start} to {exportRange.end}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '6px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.75 }}>Revenue records</span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{exportPreview.revenueRecords} · {fmtMoney(exportPreview.revenue)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.75 }}>Tech expenses</span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{exportPreview.techExpRecords} · {fmtMoney(exportPreview.techExpenses)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.75 }}>Office Fixed</span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{fmtMoney(exportPreview.officeFixed)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.75 }}>Office Payroll</span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{fmtMoney(exportPreview.officePayroll)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.75 }}>Office Other</span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{fmtMoney(exportPreview.officeOther)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.75, color: '#fbbf24' }}>Debt Service (excluded from P&L)</span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: '#fbbf24' }}>{fmtMoney(exportPreview.officeDebtService || 0)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.75 }}>Customers w/ revenue</span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{exportPreview.customerCount}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.75 }}>Vendors paid (1099 ≥ $600)</span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{exportPreview.vendorCount} · <b style={{ color: '#fbbf24' }}>{exportPreview.vendors1099} 1099</b></span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.75 }}>Miles · est deduction</span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{Math.round(exportPreview.totalMiles).toLocaleString('en-US')} · {fmtMoney(exportPreview.mileageDeduction)}</span>
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: 10, paddingTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '4px 18px', fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <b style={{ color: '#16a34a' }}>Revenue</b>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 800 }}>{fmtMoney(exportPreview.revenue)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <b style={{ color: '#f97316' }}>Total expenses</b>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 800 }}>{fmtMoney(exportPreview.totalExpenses)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <b style={{ color: exportPreview.netProfit >= 0 ? '#22d3ee' : '#fca5a5' }}>Net P&L</b>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 800 }}>{fmtMoney(exportPreview.netProfit)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
        <div>
          <label style={lbl}>Month</label>
          <select value={monthYear} onChange={e => setMonthYear(e.target.value)} style={{ ...inp, width: '100%' }}>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Category</label>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ ...inp, width: '100%' }}>
            <option value=''>All</option>
            {EXPENSE_CATEGORIES.map(c => categoryCounts[c] ? <option key={c} value={c}>{c} ({categoryCounts[c]})</option> : <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Search</label>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Description, vendor, notes…' style={{ ...inp, width: '100%' }} />
        </div>
        <button onClick={() => setEditing(newDraft())} style={{ background: '#0f1f38', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          + Add expense
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
              {entries.length === 0 ? 'Click + Add expense or import from your tracker.' : 'No rows match the current filters.'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Category</th>
                  <th style={th}>Description</th>
                  <th style={th}>Vendor</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                  <th style={th}>Notes</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id} onClick={() => setEditing(e)} style={{ cursor: 'pointer' }}>
                    <td style={cell}>{fmtDate(e.date)}</td>
                    <td style={cell}><CategoryPill value={e.category} /></td>
                    <td style={{ ...cell, fontWeight: 700, color: '#1a2332' }}>{e.description}</td>
                    <td style={cell}>{e.vendor || '—'}</td>
                    <td style={{ ...cell, textAlign: 'right', fontWeight: 700, color: '#dc2626', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                      {!isDemo ? fmtMoney(e.amount) : '—'}
                    </td>
                    <td style={cell}>{e.notes ? <span style={{ color: '#64748b' }}>{e.notes}</span> : '—'}</td>
                    <td style={{ ...cell, textAlign: 'right' }} onClick={ev => ev.stopPropagation()}>
                      <button onClick={() => setEditing(e)} style={{ background: '#f8fafc', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 5, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
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
        <EditExpenseModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
