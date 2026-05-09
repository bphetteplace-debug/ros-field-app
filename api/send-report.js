// api/send-report.js - Vercel Serverless Function (CommonJS via api/package.json)
// Sends HTML email with PDF attachment via Resend
// pdf-lib is lazy-loaded inside handler to avoid Lambda crash
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const TO = process.env.EMAIL_TO ? process.env.EMAIL_TO.split(',').map(e => e.trim()) : ['bphetteplace@reliableoilfieldservices.net']
// FROM: domain is verified — use RESEND_FROM env var directly
const FROM = process.env.RESEND_FROM || 'ReliableTrack <reports@reliable-oilfield-services.com>'

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { submissionId } = req.body || {}
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' })
  if (!RESEND_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY' })
  if (!SUPA_KEY) return res.status(500).json({ error: 'Missing Supabase key' })

  try {
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib')

    // Fetch submission + photos
    const r = await fetch(
      SUPA_URL + '/rest/v1/submissions?id=eq.' + submissionId + '&select=*,photos(id,storage_path,caption,display_order,section)',
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }
    )
    if (!r.ok) {
      const t = await r.text()
      return res.status(500).json({ error: 'Supabase fetch failed: ' + r.status, detail: t.substring(0,200) })
    }
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found', submissionId })
    }
    const s = rows[0]
    const d = s.data || {}

    // Normalize fields
    const workType = s.work_type || d.typeOfWork || 'Billable Service'
    const jobType = d.jobType || (workType.toLowerCase().includes('pm') ? 'PM' : 'SC')
    const pmNum = s.pm_number || '????'
    const customer = s.customer_name || d.customerName || 'Unknown'
    const location = s.location_name || d.locationName || ''
    const dateStr = s.date || new Date().toISOString().slice(0, 10)
    const techs = Array.isArray(d.techs) ? d.techs : []
    const parts = Array.isArray(d.parts) ? d.parts : []
    const isWarranty = !!d.warrantyWork
    const assetTag = s.asset_tag || d.assetTag || ''
    const workArea = s.work_area || d.workArea || ''
    const lastSvcDate = d.lastServiceDate || ''
    const scEquipment = Array.isArray(d.scEquipment) ? d.scEquipment : []

    const partsTotal = parts.reduce((sum, p) => sum + (parseFloat(p.price) || 0) * (parseInt(p.qty) || 0), 0)
    const laborHours = parseFloat(d.laborHours || s.labor_hours || 0)
    const hourlyRate = parseFloat(d.hourlyRate || s.labor_rate || 115)
    const billable = parseInt(d.billableTechs || 0) || techs.length
    const miles = parseFloat(d.miles || s.miles || 0)
    const cpm = parseFloat(d.costPerMile || s.cost_per_mile || 1.5)
    const laborTotal = isWarranty ? 0 : laborHours * hourlyRate * billable
    const mileTotal = miles * cpm
    const grandTotal = isWarranty ? 0 : partsTotal + laborTotal + mileTotal

    // PM equipment data
    const arrestors = jobType === 'PM' && Array.isArray(d.arrestors) ? d.arrestors : []
    const flares = jobType === 'PM' && Array.isArray(d.flares) ? d.flares : []
    const heaters = jobType === 'PM' && Array.isArray(d.heaters) ? d.heaters : []

    const jobLabel = (jobType === 'PM' ? 'PM #' : 'SC #') + pmNum
    const docTitle = jobType === 'PM' ? 'ROS PM Work Order' : 'ROS Service Work Order'
    const allPhotos = Array.isArray(s.photos) ? s.photos : []

    // ── BUILD PDF ─────────────────────────────────────────────────────────────────
    const doc = await PDFDocument.create()
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
    const fontReg = await doc.embedFont(StandardFonts.Helvetica)
    // Page size: A4-ish 595x842. Margins: left=40, right=40 (content width=515)
    const W = 595, H = 842
    const ML = 40, MR = 555   // left margin=40, right margin stops at 555 (40pt from right edge)
    const CWIDTH = MR - ML    // 515pt usable content width
    let page = doc.addPage([W, H])
    let y = H - 30

    const navy = rgb(0.102, 0.137, 0.196)
    const orange = rgb(0.902, 0.361, 0)
    const white = rgb(1, 1, 1)
    const gray = rgb(0.5, 0.5, 0.5)

    const newPage = () => { page = doc.addPage([W, H]); y = H - 30 }
    const gap = (n = 40) => { if (y - n < 40) newPage() }

    // Wrap long text into multiple lines given a max width in chars
    const wrapText = (text, maxChars) => {
      const words = String(text || '').split(' ')
      const lines = []
      let line = ''
      for (const w of words) {
        const test = line ? line + ' ' + w : w
        if (test.length > maxChars) { if (line) lines.push(line); line = w }
        else line = test
      }
      if (line) lines.push(line)
      return lines.length > 0 ? lines : ['']
    }

    const txt = (text, x, yy, opts = {}) => {
      const { font = fontReg, size = 10, color = rgb(0,0,0), maxWidth } = opts
      page.drawText(String(text || ''), { x, y: yy, font, size, color, maxWidth: maxWidth || (MR - x + 10) })
    }

    const section = (title) => {
      gap(30)
      page.drawRectangle({ x: ML, y: y - 16, width: CWIDTH, height: 18, color: navy })
      txt(title, ML + 4, y - 12, { font: fontBold, size: 11, color: white })
      y -= 26
    }

    const row = (label, value) => {
      gap(18)
      txt(label + ':', ML, y, { font: fontBold, size: 10 })
      // Value gets remaining width after label column (130pt)
      const valStr = String(value || '')
      const valLines = wrapText(valStr, 60)
      txt(valLines[0], ML + 130, y, { size: 10, maxWidth: CWIDTH - 130 })
      y -= 16
      for (let li = 1; li < valLines.length; li++) {
        gap(14)
        txt(valLines[li], ML + 130, y, { size: 10, maxWidth: CWIDTH - 130 })
        y -= 14
      }
    }

    // ── HEADER ──────────────────────────────────────────────────────────────────
    // Full-width navy header bar (80pt tall)
    page.drawRectangle({ x: 0, y: H - 80, width: W, height: 80, color: navy })
    // Orange accent line at bottom of header
    page.drawRectangle({ x: 0, y: H - 82, width: W, height: 2, color: orange })
    // Orange circle logo mark
    page.drawCircle({ x: ML + 18, y: H - 38, size: 18, color: orange })
    txt('R', ML + 13, H - 44, { font: fontBold, size: 14, color: navy })
    // Company name & subtitle
    txt('RELIABLE OILFIELD SERVICES', ML + 42, H - 24, { font: fontBold, size: 15, color: orange })
    txt('ReliableTrack  |  Built for Reliable Oilfield Services', ML + 42, H - 40, { size: 9, color: rgb(0.8, 0.8, 0.8) })
    txt(docTitle, ML + 42, H - 54, { size: 9, color: rgb(0.7, 0.7, 0.7) })
    // Job label + date top-right
    txt(jobLabel, MR - 80, H - 24, { font: fontBold, size: 14, color: white })
    txt(dateStr, MR - 80, H - 40, { size: 9, color: rgb(0.8, 0.8, 0.8) })
    y = H - 95

    // ── JOB INFO ──────────────────────────────────────────────────────────────────
    section('JOB INFORMATION')
    row('Customer', customer)
    row('Location', location)
    row('Date', dateStr)
    row('Job Type', jobType === 'PM' ? 'Preventive Maintenance' : 'Service Call')
    if (workType) row('Type of Work', workType)
    if (s.truck_number || d.truckNumber) row('Truck #', s.truck_number || d.truckNumber)
    if (s.contact || d.customerContact) row('Contact', s.contact || d.customerContact)
    if (s.work_order || d.customerWorkOrder) row('Cust. WO #', s.work_order || d.customerWorkOrder)
    if (s.gl_code || d.glCode) row('GL Code', s.gl_code || d.glCode)
    if (assetTag) row('Asset Tag', assetTag)
    if (workArea) row('Work Area', workArea)
    if (s.start_time || d.startTime) row('Start Time', s.start_time || d.startTime)
    if (s.departure_time || d.departureTime) row('Departure', s.departure_time || d.departureTime)
    if (lastSvcDate) row('Last Service Date', lastSvcDate)
    row('Technicians', techs.join(', ') || 'N/A')
    y -= 8

    if (isWarranty) {
      gap(28)
      page.drawRectangle({ x: ML, y: y - 6, width: CWIDTH, height: 22, color: rgb(1, 0.95, 0.95) })
      txt('WARRANTY - NO CHARGE', ML + 4, y + 2, { font: fontBold, size: 14, color: rgb(0.8, 0, 0) })
      y -= 30
    }

    // ── DESCRIPTION ───────────────────────────────────────────────────────────────
    const desc = s.summary || d.description
    if (desc) {
      section('WORK DESCRIPTION')
      const words = desc.split(' ')
      let line = ''
      for (const w of words) {
        const test = line ? line + ' ' + w : w
        if (test.length > 88) { gap(14); txt(line, ML + 4, y, { size: 10 }); y -= 14; line = w }
        else line = test
      }
      if (line.trim()) { gap(14); txt(line, ML + 4, y, { size: 10 }); y -= 14 }
      if (d.equipment) { gap(16); txt('Equipment: ' + d.equipment, ML + 4, y, { size: 9, color: gray }); y -= 14 }
      y -= 8
    }

    // ── SC EQUIPMENT WORKED ON ────────────────────────────────────────────────────
    if (jobType === 'SC' && scEquipment.length > 0) {
      section('EQUIPMENT WORKED ON')
      for (const item of scEquipment) {
        gap(18)
        txt('• ' + (item.type || ''), ML + 4, y, { font: fontBold, size: 10 })
        y -= 14
        if (item.notes && item.notes.trim()) {
          const noteLines = wrapText(item.notes, 85)
          for (const nl of noteLines) {
            gap(13)
            txt('  ' + nl, ML + 12, y, { size: 9, color: gray })
            y -= 13
          }
        }
      }
      y -= 8
    }

    // ── PM EQUIPMENT: FLAME ARRESTORS ─────────────────────────────────────────────
    if (jobType === 'PM' && arrestors.length > 0) {
      section('FLAME ARRESTORS')
      for (let i = 0; i < arrestors.length; i++) {
        const a = arrestors[i]
        gap(18)
        txt('Arrestor #' + (i + 1), ML, y, { font: fontBold, size: 10 })
        y -= 14
        if (a.arrestorId) row(' ID / Tag', a.arrestorId)
        row(' Condition', a.condition || 'Good')
        row(' Filter Changed', a.filterChanged ? 'Yes' : 'No')
        if (a.notes) row(' Notes', a.notes)
        y -= 4
      }
      y -= 4
    }

    // ── PM EQUIPMENT: FLARES ──────────────────────────────────────────────────────
    if (jobType === 'PM' && flares.length > 0) {
      section('FLARES')
      for (let i = 0; i < flares.length; i++) {
        const f = flares[i]
        gap(18)
        txt('Flare #' + (i + 1), ML, y, { font: fontBold, size: 10 })
        y -= 14
        if (f.flareId) row(' ID / Tag', f.flareId)
        row(' Condition', f.condition || 'Good')
        row(' Pilot Lit on Dep.', f.pilotLit ? 'Yes' : 'No')
        if (f.lastIgnition) row(' Last Ignition', f.lastIgnition)
        if (f.notes) row(' Notes', f.notes)
        y -= 4
      }
      y -= 4
    }

    // ── PM EQUIPMENT: HEATER TREATERS ─────────────────────────────────────────────
    if (jobType === 'PM' && heaters.length > 0) {
      section('HEATER TREATERS')
      for (let i = 0; i < heaters.length; i++) {
        const h = heaters[i]
        gap(18)
        txt('Heater Treater #' + (i + 1), ML, y, { font: fontBold, size: 10 })
        y -= 14
        if (h.heaterId) row(' ID / Tag', h.heaterId)
        row(' Condition', h.condition || 'Good')
        if (h.lastCleanDate) row(' Last Tube Clean', h.lastCleanDate)
        if (h.notes) row(' Notes', h.notes)
        const fts = Array.isArray(h.firetubes) ? h.firetubes : []
        if (fts.length > 0) {
          gap(14)
          txt(' Firetubes (' + fts.length + '):', ML, y, { font: fontBold, size: 9 })
          y -= 12
          for (let fi = 0; fi < fts.length; fi++) {
            gap(12)
            const ftCond = (fts[fi] && fts[fi].condition) ? fts[fi].condition : 'Good'
            txt('  FT #' + (fi + 1) + ': ' + ftCond, ML + 8, y, { size: 9,
              color: ftCond === 'Replaced' ? rgb(0.8,0,0) : ftCond === 'Poor' ? rgb(0.7,0.3,0) : rgb(0,0,0)
            })
            y -= 12
          }
        } else {
          const ftCount = h.firetubeCnt || 1
          row(' Firetubes', ftCount)
        }
        y -= 4
      }
      y -= 4
    }

    // ── PARTS (with inline photos beneath each part row) ──────────────────────────
    if (parts.length > 0) {
      section('PARTS USED')
      // Column positions (total usable = 515pt):
      //   SKU: ML(40) width 65 → ends 105
      //   Desc: 110 → maxWidth 240 → ends 350
      //   Qty: 355 width 35
      //   Unit$: 395 width 60
      //   Total: 460 width 55 → ends 515
      const C_SKU = ML          // 40
      const C_DESC = ML + 65    // 105
      const C_QTY = ML + 320    // 360
      const C_UNIT = ML + 365   // 405
      const C_TOTAL = ML + 430  // 470

      txt('SKU', C_SKU, y, { font: fontBold, size: 9 })
      txt('Description', C_DESC, y, { font: fontBold, size: 9 })
      txt('Qty', C_QTY, y, { font: fontBold, size: 9 })
      txt('Unit $', C_UNIT, y, { font: fontBold, size: 9 })
      txt('Total', C_TOTAL, y, { font: fontBold, size: 9 })
      y -= 14
      page.drawLine({ start: { x: ML, y }, end: { x: MR, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) })
      y -= 6

      for (const p of parts) {
        gap(14)
        const descLines = wrapText(p.name || p.desc || '', 38)
        txt(p.sku || p.code || '', C_SKU, y, { size: 9, maxWidth: 60 })
        txt(descLines[0], C_DESC, y, { size: 9, maxWidth: 210 })
        txt(String(p.qty || 1), C_QTY, y, { size: 9 })
        txt('$' + Number(p.price || 0).toFixed(2), C_UNIT, y, { size: 9 })
        txt('$' + (Number(p.qty || 1) * Number(p.price || 0)).toFixed(2), C_TOTAL, y, { size: 9 })
        y -= 14
        // Additional description lines if wrapped
        for (let li = 1; li < descLines.length; li++) {
          gap(13)
          txt(descLines[li], C_DESC, y, { size: 9, maxWidth: 210 })
          y -= 13
        }
        // ── Inline part photos ───────────────────────────────────────────────────
        const pSku = p.sku || p.code || ''
        const partPhotoList = allPhotos.filter(ph => ph.section === 'part-' + pSku)
        if (partPhotoList.length > 0) {
          let col = 0, rowH = 0
          for (const photo of partPhotoList) {
            try {
              const imgRes = await fetch(SUPA_URL + '/storage/v1/object/public/submission-photos/' + photo.storage_path)
              if (!imgRes.ok) continue
              const buf = await imgRes.arrayBuffer()
              const ct = (imgRes.headers.get('content-type') || '')
              const isPng = ct.includes('png') || (photo.storage_path || '').endsWith('.png')
              const em = isPng ? await doc.embedPng(buf) : await doc.embedJpg(buf)
              // Small thumbnail: max 155x120 so 3 fit across
              const sc = em.scaleToFit(155, 120)
              const xp = col === 0 ? ML : col === 1 ? ML + 170 : ML + 340
              if (col === 0) { gap(sc.height + 28); rowH = sc.height }
              page.drawImage(em, { x: xp, y: y - sc.height, width: sc.width, height: sc.height })
              if (photo.caption) txt(photo.caption, xp, y - sc.height - 10, { size: 7, color: gray })
              rowH = Math.max(rowH, sc.height)
              if (col < 2) col++
              else { y -= rowH + 20; col = 0; rowH = 0 }
            } catch (e) { console.warn('part photo skip:', e.message) }
          }
          if (col > 0) y -= rowH + 20
        }
        // Divider between parts
        gap(6)
        page.drawLine({ start: { x: ML, y }, end: { x: MR, y }, thickness: 0.3, color: rgb(0.88, 0.88, 0.88) })
        y -= 6
      }
      y -= 4
    }

    // ── TOTALS ────────────────────────────────────────────────────────────────────
    section('COST SUMMARY')
    if (!isWarranty) {
      row('Labor', '$' + laborTotal.toFixed(2) + ' (' + laborHours + ' hrs x $' + hourlyRate + '/hr x ' + billable + ' tech' + (billable !== 1 ? 's' : '') + ')')
      row('Parts', '$' + partsTotal.toFixed(2))
      row('Mileage', '$' + mileTotal.toFixed(2) + ' (' + miles + ' mi x $' + cpm + '/mi)')
      gap(24)
      page.drawRectangle({ x: ML, y: y - 6, width: CWIDTH, height: 22, color: rgb(0.95, 0.95, 0.95) })
      txt('GRAND TOTAL:', ML + 4, y + 2, { font: fontBold, size: 13 })
      txt('$' + grandTotal.toFixed(2), MR - 90, y + 2, { font: fontBold, size: 13, color: orange })
      y -= 30
    } else {
      gap(24)
      page.drawRectangle({ x: ML, y: y - 6, width: CWIDTH, height: 22, color: rgb(1, 0.95, 0.95) })
      txt('WARRANTY - NO CHARGE', ML + 4, y + 2, { font: fontBold, size: 13, color: rgb(0.8, 0, 0) })
      y -= 30
    }

    // ── PHOTOS (general job photos only — part photos already inline above) ────────
    const addPhotos = async (list) => {
      let col = 0, rowH = 0
      for (const photo of list) {
        try {
          const imgRes = await fetch(SUPA_URL + '/storage/v1/object/public/submission-photos/' + photo.storage_path)
          if (!imgRes.ok) continue
          const buf = await imgRes.arrayBuffer()
          const ct = (imgRes.headers.get('content-type') || '')
          const isPng = ct.includes('png') || (photo.storage_path || '').endsWith('.png')
          const em = isPng ? await doc.embedPng(buf) : await doc.embedJpg(buf)
          const sc = em.scaleToFit(250, 190)
          const xp = col === 0 ? ML : ML + 265
          if (col === 0) { gap(sc.height + 35); rowH = sc.height }
          page.drawImage(em, { x: xp, y: y - sc.height, width: sc.width, height: sc.height })
          if (photo.caption) txt(photo.caption, xp, y - sc.height - 12, { size: 8, color: gray })
          rowH = Math.max(rowH, sc.height)
          if (col === 0) col = 1
          else { y -= rowH + 30; col = 0; rowH = 0 }
        } catch (e) { console.warn('photo skip:', photo.storage_path, e.message) }
      }
      if (col === 1) y -= rowH + 30
      y -= 8
    }

    const workPhotos = allPhotos.filter(p => !p.section || p.section === 'work')
    if (workPhotos.length > 0) { section('JOB PHOTOS'); await addPhotos(workPhotos) }

    // Part photos are now inline above — skip the separate PART PHOTOS section

    // PM equipment photos
    if (jobType === 'PM') {
      const arrestorPhotos = allPhotos.filter(p => p.section && p.section.startsWith('arrestor-'))
      if (arrestorPhotos.length > 0) { section('FLAME ARRESTOR PHOTOS'); await addPhotos(arrestorPhotos) }
      const flarePhotos = allPhotos.filter(p => p.section && p.section.startsWith('flare-'))
      if (flarePhotos.length > 0) { section('FLARE PHOTOS'); await addPhotos(flarePhotos) }
      const heaterPhotos = allPhotos.filter(p => p.section && p.section.startsWith('ht-'))
      if (heaterPhotos.length > 0) { section('HEATER TREATER PHOTOS'); await addPhotos(heaterPhotos) }
    }

    const sigPhotos = allPhotos.filter(p => p.section && p.section.startsWith('sig-'))
    const custSig = allPhotos.find(p => p.section === 'customer-sig')
    if (sigPhotos.length > 0 || custSig) {
      section('SIGNATURES')
      for (const sig of [...sigPhotos, ...(custSig ? [custSig] : [])]) {
        gap(90)
        const label = sig.section === 'customer-sig' ? 'Customer Sign-off' : sig.section.replace('sig-', '') + ' (Tech)'
        txt(label, ML, y, { font: fontBold, size: 9 }); y -= 12
        try {
          const imgRes = await fetch(SUPA_URL + '/storage/v1/object/public/submission-photos/' + sig.storage_path)
          if (imgRes.ok) {
            const buf = await imgRes.arrayBuffer()
            const ct = imgRes.headers.get('content-type') || ''
            const isPng = ct.includes('png') || (sig.storage_path || '').endsWith('.png')
            const img = isPng ? await doc.embedPng(buf) : await doc.embedJpg(buf)
            const sc = img.scaleToFit(250, 60)
            page.drawImage(img, { x: ML, y: y - sc.height, width: sc.width, height: sc.height })
            y -= sc.height + 8
          }
        } catch (e) { console.warn('sig skip:', e.message) }
      }
    }

    // ── FOOTER ────────────────────────────────────────────────────────────────────
    doc.getPages().forEach((pg, i, arr) => {
      pg.drawText(
        'ReliableTrack - Built for Reliable Oilfield Services | Page ' + (i + 1) + ' of ' + arr.length + ' | ' + dateStr,
        { x: ML, y: 18, font: fontReg, size: 8, color: gray }
      )
    })

    const pdfBytes = await doc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')
    const fileName = 'ROS-' + jobLabel.replace(/ /g, '-').replace('#', '') + '-' + customer.replace(/[^a-zA-Z0-9]/g, '-') + '-' + dateStr + '.pdf'

    // ── HTML EMAIL ────────────────────────────────────────────────────────────────
    const techStr = techs.join(', ') || 'N/A'
    const partsHtml = parts.length > 0
      ? '<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px;margin:8px 0;width:100%">'
        + '<tr style="background:#1a2332;color:#fff"><th>SKU</th><th>Part</th><th>Qty</th><th>Unit $</th><th>Total</th></tr>'
        + parts.map(p =>
            '<tr><td>' + (p.sku || p.code || '') + '</td><td>' + (p.name || '') + '</td><td>' + (p.qty || 1)
            + '</td><td>$' + Number(p.price || 0).toFixed(2) + '</td><td>$'
            + (Number(p.qty || 1) * Number(p.price || 0)).toFixed(2) + '</td></tr>'
          ).join('')
        + '</table>'
      : '<p style="color:#888;font-size:12px">No parts used</p>'

    // SC Equipment HTML for email
    let scEquipHtml = ''
    if (jobType === 'SC' && scEquipment.length > 0) {
      scEquipHtml = '<div style="margin-top:12px"><strong style="color:#1a2332">Equipment Worked On</strong>'
        + '<ul style="margin:6px 0;padding-left:18px;font-size:12px">'
        + scEquipment.map(item =>
            '<li><strong>' + (item.type || '') + '</strong>'
            + (item.notes ? ': <span style=\'color:#555\'>' + item.notes + '</span>' : '')
            + '</li>'
          ).join('')
        + '</ul></div>'
    }

    // PM equipment HTML for email
    let pmEquipHtml = ''
    if (jobType === 'PM') {
      if (arrestors.length > 0) {
        pmEquipHtml += '<div style="margin-top:12px"><strong style="color:#1a2332">Flame Arrestors</strong>'
          + '<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px;margin:6px 0;width:100%">'
          + '<tr style="background:#1a2332;color:#fff"><th>#</th><th>ID/Tag</th><th>Condition</th><th>Filter Changed</th><th>Notes</th></tr>'
          + arrestors.map((a, i) =>
              '<tr><td>' + (i+1) + '</td><td>' + (a.arrestorId || '') + '</td><td>' + (a.condition || 'Good')
              + '</td><td>' + (a.filterChanged ? 'Yes' : 'No') + '</td><td>' + (a.notes || '') + '</td></tr>'
            ).join('')
          + '</table></div>'
      }
      if (flares.length > 0) {
        pmEquipHtml += '<div style="margin-top:12px"><strong style="color:#1a2332">Flares</strong>'
          + '<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px;margin:6px 0;width:100%">'
          + '<tr style="background:#1a2332;color:#fff"><th>#</th><th>ID/Tag</th><th>Condition</th><th>Pilot Lit</th><th>Last Ignition</th><th>Notes</th></tr>'
          + flares.map((f, i) =>
              '<tr><td>' + (i+1) + '</td><td>' + (f.flareId || '') + '</td><td>' + (f.condition || 'Good')
              + '</td><td>' + (f.pilotLit ? 'Yes' : 'No') + '</td><td>' + (f.lastIgnition || '')
              + '</td><td>' + (f.notes || '') + '</td></tr>'
            ).join('')
          + '</table></div>'
      }
      if (heaters.length > 0) {
        pmEquipHtml += '<div style="margin-top:12px"><strong style="color:#1a2332">Heater Treaters</strong>'
          + '<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px;margin:6px 0;width:100%">'
          + '<tr style="background:#1a2332;color:#fff"><th>#</th><th>ID/Tag</th><th>Condition</th><th>Last Tube Clean</th><th>Notes</th></tr>'
          + heaters.map((h, i) => {
              const fts = Array.isArray(h.firetubes) ? h.firetubes : []
              const ftSummary = fts.length > 0
                ? fts.map((ft, fi) => 'FT' + (fi+1) + ': ' + ((ft && ft.condition) || 'Good')).join(', ')
                : (h.firetubeCnt || 1) + ' firetube(s)'
              return '<tr><td>' + (i+1) + '</td><td>' + (h.heaterId || '') + '</td><td>' + (h.condition || 'Good')
                + '</td><td>' + (h.lastCleanDate || '') + '</td><td>' + (h.notes || '') + '</td></tr>'
                + (fts.length > 0 ? '<tr><td colspan="5" style="font-size:11px;color:#555;padding:3px 4px"><em>Firetubes: ' + ftSummary + '</em></td></tr>' : '')
            }).join('')
          + '</table></div>'
      }
    }

    const totalsHtml = isWarranty
      ? '<div style="background:#fff0f0;border:2px solid #c00;color:#c00;font-weight:bold;font-size:15px;text-align:center;padding:10px;border-radius:4px;margin-top:10px">WARRANTY - NO CHARGE</div>'
      : '<div style="background:#f9f9f9;border-top:2px solid #e65c00;padding:10px;margin-top:10px;text-align:right">'
        + '<span style="font-size:13px;color:#555">Parts: $' + partsTotal.toFixed(2) + ' | Labor: $' + laborTotal.toFixed(2) + ' | Mileage: $' + mileTotal.toFixed(2) + '</span><br>'
        + '<strong style="color:#e65c00;font-size:16px">TOTAL: $' + grandTotal.toFixed(2) + '</strong></div>'

    const html = '<html><body style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto">'
      + '<div style="background:#1a2332;padding:20px 24px">'
      + '<div style="color:#e65c00;font-weight:800;font-size:20px">RELIABLE OILFIELD SERVICES</div>'
      + '<div style="color:#ccc;font-size:12px;margin-top:2px">ReliableTrack - Built for Reliable Oilfield Services</div>'
      + '<div style="color:#aaa;font-size:11px;margin-top:2px">' + docTitle + ' - ' + jobLabel + '</div>'
      + '</div>'
      + '<div style="background:#f5f5f5;padding:12px 24px;border-bottom:3px solid #e65c00">'
      + '<strong style="color:#1a2332;font-size:15px">' + customer + '</strong>'
      + (location ? '<span style="color:#666;font-size:13px"> - ' + location + '</span>' : '')
      + '<span style="float:right;color:#888;font-size:12px">' + dateStr + '</span>'
      + '</div>'
      + '<div style="padding:16px 24px;border:1px solid #e0e0e0;border-top:none">'
      + '<table style="font-size:13px;width:100%;border-collapse:collapse">'
      + '<tr><td style="padding:5px 0;font-weight:bold;width:140px;color:#1a2332">Type of Work</td><td>' + workType + '</td></tr>'
      + '<tr><td style="padding:5px 0;font-weight:bold;color:#1a2332">Technicians</td><td>' + techStr + '</td></tr>'
      + (s.contact || d.customerContact ? '<tr><td style="padding:5px 0;font-weight:bold;color:#1a2332">Contact</td><td>' + (s.contact || d.customerContact) + '</td></tr>' : '')
      + (s.work_order || d.customerWorkOrder ? '<tr><td style="padding:5px 0;font-weight:bold;color:#1a2332">Cust WO #</td><td>' + (s.work_order || d.customerWorkOrder) + '</td></tr>' : '')
      + (assetTag ? '<tr><td style="padding:5px 0;font-weight:bold;color:#1a2332">Asset Tag</td><td>' + assetTag + '</td></tr>' : '')
      + (workArea ? '<tr><td style="padding:5px 0;font-weight:bold;color:#1a2332">Work Area</td><td>' + workArea + '</td></tr>' : '')
      + (lastSvcDate ? '<tr><td style="padding:5px 0;font-weight:bold;color:#1a2332">Last Service Date</td><td>' + lastSvcDate + '</td></tr>' : '')
      + '</table>'
      + scEquipHtml
      + pmEquipHtml
      + partsHtml
      + totalsHtml
      + '</div>'
      + '<p style="font-size:10px;color:#aaa;padding:8px 24px">Sent by ReliableTrack - Built for Reliable Oilfield Services. PDF attached.</p>'
      + '</body></html>'

    const techShort = techs.length > 0 ? techs.map(t => t.split(' ').pop()).join(', ') : 'No Tech'
    const subject = [customer, location, techShort, workType, docTitle].filter(Boolean).join(' - ')

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_KEY },
      body: JSON.stringify({ from: FROM, to: TO, subject, html, attachments: [{ filename: fileName, content: pdfBase64 }] })
    })
    if (!emailRes.ok) {
      const errText = await emailRes.text()
      console.error('Resend error:', emailRes.status, errText)
      return res.status(502).json({ error: 'Resend error ' + emailRes.status, detail: errText.substring(0, 300) })
    }
    const emailData = await emailRes.json()
    return res.status(200).json({ ok: true, emailId: emailData.id, fileName, subject, from: FROM })

  } catch (err) {
    console.error('send-report crash:', err.message)
    return res.status(500).json({ error: err.message, stack: err.stack ? err.stack.substring(0, 500) : undefined })
  }
}
