// api/send-report.js - Vercel Serverless Function (ESM)
// Generates a PDF report and emails it via Resend
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const SUPA_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co'
const SUPA_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const TO = ['bphetteplace@reliableoilfieldservices.net','cphetteplace@reliableoilfieldservices.net']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { submissionId } = req.body || {}
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' })
  if (!RESEND_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY env var' })
  if (!SUPA_KEY) return res.status(500).json({ error: 'Missing Supabase key env var' })

  try {
    // 1. Fetch submission + photos
    const r = await fetch(
      SUPA_URL + '/rest/v1/submissions?id=eq.' + submissionId +
      '&select=*,photos(id,storage_path,caption,display_order,section)&order=photos.display_order.asc',
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }
    )
    if (!r.ok) {
      const errText = await r.text()
      return res.status(500).json({ error: 'Supabase error: ' + r.status + ' ' + errText.substring(0,200) })
    }
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: 'Submission not found', submissionId })
    const s = rows[0]

    // Normalize data
    const d = s.data || {}
    const jobType    = d.jobType    || d.job_type    || 'SC'
    const techs      = Array.isArray(d.techs)   ? d.techs   : []
    const parts      = Array.isArray(d.parts)   ? d.parts   : []
    const workType   = d.typeOfWork || d.work_type || ''
    const truckNum   = d.truckNumber || d.truck_number || ''
    const laborHours = parseFloat(d.laborHours  || d.labor_hours  || 0)
    const miles      = parseFloat(d.miles || 0)
    const costPerMile = parseFloat(d.costPerMile || 1.50)
    const hourlyRate  = parseFloat(d.hourlyRate  || 115)
    const billable    = parseInt(d.billableTechs || 0) || techs.length
    const isWarranty  = d.warrantyWork || false
    const partsTotal  = parts.reduce((sum, p) => sum + (parseFloat(p.price)||0) * (parseInt(p.qty)||0), 0)
    const mileTotal   = miles * costPerMile
    const laborTotal  = isWarranty ? 0 : laborHours * hourlyRate * billable
    const grandTotal  = isWarranty ? 0 : partsTotal + mileTotal + laborTotal
    const pmNum       = s.pm_number || '????'
    const customer    = s.customer_name || d.customerName || ''
    const location    = s.location_name || d.locationName || ''
    const dateStr     = s.date || d.date || new Date().toISOString().slice(0,10)
    const description = d.description || s.summary || ''
    const allPhotos   = Array.isArray(s.photos) ? s.photos : []
    const jobLabel    = jobType === 'PM' ? 'PM #' + pmNum : 'SC #' + pmNum

    // 2. Build PDF
    const doc = await PDFDocument.create()
    const fontBold    = await doc.embedFont(StandardFonts.HelveticaBold)
    const fontRegular = await doc.embedFont(StandardFonts.Helvetica)
    const pageW = 595, pageH = 842
    let page = doc.addPage([pageW, pageH])
    let y = pageH - 40
    const marginL = 40, marginR = 555
    const rosOrange = rgb(0.902, 0.361, 0)

    const ensureSpace = (n = 40) => {
      if (y - n < 40) { page = doc.addPage([pageW, pageH]); y = pageH - 40 }
    }
    const drawText = (text, x, yPos, opts = {}) => {
      const { font = fontRegular, size = 10, color = rgb(0,0,0) } = opts
      page.drawText(String(text || ''), { x, y: yPos, font, size, color, maxWidth: opts.maxWidth || (marginR - x) })
    }
    const drawSection = (title) => {
      ensureSpace(30)
      page.drawRectangle({ x: marginL, y: y - 16, width: marginR - marginL, height: 18, color: rgb(0.1,0.137,0.196) })
      drawText(title, marginL + 4, y - 12, { font: fontBold, size: 11, color: rgb(1,1,1) })
      y -= 26
    }
    const drawRow = (label, value) => {
      ensureSpace(18)
      drawText(label + ':', marginL, y, { font: fontBold, size: 10 })
      drawText(String(value || ''), marginL + 130, y, { size: 10 })
      y -= 16
    }

    // Header
    page.drawRectangle({ x: 0, y: pageH - 60, width: pageW, height: 60, color: rgb(0.1,0.137,0.196) })
    drawText('RELIABLE OILFIELD SERVICES', marginL, pageH - 25, { font: fontBold, size: 16, color: rosOrange })
    drawText(jobLabel, marginR - 80, pageH - 20, { font: fontBold, size: 14, color: rgb(1,1,1) })
    drawText('ReliableTrack Field Report', marginL, pageH - 45, { size: 10, color: rgb(0.8,0.8,0.8) })
    y = pageH - 80

    // Job Info
    drawSection('JOB INFORMATION')
    drawRow('Customer', customer)
    drawRow('Location', location)
    drawRow('Date', dateStr)
    drawRow('Job Type', jobType === 'PM' ? 'Preventive Maintenance' : 'Service Call')
    if (workType) drawRow('Type of Work', workType)
    if (truckNum) drawRow('Truck #', truckNum)
    if (d.customerContact)    drawRow('Contact', d.customerContact)
    if (d.customerWorkOrder)  drawRow('Cust. WO #', d.customerWorkOrder)
    if (d.glCode)             drawRow('GL Code', d.glCode)
    if (d.startTime)          drawRow('Start Time', d.startTime)
    if (d.departureTime)      drawRow('Departure', d.departureTime)
    drawRow('Technicians', techs.join(', ') || 'N/A')
    y -= 8

    // Work Description
    if (description) {
      drawSection('WORK DESCRIPTION')
      const words = description.split(' ')
      let line = ''
      for (const w of words) {
        const test = line ? line + ' ' + w : w
        if (test.length > 85) { ensureSpace(14); drawText(line, marginL + 4, y, { size: 10 }); y -= 14; line = w }
        else line = test
      }
      if (line.trim()) { ensureSpace(14); drawText(line, marginL + 4, y, { size: 10 }); y -= 14 }
      y -= 8
    }

    // Parts
    if (parts.length > 0) {
      drawSection('PARTS USED')
      drawText('SKU', marginL, y, { font: fontBold, size: 9 })
      drawText('Description', marginL + 70, y, { font: fontBold, size: 9 })
      drawText('Qty', marginL + 330, y, { font: fontBold, size: 9 })
      drawText('Unit $', marginL + 370, y, { font: fontBold, size: 9 })
      drawText('Total', marginL + 430, y, { font: fontBold, size: 9 })
      y -= 14
      page.drawLine({ start: {x: marginL, y}, end: {x: marginR, y}, thickness: 0.5, color: rgb(0.7,0.7,0.7) })
      y -= 6
      for (const p of parts) {
        ensureSpace(14)
        drawText(p.sku || p.code || '', marginL, y, { size: 9 })
        drawText(p.name || p.desc || '', marginL + 70, y, { size: 9, maxWidth: 250 })
        drawText(String(p.qty || 1), marginL + 330, y, { size: 9 })
        drawText('$' + Number(p.price||0).toFixed(2), marginL + 370, y, { size: 9 })
        drawText('$' + (Number(p.qty||1) * Number(p.price||0)).toFixed(2), marginL + 430, y, { size: 9 })
        y -= 14
      }
      y -= 8
    }

    // Totals
    drawSection('TOTALS')
    if (!isWarranty) {
      drawRow('Labor', '$' + laborTotal.toFixed(2) + '  (' + laborHours + ' hrs x $' + hourlyRate + '/hr x ' + billable + ' tech' + (billable !== 1 ? 's' : '') + ')')
      drawRow('Parts', '$' + partsTotal.toFixed(2))
      drawRow('Mileage', '$' + mileTotal.toFixed(2) + '  (' + miles + ' mi x $' + costPerMile + '/mi)')
      ensureSpace(22)
      page.drawRectangle({ x: marginL, y: y - 6, width: marginR - marginL, height: 20, color: rgb(0.95,0.95,0.95) })
      drawText('GRAND TOTAL:', marginL + 4, y, { font: fontBold, size: 12 })
      drawText('$' + grandTotal.toFixed(2), marginR - 90, y, { font: fontBold, size: 12, color: rosOrange })
      y -= 28
    } else {
      ensureSpace(22)
      page.drawRectangle({ x: marginL, y: y - 6, width: marginR - marginL, height: 20, color: rgb(1,0.95,0.95) })
      drawText('WARRANTY - NO CHARGE', marginL + 4, y, { font: fontBold, size: 13, color: rgb(0.8,0,0) })
      y -= 28
    }

    // Photos helper
    const addPhotoGrid = async (photoList) => {
      let col = 0, rowMaxH = 0
      for (const photo of photoList) {
        const url = SUPA_URL + '/storage/v1/object/public/submission-photos/' + photo.storage_path
        try {
          const imgRes = await fetch(url)
          if (!imgRes.ok) continue
          const imgBuf = await imgRes.arrayBuffer()
          const ct = imgRes.headers.get('content-type') || ''
          const em = ct.includes('png') ? await doc.embedPng(imgBuf) : await doc.embedJpg(imgBuf)
          const sc = em.scaleToFit(250, 190)
          const xPos = col === 0 ? marginL : marginL + 265
          if (col === 0) { ensureSpace(sc.height + 30); rowMaxH = sc.height }
          page.drawImage(em, { x: xPos, y: y - sc.height, width: sc.width, height: sc.height })
          if (photo.caption) drawText(photo.caption, xPos, y - sc.height - 12, { size: 8, color: rgb(0.4,0.4,0.4) })
          rowMaxH = Math.max(rowMaxH, sc.height)
          if (col === 0) col = 1
          else { y -= (rowMaxH + 30); col = 0; rowMaxH = 0 }
        } catch(e) { console.error('Photo error:', photo.storage_path, e.message) }
      }
      if (col === 1) y -= (rowMaxH + 30)
      y -= 8
    }

    const workPhotos = allPhotos.filter(p => !p.section || p.section === 'work')
    if (workPhotos.length > 0) { drawSection('JOB PHOTOS'); await addPhotoGrid(workPhotos) }

    const partPhotos = allPhotos.filter(p => p.section && p.section.startsWith('part-'))
    if (partPhotos.length > 0) { drawSection('PART PHOTOS'); await addPhotoGrid(partPhotos) }

    const sigPhotos = allPhotos.filter(p => p.section && p.section.startsWith('sig-'))
    const custSig   = allPhotos.find(p => p.section === 'customer-sig')
    if (sigPhotos.length > 0 || custSig) {
      drawSection('SIGNATURES')
      for (const sig of [...sigPhotos, ...(custSig ? [custSig] : [])]) {
        ensureSpace(90)
        const label = sig.section === 'customer-sig' ? 'Customer Sign-off' : sig.section.replace('sig-','') + ' (Technician)'
        drawText(label, marginL, y, { font: fontBold, size: 9 }); y -= 12
        try {
          const imgRes = await fetch(SUPA_URL + '/storage/v1/object/public/submission-photos/' + sig.storage_path)
          if (imgRes.ok) {
            const imgBuf = await imgRes.arrayBuffer()
            const ct = imgRes.headers.get('content-type') || ''
            const img = ct.includes('png') ? await doc.embedPng(imgBuf) : await doc.embedJpg(imgBuf)
            const sc = img.scaleToFit(250, 60)
            page.drawImage(img, { x: marginL, y: y - sc.height, width: sc.width, height: sc.height })
            y -= (sc.height + 8)
          }
        } catch(e) { console.error('Sig error:', e.message) }
      }
    }

    // Page footers
    doc.getPages().forEach((pg, i, arr) => {
      pg.drawText('Generated by ReliableTrack  |  Page ' + (i+1) + ' of ' + arr.length + '  |  ' + dateStr,
        { x: marginL, y: 20, font: fontRegular, size: 8, color: rgb(0.5,0.5,0.5) })
    })

    // 3. PDF to base64
    const pdfBytes = await doc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')
    const fileName = 'ROS-' + jobLabel.replace(/ /g,'-').replace('#','') + '-' + (customer||'').replace(/[^a-zA-Z0-9]/g,'-') + '-' + dateStr + '.pdf'

    // 4. Send via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_KEY },
      body: JSON.stringify({
        from: 'ReliableTrack <noreply@reliable-oilfield-services.com>',
        to: TO,
        subject: jobLabel + ' - ' + customer + ' - ' + location + ' (' + dateStr + ')',
        html: '<p>Please find the attached field report for <strong>' + customer + '</strong> at <strong>' + location + '</strong> on ' + dateStr + '.</p>' +
              '<p>Job: ' + jobLabel + ' | ' + (jobType==='PM'?'Preventive Maintenance':'Service Call') + (workType?' - '+workType:'') + '</p>' +
              '<p>Techs: ' + (techs.join(', ')||'N/A') + '</p>' +
              (isWarranty ? '<p><strong>WARRANTY - NO CHARGE</strong></p>' : '<p>Total: <strong>$' + grandTotal.toFixed(2) + '</strong></p>') +
              '<hr/><p style="font-size:11px;color:#888">Sent by ReliableTrack</p>',
        attachments: [{ filename: fileName, content: pdfBase64 }]
      })
    })

    if (!emailRes.ok) {
      const errText = await emailRes.text()
      return res.status(500).json({ error: 'Resend failed: ' + errText.substring(0,300) })
    }
    const emailData = await emailRes.json()
    return res.status(200).json({ ok: true, emailId: emailData.id, fileName })

  } catch (err) {
    console.error('send-report error:', err.message, err.stack)
    return res.status(500).json({ error: err.message })
  }
}
// api/send-report.js - Vercel Serverless Function (ESM)
// Generates a PDF report (with photos) and emails it via Resend

// SUPA_URL is public (same as frontend) - hardcoded as fallback since VITE_ vars aren't runtime-available in serverless
const SUPA_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co'
const SUPA_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const TO = ['bphetteplace@reliableoilfieldservices.net','cphetteplace@reliableoilfieldservices.net']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { submissionId } = req.body || {}
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' })

  // Env var check
  if (!SUPA_KEY) return res.status(500).json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY env var' })
  if (!RESEND_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY env var' })

  try {
    // 1. Fetch submission + photos from Supabase
    const r = await fetch(
      SUPA_URL + '/rest/v1/submissions?id=eq.' + submissionId +
      '&select=*,photos(id,storage_path,caption,display_order,section)&order=photos.display_order.asc',
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }
    )
    if (!r.ok) {
      const errText = await r.text()
      return res.status(500).json({ error: 'Supabase query failed: ' + r.status + ' ' + errText.substring(0,200) })
    }
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: 'Submission not found', submissionId })
    const s = rows[0]

    // Normalize fields from data JSONB with top-level fallbacks
    const d = s.data || {}
    const jobType    = d.jobType    || d.job_type    || s.job_type    || 'SC'
    const techs      = Array.isArray(d.techs)   ? d.techs   : []
    const parts      = Array.isArray(d.parts)   ? d.parts   : []
    const workType   = d.typeOfWork || d.work_type   || ''
    const truckNum   = d.truckNumber || d.truck_number || s.truck_number || ''
    const laborHours = d.laborHours  || d.labor_hours  || 0
    const miles      = d.miles        || 0
    const costPerMile = parseFloat(d.costPerMile || d.cost_per_mile || 1.50)
    const hourlyRate  = parseFloat(d.hourlyRate  || d.hourly_rate  || 115)
    const billable    = parseInt(d.billableTechs || d.billable_techs || 0) || techs.length
    const isWarranty  = d.warrantyWork || d.is_warranty || false
    const partsTotal  = parts.reduce((sum, p) => sum + (parseFloat(p.price)||0) * (parseInt(p.qty)||0), 0)
    const mileTotal   = parseFloat(miles||0) * costPerMile
    const laborTotal  = isWarranty ? 0 : parseFloat(laborHours||0) * hourlyRate * billable
    const grandTotal  = isWarranty ? 0 : partsTotal + mileTotal + laborTotal
    const pmNum       = s.pm_number   || '????'
    const customer    = s.customer_name || d.customerName || ''
    const location    = s.location_name || d.locationName || ''
    const dateStr     = s.date || d.date || new Date().toISOString().slice(0,10)
    const description = d.description || s.summary || ''
    const allPhotos   = Array.isArray(s.photos) ? s.photos : []
    const jobLabel    = jobType === 'PM' ? 'PM #' + pmNum : 'SC #' + pmNum
    const startTime   = d.startTime || ''
    const departureTime = d.departureTime || ''
    const customerContact = d.customerContact || ''
    const customerWorkOrder = d.customerWorkOrder || ''
    const glCode      = d.glCode || ''

    // 2. Build PDF using pdf-lib (pure JS, no native deps)
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')

    const doc = await PDFDocument.create()
    const fontBold    = await doc.embedFont(StandardFonts.HelveticaBold)
    const fontRegular = await doc.embedFont(StandardFonts.Helvetica)

    const pageW = 595, pageH = 842 // A4
    let page = doc.addPage([pageW, pageH])
    let y = pageH - 40
    const marginL = 40, marginR = 555

    function ensureSpace(needed = 40) {
      if (y - needed < 40) {
        page = doc.addPage([pageW, pageH])
        y = pageH - 40
      }
    }

    function drawText(text, x, yPos, opts = {}) {
      const { font = fontRegular, size = 10, color = rgb(0,0,0) } = opts
      page.drawText(String(text || ''), { x, y: yPos, font, size, color, maxWidth: opts.maxWidth || (marginR - x) })
    }

    function drawSection(title) {
      ensureSpace(30)
      page.drawRectangle({ x: marginL, y: y - 16, width: marginR - marginL, height: 18, color: rgb(0.1, 0.137, 0.196) })
      drawText(title, marginL + 4, y - 12, { font: fontBold, size: 11, color: rgb(1,1,1) })
      y -= 26
    }

    function drawRow(label, value) {
      ensureSpace(18)
      drawText(label + ':', marginL, y, { font: fontBold, size: 10 })
      drawText(String(value || ''), marginL + 130, y, { font: fontRegular, size: 10 })
      y -= 16
    }

    // --- HEADER ---
    const rosOrange = rgb(0.902, 0.361, 0)
    page.drawRectangle({ x: 0, y: pageH - 60, width: pageW, height: 60, color: rgb(0.1,0.137,0.196) })
    drawText('RELIABLE OILFIELD SERVICES', marginL, pageH - 25, { font: fontBold, size: 16, color: rosOrange })
    drawText(jobLabel, marginR - 80, pageH - 20, { font: fontBold, size: 14, color: rgb(1,1,1) })
    drawText('ReliableTrack Field Report', marginL, pageH - 45, { font: fontRegular, size: 10, color: rgb(0.8,0.8,0.8) })
    y = pageH - 80

    // --- JOB INFO ---
    drawSection('JOB INFORMATION')
    drawRow('Customer', customer)
    drawRow('Location', location)
    drawRow('Date', dateStr)
    drawRow('Job Type', jobType === 'PM' ? 'Preventive Maintenance' : 'Service Call')
    if (workType) drawRow('Type of Work', workType)
    drawRow('Truck #', truckNum)
    if (customerContact)    drawRow('Contact', customerContact)
    if (customerWorkOrder)  drawRow('Cust. WO #', customerWorkOrder)
    if (glCode)             drawRow('GL Code', glCode)
    if (startTime)          drawRow('Start Time', startTime)
    if (departureTime)      drawRow('Departure', departureTime)
    drawRow('Technicians', techs.join(', ') || 'N/A')
    y -= 8

    // --- WORK DESCRIPTION ---
    if (description) {
      drawSection('WORK DESCRIPTION')
      const words = description.split(' ')
      let line = ''
      for (const w of words) {
        const test = line ? line + ' ' + w : w
        if (test.length > 85) {
          ensureSpace(14)
          drawText(line, marginL + 4, y, { size: 10 })
          y -= 14
          line = w
        } else { line = test }
      }
      if (line.trim()) { ensureSpace(14); drawText(line, marginL + 4, y, { size: 10 }); y -= 14 }
      y -= 8
    }

    // --- PARTS ---
    if (parts.length > 0) {
      drawSection('PARTS USED')
      ensureSpace(16)
      drawText('SKU',         marginL,       y, { font: fontBold, size: 9 })
      drawText('Description', marginL + 70,  y, { font: fontBold, size: 9 })
      drawText('Qty',         marginL + 330, y, { font: fontBold, size: 9 })
      drawText('Unit $',      marginL + 370, y, { font: fontBold, size: 9 })
      drawText('Total',       marginL + 430, y, { font: fontBold, size: 9 })
      y -= 14
      page.drawLine({ start: {x: marginL, y}, end: {x: marginR, y}, thickness: 0.5, color: rgb(0.7,0.7,0.7) })
      y -= 6
      for (const p of parts) {
        ensureSpace(14)
        drawText(p.sku || p.code || '',         marginL,       y, { size: 9 })
        drawText(p.name || p.desc || '',        marginL + 70,  y, { size: 9, maxWidth: 250 })
        drawText(String(p.qty || 1),            marginL + 330, y, { size: 9 })
        drawText('$' + Number(p.price || 0).toFixed(2), marginL + 370, y, { size: 9 })
        drawText('$' + (Number(p.qty||1) * Number(p.price||0)).toFixed(2), marginL + 430, y, { size: 9 })
        y -= 14
      }
      y -= 8
    }

    // --- TOTALS ---
    drawSection('TOTALS')
    if (!isWarranty) {
      drawRow('Labor', '$' + Number(laborTotal).toFixed(2) + '  (' + laborHours + ' hrs x $' + hourlyRate + '/hr x ' + billable + ' tech' + (billable !== 1 ? 's' : '') + ')')
      drawRow('Parts', '$' + Number(partsTotal).toFixed(2))
      drawRow('Mileage', '$' + Number(mileTotal).toFixed(2) + '  (' + miles + ' mi x $' + costPerMile + '/mi)')
      ensureSpace(22)
      page.drawRectangle({ x: marginL, y: y - 6, width: marginR - marginL, height: 20, color: rgb(0.95,0.95,0.95) })
      drawText('GRAND TOTAL:', marginL + 4, y, { font: fontBold, size: 12 })
      drawText('$' + Number(grandTotal).toFixed(2), marginR - 90, y, { font: fontBold, size: 12, color: rosOrange })
      y -= 28
    } else {
      ensureSpace(22)
      page.drawRectangle({ x: marginL, y: y - 6, width: marginR - marginL, height: 20, color: rgb(1, 0.95, 0.95) })
      drawText('WARRANTY - NO CHARGE', marginL + 4, y, { font: fontBold, size: 13, color: rgb(0.8,0,0) })
      y -= 28
    }

    // --- WORK PHOTOS ---
    const workPhotos = allPhotos.filter(p => !p.section || p.section === 'work')
    if (workPhotos.length > 0) {
      drawSection('JOB PHOTOS')
      let col = 0, rowMaxH = 0
      for (const photo of workPhotos) {
        const url = SUPA_URL + '/storage/v1/object/public/submission-photos/' + photo.storage_path
        try {
          const imgRes = await fetch(url)
          if (!imgRes.ok) continue
          const imgBuf = await imgRes.arrayBuffer()
          const ct = imgRes.headers.get('content-type') || ''
          const embeddedImg = ct.includes('png') ? await doc.embedPng(imgBuf) : await doc.embedJpg(imgBuf)
          const scaled = embeddedImg.scaleToFit(250, 190)
          const xPos = col === 0 ? marginL : marginL + 265
          if (col === 0) { ensureSpace(scaled.height + 30); rowMaxH = scaled.height }
          page.drawImage(embeddedImg, { x: xPos, y: y - scaled.height, width: scaled.width, height: scaled.height })
          if (photo.caption) drawText(photo.caption, xPos, y - scaled.height - 12, { size: 8, color: rgb(0.4,0.4,0.4) })
          rowMaxH = Math.max(rowMaxH, scaled.height)
          if (col === 0) { col = 1 } else { y -= (rowMaxH + 30); col = 0; rowMaxH = 0 }
        } catch(e) { console.error('Photo embed error:', photo.storage_path, e.message) }
      }
      if (col === 1) y -= (rowMaxH + 30)
      y -= 8
    }

    // --- PART PHOTOS ---
    const partPhotos = allPhotos.filter(p => p.section && p.section.startsWith('part-'))
    if (partPhotos.length > 0) {
      drawSection('PART PHOTOS')
      let col = 0, rowMaxH = 0
      for (const photo of partPhotos) {
        const url = SUPA_URL + '/storage/v1/object/public/submission-photos/' + photo.storage_path
        try {
          const imgRes = await fetch(url)
          if (!imgRes.ok) continue
          const imgBuf = await imgRes.arrayBuffer()
          const ct = imgRes.headers.get('content-type') || ''
          const embeddedImg = ct.includes('png') ? await doc.embedPng(imgBuf) : await doc.embedJpg(imgBuf)
          const scaled = embeddedImg.scaleToFit(250, 190)
          const xPos = col === 0 ? marginL : marginL + 265
          if (col === 0) { ensureSpace(scaled.height + 30); rowMaxH = scaled.height }
          page.drawImage(embeddedImg, { x: xPos, y: y - scaled.height, width: scaled.width, height: scaled.height })
          if (photo.caption) drawText(photo.caption, xPos, y - scaled.height - 12, { size: 8, color: rgb(0.4,0.4,0.4) })
          rowMaxH = Math.max(rowMaxH, scaled.height)
          if (col === 0) { col = 1 } else { y -= (rowMaxH + 30); col = 0; rowMaxH = 0 }
        } catch(e) { console.error('Part photo error:', photo.storage_path, e.message) }
      }
      if (col === 1) y -= (rowMaxH + 30)
      y -= 8
    }

    // --- SIGNATURES ---
    const sigPhotos = allPhotos.filter(p => p.section && p.section.startsWith('sig-'))
    const custSig   = allPhotos.find(p => p.section === 'customer-sig')
    if (sigPhotos.length > 0 || custSig) {
      drawSection('SIGNATURES')
      for (const sig of sigPhotos) {
        ensureSpace(90)
        const techName = sig.section.replace('sig-', '')
        drawText(techName + ' (Technician)', marginL, y, { font: fontBold, size: 9 })
        y -= 12
        try {
          const imgRes = await fetch(SUPA_URL + '/storage/v1/object/public/submission-photos/' + sig.storage_path)
          if (imgRes.ok) {
            const imgBuf = await imgRes.arrayBuffer()
            const ct = imgRes.headers.get('content-type') || ''
            const img = ct.includes('png') ? await doc.embedPng(imgBuf) : await doc.embedJpg(imgBuf)
            const scaled = img.scaleToFit(250, 60)
            page.drawImage(img, { x: marginL, y: y - scaled.height, width: scaled.width, height: scaled.height })
            y -= (scaled.height + 8)
          }
        } catch(e) { console.error('Sig error:', e.message) }
      }
      if (custSig) {
        ensureSpace(90)
        drawText('Customer Sign-off', marginL, y, { font: fontBold, size: 9 })
        y -= 12
        try {
          const imgRes = await fetch(SUPA_URL + '/storage/v1/object/public/submission-photos/' + custSig.storage_path)
          if (imgRes.ok) {
            const imgBuf = await imgRes.arrayBuffer()
            const ct = imgRes.headers.get('content-type') || ''
            const img = ct.includes('png') ? await doc.embedPng(imgBuf) : await doc.embedJpg(imgBuf)
            const scaled = img.scaleToFit(250, 60)
            page.drawImage(img, { x: marginL, y: y - scaled.height, width: scaled.width, height: scaled.height })
            y -= (scaled.height + 8)
          }
        } catch(e) { console.error('CustSig error:', e.message) }
      }
    }

    // --- PAGE FOOTERS ---
    const pages = doc.getPages()
    for (let i = 0; i < pages.length; i++) {
      pages[i].drawText(
        'Generated by ReliableTrack  |  Page ' + (i+1) + ' of ' + pages.length + '  |  ' + dateStr,
        { x: marginL, y: 20, font: fontRegular, size: 8, color: rgb(0.5,0.5,0.5) }
      )
    }

    // 3. Serialize PDF
    const pdfBytes  = await doc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')
    const fileName  = 'ROS-' + jobLabel.replace(/ /g,'-').replace('#','') + '-' + (customer||'').replace(/[^a-zA-Z0-9]/g,'-') + '-' + dateStr + '.pdf'

    // 4. Send via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_KEY },
      body: JSON.stringify({
        from: 'ReliableTrack <noreply@reliable-oilfield-services.com>',
        to: TO,
        subject: jobLabel + ' - ' + customer + ' - ' + location + ' (' + dateStr + ')',
        html: '<p>Please find the attached field report for <strong>' + customer + '</strong> at <strong>' + location + '</strong> on ' + dateStr + '.</p>' +
              '<p>Job: ' + jobLabel + ' | Type: ' + (jobType === 'PM' ? 'Preventive Maintenance' : 'Service Call') + (workType ? ' - ' + workType : '') + '</p>' +
              '<p>Techs: ' + (techs.join(', ') || 'N/A') + '</p>' +
              (isWarranty ? '<p><strong>WARRANTY - NO CHARGE</strong></p>' : '<p>Total: <strong>$' + Number(grandTotal).toFixed(2) + '</strong></p>') +
              '<hr/><p style="font-size:11px;color:#888">Sent by ReliableTrack</p>',
        attachments: [{ filename: fileName, content: pdfBase64 }]
      })
    })

    if (!emailRes.ok) {
      const errText = await emailRes.text()
      console.error('Resend error:', emailRes.status, errText)
      return res.status(500).json({ error: 'Email failed: ' + errText })
    }

    const emailData = await emailRes.json()
    return res.status(200).json({ ok: true, emailId: emailData.id, fileName })

  } catch (err) {
    console.error('send-report error:', err.message, err.stack)
    return res.status(500).json({ error: err.message })
  }
}
// api/send-report.js - Vercel Serverless Function (ESM)
// Generates a PDF report (with photos) and emails it via Resend

const SUPA_URL  = process.env.VITE_SUPABASE_URL
const SUPA_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const TO = ['bphetteplace@reliableoilfieldservices.net','cphetteplace@reliableoilfieldservices.net']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { submissionId } = req.body || {}
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' })

  try {
    // 1. Fetch submission + photos from Supabase using service role key (bypasses RLS)
    const r = await fetch(
      SUPA_URL + '/rest/v1/submissions?id=eq.' + submissionId +
      '&select=*,photos(id,storage_path,caption,display_order,section)&order=photos.display_order.asc',
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }
    )
    const rows = await r.json()
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Submission not found' })
    const s = rows[0]

    // Normalize fields from data JSONB with top-level fallbacks
    const d = s.data || {}
    const jobType    = d.jobType    || d.job_type    || s.job_type    || 'PM'
    const techs      = Array.isArray(d.techs)   ? d.techs   : []
    const parts      = Array.isArray(d.parts)   ? d.parts   : []
    const workType   = d.typeOfWork || d.work_type   || ''
    const truckNum   = d.truckNumber || d.truck_number || s.truck_number || ''
    const laborHours = d.laborHours  || d.labor_hours  || 0
    const miles      = d.miles        || 0
    const costPerMile = parseFloat(d.costPerMile || d.cost_per_mile || 1.50)
    const hourlyRate  = parseFloat(d.hourlyRate  || d.hourly_rate  || 115)
    const billable    = parseInt(d.billableTechs || d.billable_techs || 0) || techs.length
    const isWarranty  = d.warrantyWork || d.is_warranty || false
    const partsTotal  = parts.reduce((sum, p) => sum + (parseFloat(p.price)||0) * (parseInt(p.qty)||0), 0)
    const mileTotal   = parseFloat(miles||0) * costPerMile
    const laborTotal  = isWarranty ? 0 : parseFloat(laborHours||0) * hourlyRate * billable
    const grandTotal  = isWarranty ? 0 : partsTotal + mileTotal + laborTotal
    const pmNum       = s.pm_number   || '????'
    const customer    = s.customer_name || d.customerName || ''
    const location    = s.location_name || d.locationName || ''
    const dateStr     = s.date || d.date || new Date().toISOString().slice(0,10)
    const description = d.description || s.summary || ''
    const allPhotos   = Array.isArray(s.photos) ? s.photos : []
    const jobLabel    = jobType === 'PM' ? 'PM #' + pmNum : 'SC #' + pmNum
    const startTime   = d.startTime || ''
    const departureTime = d.departureTime || ''
    const customerContact = d.customerContact || ''
    const customerWorkOrder = d.customerWorkOrder || ''
    const glCode      = d.glCode || ''

    // 2. Build PDF using pdf-lib (pure JS, no native deps)
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')

    const doc = await PDFDocument.create()
    const fontBold    = await doc.embedFont(StandardFonts.HelveticaBold)
    const fontRegular = await doc.embedFont(StandardFonts.Helvetica)

    const pageW = 595, pageH = 842 // A4
    let page = doc.addPage([pageW, pageH])
    let y = pageH - 40
    const marginL = 40, marginR = 555

    function ensureSpace(needed = 40) {
      if (y - needed < 40) {
        page = doc.addPage([pageW, pageH])
        y = pageH - 40
      }
    }

    function drawText(text, x, yPos, opts = {}) {
      const { font = fontRegular, size = 10, color = rgb(0,0,0) } = opts
      page.drawText(String(text || ''), { x, y: yPos, font, size, color, maxWidth: opts.maxWidth || (marginR - x) })
    }

    function drawSection(title) {
      ensureSpace(30)
      page.drawRectangle({ x: marginL, y: y - 16, width: marginR - marginL, height: 18, color: rgb(0.1, 0.137, 0.196) })
      drawText(title, marginL + 4, y - 12, { font: fontBold, size: 11, color: rgb(1,1,1) })
      y -= 26
    }

    function drawRow(label, value) {
      ensureSpace(18)
      drawText(label + ':', marginL, y, { font: fontBold, size: 10 })
      drawText(String(value || ''), marginL + 130, y, { font: fontRegular, size: 10 })
      y -= 16
    }

    // --- HEADER ---
    const rosOrange = rgb(0.902, 0.361, 0)
    page.drawRectangle({ x: 0, y: pageH - 60, width: pageW, height: 60, color: rgb(0.1,0.137,0.196) })
    drawText('RELIABLE OILFIELD SERVICES', marginL, pageH - 25, { font: fontBold, size: 16, color: rosOrange })
    drawText(jobLabel, marginR - 80, pageH - 20, { font: fontBold, size: 14, color: rgb(1,1,1) })
    drawText('ReliableTrack Field Report', marginL, pageH - 45, { font: fontRegular, size: 10, color: rgb(0.8,0.8,0.8) })
    y = pageH - 80

    // --- JOB INFO ---
    drawSection('JOB INFORMATION')
    drawRow('Customer', customer)
    drawRow('Location', location)
    drawRow('Date', dateStr)
    drawRow('Job Type', jobType === 'PM' ? 'Preventive Maintenance' : 'Service Call')
    if (workType) drawRow('Type of Work', workType)
    drawRow('Truck #', truckNum)
    if (customerContact)    drawRow('Contact', customerContact)
    if (customerWorkOrder)  drawRow('Cust. WO #', customerWorkOrder)
    if (glCode)             drawRow('GL Code', glCode)
    if (startTime)          drawRow('Start Time', startTime)
    if (departureTime)      drawRow('Departure', departureTime)
    drawRow('Technicians', techs.join(', '))
    y -= 8

    // --- WORK DESCRIPTION ---
    if (description) {
      drawSection('WORK DESCRIPTION')
      const words = description.split(' ')
      let line = ''
      for (const w of words) {
        const test = line ? line + ' ' + w : w
        if (test.length > 85) {
          ensureSpace(14)
          drawText(line, marginL + 4, y, { size: 10 })
          y -= 14
          line = w
        } else {
          line = test
        }
      }
      if (line.trim()) {
        ensureSpace(14)
        drawText(line, marginL + 4, y, { size: 10 })
        y -= 14
      }
      y -= 8
    }

    // --- PARTS ---
    if (parts.length > 0) {
      drawSection('PARTS USED')
      ensureSpace(16)
      drawText('SKU',         marginL,       y, { font: fontBold, size: 9 })
      drawText('Description', marginL + 70,  y, { font: fontBold, size: 9 })
      drawText('Qty',         marginL + 330, y, { font: fontBold, size: 9 })
      drawText('Unit $',      marginL + 370, y, { font: fontBold, size: 9 })
      drawText('Total',       marginL + 430, y, { font: fontBold, size: 9 })
      y -= 14
      page.drawLine({ start: {x: marginL, y}, end: {x: marginR, y}, thickness: 0.5, color: rgb(0.7,0.7,0.7) })
      y -= 6
      for (const p of parts) {
        ensureSpace(14)
        drawText(p.sku || p.code || '',         marginL,       y, { size: 9 })
        drawText(p.name || p.desc || '',        marginL + 70,  y, { size: 9, maxWidth: 250 })
        drawText(String(p.qty || 1),            marginL + 330, y, { size: 9 })
        drawText('$' + Number(p.price || 0).toFixed(2), marginL + 370, y, { size: 9 })
        drawText('$' + (Number(p.qty||1) * Number(p.price||0)).toFixed(2), marginL + 430, y, { size: 9 })
        y -= 14
      }
      y -= 8
    }

    // --- TOTALS ---
    drawSection('TOTALS')
    if (!isWarranty) {
      drawRow('Labor', '$' + Number(laborTotal).toFixed(2) + '  (' + laborHours + ' hrs x $' + hourlyRate + '/hr x ' + billable + ' tech' + (billable !== 1 ? 's' : '') + ')')
      drawRow('Parts', '$' + Number(partsTotal).toFixed(2))
      drawRow('Mileage', '$' + Number(mileTotal).toFixed(2) + '  (' + miles + ' mi x $' + costPerMile + '/mi)')
      ensureSpace(22)
      page.drawRectangle({ x: marginL, y: y - 6, width: marginR - marginL, height: 20, color: rgb(0.95,0.95,0.95) })
      drawText('GRAND TOTAL:', marginL + 4, y, { font: fontBold, size: 12 })
      drawText('$' + Number(grandTotal).toFixed(2), marginR - 90, y, { font: fontBold, size: 12, color: rosOrange })
      y -= 28
    } else {
      ensureSpace(22)
      page.drawRectangle({ x: marginL, y: y - 6, width: marginR - marginL, height: 20, color: rgb(1, 0.95, 0.95) })
      drawText('WARRANTY - NO CHARGE', marginL + 4, y, { font: fontBold, size: 13, color: rgb(0.8,0,0) })
      y -= 28
    }

    // --- WORK PHOTOS ---
    const workPhotos = allPhotos.filter(p => !p.section || p.section === 'work')
    if (workPhotos.length > 0) {
      drawSection('JOB PHOTOS')
      let col = 0, rowMaxH = 0
      for (const photo of workPhotos) {
        const url = SUPA_URL + '/storage/v1/object/public/submission-photos/' + photo.storage_path
        try {
          const imgRes = await fetch(url)
          if (!imgRes.ok) continue
          const imgBuf = await imgRes.arrayBuffer()
          const ct = imgRes.headers.get('content-type') || ''
          const embeddedImg = ct.includes('png') ? await doc.embedPng(imgBuf) : await doc.embedJpg(imgBuf)
          const scaled = embeddedImg.scaleToFit(250, 190)
          const xPos = col === 0 ? marginL : marginL + 265
          if (col === 0) { ensureSpace(scaled.height + 30); rowMaxH = scaled.height }
          page.drawImage(embeddedImg, { x: xPos, y: y - scaled.height, width: scaled.width, height: scaled.height })
          if (photo.caption) drawText(photo.caption, xPos, y - scaled.height - 12, { size: 8, color: rgb(0.4,0.4,0.4) })
          rowMaxH = Math.max(rowMaxH, scaled.height)
          if (col === 0) { col = 1 }
          else { y -= (rowMaxH + 30); col = 0; rowMaxH = 0 }
        } catch(e) { console.error('Photo embed error:', photo.storage_path, e.message) }
      }
      if (col === 1) y -= (rowMaxH + 30)
      y -= 8
    }

    // --- PART PHOTOS ---
    const partPhotos = allPhotos.filter(p => p.section && p.section.startsWith('part-'))
    if (partPhotos.length > 0) {
      drawSection('PART PHOTOS')
      let col = 0, rowMaxH = 0
      for (const photo of partPhotos) {
        const url = SUPA_URL + '/storage/v1/object/public/submission-photos/' + photo.storage_path
        try {
          const imgRes = await fetch(url)
          if (!imgRes.ok) continue
          const imgBuf = await imgRes.arrayBuffer()
          const ct = imgRes.headers.get('content-type') || ''
          const embeddedImg = ct.includes('png') ? await doc.embedPng(imgBuf) : await doc.embedJpg(imgBuf)
          const scaled = embeddedImg.scaleToFit(250, 190)
          const xPos = col === 0 ? marginL : marginL + 265
          if (col === 0) { ensureSpace(scaled.height + 30); rowMaxH = scaled.height }
          page.drawImage(embeddedImg, { x: xPos, y: y - scaled.height, width: scaled.width, height: scaled.height })
          if (photo.caption) drawText(photo.caption, xPos, y - scaled.height - 12, { size: 8, color: rgb(0.4,0.4,0.4) })
          rowMaxH = Math.max(rowMaxH, scaled.height)
          if (col === 0) { col = 1 }
          else { y -= (rowMaxH + 30); col = 0; rowMaxH = 0 }
        } catch(e) { console.error('Part photo error:', photo.storage_path, e.message) }
      }
      if (col === 1) y -= (rowMaxH + 30)
      y -= 8
    }

    // --- SIGNATURES ---
    const sigPhotos = allPhotos.filter(p => p.section && p.section.startsWith('sig-'))
    const custSig   = allPhotos.find(p => p.section === 'customer-sig')
    if (sigPhotos.length > 0 || custSig) {
      drawSection('SIGNATURES')
      for (const sig of sigPhotos) {
        ensureSpace(90)
        const techName = sig.section.replace('sig-', '')
        drawText(techName + ' (Technician)', marginL, y, { font: fontBold, size: 9 })
        y -= 12
        try {
          const imgRes = await fetch(SUPA_URL + '/storage/v1/object/public/submission-photos/' + sig.storage_path)
          if (imgRes.ok) {
            const imgBuf = await imgRes.arrayBuffer()
            const ct = imgRes.headers.get('content-type') || ''
            const img = ct.includes('png') ? await doc.embedPng(imgBuf) : await doc.embedJpg(imgBuf)
            const scaled = img.scaleToFit(250, 60)
            page.drawImage(img, { x: marginL, y: y - scaled.height, width: scaled.width, height: scaled.height })
            y -= (scaled.height + 8)
          }
        } catch(e) { console.error('Sig error:', e.message) }
      }
      if (custSig) {
        ensureSpace(90)
        drawText('Customer Sign-off', marginL, y, { font: fontBold, size: 9 })
        y -= 12
        try {
          const imgRes = await fetch(SUPA_URL + '/storage/v1/object/public/submission-photos/' + custSig.storage_path)
          if (imgRes.ok) {
            const imgBuf = await imgRes.arrayBuffer()
            const ct = imgRes.headers.get('content-type') || ''
            const img = ct.includes('png') ? await doc.embedPng(imgBuf) : await doc.embedJpg(imgBuf)
            const scaled = img.scaleToFit(250, 60)
            page.drawImage(img, { x: marginL, y: y - scaled.height, width: scaled.width, height: scaled.height })
            y -= (scaled.height + 8)
          }
        } catch(e) { console.error('CustSig error:', e.message) }
      }
    }

    // --- PAGE FOOTERS ---
    const pages = doc.getPages()
    for (let i = 0; i < pages.length; i++) {
      pages[i].drawText(
        'Generated by ReliableTrack  |  Page ' + (i+1) + ' of ' + pages.length + '  |  ' + dateStr,
        { x: marginL, y: 20, font: fontRegular, size: 8, color: rgb(0.5,0.5,0.5) }
      )
    }

    // 3. Serialize PDF
    const pdfBytes  = await doc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')
    const fileName  = 'ROS-' + jobLabel.replace(/ /g,'-').replace('#','') + '-' + (customer||'').replace(/[^a-zA-Z0-9]/g,'-') + '-' + dateStr + '.pdf'

    // 4. Send via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_KEY },
      body: JSON.stringify({
        from: 'ReliableTrack <noreply@reliable-oilfield-services.com>',
        to: TO,
        subject: jobLabel + ' - ' + customer + ' - ' + location + ' (' + dateStr + ')',
        html: '<p>Please find the attached field report for <strong>' + customer + '</strong> at <strong>' + location + '</strong> on ' + dateStr + '.</p>' +
              '<p>Job: ' + jobLabel + ' | Type: ' + (jobType === 'PM' ? 'Preventive Maintenance' : 'Service Call') + (workType ? ' - ' + workType : '') + '</p>' +
              '<p>Techs: ' + (techs.join(', ') || 'N/A') + '</p>' +
              (isWarranty ? '<p><strong>WARRANTY - NO CHARGE</strong></p>' : '<p>Total: <strong>$' + Number(grandTotal).toFixed(2) + '</strong></p>') +
              '<hr/><p style="font-size:11px;color:#888">Sent by ReliableTrack</p>',
        attachments: [{ filename: fileName, content: pdfBase64 }]
      })
    })

    if (!emailRes.ok) {
      const errText = await emailRes.text()
      console.error('Resend error:', emailRes.status, errText)
      return res.status(500).json({ error: 'Email failed: ' + errText })
    }

    const emailData = await emailRes.json()
    return res.status(200).json({ ok: true, emailId: emailData.id, fileName })

  } catch (err) {
    console.error('send-report error:', err.message, err.stack)
    return res.status(500).json({ error: err.message })
  }
}
