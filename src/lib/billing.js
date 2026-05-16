// Billing helpers — derives payment status and aging from a submission's
// existing data fields plus the new billing fields stored on data.*:
//
//   data.dbWoNumber     — customer's reference WO number (e.g. Diamondback's)
//   data.foreman        — customer-side foreman
//   data.approvedDate   — yyyy-mm-dd, customer approved the invoice
//   data.paidDate       — yyyy-mm-dd, payment received
//   data.paidReference  — invoice/payment reference string
//   data.paymentTerms   — 'Net 30' / 'Net 45' / 'Net 60'
//   data.billable       — boolean, defaults true
//
// No schema migration: every field lives in the existing submissions.data
// JSONB column. Office staff fills these in from the Billing admin tab.

export const PAYMENT_TERMS = ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 90']

export const BILLING_STATUSES = [
  'Non-Billable',
  'Open',
  'Needs Approval',
  'Approved',
  'Past Due',
  'Paid',
]

export const BILLING_STATUS_STYLES = {
  'Non-Billable':   { bg: '#f1f5f9', fg: '#475569' },
  'Open':           { bg: '#fff7ed', fg: '#c2410c' },
  'Needs Approval': { bg: '#fef3c7', fg: '#a16207' },
  'Approved':       { bg: '#dbeafe', fg: '#1d4ed8' },
  'Past Due':       { bg: '#fef2f2', fg: '#b91c1c' },
  'Paid':           { bg: '#ecfdf5', fg: '#047857' },
}

// Default terms per customer; admin can override per row.
export const DEFAULT_TERMS_BY_CUSTOMER = {
  Diamondback: 'Net 60',
  'High Peak': 'Net 45',
  ExTex: 'Net 30',
  'A8 Oilfield': 'Net 30',
  KOS: 'Net 60',
  'Pristine Alliance': 'Net 30',
}

function parseTermDays(terms) {
  if (!terms) return 30
  const m = String(terms).match(/\d+/)
  return m ? parseInt(m[0], 10) : 30
}

function parseDate(s) {
  if (!s) return null
  // Parse plain `YYYY-MM-DD` strings as local noon, not UTC midnight. The
  // JS spec parses bare date-only strings as UTC, so for a customer in
  // Central time a Net 30 invoice approved 2026-03-08 lands its computed
  // due date at 2026-04-07 00:00 UTC. Comparing that against `asOf =
  // new Date()` (a local Date) flipped past-due a calendar day early
  // anytime the user looked between 6pm-midnight local. Coerce to noon
  // local so the comparison is day-vs-day on the user's clock.
  const d = new Date(/T/.test(s) ? s : s + 'T12:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

// Returns 'Non-Billable' / 'Paid' / 'Past Due' / 'Approved' /
// 'Needs Approval' / 'Open' for a submission row.
export function deriveBillingStatus(s, asOf = new Date()) {
  if (!s) return 'Open'
  const d = s.data || {}
  if (d.billable === false) return 'Non-Billable'
  if (d.paidDate) return 'Paid'
  if (d.approvedDate) {
    const approved = parseDate(d.approvedDate)
    const termDays = parseTermDays(d.paymentTerms || DEFAULT_TERMS_BY_CUSTOMER[s.customer_name])
    if (approved) {
      const due = new Date(approved.getTime() + termDays * 86400000)
      if (asOf > due) return 'Past Due'
    }
    return 'Approved'
  }
  return 'Needs Approval'
}

// Bucket "open" amounts into 0-7 / 8-30 / 31-60 / 61-90 / 90+ days past
// the calculated due date. Returns null if not past due / not approved.
export function agingBucket(s, asOf = new Date()) {
  const d = s?.data || {}
  if (!d.approvedDate || d.paidDate) return null
  const approved = parseDate(d.approvedDate)
  if (!approved) return null
  const termDays = parseTermDays(d.paymentTerms || DEFAULT_TERMS_BY_CUSTOMER[s.customer_name])
  const due = new Date(approved.getTime() + termDays * 86400000)
  const past = Math.floor((asOf - due) / 86400000)
  if (past < 0) return 'Not yet due'
  if (past <= 7) return '0-7 days'
  if (past <= 30) return '8-30 days'
  if (past <= 60) return '31-60 days'
  if (past <= 90) return '61-90 days'
  return '90+ days'
}

// True if the row was cancelled / marked non-billable (e.g. a duplicate
// visit, warranty work, etc.). Excluded from every revenue calculation
// in the app.
export function isNonBillable(s) {
  return s?.data?.billable === false
}

// Convenience: amount we count as billed for this submission. Reads the
// canonical data.grandTotal first (same path the rest of the app uses)
// and falls back to total_revenue for any older rows. Non-billable rows
// always return 0 — they're invisible to every revenue total.
export function billedAmount(s) {
  if (isNonBillable(s)) return 0
  const v = s?.data?.grandTotal != null ? s.data.grandTotal : s?.total_revenue
  return parseFloat(v) || 0
}

// Convenience: collected amount = billed if paid, else 0.
export function collectedAmount(s) {
  if (s?.data?.paidDate) return billedAmount(s)
  return 0
}

// Convenience: open amount = billed if not paid, else 0.
// (billedAmount already returns 0 for non-billable rows.)
export function openAmount(s) {
  if (s?.data?.paidDate) return 0
  return billedAmount(s)
}

export function isWorkOrder(s) {
  return s?.template === 'service_call' || s?.template === 'pm_flare_combustor'
}
