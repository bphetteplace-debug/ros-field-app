// cpaReport.js — generate a one-page CPA-ready PDF summarizing YTD financial
// reconciliation from app data (submissions + monthlyExpenses).
//
// Sections:
//   1. Operating P&L (deductible expenses only)
//   2. Debt Service / Capital purchases (non-deductible)
//   3. Methodology + CPA decision items
//
// Does NOT include the bank-derived cash-flow reconciliation section
// (Section 3 of the Python-generated PDF) — that requires the bank XLS
// statement which is not in the app. For the full reconciliation, use
// scripts/generate_cpa_pdf.py locally.

import { isWorkOrder, isNonBillable } from './billing'

function fmtMoney(n) {
  const v = Number(n) || 0
  const sign = v < 0 ? '-' : ''
  return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function inRangeYear(d, year) {
  if (!d || !year) return false
  const iso = String(d).slice(0, 10)
  return iso >= year + '-01-01' && iso <= year + '-12-31'
}

function consolidateDebtLabel(row) {
  const v = String(row.vendor || '').toLowerCase()
  const d = String(row.description || '').toLowerCase()
  const s = v + ' ' + d
  if (s.includes('momentum') || s.includes('momentu')) return 'American Momentum (BMS equipment)'
  if (s.includes('amex') || s.includes('american')) return 'American Express (card payoffs)'
  if (s.includes('fundbox')) return 'Fundbox (loan principal)'
  if (s.includes('carvana') || s.includes('cvna')) return 'Carvana (vehicle down pmts)'
  if (s.includes('qbc') || s.includes('intuit financing')) return 'QuickBooks Capital LOC'
  if (s.includes('loan') || s.includes('repay')) return 'Misc loan principal'
  return (row.vendor || row.description || '').slice(0, 35) || '(unknown)'
}

const DEBT_NOTES = {
  'American Express (card payoffs)': 'Credit-card payoff. Underlying line-item charges already in P&L above.',
  'Fundbox (loan principal)': 'Loan principal portion of ACH debits. Interest is in Other above.',
  'American Momentum (BMS equipment)': 'BMS controller equipment financing — VERIFY Sec 179 vs depreciate.',
  'Carvana (vehicle down pmts)': 'Vehicle down payments — capitalize as Vehicles asset, depreciate.',
  'QuickBooks Capital LOC': 'LOC principal repayment — non-deductible.',
  'Misc loan principal': 'QB LOC + account opening + repay — non-deductible.',
}

export function buildCpaReportData(submissions, monthlyExpenses, year) {
  const y = year || new Date().getFullYear()
  const subs = (submissions || []).filter(s => inRangeYear(s.date || s.created_at, String(y)))
  const me = (monthlyExpenses || []).filter(r => inRangeYear(r.date, String(y)))

  let revenue = 0
  let revRecords = 0
  for (const s of subs) {
    const d = s.data || {}
    if (!isWorkOrder(s)) continue
    if (isNonBillable(s)) continue
    if (d.warrantyWork) continue
    revenue += parseFloat(d.grandTotal || 0) || 0
    revRecords++
  }

  let techExp = 0
  let techExpRecords = 0
  for (const s of subs) {
    if (s.template === 'expense_report') {
      techExp += parseFloat((s.data || {}).expenseTotal || 0) || 0
      techExpRecords++
    }
  }

  const catTotals = { Fixed: 0, Payroll: 0, Other: 0, 'Debt Service': 0 }
  for (const r of me) {
    const c = r.category || 'Other'
    catTotals[c] = (catTotals[c] || 0) + (parseFloat(r.amount) || 0)
  }

  const debtBuckets = {}
  for (const r of me) {
    if (r.category !== 'Debt Service') continue
    const k = consolidateDebtLabel(r)
    debtBuckets[k] = (debtBuckets[k] || 0) + (parseFloat(r.amount) || 0)
  }
  const debtRows = Object.entries(debtBuckets)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: k, amount: v, note: DEBT_NOTES[k] || '' }))

  const deductibleOpex = catTotals.Fixed + catTotals.Payroll + catTotals.Other
  const netPL = revenue - techExp - deductibleOpex

  return {
    year: y,
    revenue,
    revRecords,
    techExp,
    techExpRecords,
    catTotals,
    deductibleOpex,
    debtService: catTotals['Debt Service'],
    debtRows,
    netPL,
  }
}

function buildHtml(d) {
  const ts = new Date().toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })
  const rows = (cells, opts = {}) => {
    const tdStyle = opts.bold
      ? 'padding:5px 8px;font-weight:800;border-top:1px solid #475569;'
      : 'padding:5px 8px;border-top:1px solid #f1f5f9;'
    return '<tr>' + cells.map((c, i) => {
      const alignRight = i === cells.length - 1
      return '<td style="' + tdStyle + (alignRight ? 'text-align:right;font-family:ui-monospace,Menlo,monospace;' : '') + '">' + c + '</td>'
    }).join('') + '</tr>'
  }

  const debtRowsHtml = d.debtRows.map(r =>
    '<tr>' +
      '<td style="padding:5px 8px;border-top:1px solid #f1f5f9;">' + r.label + '</td>' +
      '<td style="padding:5px 8px;border-top:1px solid #f1f5f9;text-align:right;font-family:ui-monospace,Menlo,monospace;">' + fmtMoney(r.amount) + '</td>' +
      '<td style="padding:5px 8px;border-top:1px solid #f1f5f9;font-size:8px;color:#475569;">' + r.note + '</td>' +
    '</tr>'
  ).join('')

  return (
    '<div style="font-family:Helvetica,Arial,sans-serif;padding:0.4in 0.5in;color:#1a2332;font-size:9.5px;">' +
      '<div style="font-size:14px;font-weight:800;color:#0f1f38;">Reliable Oilfield Services LLC &nbsp;&nbsp; YTD ' + d.year + ' Financial Reconciliation</div>' +
      '<div style="font-size:8px;color:#475569;margin-bottom:6px;">Generated ' + ts + ' from Reliable Track app data (monthly_expenses + submissions). Prepared for CPA review.</div>' +
      '<hr style="border:none;border-top:1px solid #0f1f38;margin:4px 0 10px 0;" />' +

      '<div style="font-size:11px;font-weight:800;color:#1a2332;margin:6px 0 4px;">1. Operating P&amp;L (deductible expenses only)</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:9px;">' +
        '<thead><tr style="background:#f1f5f9;">' +
          '<th style="padding:5px 8px;text-align:left;border-bottom:1px solid #475569;">Line</th>' +
          '<th style="padding:5px 8px;text-align:left;border-bottom:1px solid #475569;">Source</th>' +
          '<th style="padding:5px 8px;text-align:right;border-bottom:1px solid #475569;">Amount</th>' +
        '</tr></thead><tbody>' +
        rows(['Revenue (PM/SC billed, billable only)', d.revRecords + ' work-order submissions', fmtMoney(d.revenue)]) +
        rows(['Tech-side expenses (field expense reports)', d.techExpRecords + ' records', '(' + fmtMoney(d.techExp) + ')']) +
        rows(['Office expenses — Fixed', 'Insurance / lot rent / fleet / utilities', '(' + fmtMoney(d.catTotals.Fixed) + ')']) +
        rows(['Office expenses — Payroll', 'Intuit payroll + tax + 401k', '(' + fmtMoney(d.catTotals.Payroll) + ')']) +
        rows(['Office expenses — Other', 'Fuel / parts / govt fees / vendors', '(' + fmtMoney(d.catTotals.Other) + ')']) +
        rows(['<b>NET OPERATING P&amp;L</b>', '', '<b>' + fmtMoney(d.netPL) + '</b>'], { bold: true }) +
      '</tbody></table>' +

      '<div style="font-size:11px;font-weight:800;color:#1a2332;margin:14px 0 4px;">2. Debt Service / Capital purchases (NON-deductible — excluded from P&amp;L above)</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:9px;">' +
        '<thead><tr style="background:#fef3c7;">' +
          '<th style="padding:5px 8px;text-align:left;border-bottom:1px solid #92400e;">Vendor / category</th>' +
          '<th style="padding:5px 8px;text-align:right;border-bottom:1px solid #92400e;">Amount</th>' +
          '<th style="padding:5px 8px;text-align:left;border-bottom:1px solid #92400e;">Treatment note</th>' +
        '</tr></thead><tbody>' +
        debtRowsHtml +
        '<tr>' +
          '<td style="padding:5px 8px;border-top:1px solid #92400e;font-weight:800;">TOTAL Debt Service</td>' +
          '<td style="padding:5px 8px;border-top:1px solid #92400e;text-align:right;font-family:ui-monospace,Menlo,monospace;font-weight:800;">' + fmtMoney(d.debtService) + '</td>' +
          '<td style="padding:5px 8px;border-top:1px solid #92400e;"></td>' +
        '</tr>' +
      '</tbody></table>' +

      '<div style="font-size:11px;font-weight:800;color:#1a2332;margin:14px 0 4px;">3. CPA decisions requested</div>' +
      '<ul style="font-size:9px;line-height:1.4;margin:0;padding-left:16px;">' +
        '<li><b>Sec 179 / bonus depreciation election on 2026 equipment purchases.</b><br/>' +
          '<span style="color:#475569;font-size:8px;">BMS controllers (' + fmtMoney(d.debtBuckets ? d.debtBuckets['American Momentum (BMS equipment)'] || 0 : 0) + ' American Momentum) + Carvana vehicle down payments are capital purchases. If elected as Sec 179, becomes a direct deduction in current year — Net P&amp;L drops accordingly.</span></li>' +
        '<li><b>Split principal vs interest on American Momentum + Carvana monthly payments.</b><br/>' +
          '<span style="color:#475569;font-size:8px;">Currently lumped entirely into Debt Service. Interest portion is deductible operating expense.</span></li>' +
        '<li><b>Reconcile any variance between QuickBooks accrual NI and this cash-basis report.</b><br/>' +
          '<span style="color:#475569;font-size:8px;">Likely sources: depreciation on existing fixed assets, accrued AP not yet on app, accrued payroll. Please confirm.</span></li>' +
        '<li><b>Verify Fundbox interest schedule used for 2026 deduction.</b><br/>' +
          '<span style="color:#475569;font-size:8px;">YTD interest is broken out as deductible Other opex. Confirm against Fundbox statement.</span></li>' +
      '</ul>' +

      '<hr style="border:none;border-top:1px solid #cbd5e1;margin:14px 0 6px 0;" />' +
      '<div style="font-size:7px;color:#475569;line-height:1.4;">' +
        'Numbers sourced from Reliable Track app data (monthly_expenses + submissions tables). This report excludes the bank-derived cash-flow reconciliation section ' +
        '(which requires the bank XLS statement) — for that, use scripts/generate_cpa_pdf.py locally. Live dashboard: pm.reliable-oilfield-services.com' +
      '</div>' +
    '</div>'
  )
}

export async function downloadCpaPdf({ submissions, monthlyExpenses, year }) {
  const d = buildCpaReportData(submissions, monthlyExpenses, year)
  d.debtBuckets = d.debtRows.reduce((acc, r) => { acc[r.label] = r.amount; return acc }, {})

  const html = buildHtml(d)
  // Render on-screen (visible) so html2canvas captures real pixels. The
  // off-screen `left:-9999px` trick causes html2canvas to capture from a
  // viewport that doesn't include the element. We mount it on-screen with
  // a very high z-index, capture immediately, then remove. The flicker is
  // brief (~700ms) — acceptable for a one-click export.
  const container = document.createElement('div')
  container.style.cssText = (
    'position:fixed;top:0;left:0;width:8.5in;background:#fff;' +
    'z-index:99999;box-shadow:0 0 0 9999px rgba(0,0,0,0.5);'
  )
  container.innerHTML = html
  document.body.appendChild(container)
  void container.offsetHeight
  await new Promise(resolve => setTimeout(resolve, 300))

  try {
    const mod = await import('html2pdf.js')
    const html2pdf = mod.default || mod
    await html2pdf().set({
      margin: 0,
      filename: 'ROS_YTD_Reconciliation_' + (d.year) + '_' + new Date().toISOString().slice(0, 10) + '.pdf',
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, allowTaint: false, logging: false, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(container).save()
  } finally {
    container.remove()
  }
  return d
}
