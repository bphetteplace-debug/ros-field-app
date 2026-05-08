// api/send-report.js - Vercel Serverless Function (CommonJS via api/package.json)
// Sends a rich HTML email with PDF attachment via Resend

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib')

const SUPA_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co'
const SUPA_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const TO = ['bphetteplace@reliableoilfieldservices.net','cphetteplace@reliableoilfieldservices.net']

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { submissionId } = req.body || {}
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' })
  if (!RESEND_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY' })
  if (!SUPA_KEY)   return res.status(500).json({ error: 'Missing Supabase key' })

  try {
    const r = await fetch(
      SUPA_URL + '/rest/v1/submissions?id=eq.' + submissionId +
      '&select=*,photos(id,storage_path,caption,display_order,section)&order=photos.display_order.asc',
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }
    )
    if (!r.ok) {
      const t = await r.text()
      return res.status(500).json({ error: 'Supabase error: ' + r.status, detail: t.substring(0,200) })
    }
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found', submissionId })
    }
    const s = rows[0]
    const d = s.data || {}

    const jobType   = d.jobType || d.job_type || 'SC'
    const pmNum     = s.pm_number || '????'
    const customer  = s.customer_name || d.customerName || 'Unknown'
    const location  = s.location_name || d.locationName || ''
    const dateStr   = s.date || d.date || new Date().toISOString().slice(0,10)
    const techs     = Array.isArray(d.techs) ? d.techs : []
    const parts     = Array.isArray(d.parts) ? d.parts : []
    const isWarranty = d.warrantyWork || false
    const partsTotal = parts.reduce((sum, p) => sum + (parseFloat(p.price)||0) * (parseInt(p.qty)||0), 0)
    const laborHours = parseFloat(d.laborHours || 0)
    const hourlyRate = parseFloat(d.hourlyRate || 115)
    const billable   = parseInt(d.billableTechs || 0) || techs.length
    const miles      = parseFloat(d.miles || 0)
    const costPerMile = parseFloat(d.costPerMile || 1.50)
    const laborTotal = isWarranty ? 0 : laborHours * hourlyRate * billable
    const mileTotal  = miles * costPerMile
    const grandTotal = isWarranty ? 0 : partsTotal + laborTotal + mileTotal
    const jobLabel   = jobType === 'PM' ? 'PM #' + pmNum : 'SC #' + pmNum
    const allPhotos  = Array.isArray(s.photos) ? s.photos : []

    // Build PDF
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

    page.drawRectangle({ x: 0, y: pageH - 60, width: pageW, height: 60, color: rgb(0.1,0.137,0.196) })
    drawText('RELIABLE OILFIELD SERVICES', marginL, pageH - 25, { font: fontBold, size: 16, color: rosOrange })
    drawText(jobLabel, marginR - 80, pageH - 20, { font: fontBold, size: 14, color: rgb(1,1,1) })
    drawText('ReliableTrack Field Report', marginL, pageH - 45, { size: 10, color: rgb(0.8,0.8,0.8) })
    y = pageH - 80

    drawSection('JOB INFORMATION')
    drawRow('Customer', customer)
    drawRow('Location', location)
    drawRow('Date', dateStr)
    drawRow('Job Type', jobType === 'PM' ? 'Preventive Maintenance' : 'Service Call')
    if (d.typeOfWork) drawRow('Type of Work', d.typeOfWork)
    if (d.truckNumber) drawRow('Truck #', d.truckNumber)
    if (d.customerContact)   drawRow('Contact', d.customerContact)
    if (d.customerWorkOrder) drawRow('Cust. WO #', d.customerWorkOrder)
    if (d.glCode)            drawRow('GL Code', d.glCode)
    if (d.startTime)         drawRow('Start Time', d.startTime)
    if (d.departureTime)     drawRow('Departure', d.departureTime)
    drawRow('Technicians', techs.join(', ') || 'N/A')
    y -= 8

    if (d.description) {
      drawSection('WORK DESCRIPTION')
      const words = d.description.split(' ')
      let line = ''
      for (const w of words) {
        const test = line ? line + ' ' + w : w
        if (test.length > 85) { ensureSpace(14); drawText(line, marginL + 4, y, { size: 10 }); y -= 14; line = w }
        else line = test
      }
      if (line.trim()) { ensureSpace(14); drawText(line, marginL + 4, y, { size: 10 }); y -= 14 }
      y -= 8
    }

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
        drawText('$' + (Number(p.qty||1)*Number(p.price||0)).toFixed(2), marginL + 430, y, { size: 9 })
        y -= 14
      }
      y -= 8
    }

    drawSection('TOTALS')
    if (!isWarranty) {
      drawRow('Labor', '$' + laborTotal.toFixed(2) + '  (' + laborHours + ' hrs x $' + hourlyRate + '/hr x ' + billable + ' tech' + (billable!==1?'s':'') + ')')
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
        } catch(e) { console.error('Photo err:', photo.storage_path, e.message) }
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
        const label = sig.section === 'customer-sig' ? 'Customer Sign-off' : sig.section.replace('sig-','') + ' (Tech)'
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

    doc.getPages().forEach((pg, i, arr) => {
      pg.drawText('Generated by ReliableTrack  |  Page ' + (i+1) + ' of ' + arr.length + '  |  ' + dateStr,
        { x: marginL, y: 20, font: fontRegular, size: 8, color: rgb(0.5,0.5,0.5) })
    })

    const pdfBytes  = await doc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')
    const fileName  = 'ROS-' + jobLabel.replace(/ /g,'-').replace('#','') + '-' + (customer||'').replace(/[^a-zA-Z0-9]/g,'-') + '-' + dateStr + '.pdf'

    const partsHtml = parts.length > 0
      ? '<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px;margin:8px 0"><tr style="background:#1a2332;color:#fff"><th>SKU</th><th>Part</th><th>Qty</th><th>Unit $</th><th>Total</th></tr>' +
        parts.map(p => '<tr><td>' + (p.sku||p.code||'') + '</td><td>' + (p.name||'') + '</td><td>' + (p.qty||1) + '</td><td>$' + Number(p.price||0).toFixed(2) + '</td><td>$' + (Number(p.qty||1)*Number(p.price||0)).toFixed(2) + '</td></tr>').join('') +
        '</table>'
      : '<p>No parts used</p>'

    const html = '<html><body style="font-family:Arial,sans-serif;max-width:600px"><div style="background:#1a2332;color:#fff;padding:16px"><h2 style="margin:0;color:#e65c00">RELIABLE OILFIELD SERVICES</h2><p style="margin:4px 0 0;font-size:13px">ReliableTrack - ' + jobLabel + '</p></div><div style="padding:16px;border:1px solid #ddd"><table style="font-size:13px;width:100%"><tr><td style="padding:4px;font-weight:bold;width:130px">Customer</td><td>' + customer + '</td></tr><tr><td style="padding:4px;font-weight:bold">Location</td><td>' + location + '</td></tr><tr><td style="padding:4px;font-weight:bold">Date</td><td>' + dateStr + '</td></tr><tr><td style="padding:4px;font-weight:bold">Techs</td><td>' + (techs.join(', ')||'N/A') + '</td></tr></table>' + partsHtml + (isWarranty ? '<p style="color:red;font-weight:bold">WARRANTY - NO CHARGE</p>' : '<p>Total: <strong style="color:#e65c00">$' + grandTotal.toFixed(2) + '</strong></p>') + '</div><p style="font-size:10px;color:#888">Sent by ReliableTrack</p></body></html>'

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_KEY },
      body: JSON.stringify({
        from: 'ReliableTrack <noreply@reliable-oilfield-services.com>',
        to: TO,
        subject: jobLabel + ' - ' + customer + ' - ' + location + ' (' + dateStr + ')',
        html,
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
// api/send-report.js - Minimal test (CommonJS via api/package.json)
module.exports = async function handler(req, res) {
  return res.status(200).json({ ok: true, method: req.method, body: req.body })
}
