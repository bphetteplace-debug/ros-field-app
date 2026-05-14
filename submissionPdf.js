// src/lib/submissionPdf.js
// Client-side PDF generation for PM and Service Call submissions.
// Layout matches the GoCanvas "ROS Preventive Maintenance" PDF format:
//   - Logo top-left, "ROS Work Order" title, No. top-right
//   - Black bar section headers with white text
//   - Customer Information with site sign photo + GPS map side-by-side
//   - Description of Work (summary)
//   - Completed Work — tech name + tech signature image + work photos
//   - Flare/Combustor PM — one section per flare with arrestor photos + ID tags
//   - Heater Treater PM — one section per heater with firetube photos
//   - Parts table with thumbnail per row
//   - Labor / Mileage blocks (Mileage includes departing GPS map)
//   - Customer Sign-off (signature image)
//   - Cost summary on the final page
//
// Title is "ROS Work Order" for BOTH PM and Service Call (per spec).
// PDF is generated CLIENT-SIDE only — do not import pdf-lib in any /api file.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { LOGO_PNG_B64 } from './rosLogo'
import { getPhotoUrl } from './submissions'

const PAGE_W   = 612
const PAGE_H   = 792
const MARGIN   = 40
const FOOTER_Y = 30
const HEADER_RESERVED = 110   // top of page reserved for header band

const BLACK = rgb(0, 0, 0)
const WHITE = rgb(1, 1, 1)
const GRAY  = rgb(0.5, 0.5, 0.5)

const COMPANY    = 'Reliable Oilfield Services'
const COMPANY_FOOTER = 'Reliable Oilfield Services  |  reports@reliable-oilfield-services.com'

// ---------- public API ----------

/**
 * Generates a PDF for one submission. Returns a Uint8Array.
 * `submission` is the row from Supabase plus joined `photos` array.
 * Photos array shape: { id, storage_path, section, caption, display_order }
 */
export async function generateSubmissionPdf(submission) {
  const doc = await PDFDocument.create()
  const font     = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

  // Embed logo once, reuse on every page
  let logoImg = null
  try {
    const logoBytes = base64ToBytes(LOGO_PNG_B64)
    logoImg = await doc.embedPng(logoBytes)
  } catch (e) {
    console.warn('logo embed failed:', e)
  }

  const pad = String(submission.pm_number || '0').padStart(5, '0')
  const photos = submission.photos || []
  const d = submission.data || {}

  // Photo buckets — section names match what FormPage uploads with
  const bySection = (name) => photos.filter(p => p.section === name)
  const sitePhotos     = bySection('site')
  const gpsPhotos      = bySection('gps_start')
  const departGpsPhotos= bySection('gps_depart')
  const workPhotos     = bySection('work')
  const customerSig    = bySection('customer-sig')[0] || bySection('customer_sig')[0]
  const techSigs       = photos.filter(p => /^sig[-_]/.test(p.section || ''))

  // Equipment photo helpers — match the upload patterns from FormPage
  const arrestorPhotos = (idx, slot) => photos.filter(p =>
    p.section === `arrestor-${idx}-${slot}` || p.section === `arr_${idx}_${slot}`
  )
  const flarePhotos = (idx, slot) => photos.filter(p =>
    p.section === `flare-${idx}-${slot}` || p.section === `flare_${idx}_${slot}`
  )
  const heaterPhotos = (hi, fi, slot) => photos.filter(p =>
    p.section === `heater-${hi}-firetube-${fi}-${slot}`
    || p.section === `heater_${hi}_ft_${fi}_${slot}`
  )
  const partPhotos = (sku) => photos.filter(p =>
    p.section === `part-${sku}` || p.section === `part_${sku}`
  )

  const ctx = {
    doc, font, fontBold, logoImg,
    pmNumber: pad,
    template: submission.template || 'PM',
    page: null, y: 0, pageNumber: 0,
  }

  newPage(ctx)

  // ========== Customer Information ==========
  drawSectionBar(ctx, 'Customer Information')
  drawCustomerInfo(ctx, submission)
  await drawSiteSignAndGps(ctx, sitePhotos, gpsPhotos)

  // ========== Description of Work ==========
  drawSectionBar(ctx, 'Description of Work')
  drawWrappedText(ctx, submission.summary || '', { size: 11 })

  // ========== Completed Work ==========
  if (techSigs.length > 0 || workPhotos.length > 0 || (Array.isArray(d.techs) && d.techs.length > 0)) {
    drawSectionBar(ctx, 'Completed Work')

    // Tech name(s) + signature(s)
    const techs = Array.isArray(d.techs) ? d.techs : []
    if (techs.length > 0) {
      drawLabelAndValue(ctx, 'Tech Name:', techs.join(', '))
    }
    if (techSigs.length > 0) {
      ctx.y -= 4
      drawTinyLabel(ctx, 'Tech Signature:')
      await drawSignatureRow(ctx, techSigs)
    }

    // Work photos
    if (workPhotos.length > 0) {
      ctx.y -= 6
      drawTinyLabel(ctx, 'Completed Work:')
      await drawPhotoGrid(ctx, workPhotos, { photoW: 240, photoH: 180, cols: 2 })
    }
  }

  // ========== Flare / Combustor PM sections ==========
  const flares = Array.isArray(d.flares) ? d.flares : []
  for (let i = 0; i < flares.length; i++) {
    const f = flares[i] || {}
    drawSectionBar(ctx, `Flare/Combustor PM(${i + 1})`)
    await drawFlareSection(ctx, f, i, flarePhotos, arrestorPhotos)
  }

  // ========== Heater Treater PM sections ==========
  const heaters = Array.isArray(d.heaters) ? d.heaters : []
  for (let hi = 0; hi < heaters.length; hi++) {
    const h = heaters[hi] || {}
    drawSectionBar(ctx, `Heater Treater PM(${hi + 1})`)
    await drawHeaterSection(ctx, h, hi, heaterPhotos)
  }

  // ========== Parts ==========
  const parts = Array.isArray(d.parts) ? d.parts : []
  if (parts.length > 0) {
    drawSectionBar(ctx, 'Parts')
    await drawPartsTable(ctx, parts, partPhotos)
  }

  // ========== Labor ==========
  drawSectionBar(ctx, 'Labor')
  drawLaborBlock(ctx, submission, d)

  // ========== Mileage ==========
  drawSectionBar(ctx, 'Mileage')
  await drawMileageBlock(ctx, submission, departGpsPhotos)

  // ========== Customer Sign-off ==========
  if (customerSig) {
    drawSectionBar(ctx, 'Customer Sign-off')
    ctx.y -= 2
    drawTinyLabel(ctx, 'Customer Signature / Approval:')
    await drawSignatureImage(ctx, customerSig)
  }

  // ========== Cost summary ==========
  // Hide totals on warranty jobs (per project rule)
  const isWarranty = !!d.warranty_work
  if (isWarranty) {
    newPage(ctx)
    drawSectionBar(ctx, 'Cost')
    drawWarrantyStamp(ctx)
  } else {
    newPage(ctx)
    drawSectionBar(ctx, 'Cost')
    drawCostSummary(ctx, submission, d)
  }

  finalizePages(ctx)
  return await doc.save()
}

/** Convenience for fire-and-forget email pipeline. */
export async function generateSubmissionPdfBase64(submission) {
  const bytes = await generateSubmissionPdf(submission)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// ---------- section drawers ----------

function drawCustomerInfo(ctx, s) {
  // Three columns of label/value pairs, matching the GoCanvas layout
  const left   = MARGIN
  const mid    = MARGIN + (PAGE_W - MARGIN * 2) / 3
  const right  = MARGIN + 2 * (PAGE_W - MARGIN * 2) / 3

  // Build rows top-to-bottom for each column
  const leftCol = [
    ['Customer Name:',     s.customer_name],
    ['Location Name:',     s.location_name],
    ['GL Code:',           s.gl_code],
    ['Equipment Asset Tag:', s.asset_tag],
    ['Customer Work Order:', s.work_order],
  ]
  const midCol = [
    ['ROS Truck Number:',  s.truck_number],
    ['Customer Contact:',  s.contact],
    ['Type of work:',      s.work_type],
    ['Work Area:',         s.work_area],
    ['Date:',              s.date],
  ]
  const rightCol = [
    ['Start Time:',        s.start_time],
    ['Website:',           'Reliable-Oilfield-Services.com'],
  ]

  const startY = ctx.y

  const colInnerW = (PAGE_W - MARGIN * 2) / 3 - 8

  // Pre-compute each column's row heights so all 3 columns share the same
  // tallest-row spacing — keeps things aligned even when one column wraps.
  const rowHeightFor = (rows) =>
    rows.map(([_, v]) => {
      const val = (v == null || v === '') ? '—' : String(v)
      const lines = wrapText(val, ctx.font, 11, colInnerW).slice(0, 2)
      return 12 + lines.length * 13 + 4  // label(12) + lines + gap(4)
    })

  const lh = rowHeightFor(leftCol)
  const mh = rowHeightFor(midCol)
  const rh = rowHeightFor(rightCol)
  const maxRows = Math.max(leftCol.length, midCol.length, rightCol.length)
  const rowHeights = []
  for (let i = 0; i < maxRows; i++) {
    rowHeights.push(Math.max(lh[i] || 0, mh[i] || 0, rh[i] || 0))
  }

  const drawCol = (rows, x) => {
    let y = startY
    for (let i = 0; i < rows.length; i++) {
      const [label, value] = rows[i]
      const rowH = rowHeights[i]
      ctx.page.drawText(label, {
        x, y, size: 9, font: ctx.fontBold, color: BLACK,
      })
      const val = (value == null || value === '') ? '—' : String(value)
      const lines = wrapText(val, ctx.font, 11, colInnerW).slice(0, 2)
      let vy = y - 12
      for (const line of lines) {
        ctx.page.drawText(line, {
          x, y: vy, size: 11, font: ctx.font, color: BLACK,
        })
        vy -= 13
      }
      y -= rowH
    }
    return y
  }

  const y1 = drawCol(leftCol,  left)
  const y2 = drawCol(midCol,   mid)
  const y3 = drawCol(rightCol, right)

  ctx.y = Math.min(y1, y2, y3) - 6
}

async function drawSiteSignAndGps(ctx, sitePhotos, gpsPhotos) {
  const site = sitePhotos[0]
  const gps  = gpsPhotos[0]
  if (!site && !gps) return

  ensureSpace(ctx, 220)
  const photoW = 220, photoH = 200, gap = 20

  // Labels
  if (site) drawTinyLabel(ctx, 'Site Sign:', MARGIN)
  if (gps)  drawTinyLabel(ctx, 'GPS:',       MARGIN + photoW + gap, ctx.y + 12)
  ctx.y -= 2

  // Side-by-side photos
  const yBase = ctx.y - photoH
  if (site) await drawSinglePhoto(ctx, site, MARGIN, yBase, photoW, photoH)
  if (gps)  await drawSinglePhoto(ctx, gps,  MARGIN + photoW + gap, yBase, photoW, photoH)
  ctx.y -= photoH + 8
}

async function drawFlareSection(ctx, flare, idx, flarePhotos, arrestorPhotos) {
  // Layout matches GoCanvas: Flare Serial photo + Arrestor ID photos in 3-column grid
  // Plus key/value status indicators on the left

  // Row 1: Flare Serial (text/photo) + Arr 1 photos
  ensureSpace(ctx, 240)

  const colW = (PAGE_W - MARGIN * 2 - 20) / 3
  const photoH = 160

  // Column labels
  drawTinyLabel(ctx, 'Flare Serial Number:', MARGIN)
  drawTinyLabel(ctx, 'Arr 1 ID Tag:',        MARGIN + colW + 10)
  drawTinyLabel(ctx, 'Arr 1 ID Tag:',        MARGIN + (colW + 10) * 2)
  ctx.y -= 2

  // Render whatever photos are present in each column slot
  const yBase = ctx.y - photoH
  const flarePhoto = flarePhotos(idx, 'serial')[0]
  const arr1a      = arrestorPhotos(idx, 'tag1')[0] || arrestorPhotos(idx, 'before1')[0]
  const arr1b      = arrestorPhotos(idx, 'tag2')[0] || arrestorPhotos(idx, 'before2')[0]
  if (flarePhoto) await drawSinglePhoto(ctx, flarePhoto, MARGIN, yBase, colW, photoH)
  if (arr1a)      await drawSinglePhoto(ctx, arr1a, MARGIN + colW + 10, yBase, colW, photoH)
  if (arr1b)      await drawSinglePhoto(ctx, arr1b, MARGIN + (colW + 10) * 2, yBase, colW, photoH)

  ctx.y -= photoH + 16

  // Status indicators column (left side) + remaining arrestor slots (right)
  ensureSpace(ctx, 100)
  const startY = ctx.y

  // Left column — status indicators
  const leftRows = [
    ['Pump Motor:',         flare.pump_motor],
    ['Level Switch Functional:', flare.level_switch],
    ['Fluid Pumped Off:',   flare.fluid_pumped_off],
    ['Fan Motor Functional:', flare.fan_motor],
  ]
  let ly = startY
  for (const [label, value] of leftRows) {
    ctx.page.drawText(label, { x: MARGIN, y: ly, size: 9, font: ctx.fontBold, color: BLACK })
    ctx.page.drawText(String(value || 'N/A'), {
      x: MARGIN, y: ly - 12, size: 11, font: ctx.font, color: BLACK,
    })
    ly -= 26
  }

  // Right two columns — Arr 2 through Arr 5 ID Tags
  const rightLabels = [
    ['Arr 2 ID Tag:', 2], ['Arr 3 ID Tag:', 3],
    ['Arr 4 ID Tag:', 4], ['Arr 5 ID Tag:', 5],
  ]
  let ry = startY
  for (const [label, n] of rightLabels) {
    // Two columns — middle and right
    ctx.page.drawText(label, {
      x: MARGIN + colW + 10, y: ry, size: 9, font: ctx.fontBold, color: BLACK,
    })
    ctx.page.drawText(label, {
      x: MARGIN + (colW + 10) * 2, y: ry, size: 9, font: ctx.fontBold, color: BLACK,
    })
    const v1 = (flare[`arr_${n}_tag_a`] || flare[`arr${n}_tag1`] || flare.arrestors?.[n - 1]?.id_a || 'N/A')
    const v2 = (flare[`arr_${n}_tag_b`] || flare[`arr${n}_tag2`] || flare.arrestors?.[n - 1]?.id_b || 'N/A')
    ctx.page.drawText(String(v1), {
      x: MARGIN + colW + 10, y: ry - 12, size: 11, font: ctx.font, color: BLACK,
    })
    ctx.page.drawText(String(v2), {
      x: MARGIN + (colW + 10) * 2, y: ry - 12, size: 11, font: ctx.font, color: BLACK,
    })
    ry -= 26
  }

  ctx.y = Math.min(ly, ry) - 4
}

async function drawHeaterSection(ctx, heater, hi, heaterPhotos) {
  // Heater label + per-firetube rows
  if (heater.heaterId || heater.id) {
    drawLabelAndValue(ctx, 'Heater ID:', heater.heaterId || heater.id)
  }
  if (heater.condition) {
    drawLabelAndValue(ctx, 'Overall Condition:', heater.condition)
  }
  if (heater.notes) {
    drawLabelAndValue(ctx, 'Notes:', heater.notes)
  }

  const firetubes = Array.isArray(heater.firetubes) ? heater.firetubes : []
  for (let fi = 0; fi < firetubes.length; fi++) {
    const ft = firetubes[fi] || {}
    ensureSpace(ctx, 50)
    ctx.page.drawText(`Firetube ${fi + 1}`, {
      x: MARGIN, y: ctx.y, size: 11, font: ctx.fontBold, color: BLACK,
    })
    ctx.y -= 14
    if (ft.condition) drawLabelAndValue(ctx, 'Condition:', ft.condition)

    const ftPhotos = [
      ...heaterPhotos(hi, fi, 'before'),
      ...heaterPhotos(hi, fi, 'after'),
      ...heaterPhotos(hi, fi, 'photo1'),
      ...heaterPhotos(hi, fi, 'photo2'),
    ]
    if (ftPhotos.length) {
      await drawPhotoGrid(ctx, ftPhotos, { photoW: 200, photoH: 150, cols: 2 })
    }
  }
}

async function drawPartsTable(ctx, parts, partPhotos) {
  // Columns: Part Description | Part # | Description of Parts Used | Pic 1 | Pic 2 | Price | Qty | Cost
  // Layout — fixed widths, header row first, then one row per part
  const usableW = PAGE_W - MARGIN * 2

  // Column widths (in points). Header labels are kept short to fit each column.
  const cols = [
    { key: 'desc',       label: 'Description',  w: 110 },
    { key: 'part_no',    label: 'Part #',       w: 75 },
    { key: 'desc_used',  label: 'Used',         w: 60 },
    { key: 'pic1',       label: 'Pic 1',        w: 56 },
    { key: 'pic2',       label: 'Pic 2',        w: 56 },
    { key: 'price',      label: 'Price',        w: 55, align: 'right' },
    { key: 'qty',        label: 'Qty',          w: 40, align: 'right' },
    { key: 'cost',       label: 'Cost',         w: 80, align: 'right' },
  ]
  const totalW = cols.reduce((s, c) => s + c.w, 0)
  if (totalW > usableW) {
    // Should be 508pt, fits 532 — but if anyone widens columns later this catches it
    console.warn('parts columns total wider than usable width:', totalW, '>', usableW)
  }

  // Header row
  ensureSpace(ctx, 30)
  const headerY = ctx.y
  ctx.page.drawRectangle({
    x: MARGIN, y: headerY - 16, width: usableW, height: 18,
    color: rgb(0.95, 0.95, 0.95),
  })
  let cx = MARGIN
  for (const col of cols) {
    const tx = col.align === 'right' ? cx + col.w - 4 : cx + 4
    const label = col.label
    const textW = ctx.fontBold.widthOfTextAtSize(label, 9)
    ctx.page.drawText(label, {
      x: col.align === 'right' ? tx - textW : tx,
      y: headerY - 12, size: 9, font: ctx.fontBold, color: BLACK,
    })
    cx += col.w
  }
  ctx.y -= 22

  // Rows
  for (const p of parts) {
    const rowHeight = 60   // Tall enough for thumbnails
    ensureSpace(ctx, rowHeight + 4)
    const rowY = ctx.y

    const sku = p.sku || p.code || ''
    const name = p.name || p.desc || ''
    const qty = Number(p.qty || 0)
    const price = Number(p.price || 0)
    const cost = qty * price

    const pics = partPhotos(sku).slice(0, 2)

    // Border line under row
    ctx.page.drawLine({
      start: { x: MARGIN,           y: rowY - rowHeight },
      end:   { x: MARGIN + usableW, y: rowY - rowHeight },
      thickness: 0.4, color: rgb(0.85, 0.85, 0.85),
    })

    cx = MARGIN

    // Column 1: Part Description (the readable name)
    drawCellText(ctx, name, cx + 4, rowY - 14, cols[0].w - 8, 9)
    cx += cols[0].w

    // Column 2: Part # (the SKU)
    drawCellText(ctx, sku, cx + 4, rowY - 14, cols[1].w - 8, 9)
    cx += cols[1].w

    // Column 3: Description of Parts Used (same as part description by default)
    drawCellText(ctx, name, cx + 4, rowY - 14, cols[2].w - 8, 9)
    cx += cols[2].w

    // Column 4: Part Picture 1
    if (pics[0]) {
      await drawSinglePhoto(ctx, pics[0], cx + 2, rowY - rowHeight + 2, cols[3].w - 4, rowHeight - 4)
    }
    cx += cols[3].w

    // Column 5: Part Picture 2
    if (pics[1]) {
      await drawSinglePhoto(ctx, pics[1], cx + 2, rowY - rowHeight + 2, cols[4].w - 4, rowHeight - 4)
    }
    cx += cols[4].w

    // Column 6: Price (right-aligned)
    const priceStr = `$${price.toFixed(2)}`
    const priceW = ctx.font.widthOfTextAtSize(priceStr, 9)
    ctx.page.drawText(priceStr, {
      x: cx + cols[5].w - 4 - priceW, y: rowY - 14,
      size: 9, font: ctx.font, color: BLACK,
    })
    cx += cols[5].w

    // Column 7: Qty (right-aligned)
    const qtyStr = qty.toFixed(2)
    const qtyW = ctx.font.widthOfTextAtSize(qtyStr, 9)
    ctx.page.drawText(qtyStr, {
      x: cx + cols[6].w - 4 - qtyW, y: rowY - 14,
      size: 9, font: ctx.font, color: BLACK,
    })
    cx += cols[6].w

    // Column 8: Cost (right-aligned, bold)
    const costStr = `$${cost.toFixed(2)}`
    const costW = ctx.fontBold.widthOfTextAtSize(costStr, 9)
    ctx.page.drawText(costStr, {
      x: cx + cols[7].w - 4 - costW, y: rowY - 14,
      size: 9, font: ctx.fontBold, color: BLACK,
    })

    ctx.y -= rowHeight + 2
  }
}

function drawLaborBlock(ctx, s, d) {
  const hrs = Number(s.labor_hours || 0)
  const rate = Number(s.labor_rate || 0)
  const total = Number(d.labor_total || (hrs * rate))

  ensureSpace(ctx, 50)
  const leftX = MARGIN, rightX = MARGIN + (PAGE_W - MARGIN * 2) / 2

  ctx.page.drawText('Hours:', { x: leftX, y: ctx.y, size: 9, font: ctx.fontBold, color: BLACK })
  ctx.page.drawText('Labor Total:', { x: rightX, y: ctx.y, size: 9, font: ctx.fontBold, color: BLACK })
  ctx.y -= 12
  ctx.page.drawText(hrs.toFixed(2), { x: leftX, y: ctx.y, size: 11, font: ctx.font, color: BLACK })
  ctx.page.drawText(total.toFixed(2), { x: rightX, y: ctx.y, size: 11, font: ctx.font, color: BLACK })
  ctx.y -= 16
  ctx.page.drawText('Hourly Rate:', { x: leftX, y: ctx.y, size: 9, font: ctx.fontBold, color: BLACK })
  ctx.y -= 12
  ctx.page.drawText(`$${rate.toFixed(2)}`, { x: leftX, y: ctx.y, size: 11, font: ctx.font, color: BLACK })
  ctx.y -= 14
}

async function drawMileageBlock(ctx, s, departGpsPhotos) {
  const miles = Number(s.miles || 0)
  const cpm = Number(s.cost_per_mile || 0)
  const cost = miles * cpm

  ensureSpace(ctx, 50)
  const leftX = MARGIN, rightX = MARGIN + (PAGE_W - MARGIN * 2) / 2

  ctx.page.drawText('Miles:', { x: leftX, y: ctx.y, size: 9, font: ctx.fontBold, color: BLACK })
  ctx.page.drawText('Mileage Cost:', { x: rightX, y: ctx.y, size: 9, font: ctx.fontBold, color: BLACK })
  ctx.y -= 12
  ctx.page.drawText(String(miles), { x: leftX, y: ctx.y, size: 11, font: ctx.font, color: BLACK })
  ctx.page.drawText(cost.toFixed(2), { x: rightX, y: ctx.y, size: 11, font: ctx.font, color: BLACK })
  ctx.y -= 16

  ctx.page.drawText('Cost Per Mile:', { x: leftX, y: ctx.y, size: 9, font: ctx.fontBold, color: BLACK })
  ctx.page.drawText('Departure Time:', { x: rightX, y: ctx.y, size: 9, font: ctx.fontBold, color: BLACK })
  ctx.y -= 12
  ctx.page.drawText(`$${cpm.toFixed(2)}`, { x: leftX, y: ctx.y, size: 11, font: ctx.font, color: BLACK })
  ctx.page.drawText(s.departure_time || '', { x: rightX, y: ctx.y, size: 11, font: ctx.font, color: BLACK })
  ctx.y -= 14

  if (departGpsPhotos && departGpsPhotos[0]) {
    drawTinyLabel(ctx, 'Departing GPS:')
    ensureSpace(ctx, 200)
    const yBase = ctx.y - 180
    await drawSinglePhoto(ctx, departGpsPhotos[0], MARGIN, yBase, 220, 180)
    ctx.y -= 184
  }
}

function drawCostSummary(ctx, s, d) {
  const labor   = Number(d.labor_total   || 0)
  const parts   = Number(d.parts_total   || 0)
  const mileage = Number(d.mileage_total || 0)
  const total   = Number(d.grand_total   || (labor + parts + mileage))

  ensureSpace(ctx, 80)
  const leftX = MARGIN, rightX = MARGIN + (PAGE_W - MARGIN * 2) / 2

  ctx.page.drawText('Labor Cost:', { x: leftX, y: ctx.y, size: 9, font: ctx.fontBold, color: BLACK })
  ctx.page.drawText('Mileage Cost:', { x: rightX, y: ctx.y, size: 9, font: ctx.fontBold, color: BLACK })
  ctx.y -= 12
  ctx.page.drawText(labor.toFixed(2), { x: leftX, y: ctx.y, size: 11, font: ctx.font, color: BLACK })
  ctx.page.drawText(mileage.toFixed(2), { x: rightX, y: ctx.y, size: 11, font: ctx.font, color: BLACK })
  ctx.y -= 18

  ctx.page.drawText('Parts Cost:', { x: leftX, y: ctx.y, size: 9, font: ctx.fontBold, color: BLACK })
  ctx.page.drawText('Total Cost:', { x: rightX, y: ctx.y, size: 9, font: ctx.fontBold, color: BLACK })
  ctx.y -= 12
  ctx.page.drawText(`$${parts.toFixed(2)}`, { x: leftX, y: ctx.y, size: 11, font: ctx.font, color: BLACK })
  ctx.page.drawText(`$${total.toFixed(2)}`, { x: rightX, y: ctx.y, size: 13, font: ctx.fontBold, color: BLACK })
  ctx.y -= 24
}

function drawWarrantyStamp(ctx) {
  ensureSpace(ctx, 80)
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 50, width: PAGE_W - MARGIN * 2, height: 60,
    borderColor: rgb(0.6, 0.4, 0), borderWidth: 2, color: rgb(1, 0.97, 0.8),
  })
  const txt = 'WARRANTY — NO CHARGE'
  const w = ctx.fontBold.widthOfTextAtSize(txt, 22)
  ctx.page.drawText(txt, {
    x: PAGE_W / 2 - w / 2, y: ctx.y - 32,
    size: 22, font: ctx.fontBold, color: rgb(0.5, 0.3, 0),
  })
  ctx.y -= 70
}

// ---------- primitive drawers ----------

function newPage(ctx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H])
  ctx.pageNumber += 1
  ctx.y = PAGE_H - HEADER_RESERVED
}

function ensureSpace(ctx, needed) {
  if (ctx.y - needed < FOOTER_Y + 20) newPage(ctx)
}

function drawSectionBar(ctx, label) {
  ensureSpace(ctx, 36)
  ctx.y -= 6
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 22, width: PAGE_W - MARGIN * 2, height: 26,
    color: BLACK,
  })
  const size = 13
  const w = ctx.fontBold.widthOfTextAtSize(label, size)
  ctx.page.drawText(label, {
    x: (PAGE_W - w) / 2, y: ctx.y - 16,
    size, font: ctx.fontBold, color: WHITE,
  })
  ctx.y -= 34
}

function drawLabelAndValue(ctx, label, value) {
  if (value == null || value === '') return
  ensureSpace(ctx, 30)
  ctx.page.drawText(label, { x: MARGIN, y: ctx.y, size: 9, font: ctx.fontBold, color: BLACK })
  ctx.y -= 12
  const lines = wrapText(String(value), ctx.font, 11, PAGE_W - MARGIN * 2)
  for (const line of lines) {
    ensureSpace(ctx, 14)
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size: 11, font: ctx.font, color: BLACK })
    ctx.y -= 14
  }
  ctx.y -= 4
}

function drawTinyLabel(ctx, label, x = MARGIN, y = null) {
  if (y == null) {
    ensureSpace(ctx, 14)
    ctx.page.drawText(label, { x, y: ctx.y, size: 9, font: ctx.fontBold, color: BLACK })
    ctx.y -= 12
  } else {
    ctx.page.drawText(label, { x, y, size: 9, font: ctx.fontBold, color: BLACK })
  }
}

function drawCellText(ctx, text, x, y, maxW, size) {
  if (!text) return
  const lines = wrapText(String(text), ctx.font, size, maxW)
  let yy = y
  for (const line of lines.slice(0, 4)) {
    ctx.page.drawText(line, { x, y: yy, size, font: ctx.font, color: BLACK })
    yy -= size + 2
  }
}

function drawWrappedText(ctx, text, opts = {}) {
  const size = opts.size || 11
  const lines = wrapText(String(text || ''), ctx.font, size, PAGE_W - MARGIN * 2)
  for (const line of lines) {
    ensureSpace(ctx, size + 4)
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size, font: ctx.font, color: BLACK })
    ctx.y -= size + 4
  }
  ctx.y -= 4
}

async function drawSinglePhoto(ctx, photo, x, y, w, h) {
  if (!photo) return
  const img = await embedPhoto(ctx, photo)
  if (!img) {
    // Placeholder rectangle
    ctx.page.drawRectangle({ x, y, width: w, height: h, borderColor: GRAY, borderWidth: 0.5 })
    return
  }
  const dims = img.scaleToFit(w, h)
  ctx.page.drawImage(img, {
    x: x + (w - dims.width) / 2,
    y: y + (h - dims.height) / 2,
    width: dims.width, height: dims.height,
  })
}

async function drawPhotoGrid(ctx, photos, opts) {
  const { photoW = 240, photoH = 180, cols = 2, gap = 8 } = opts
  for (let i = 0; i < photos.length; i++) {
    const col = i % cols
    if (col === 0) ensureSpace(ctx, photoH + 18)
    const x = MARGIN + col * (photoW + gap)
    const y = ctx.y - photoH
    await drawSinglePhoto(ctx, photos[i], x, y, photoW, photoH)
    if (photos[i].caption) {
      ctx.page.drawText(String(photos[i].caption).slice(0, 60), {
        x, y: y - 11, size: 8, font: ctx.font, color: GRAY,
      })
    }
    if (col === cols - 1 || i === photos.length - 1) {
      ctx.y -= photoH + 18
    }
  }
}

async function drawSignatureRow(ctx, sigs) {
  // Each signature is rendered as a 60pt-tall image at ~200pt wide, with name below
  ensureSpace(ctx, 80)
  const sigW = 180, sigH = 50, gap = 20
  let col = 0
  let baseY = ctx.y - sigH
  for (let i = 0; i < sigs.length; i++) {
    if (col >= 3) { col = 0; ctx.y -= sigH + 24; ensureSpace(ctx, 80); baseY = ctx.y - sigH }
    await drawSinglePhoto(ctx, sigs[i], MARGIN + col * (sigW + gap), baseY, sigW, sigH)
    // Sig section name often encodes the tech name as `sig-<NAME>` — strip the prefix
    const techName = String(sigs[i].section || '').replace(/^sig[-_]/, '').replace(/[-_]/g, ' ')
    ctx.page.drawText(techName, {
      x: MARGIN + col * (sigW + gap), y: baseY - 10,
      size: 8, font: ctx.font, color: GRAY,
    })
    col += 1
  }
  ctx.y -= sigH + 24
}

async function drawSignatureImage(ctx, sig) {
  ensureSpace(ctx, 70)
  await drawSinglePhoto(ctx, sig, MARGIN, ctx.y - 50, 220, 50)
  ctx.y -= 60
}

async function embedPhoto(ctx, photo) {
  const url = getPhotoUrl(photo.storage_path)
  if (!url) return null
  try {
    const bytes = await (await fetch(url)).arrayBuffer()
    try {
      return await ctx.doc.embedJpg(bytes)
    } catch {
      try { return await ctx.doc.embedPng(bytes) }
      catch (e) { console.warn('photo embed failed:', url, e); return null }
    }
  } catch (e) {
    console.warn('photo fetch failed:', url, e)
    return null
  }
}

function wrapText(text, font, size, maxW) {
  if (!text) return ['']
  const words = String(text).split(/\s+/)
  const lines = []
  let cur = ''
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w
    if (font.widthOfTextAtSize(trial, size) > maxW && cur) {
      lines.push(cur)
      cur = w
    } else {
      cur = trial
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function base64ToBytes(b64) {
  const binary = atob(b64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ---------- header/footer on every page ----------

function finalizePages(ctx) {
  const total = ctx.doc.getPageCount()
  for (let i = 0; i < total; i++) {
    const page = ctx.doc.getPage(i)
    drawHeader(page, ctx)
    drawFooter(page, ctx, i + 1, total)
  }
}

function drawHeader(page, ctx) {
  // Logo top-left (real PNG embedded)
  if (ctx.logoImg) {
    const lDims = ctx.logoImg.scaleToFit(70, 70)
    page.drawImage(ctx.logoImg, {
      x: MARGIN, y: PAGE_H - 10 - lDims.height,
      width: lDims.width, height: lDims.height,
    })
  }

  // Title centered
  const title = 'ROS Work Order'
  const tsize = 22
  const tw = ctx.fontBold.widthOfTextAtSize(title, tsize)
  page.drawText(title, {
    x: PAGE_W / 2 - tw / 2, y: PAGE_H - 50,
    size: tsize, font: ctx.fontBold, color: BLACK,
  })

  // No. block top-right
  page.drawText('No.', {
    x: PAGE_W - MARGIN - 50, y: PAGE_H - 38,
    size: 10, font: ctx.fontBold, color: BLACK,
  })
  page.drawText(ctx.pmNumber, {
    x: PAGE_W - MARGIN - 50, y: PAGE_H - 52,
    size: 12, font: ctx.font, color: BLACK,
  })
}

function drawFooter(page, ctx, n, total) {
  const left = COMPANY_FOOTER
  page.drawText(left, {
    x: MARGIN, y: FOOTER_Y,
    size: 8, font: ctx.font, color: GRAY,
  })
  const right = `Page ${n} of ${total}`
  const rw = ctx.font.widthOfTextAtSize(right, 8)
  page.drawText(right, {
    x: PAGE_W - MARGIN - rw, y: FOOTER_Y,
    size: 8, font: ctx.font, color: GRAY,
  })
}
