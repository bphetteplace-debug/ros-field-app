// api/send-report.js - Vercel Serverless Function (CommonJS via api/package.json)
// Sends rich HTML email with PDF attachment via Resend
// NOTE: require('pdf-lib') is inside handler to avoid Lambda crash at module load time

const SUPA_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co'
const SUPA_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const FROM      = process.env.RESEND_FROM || 'ReliableTrack <onboarding@resend.dev>'
const TO        = process.env.EMAIL_TO
  ? process.env.EMAIL_TO.split(',').map(e => e.trim())
  : ['bphetteplace@reliableoilfieldservices.net']

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { submissionId } = req.body || {}
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' })
  if (!RESEND_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY' })
  if (!SUPA_KEY)   return res.status(500).json({ error: 'Missing Supabase key' })

  try {
    // Lazy-load pdf-lib INSIDE the handler to avoid Lambda module crash
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib')

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

    // Field normalization
    const workType  = s.work_type || d.typeOfWork || d.work_type || 'Billable Service'
    const jobType   = d.jobType || (workType.toLowerCase().includes('pm') ? 'PM' : 'SC')
    const pmNum     = s.pm_number || '????'
    const customer  = s.customer_name || d.customerName || 'Unknown'
    const location  = s.location_name || d.locationName || ''
    const dateStr   = s.date || d.date || new Date().toISOString().slice(0,10)
    const techs     = Array.isArray(d.techs) ? d.techs : []
    const parts     = Array.isArray(d.parts) ? d.parts : []
    const isWarranty = d.warrantyWork || false
    const partsTotal = parts.reduce((sum, p) => sum + (parseFloat(p.price)||0) * (parseInt(p.qty)||0), 0)
    const laborHours = parseFloat(d.laborHours || s.labor_hours || 0)
    const hourlyRate = parseFloat(d.hourlyRate || s.labor_rate || 115)
    const billable   = parseInt(d.billableTechs || 0) || techs.length
    const miles      = parseFloat(d.miles || s.miles || 0)
    const costPerMile = parseFloat(d.costPerMile || s.cost_per_mile || 1.50)
    const laborTotal  = isWarranty ? 0 : laborHours * hourlyRate * billable
    const mileTotal   = miles * costPerMile
    const grandTotal  = isWarranty ? 0 : partsTotal + laborTotal + mileTotal
    const jobLabel    = jobType === 'PM' ? 'PM #' + pmNum : 'SC #' + pmNum
    const docTitle    = jobType === 'PM' ? 'ROS PM Work Order' : 'ROS Service Work Order'
    const allPhotos   = Array.isArray(s.photos) ? s.photos : []

    // ─── Build PDF ───────────────────────────────────────────────────────────
    const doc      = await PDFDocument.create()
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
    const fontReg  = await doc.embedFont(StandardFonts.Helvetica)
    const pageW = 595, pageH = 842
    let page = doc.addPage([pageW, pageH])
    let y = pageH - 40
    const marginL = 40, marginR = 555
    const rosNavy  = rgb(0.102, 0.137, 0.196)  // #1a2332
    const rosOrange= rgb(0.902, 0.361, 0)       // #e65c00
    const white    = rgb(1,1,1)
    const gray     = rgb(0.5,0.5,0.5)
    const lightGray= rgb(0.95,0.95,0.95)

    const ensureSpace = (n = 40) => {
      if (y - n < 40) { page = doc.addPage([pageW, pageH]); y = pageH - 40 }
    }
    const drawText = (text, x, yPos, opts = {}) => {
      const { font = fontReg, size = 10, color = rgb(0,0,0), maxWidth } = opts
      page.drawText(String(text || ''), { x, y: yPos, font, size, color, maxWidth: maxWidth || (marginR - x + 10) })
    }
    const drawSection = (title) => {
      ensureSpace(30)
      page.drawRectangle({ x: marginL, y: y - 16, width: marginR - marginL, height: 18, color: rosNavy })
      drawText(title, marginL + 4, y - 12, { font: fontBold, size: 11, color: white })
      y -= 26
    }
    const drawRow = (label, value) => {
      ensureSpace(18)
      drawText(label + ':', marginL, y, { font: fontBold, size: 10 })
      drawText(String(value || ''), marginL + 130, y, { size: 10 })
      y -= 16
    }

    // ─── HEADER ──────────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: pageH - 70, width: pageW, height: 70, color: rosNavy })

    // ROS logo: use drawEllipse (pdf-lib 1.17.x API — drawCircle doesn't exist)
    const logoX = 52, logoY = pageH - 35, logoR = 26
    page.drawEllipse({ x: logoX, y: logoY, xScale: logoR, yScale: logoR, color: white })
    page.drawEllipse({ x: logoX, y: logoY, xScale: logoR - 3, yScale: logoR - 3, color: rosNavy })
    // Three vertical bars
    page.drawRectangle({ x: logoX - 10, y: logoY - 10, width: 5,  height: 18, color: white })
    page.drawRectangle({ x: logoX - 3,  y: logoY - 12, width: 6,  height: 22, color: white })
    page.drawRectangle({ x: logoX + 5,  y: logoY - 10, width: 5,  height: 18, color: white })
    drawText('ROS', logoX - 9, logoY - 20, { font: fontBold, size: 6, color: white })

    drawText('RELIABLE OILFIELD SERVICES', logoX + logoR + 8, pageH - 22, { font: fontBold, size: 14, color: rosOrange })
    drawText('ReliableTrack - Built for Reliable Oilfield Services', logoX + logoR + 8, pageH - 37, { size: 9, color: rgb(0.8,0.8,0.8) })
    drawText(docTitle, logoX + logoR + 8, pageH - 52, { size: 9, color: rgb(0.7,0.7,0.7) })
    drawText(jobLabel, marginR - 70, pageH - 20, { font: fontBold, size: 14, color: white })
    drawText(dateStr,  marginR - 70, pageH - 36, { size: 9, color: rgb(0.8,0.8,0.8) })
    y = pageH - 85

    // ─── JOB INFORMATION ─────────────────────────────────────────────────────
    drawSection('JOB INFORMATION')
    drawRow('Customer',   customer)
    drawRow('Location',   location)
    drawRow('Date',       dateStr)
    drawRow('Job Type',   jobType === 'PM' ? 'Preventive Maintenance' : 'Service Call')
    if (workType)                          drawRow('Type of Work', workType)
    if (s.truck_number || d.truckNumber)   drawRow('Truck #',      s.truck_number || d.truckNumber)
    if (s.contact || d.customerContact)    drawRow('Contact',      s.contact || d.customerContact)
    if (s.work_order || d.customerWorkOrder) drawRow('Cust. WO #', s.work_order || d.customerWorkOrder)
    if (s.gl_code || d.glCode)             drawRow('GL Code',      s.gl_code || d.glCode)
    if (s.start_time || d.startTime)       drawRow('Start Time',   s.start_time || d.startTime)
    if (s.departure_time || d.departureTime) drawRow('Departure',  s.departure_time || d.departureTime)
    drawRow('Technicians', techs.join(', ') || 'N/A')
    y -= 8

    // ─── WARRANTY STAMP ───────────────────────────────────────────────────────
    if (isWarranty) {
      ensureSpace(30)
      page.drawRectangle({ x: marginL, y: y - 6, width: marginR - marginL, height: 22, color: rgb(1, 0.95, 0.95) })
      drawText('WARRANTY - NO CHARGE', marginL + 4, y + 2, { font: fontBold, size: 14, color: rgb(0.8, 0, 0) })
      y -= 30
    }

    // ─── WORK DESCRIPTION ─────────────────────────────────────────────────────
    const desc = s.summary || d.description
    if (desc) {
      drawSection('WORK DESCRIPTION')
      const words = desc.split(' ')
      let line = ''
      for (const w of words) {
        const test = line ? line + ' ' + w : w
        if (test.length > 88) {
          ensureSpace(14); drawText(line, marginL + 4, y, { size: 10 }); y -= 14; line = w
        } else line = test
      }
      if (line.trim()) { ensureSpace(14); drawText(line, marginL + 4, y, { size: 10 }); y -= 14 }
      if (d.equipment) { ensureSpace(16); drawText('Equipment: ' + d.equipment, marginL + 4, y, { size: 9, color: gray }); y -= 14 }
      y -= 8
    }

    // ─── PARTS USED ───────────────────────────────────────────────────────────
    if (parts.length > 0) {
      drawSection('PARTS USED')
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
        drawText(p.sku || p.code || '',      marginL,       y, { size: 9 })
        drawText(p.name || p.desc || '',     marginL + 70,  y, { size: 9, maxWidth: 250 })
        drawText(String(p.qty || 1),         marginL + 330, y, { size: 9 })
        drawText('$' + Number(p.price||0).toFixed(2), marginL + 370, y, { size: 9 })
        drawText('$' + (Number(p.qty||1)*Number(p.price||0)).toFixed(2), marginL + 430, y, { size: 9 })
        y -= 14
      }
      y -= 8
    }

    // ─── COST SUMMARY ─────────────────────────────────────────────────────────
    drawSection('COST SUMMARY')
    if (!isWarranty) {
      drawRow('Labor',   '$' + laborTotal.toFixed(2) + ' (' + laborHours + ' hrs x $' + hourlyRate + '/hr x ' + billable + ' tech' + (billable!==1?'s':'') + ')')
      drawRow('Parts',   '$' + partsTotal.toFixed(2))
      drawRow('Mileage', '$' + mileTotal.toFixed(2) + ' (' + miles + ' mi x $' + costPerMile + '/mi)')
      ensureSpace(24)
      page.drawRectangle({ x: marginL, y: y - 6, width: marginR - marginL, height: 22, color: lightGray })
      drawText('GRAND TOTAL:', marginL + 4, y + 2, { font: fontBold, size: 13 })
      drawText('$' + grandTotal.toFixed(2), marginR - 90, y + 2, { font: fontBold, size: 13, color: rosOrange })
      y -= 30
    } else {
      ensureSpace(24)
      page.drawRectangle({ x: marginL, y: y - 6, width: marginR - marginL, height: 22, color: rgb(1, 0.95, 0.95) })
      drawText('WARRANTY - NO CHARGE', marginL + 4, y + 2, { font: fontBold, size: 13, color: rgb(0.8, 0, 0) })
      y -= 30
    }

    // ─── PHOTOS ───────────────────────────────────────────────────────────────
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
          if (col === 0) { ensureSpace(sc.height + 35); rowMaxH = sc.height }
          page.drawImage(em, { x: xPos, y: y - sc.height, width: sc.width, height: sc.height })
          if (photo.caption) drawText(photo.caption, xPos, y - sc.height - 12, { size: 8, color: gray })
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

    // ─── Footer on all pages ──────────────────────────────────────────────────
    doc.getPages().forEach((pg, i, arr) => {
      pg.drawText(
        'ReliableTrack - Built for Reliable Oilfield Services | Page ' + (i+1) + ' of ' + arr.length + ' | ' + dateStr,
        { x: marginL, y: 18, font: fontReg, size: 8, color: gray }
      )
    })

    const pdfBytes  = await doc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')
    const fileName  = 'ROS-' + jobLabel.replace(/ /g,'-').replace('#','') + '-' +
                      (customer||'').replace(/[^a-zA-Z0-9]/g,'-') + '-' + dateStr + '.pdf'

    // ─── HTML Email ───────────────────────────────────────────────────────────
    const techStr   = techs.join(', ') || 'N/A'
    const partsHtml = parts.length > 0
      ? '<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px;margin:8px 0;width:100%">' +
        '<tr style="background:#1a2332;color:#fff"><th>SKU</th><th>Part</th><th>Qty</th><th>Unit $</th><th>Total</th></tr>' +
        parts.map(p =>
          '<tr><td>' + (p.sku||p.code||'') + '</td><td>' + (p.name||'') + '</td><td>' + (p.qty||1) +
          '</td><td>$' + Number(p.price||0).toFixed(2) + '</td><td>$' + (Number(p.qty||1)*Number(p.price||0)).toFixed(2) + '</td></tr>'
        ).join('') + '</table>'
      : '<p style="color:#888;font-size:12px">No parts used</p>'

    const html = `<html><body style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto">
<div style="background:#1a2332;padding:20px 24px">
  <div style="color:#e65c00;font-weight:800;font-size:20px;letter-spacing:1px">RELIABLE OILFIELD SERVICES</div>
  <div style="color:#ccc;font-size:12px;margin-top:2px">ReliableTrack - Built for Reliable Oilfield Services</div>
  <div style="color:#aaa;font-size:11px;margin-top:2px">${docTitle} - ${jobLabel}</div>
</div>
<div style="background:#f5f5f5;padding:12px 24px;border-bottom:3px solid #e65c00">
  <strong style="color:#1a2332;font-size:15px">${customer}</strong>
  ${location ? '<span style="color:#666;font-size:13px"> - ' + location + '</span>' : ''}
  <span style="float:right;color:#888;font-size:12px">${dateStr}</span>
</div>
<div style="padding:16px 24px;border:1px solid #e0e0e0;border-top:none">
  <table style="font-size:13px;width:100%;border-collapse:collapse">
    <tr><td style="padding:5px 0;font-weight:bold;width:140px;color:#1a2332">Type of Work</td><td style="color:#333">${workType}</td></tr>
    <tr><td style="padding:5px 0;font-weight:bold;color:#1a2332">Technicians</td><td style="color:#333">${techStr}</td></tr>
    ${(s.contact||d.customerContact) ? '<tr><td style="padding:5px 0;font-weight:bold;color:#1a2332">Contact</td><td style="color:#333">' + (s.contact||d.customerContact) + '</td></tr>' : ''}
    ${(s.work_order||d.customerWorkOrder) ? '<tr><td style="padding:5px 0;font-weight:bold;color:#1a2332">Cust WO #</td><td style="color:#333">' + (s.work_order||d.customerWorkOrder) + '</td></tr>' : ''}
  </table>
  ${partsHtml}
  ${isWarranty
    ? '<div style="background:#fff0f0;border:2px solid #c00;color:#c00;font-weight:bold;font-size:15px;text-align:center;padding:10px;border-radius:4px;margin-top:10px">WARRANTY - NO CHARGE</div>'
    : '<div style="background:#f9f9f9;border-top:2px solid #e65c00;padding:10px;margin-top:10px;text-align:right"><span style="font-size:13px;color:#555">Parts: $' + partsTotal.toFixed(2) + ' | Labor: $' + laborTotal.toFixed(2) + ' | Mileage: $' + mileTotal.toFixed(2) + '</span><br><strong style="color:#e65c00;font-size:16px">TOTAL: $' + grandTotal.toFixed(2) + '</strong></div>'
  }
</div>
<p style="font-size:10px;color:#aaa;padding:8px 24px">Sent by ReliableTrack - Built for Reliable Oilfield Services<br>PDF work order attached.</p>
</body></html>`

    // ─── Email subject: GoCanvas-style ────────────────────────────────────────
    const techShort = techs.length > 0 ? techs.map(t => t.split(' ').pop()).join(', ') : 'No Tech'
    const subject   = [customer, location, techShort, workType, docTitle].filter(Boolean).join(' - ')

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_KEY },
      body: JSON.stringify({ from: FROM, to: TO, subject, html, attachments: [{ filename: fileName, content: pdfBase64 }] })
    })
    if (!emailRes.ok) {
      const errText = await emailRes.text()
      return res.status(502).json({ error: 'Resend error: ' + errText.substring(0,300) })
    }
    const emailData = await emailRes.json()
    return res.status(200).json({ ok: true, emailId: emailData.id, fileName, subject })

  } catch (err) {
    console.error('send-report error:', err.message, err.stack)
    return res.status(500).json({ error: err.message })
  }
}
