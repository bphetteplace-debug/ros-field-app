// cpaReport.js — generate a one-page CPA-ready PDF summarizing YTD financial
// reconciliation from app data (submissions + monthlyExpenses).
//
// Uses pdf-lib (already a project dep, also used for the lambda PDF fallback)
// to construct the PDF directly with drawText/drawLine/drawRectangle. We
// deliberately avoid html2pdf/html2canvas here — repeated production attempts
// produced 3KB blank PDFs with no embedded image, despite the DOM rendering
// the report correctly. pdf-lib bypasses that whole pipeline.
//
// Sections:
//   1. Operating P&L (deductible expenses only)
//   2. Debt Service / Capital purchases (non-deductible)
//   3. CPA decision items
//
// The bank-derived cash-flow reconciliation section (Section 3 of the
// Python-generated PDF) is intentionally omitted from the in-app version
// — that requires the bank XLS statement which is not in the app.

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
  'American Momentum (BMS equipment)': 'BMS controller equipment financing - VERIFY Sec 179 vs depreciate.',
  'Carvana (vehicle down pmts)': 'Vehicle down payments - capitalize as Vehicles asset, depreciate.',
  'QuickBooks Capital LOC': 'LOC principal repayment - non-deductible.',
  'Misc loan principal': 'QB LOC + account opening + repay - non-deductible.',
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

// ── PDF construction via pdf-lib ──────────────────────────────────────────

const PAGE_W = 612 // 8.5 in × 72 pt/in
const PAGE_H = 792 // 11 in × 72 pt/in
const MARGIN_L = 36 // 0.5 in
const MARGIN_R = 36
const MARGIN_T = 36

// Layout helper: track current Y position as we draw top-to-bottom
function createCursor(startY) {
  return {
    y: startY,
    move(dy) { this.y -= dy; return this.y },
  }
}

// Replace en-dash and other Unicode chars that StandardFonts can't render
function asciify(s) {
  if (s == null) return ''
  return String(s)
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/&/g, '&')
    .replace(/[^\x20-\x7E]/g, '?') // last-resort: replace anything still non-ASCII
}

export async function downloadCpaPdf({ submissions, monthlyExpenses, year }) {
  const d = buildCpaReportData(submissions, monthlyExpenses, year)
  d.debtBuckets = d.debtRows.reduce((acc, r) => { acc[r.label] = r.amount; return acc }, {})

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')

  const pdfDoc = await PDFDocument.create()
  pdfDoc.setTitle('ROS YTD ' + d.year + ' Financial Reconciliation')
  pdfDoc.setAuthor('Reliable Oilfield Services LLC')
  pdfDoc.setCreator('Reliable Track')

  const page = pdfDoc.addPage([PAGE_W, PAGE_H])
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  const cur = createCursor(PAGE_H - MARGIN_T)

  const DARK = rgb(0.06, 0.12, 0.22)    // #0f1f38
  const GRAY = rgb(0.28, 0.34, 0.41)    // #475569
  const HEADER_BG = rgb(0.95, 0.96, 0.97) // #f1f5f9
  const DEBT_BG = rgb(0.996, 0.95, 0.78)  // #fef3c7
  const DEBT_BORDER = rgb(0.57, 0.25, 0.05) // #92400e
  const LINE_LIGHT = rgb(0.95, 0.96, 0.97)
  const LINE_DARK = rgb(0.28, 0.34, 0.41)

  function drawText(text, x, y, opts = {}) {
    page.drawText(asciify(text), {
      x, y,
      size: opts.size || 9,
      font: opts.bold ? fontBold : (opts.italic ? fontItalic : fontRegular),
      color: opts.color || DARK,
      maxWidth: opts.maxWidth,
    })
  }

  function drawTextRight(text, rightX, y, opts = {}) {
    const t = asciify(text)
    const size = opts.size || 9
    const font = opts.bold ? fontBold : fontRegular
    const w = font.widthOfTextAtSize(t, size)
    page.drawText(t, { x: rightX - w, y, size, font, color: opts.color || DARK })
  }

  function drawWrappedText(text, x, y, maxWidth, opts = {}) {
    const t = asciify(text)
    const size = opts.size || 9
    const lineHeight = opts.lineHeight || (size * 1.25)
    const font = opts.bold ? fontBold : fontRegular
    const words = t.split(/\s+/)
    const lines = []
    let line = ''
    for (const w of words) {
      const test = line ? line + ' ' + w : w
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line)
        line = w
      } else {
        line = test
      }
    }
    if (line) lines.push(line)
    let yy = y
    for (const l of lines) {
      page.drawText(l, { x, y: yy, size, font, color: opts.color || DARK })
      yy -= lineHeight
    }
    return y - lineHeight * lines.length
  }

  function drawRect(x, y, w, h, color) {
    page.drawRectangle({ x, y, width: w, height: h, color })
  }

  function drawHorizontalLine(y, color, thickness) {
    page.drawLine({
      start: { x: MARGIN_L, y },
      end: { x: PAGE_W - MARGIN_R, y },
      thickness: thickness || 0.5,
      color: color || LINE_LIGHT,
    })
  }

  const contentW = PAGE_W - MARGIN_L - MARGIN_R

  // ── Header ─────────────────────────────────────────────────────────
  drawText('Reliable Oilfield Services LLC', MARGIN_L, cur.y, { size: 13, bold: true, color: DARK })
  drawText('YTD ' + d.year + ' Financial Reconciliation', MARGIN_L + 220, cur.y, { size: 13, bold: true, color: DARK })
  cur.move(16)
  const ts = new Date().toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })
  drawText('Generated ' + ts + ' from Reliable Track app data. Prepared for CPA review.', MARGIN_L, cur.y, { size: 7, color: GRAY })
  cur.move(8)
  page.drawLine({
    start: { x: MARGIN_L, y: cur.y },
    end: { x: PAGE_W - MARGIN_R, y: cur.y },
    thickness: 1,
    color: DARK,
  })
  cur.move(14)

  // ── Section 1: Operating P&L ──────────────────────────────────────
  drawText('1. Operating P&L (deductible expenses only)', MARGIN_L, cur.y, { size: 11, bold: true })
  cur.move(14)

  // Table header background bar
  drawRect(MARGIN_L, cur.y - 2, contentW, 14, HEADER_BG)
  drawText('Line', MARGIN_L + 4, cur.y + 2, { size: 9, bold: true, color: GRAY })
  drawText('Source', MARGIN_L + 240, cur.y + 2, { size: 9, bold: true, color: GRAY })
  drawTextRight('Amount', PAGE_W - MARGIN_R - 4, cur.y + 2, { size: 9, bold: true, color: GRAY })
  cur.move(14)
  drawHorizontalLine(cur.y + 2, LINE_DARK, 0.5)
  cur.move(4)

  const plRows = [
    ['Revenue (PM/SC billed, billable only)', d.revRecords + ' work-order submissions', fmtMoney(d.revenue)],
    ['Tech-side expenses (field expense reports)', d.techExpRecords + ' records', '(' + fmtMoney(d.techExp) + ')'],
    ['Office expenses - Fixed', 'Insurance / lot rent / fleet / utilities', '(' + fmtMoney(d.catTotals.Fixed) + ')'],
    ['Office expenses - Payroll', 'Intuit payroll + tax + 401k', '(' + fmtMoney(d.catTotals.Payroll) + ')'],
    ['Office expenses - Other', 'Fuel / parts / govt fees / vendors', '(' + fmtMoney(d.catTotals.Other) + ')'],
  ]
  for (const [line, src, amt] of plRows) {
    drawText(line, MARGIN_L + 4, cur.y, { size: 9 })
    drawText(src, MARGIN_L + 240, cur.y, { size: 9, color: GRAY })
    drawTextRight(amt, PAGE_W - MARGIN_R - 4, cur.y, { size: 9 })
    cur.move(13)
    drawHorizontalLine(cur.y + 2, LINE_LIGHT)
  }
  cur.move(2)
  drawHorizontalLine(cur.y + 4, LINE_DARK, 0.7)
  drawText('NET OPERATING P&L', MARGIN_L + 4, cur.y - 4, { size: 10, bold: true })
  drawTextRight(fmtMoney(d.netPL), PAGE_W - MARGIN_R - 4, cur.y - 4, { size: 10, bold: true })
  cur.move(18)

  // ── Section 2: Debt Service ───────────────────────────────────────
  drawText('2. Debt Service / Capital purchases (NON-deductible - excluded from P&L above)', MARGIN_L, cur.y, { size: 11, bold: true })
  cur.move(14)

  drawRect(MARGIN_L, cur.y - 2, contentW, 14, DEBT_BG)
  drawText('Vendor / category', MARGIN_L + 4, cur.y + 2, { size: 9, bold: true, color: DEBT_BORDER })
  drawText('Amount', MARGIN_L + 180, cur.y + 2, { size: 9, bold: true, color: DEBT_BORDER })
  drawText('Treatment note', MARGIN_L + 250, cur.y + 2, { size: 9, bold: true, color: DEBT_BORDER })
  cur.move(14)
  drawHorizontalLine(cur.y + 2, DEBT_BORDER, 0.5)
  cur.move(4)

  for (const r of d.debtRows) {
    drawText(r.label, MARGIN_L + 4, cur.y, { size: 9 })
    drawText(fmtMoney(r.amount), MARGIN_L + 180, cur.y, { size: 9 })
    if (r.note) {
      drawText(r.note, MARGIN_L + 250, cur.y, { size: 7, color: GRAY })
    }
    cur.move(13)
    drawHorizontalLine(cur.y + 2, LINE_LIGHT)
  }
  cur.move(2)
  drawHorizontalLine(cur.y + 4, DEBT_BORDER, 0.7)
  drawText('TOTAL Debt Service', MARGIN_L + 4, cur.y - 4, { size: 10, bold: true })
  drawText(fmtMoney(d.debtService), MARGIN_L + 180, cur.y - 4, { size: 10, bold: true })
  cur.move(18)

  // ── Section 3: CPA decision items ─────────────────────────────────
  drawText('3. CPA decisions requested', MARGIN_L, cur.y, { size: 11, bold: true })
  cur.move(14)

  const equipAmt = (d.debtBuckets['American Momentum (BMS equipment)'] || 0) + (d.debtBuckets['Carvana (vehicle down pmts)'] || 0)
  const actions = [
    {
      title: 'Sec 179 / bonus depreciation election on 2026 equipment purchases.',
      body: 'BMS controllers (' + fmtMoney(d.debtBuckets['American Momentum (BMS equipment)'] || 0) + ' via American Momentum) + Carvana vehicle down payments (' + fmtMoney(d.debtBuckets['Carvana (vehicle down pmts)'] || 0) + ') are capital purchases totaling ' + fmtMoney(equipAmt) + '. If elected as Sec 179, becomes a direct deduction in current year - Net P&L drops accordingly.',
    },
    {
      title: 'Split principal vs interest on American Momentum + Carvana monthly payments.',
      body: 'Currently lumped entirely into Debt Service. Interest portion is deductible operating expense.',
    },
    {
      title: 'Reconcile variance between QuickBooks accrual NI and this cash-basis report.',
      body: 'Likely sources: depreciation on existing fixed assets, accrued AP not yet on app, accrued payroll. Please confirm.',
    },
    {
      title: 'Verify Fundbox interest schedule used for 2026 deduction.',
      body: 'YTD interest is broken out as deductible Other opex. Confirm against Fundbox statement.',
    },
  ]
  for (const a of actions) {
    drawText('* ' + a.title, MARGIN_L, cur.y, { size: 9, bold: true })
    cur.move(11)
    cur.y = drawWrappedText(a.body, MARGIN_L + 12, cur.y, contentW - 12, { size: 8, color: GRAY, lineHeight: 10 }) - 4
  }

  // ── Footer ─────────────────────────────────────────────────────────
  cur.move(8)
  drawHorizontalLine(cur.y, LINE_LIGHT)
  cur.move(8)
  drawWrappedText(
    'Numbers sourced from Reliable Track app data (monthly_expenses + submissions tables). This report excludes the bank-derived cash-flow reconciliation section (which requires the bank XLS statement) - for that, use scripts/generate_cpa_pdf.py locally. Live dashboard: pm.reliable-oilfield-services.com',
    MARGIN_L, cur.y, contentW, { size: 7, color: GRAY, lineHeight: 9 }
  )

  // ── Save and download ──────────────────────────────────────────────
  const bytes = await pdfDoc.save()
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ROS_YTD_Reconciliation_' + d.year + '_' + new Date().toISOString().slice(0, 10) + '.pdf'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)

  return d
}
