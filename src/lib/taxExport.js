// taxExport.js — build a single year-end CSV that bundles every
// revenue + expense line item the company has logged for a given year.
// Designed to be CPA-friendly: clearly-labeled sections, all amounts
// in plain dollar columns, summary totals at the bottom.
//
// Input sources:
//   - submissions (PM / SC / EXP)
//   - monthly_expenses (Fixed / Payroll / Other)
//
// Sections (each a single CSV with blank-line separators):
//   1. REVENUE — every PM / SC the year, billable only (skips
//      non-billable + warranty), with payment status fields.
//   2. TECH-SIDE EXPENSES — per-job expense_report submissions
//      (fuel / meals / lodging on the road).
//   3. OFFICE EXPENSES — monthly_expenses (rent / insurance / payroll
//      / etc.) grouped by category.
//   4. SUMMARY — totals per section + net P&L for the year.

import { canonicalTech } from './techs'
import { fetchMonthlyExpenses } from './monthlyExpenses'
import { isWorkOrder, isNonBillable, billedAmount } from './billing'
import { fetchAllSubmissions } from './submissions'

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function row(cells) {
  return cells.map(csvEscape).join(',')
}

function fmtDate(d) {
  if (!d) return ''
  return String(d).slice(0, 10)
}

function fmtMoney(n) {
  const v = parseFloat(n) || 0
  return v.toFixed(2)
}

// Build the CSV string from a year (number, e.g. 2026) + already-loaded
// submissions array + already-loaded monthly_expenses array.
export function buildTaxExportCsv(year, submissions, monthlyExpenses) {
  const prefix = String(year) + '-'
  const subs = (submissions || []).filter(s => (s.date || s.created_at || '').startsWith(prefix))
  const offexp = (monthlyExpenses || []).filter(e => (e.month_year || '').startsWith(prefix))

  // 1. Revenue rows (PM / SC only, billable, exclude warranty)
  const woRows = subs.filter(s => isWorkOrder(s) && !isNonBillable(s) && !s.data?.warrantyWork)
  const lines = []

  lines.push('# ROS Field App — Tax Export for ' + year)
  lines.push('# Generated ' + new Date().toISOString())
  lines.push('')

  lines.push('## SECTION 1 — REVENUE (Billable PMs + Service Calls)')
  lines.push(row(['Date', 'WO#', 'DB WO#', 'Customer', 'Site', 'Tech', 'Type', 'Hours', 'Miles', 'Cost', 'Approved', 'Paid Date', 'Paid Reference', 'Payment Terms', 'Status', 'Notes']))
  let revenueTotal = 0
  for (const s of woRows.sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    const tech = canonicalTech((Array.isArray(s.data?.techs) && s.data.techs[0]) || s.profiles?.full_name || '')
    const cost = billedAmount(s)
    revenueTotal += cost
    const data = s.data || {}
    const lbl = s.template === 'pm_flare_combustor' ? 'PM' : 'SC'
    const status = data.paidDate ? 'Paid' : data.approvedDate ? 'Approved' : 'Open'
    lines.push(row([
      fmtDate(s.date),
      s.work_order || s.pm_number || '',
      data.dbWoNumber || '',
      s.customer_name || '',
      s.location_name || '',
      tech || '',
      lbl,
      parseFloat(s.labor_hours || 0) || 0,
      parseFloat(s.miles || data.miles || 0) || 0,
      fmtMoney(cost),
      fmtDate(data.approvedDate),
      fmtDate(data.paidDate),
      data.paidReference || '',
      data.paymentTerms || '',
      status,
      s.summary || data.description || '',
    ]))
  }
  lines.push(row(['', '', '', '', '', '', '', '', '', fmtMoney(revenueTotal), '', '', '', '', 'TOTAL REVENUE', '']))
  lines.push('')

  // 2. Tech-side expense reports
  const techExpSubs = subs.filter(s => s.template === 'expense_report')
  lines.push('## SECTION 2 — TECH-SIDE EXPENSE REPORTS (per-job field expenses)')
  lines.push(row(['Date', 'Tech', 'Customer', 'Site', 'Total', 'Description', 'Notes']))
  let techExpTotal = 0
  for (const s of techExpSubs.sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    const tech = canonicalTech((Array.isArray(s.data?.techs) && s.data.techs[0]) || s.profiles?.full_name || '')
    const total = parseFloat(s.data?.expenseTotal || 0) || 0
    techExpTotal += total
    lines.push(row([
      fmtDate(s.date),
      tech || '',
      s.customer_name || '',
      s.location_name || '',
      fmtMoney(total),
      (s.data?.description || s.summary || '').slice(0, 200),
      s.summary || '',
    ]))
  }
  lines.push(row(['', '', '', '', fmtMoney(techExpTotal), 'TOTAL TECH EXPENSES', '']))
  lines.push('')

  // 3. Office expenses — break out by category
  lines.push('## SECTION 3 — OFFICE EXPENSES (Fixed / Payroll / Other)')
  lines.push(row(['Date', 'Category', 'Description', 'Vendor', 'Amount', 'Notes']))
  const byCat = { Fixed: 0, Payroll: 0, Other: 0 }
  for (const e of offexp.sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    const amt = parseFloat(e.amount) || 0
    byCat[e.category] = (byCat[e.category] || 0) + amt
    lines.push(row([
      fmtDate(e.date),
      e.category || 'Other',
      e.description || '',
      e.vendor || '',
      fmtMoney(amt),
      e.notes || '',
    ]))
  }
  const officeTotal = byCat.Fixed + byCat.Payroll + byCat.Other
  lines.push(row(['', 'Fixed subtotal', '', '', fmtMoney(byCat.Fixed), '']))
  lines.push(row(['', 'Payroll subtotal', '', '', fmtMoney(byCat.Payroll), '']))
  lines.push(row(['', 'Other subtotal', '', '', fmtMoney(byCat.Other), '']))
  lines.push(row(['', 'TOTAL OFFICE EXPENSES', '', '', fmtMoney(officeTotal), '']))
  lines.push('')

  // 4. Summary
  const totalExpenses = techExpTotal + officeTotal
  const netProfit = revenueTotal - totalExpenses
  lines.push('## SECTION 4 — SUMMARY')
  lines.push(row(['', 'Year', String(year)]))
  lines.push(row(['', 'Revenue', fmtMoney(revenueTotal)]))
  lines.push(row(['', 'Tech-side expenses', fmtMoney(techExpTotal)]))
  lines.push(row(['', 'Office Fixed', fmtMoney(byCat.Fixed)]))
  lines.push(row(['', 'Office Payroll', fmtMoney(byCat.Payroll)]))
  lines.push(row(['', 'Office Other', fmtMoney(byCat.Other)]))
  lines.push(row(['', 'Total expenses', fmtMoney(totalExpenses)]))
  lines.push(row(['', 'Net (P&L)', fmtMoney(netProfit)]))
  lines.push(row(['', 'Revenue records', String(woRows.length)]))
  lines.push(row(['', 'Tech expense records', String(techExpSubs.length)]))
  lines.push(row(['', 'Office expense records', String(offexp.length)]))

  return lines.join('\r\n')
}

// Trigger a browser download of the CSV for the given year. If
// submissions are passed in (AdminPage already has them) we skip the
// big refetch; otherwise we pull both sources fresh.
export async function downloadTaxExportCsv(year, submissions) {
  const [subs, offexp] = await Promise.all([
    submissions ? Promise.resolve(submissions) : fetchAllSubmissions().catch(() => []),
    fetchMonthlyExpenses({ limit: 5000 }).catch(() => []),
  ])
  const csv = buildTaxExportCsv(year, subs || [], offexp || [])
  const filename = 'ROS_TaxExport_' + year + '.csv'
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
