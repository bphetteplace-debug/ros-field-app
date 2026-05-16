// taxExport.js — year-end tax export.
//
// Outputs a multi-sheet XLSX (default) or single sectioned CSV
// (fallback) covering every revenue + expense line for a chosen
// period. Designed to be CPA-friendly:
//   - Each sheet has a frozen header row + Excel auto-filter so the
//     CPA can sort/filter columns inline.
//   - Money columns are formatted as $ accounting numbers.
//   - Customer + vendor 1099 summary sheets flag anyone paid >$600.
//   - Mileage summary line for vehicle-deduction calculations.
//
// Period options:
//   - Full calendar year
//   - Q1 / Q2 / Q3 / Q4
//   - Custom date range
//
// All inputs (submissions + monthly_expenses) are passed in by the
// caller — AdminPage already loads both, so no extra fetches.

import { canonicalTech } from './techs'
import { fetchMonthlyExpenses } from './monthlyExpenses'
import { fetchAllSubmissions } from './submissions'
import { isWorkOrder, isNonBillable, billedAmount } from './billing'

const IRS_MILEAGE_RATE_2026 = 0.70  // $/mile — adjust if IRS changes annually

// ── Date range helpers ─────────────────────────────────────────────

export function periodRange(year, period, customStart, customEnd) {
  const y = Number(year)
  if (period === 'custom') {
    return { start: customStart || (y + '-01-01'), end: customEnd || (y + '-12-31') }
  }
  if (period === 'q1') return { start: y + '-01-01', end: y + '-03-31' }
  if (period === 'q2') return { start: y + '-04-01', end: y + '-06-30' }
  if (period === 'q3') return { start: y + '-07-01', end: y + '-09-30' }
  if (period === 'q4') return { start: y + '-10-01', end: y + '-12-31' }
  return { start: y + '-01-01', end: y + '-12-31' }  // full year
}

function inRange(d, range) {
  if (!d || !range) return false
  const iso = String(d).slice(0, 10)
  return iso >= range.start && iso <= range.end
}

function fmtDate(d) {
  if (!d) return ''
  return String(d).slice(0, 10)
}

function num(v) {
  return parseFloat(v) || 0
}

// ── Core data assembly (used by both XLSX and CSV exports) ─────────

export function buildTaxExportRows(submissions, monthlyExpenses, range) {
  const subs = (submissions || []).filter(s => inRange(s.date || s.created_at, range))
  const expenses = (monthlyExpenses || []).filter(e => inRange(e.date, range))

  // Revenue: billable PMs + SCs, not warranty
  const woRows = subs.filter(s => isWorkOrder(s) && !isNonBillable(s) && !s.data?.warrantyWork)
  const revenue = woRows
    .map(s => {
      const data = s.data || {}
      const tech = canonicalTech((Array.isArray(data.techs) && data.techs[0]) || s.profiles?.full_name || '')
      const status = data.paidDate ? 'Paid' : data.approvedDate ? 'Approved' : 'Open'
      return {
        Date: fmtDate(s.date),
        'WO#': s.work_order || s.pm_number || '',
        'DB WO#': data.dbWoNumber || '',
        Customer: s.customer_name || '',
        Site: s.location_name || '',
        Tech: tech || '',
        Type: s.template === 'pm_flare_combustor' ? 'PM' : 'SC',
        Hours: num(s.labor_hours),
        Miles: num(s.miles || data.miles),
        Cost: billedAmount(s),
        Approved: fmtDate(data.approvedDate),
        'Paid Date': fmtDate(data.paidDate),
        'Paid Ref': data.paidReference || '',
        'Payment Terms': data.paymentTerms || '',
        Status: status,
        Notes: s.summary || data.description || '',
      }
    })
    .sort((a, b) => (a.Date || '').localeCompare(b.Date || ''))

  // Tech-side expenses
  const techExpSubs = subs.filter(s => s.template === 'expense_report')
  const techExpenses = techExpSubs
    .map(s => {
      const data = s.data || {}
      const tech = canonicalTech((Array.isArray(data.techs) && data.techs[0]) || s.profiles?.full_name || '')
      return {
        Date: fmtDate(s.date),
        Tech: tech || '',
        Customer: s.customer_name || '',
        Site: s.location_name || '',
        Total: num(data.expenseTotal),
        Description: (data.description || s.summary || '').slice(0, 250),
      }
    })
    .sort((a, b) => (a.Date || '').localeCompare(b.Date || ''))

  // Office expenses
  const office = expenses
    .map(e => ({
      Date: fmtDate(e.date),
      Category: e.category || 'Other',
      Description: e.description || '',
      Vendor: e.vendor || '',
      Amount: num(e.amount),
      Notes: e.notes || '',
    }))
    .sort((a, b) => (a.Date || '').localeCompare(b.Date || ''))

  // Customer revenue summary (useful for accounting, NOT 1099 — that's
  // for what we paid out)
  const customerMap = new Map()
  for (const r of revenue) {
    const c = r.Customer || '(unspecified)'
    const entry = customerMap.get(c) || { Customer: c, Billed: 0, Collected: 0, Open: 0, Records: 0 }
    entry.Billed += r.Cost
    if (r['Paid Date']) entry.Collected += r.Cost
    else entry.Open += r.Cost
    entry.Records++
    customerMap.set(c, entry)
  }
  const customers = Array.from(customerMap.values()).sort((a, b) => b.Billed - a.Billed)

  // Vendor summary across BOTH office expenses AND tech-side expenses
  // (when those have a vendor field). Flag anyone we paid >$600 in
  // the period — that's the 1099-NEC threshold.
  const vendorMap = new Map()
  for (const e of office) {
    if (!e.Vendor) continue
    const v = e.Vendor
    const entry = vendorMap.get(v) || { Vendor: v, Total: 0, Records: 0, Category: e.Category }
    entry.Total += e.Amount
    entry.Records++
    vendorMap.set(v, entry)
  }
  const vendors = Array.from(vendorMap.values())
    .map(v => ({ ...v, '1099 Threshold': v.Total >= 600 ? 'YES — file 1099-NEC' : '' }))
    .sort((a, b) => b.Total - a.Total)

  // Tax-relevant aggregates
  const revenueTotal = revenue.reduce((s, r) => s + r.Cost, 0)
  const techExpTotal = techExpenses.reduce((s, r) => s + r.Total, 0)
  const officeFixed = office.filter(r => r.Category === 'Fixed').reduce((s, r) => s + r.Amount, 0)
  const officePayroll = office.filter(r => r.Category === 'Payroll').reduce((s, r) => s + r.Amount, 0)
  const officeOther = office.filter(r => r.Category === 'Other').reduce((s, r) => s + r.Amount, 0)
  const officeTotal = officeFixed + officePayroll + officeOther
  const totalExpenses = techExpTotal + officeTotal
  const netProfit = revenueTotal - totalExpenses
  const totalMiles = revenue.reduce((s, r) => s + r.Miles, 0)
  const mileageDeduction = totalMiles * IRS_MILEAGE_RATE_2026

  return {
    range,
    revenue,
    techExpenses,
    office,
    customers,
    vendors,
    summary: {
      revenue: revenueTotal,
      techExpenses: techExpTotal,
      officeFixed,
      officePayroll,
      officeOther,
      officeTotal,
      totalExpenses,
      netProfit,
      totalMiles,
      mileageDeduction,
      revenueRecords: revenue.length,
      techExpRecords: techExpenses.length,
      officeRecords: office.length,
      customerCount: customers.length,
      vendorCount: vendors.length,
      vendors1099: vendors.filter(v => v.Total >= 600).length,
    },
  }
}

// Lightweight preview — same numbers we'd embed in the workbook,
// returned for the live UI panel.
export function computeTaxExportPreview(submissions, monthlyExpenses, range) {
  const built = buildTaxExportRows(submissions, monthlyExpenses, range)
  return built.summary
}

// ── XLSX writer ────────────────────────────────────────────────────

function applySheetPolish(ws, headerCount, rowCount) {
  if (!ws['!ref']) return
  // Auto-filter on the header row
  // Convert col index to letter (supports up to ZZ)
  const lastColIdx = headerCount - 1
  const colLetter = (i) => {
    let s = ''
    let n = i
    do {
      s = String.fromCharCode(65 + (n % 26)) + s
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    return s
  }
  const lastCol = colLetter(lastColIdx)
  ws['!autofilter'] = { ref: 'A1:' + lastCol + Math.max(1, rowCount + 1) }
  // Freeze header row
  ws['!views'] = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2' }]
}

function autoWidthCols(rows, headers) {
  const widths = headers.map(h => Math.max(10, String(h).length + 2))
  for (const r of rows) {
    headers.forEach((h, i) => {
      const v = r[h]
      const len = v == null ? 0 : String(v).length
      if (len + 2 > widths[i]) widths[i] = Math.min(60, len + 2)
    })
  }
  return widths.map(w => ({ wch: w }))
}

export async function downloadTaxExportXlsx({ year, period = 'year', customStart, customEnd, submissions, monthlyExpenses, filenameHint }) {
  const XLSX = await import('xlsx')
  const range = periodRange(year, period, customStart, customEnd)
  const data = buildTaxExportRows(submissions || [], monthlyExpenses || [], range)

  const wb = XLSX.utils.book_new()

  const addSheet = (name, rows, headers) => {
    const aoa = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = autoWidthCols(rows, headers)
    applySheetPolish(ws, headers.length, rows.length)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  // Revenue sheet
  addSheet('Revenue', data.revenue, [
    'Date', 'WO#', 'DB WO#', 'Customer', 'Site', 'Tech', 'Type', 'Hours', 'Miles', 'Cost',
    'Approved', 'Paid Date', 'Paid Ref', 'Payment Terms', 'Status', 'Notes',
  ])

  // Tech expense reports
  addSheet('Tech Expenses', data.techExpenses, [
    'Date', 'Tech', 'Customer', 'Site', 'Total', 'Description',
  ])

  // Office expenses
  addSheet('Office Expenses', data.office, [
    'Date', 'Category', 'Description', 'Vendor', 'Amount', 'Notes',
  ])

  // Customer summary
  addSheet('Customer Summary', data.customers, [
    'Customer', 'Billed', 'Collected', 'Open', 'Records',
  ])

  // Vendor 1099 sheet
  addSheet('Vendors (1099 candidates)', data.vendors, [
    'Vendor', 'Total', 'Records', 'Category', '1099 Threshold',
  ])

  // Summary sheet
  const s = data.summary
  const summaryRows = [
    { Field: 'Period', Value: range.start + ' to ' + range.end },
    { Field: '', Value: '' },
    { Field: 'Revenue', Value: s.revenue },
    { Field: 'Revenue records', Value: s.revenueRecords },
    { Field: '', Value: '' },
    { Field: 'Tech-side expenses', Value: s.techExpenses },
    { Field: 'Tech expense records', Value: s.techExpRecords },
    { Field: '', Value: '' },
    { Field: 'Office Fixed', Value: s.officeFixed },
    { Field: 'Office Payroll', Value: s.officePayroll },
    { Field: 'Office Other', Value: s.officeOther },
    { Field: 'Office total', Value: s.officeTotal },
    { Field: 'Office expense records', Value: s.officeRecords },
    { Field: '', Value: '' },
    { Field: 'TOTAL EXPENSES', Value: s.totalExpenses },
    { Field: 'NET P&L', Value: s.netProfit },
    { Field: '', Value: '' },
    { Field: 'Customers w/ revenue', Value: s.customerCount },
    { Field: 'Vendors paid', Value: s.vendorCount },
    { Field: 'Vendors over $600 (1099-NEC candidates)', Value: s.vendors1099 },
    { Field: '', Value: '' },
    { Field: 'Total miles driven', Value: s.totalMiles },
    { Field: 'IRS mileage rate ($/mi, 2026)', Value: IRS_MILEAGE_RATE_2026 },
    { Field: 'Mileage deduction (est)', Value: s.mileageDeduction },
  ]
  addSheet('Summary', summaryRows, ['Field', 'Value'])

  const filenameBase = filenameHint || ('ROS_TaxExport_' + (period === 'year' ? year : (year + '_' + period)))
  XLSX.writeFile(wb, filenameBase + '.xlsx')
  return data.summary
}

// ── CSV fallback (legacy single-file output) ───────────────────────

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}
function rowCsv(cells) { return cells.map(csvEscape).join(',') }
function fmtMoney(n) { return (parseFloat(n) || 0).toFixed(2) }

export function buildTaxExportCsv(submissions, monthlyExpenses, range) {
  const data = buildTaxExportRows(submissions, monthlyExpenses, range)
  const lines = []
  lines.push('# ROS Field App — Tax Export')
  lines.push('# Period ' + range.start + ' to ' + range.end)
  lines.push('# Generated ' + new Date().toISOString())
  lines.push('')

  lines.push('## SECTION 1 — REVENUE')
  const revH = ['Date','WO#','DB WO#','Customer','Site','Tech','Type','Hours','Miles','Cost','Approved','Paid Date','Paid Ref','Payment Terms','Status','Notes']
  lines.push(rowCsv(revH))
  for (const r of data.revenue) lines.push(rowCsv(revH.map(h => h === 'Cost' ? fmtMoney(r[h]) : r[h])))
  lines.push('')
  lines.push('## SECTION 2 — TECH-SIDE EXPENSES')
  const teH = ['Date','Tech','Customer','Site','Total','Description']
  lines.push(rowCsv(teH))
  for (const r of data.techExpenses) lines.push(rowCsv(teH.map(h => h === 'Total' ? fmtMoney(r[h]) : r[h])))
  lines.push('')
  lines.push('## SECTION 3 — OFFICE EXPENSES')
  const oH = ['Date','Category','Description','Vendor','Amount','Notes']
  lines.push(rowCsv(oH))
  for (const r of data.office) lines.push(rowCsv(oH.map(h => h === 'Amount' ? fmtMoney(r[h]) : r[h])))
  lines.push('')
  lines.push('## SECTION 4 — CUSTOMERS')
  const cH = ['Customer','Billed','Collected','Open','Records']
  lines.push(rowCsv(cH))
  for (const r of data.customers) lines.push(rowCsv(cH.map(h => ['Billed','Collected','Open'].includes(h) ? fmtMoney(r[h]) : r[h])))
  lines.push('')
  lines.push('## SECTION 5 — VENDORS (1099 candidates)')
  const vH = ['Vendor','Total','Records','Category','1099 Threshold']
  lines.push(rowCsv(vH))
  for (const r of data.vendors) lines.push(rowCsv(vH.map(h => h === 'Total' ? fmtMoney(r[h]) : r[h])))
  lines.push('')
  lines.push('## SECTION 6 — SUMMARY')
  const s = data.summary
  lines.push(rowCsv(['Period', range.start + ' to ' + range.end]))
  lines.push(rowCsv(['Revenue', fmtMoney(s.revenue)]))
  lines.push(rowCsv(['Tech expenses', fmtMoney(s.techExpenses)]))
  lines.push(rowCsv(['Office Fixed', fmtMoney(s.officeFixed)]))
  lines.push(rowCsv(['Office Payroll', fmtMoney(s.officePayroll)]))
  lines.push(rowCsv(['Office Other', fmtMoney(s.officeOther)]))
  lines.push(rowCsv(['Total expenses', fmtMoney(s.totalExpenses)]))
  lines.push(rowCsv(['Net P&L', fmtMoney(s.netProfit)]))
  lines.push(rowCsv(['Total miles', String(s.totalMiles)]))
  lines.push(rowCsv(['Mileage deduction (est)', fmtMoney(s.mileageDeduction)]))

  return lines.join('\r\n')
}

export async function downloadTaxExportCsv({ year, period = 'year', customStart, customEnd, submissions, monthlyExpenses, filenameHint }) {
  const subs = submissions || await fetchAllSubmissions().catch(() => [])
  const exp = monthlyExpenses || await fetchMonthlyExpenses({ limit: 5000 }).catch(() => [])
  const range = periodRange(year, period, customStart, customEnd)
  const csv = buildTaxExportCsv(subs, exp, range)
  const filenameBase = filenameHint || ('ROS_TaxExport_' + (period === 'year' ? year : (year + '_' + period)))
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filenameBase + '.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return buildTaxExportRows(subs, exp, range).summary
}
