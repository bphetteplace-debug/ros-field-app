// api/send-report.js - Vercel Serverless Function (CommonJS via api/package.json)
// Sends HTML email with PDF attachment via Resend
// pdf-lib is lazy-loaded inside handler to avoid Lambda crash

const SUPA_URL   = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co'
const SUPA_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const TO         = process.env.EMAIL_TO
  ? process.env.EMAIL_TO.split(',').map(e => e.trim())
  : ['bphetteplace@reliableoilfieldservices.net']

// FROM: use onboarding@resend.dev (always works) until reliable-oilfield-services.com domain verifies in Resend
// Once domain SPF+MX go green at resend.com/domains, update RESEND_FROM env var and remove this line
const FROM = process.env.RESEND_FROM && !process.env.RESEND_FROM.includes('reliable-oilfield-services.com')
  ? process.env.RESEND_FROM
  : 'ReliableTrack <onboarding@resend.dev>'

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { submissionId } = req.body || {}
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' })
  if (!RESEND_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY' })
  if (!SUPA_KEY)   return res.status(500).json({ error: 'Missing Supabase key' })

  try {
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib')

    // Fetch submission + photos
    const r = await fetch(
      SUPA_URL + '/rest/v1/submissions?id=eq.' + submissionId +
      '&select=*,photos(id,storage_path,caption,display_order,section)',
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
    const workType   = s.work_type || d.typeOfWork || 'Billable Service'
    const jobType    = d.jobType || (workType.toLowerCase().includes('pm') ? 'PM' : 'SC')
    const pmNum      = s.pm_number || '????'
    const customer   = s.customer_name || d.customerName || 'Unknown'
    const location   = s.location_name || d.locationName || ''
    const dateStr    = s.date || new Date().toISOString().slice(0, 10)
    const techs      = Array.isArray(d.techs) ? d.techs : []
    const parts      = Array.isArray(d.parts) ? d.parts : []
    const isWarranty = !!d.warrantyWork
    const partsTotal  = parts.reduce((sum, p) => sum + (parseFloat(p.price) || 0) * (parseInt(p.qty) || 0), 0)
    const laborHours  = parseFloat(d.laborHours || s.labor_hours || 0)
    const hourlyRate  = parseFloat(d.hourlyRate  || s.labor_rate  || 115)
    const billable    = parseInt(d.billableTechs || 0) || techs.length
    const miles       = parseFloat(d.miles || s.miles || 0)
    const cpm         = parseFloat(d.costPerMile || s.cost_per_mile || 1.5)
    const laborTotal  = isWarranty ? 0 : laborHours * hourlyRate * billable
    const mileTotal   = miles * cpm
    const grandTotal  = isWarranty ? 0 : partsTotal + laborTotal + mileTotal
    const jobLabel    = (jobType === 'PM' ? 'PM #' : 'SC #') + pmNum
    const docTitle    = jobType === 'PM' ? 'ROS PM Work Order' : 'ROS Service Work Order'
    const allPhotos   = Array.isArray(s.photos) ? s.photos : []

    // ── BUILD PDF ─────────────────────────────────────────────────────────────
    const doc      = await PDFDocument.create()
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
    const fontReg  = await doc.embedFont(StandardFonts.Helvetica)
    const W = 595, H = 842
    let page = doc.addPage([W, H])
    let y = H - 30
    const ML = 40, MR = 555
    const navy   = rgb(0.102, 0.137, 0.196)
    const orange = rgb(0.902, 0.361, 0)
    const white  = rgb(1, 1, 1)
    const gray   = rgb(0.5, 0.5, 0.5)

    const newPage = () => { page = doc.addPage([W, H]); y = H - 30 }
    const gap = (n = 40) => { if (y - n < 40) newPage() }

    const txt = (text, x, yy, opts = {}) => {
      const { font = fontReg, size = 10, color = rgb(0,0,0), maxWidth } = opts
      page.drawText(String(text || ''), { x, y: yy, font, size, color, maxWidth: maxWidth || (MR - x + 10) })
    }

    const section = (title) => {
      gap(30)
      page.drawRectangle({ x: ML, y: y - 16, width: MR - ML, height: 18, color: navy })
      txt(title, ML + 4, y - 12, { font: fontBold, size: 11, color: white })
      y -= 26
    }

    const row = (label, value) => {
      gap(18)
      txt(label + ':', ML, y, { font: fontBold, size: 10 })
      txt(String(value || ''), ML + 130, y, { size: 10 })
      y -= 16
    }

    // ── HEADER (text-only, no graphic primitives) ─────────────────────────────
    page.drawRectangle({ x: 0, y: H - 65, width: W, height: 65, color: navy })
    txt('RELIABLE OILFIELD SERVICES', ML, H - 22, { font: fontBold, size: 15, color: orange })
    txt('ReliableTrack - Built for Reliable Oilfield Services', ML, H - 38, { size: 9, color: rgb(0.8, 0.8, 0.8) })
    txt(docTitle, ML, H - 52, { size: 9, color: rgb(0.7, 0.7, 0.7) })
    txt(jobLabel, MR - 70, H - 20, { font: fontBold, size: 14, color: white })
    txt(dateStr,  MR - 70, H - 36, { size: 9, color: rgb(0.8, 0.8, 0.8) })
    y = H - 80

    // ── JOB INFO ──────────────────────────────────────────────────────────────
    section('JOB INFORMATION')
    row('Customer',   customer)
    row('Location',   location)
    row('Date',       dateStr)
    row('Job Type',   jobType === 'PM' ? 'Preventive Maintenance' : 'Service Call')
    if (workType)                                row('Type of Work', workType)
    if (s.truck_number || d.truckNumber)         row('Truck #',      s.truck_number || d.truckNumber)
    if (s.contact || d.customerContact)          row('Contact',      s.contact || d.customerContact)
    if (s.work_order || d.customerWorkOrder)     row('Cust. WO #',   s.work_order || d.customerWorkOrder)
    if (s.gl_code || d.glCode)                   row('GL Code',      s.gl_code || d.glCode)
    if (s.start_time || d.startTime)             row('Start Time',   s.start_time || d.startTime)
    if (s.departure_time || d.departureTime)     row('Departure',    s.departure_time || d.departureTime)
    row('Technicians', techs.join(', ') || 'N/A')
    y -= 8

    if (isWarranty) {
      gap(28)
      page.drawRectangle({ x: ML, y: y - 6, width: MR - ML, height: 22, color: rgb(1, 0.95, 0.95) })
      txt('WARRANTY - NO CHARGE', ML + 4, y + 2, { font: fontBold, size: 14, color: rgb(0.8, 0, 0) })
      y -= 30
    }

    // ── DESCRIPTION ───────────────────────────────────────────────────────────
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

    // ── PARTS ─────────────────────────────────────────────────────────────────
    if (parts.length > 0) {
      section('PARTS USED')
      txt('SKU',         ML,       y, { font: fontBold, size: 9 })
      txt('Description', ML + 70,  y, { font: fontBold, size: 9 })
      txt('Qty',         ML + 330, y, { font: fontBold, size: 9 })
      txt('Unit $',      ML + 370, y, { font: fontBold, size: 9 })
      txt('Total',       ML + 430, y, { font: fontBold, size: 9 })
      y -= 14
      page.drawLine({ start: { x: ML, y }, end: { x: MR, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) })
      y -= 6
      for (const p of parts) {
        gap(14)
        txt(p.sku || p.code || '',   ML,       y, { size: 9 })
        txt(p.name || p.desc || '',  ML + 70,  y, { size: 9, maxWidth: 250 })
        txt(String(p.qty || 1),      ML + 330, y, { size: 9 })
        txt('$' + Number(p.price || 0).toFixed(2), ML + 370, y, { size: 9 })
        txt('$' + (Number(p.qty || 1) * Number(p.price || 0)).toFixed(2), ML + 430, y, { size: 9 })
        y -= 14
      }
      y -= 8
    }

    // ── TOTALS ────────────────────────────────────────────────────────────────
    section('COST SUMMARY')
    if (!isWarranty) {
      row('Labor',   '$' + laborTotal.toFixed(2) + ' (' + laborHours + ' hrs x $' + hourlyRate + '/hr x ' + billable + ' tech' + (billable !== 1 ? 's' : '') + ')')
      row('Parts',   '$' + partsTotal.toFixed(2))
      row('Mileage', '$' + mileTotal.toFixed(2) + ' (' + miles + ' mi x $' + cpm + '/mi)')
      gap(24)
      page.drawRectangle({ x: ML, y: y - 6, width: MR - ML, height: 22, color: rgb(0.95, 0.95, 0.95) })
      txt('GRAND TOTAL:', ML + 4, y + 2, { font: fontBold, size: 13 })
      txt('$' + grandTotal.toFixed(2), MR - 90, y + 2, { font: fontBold, size: 13, color: orange })
      y -= 30
    } else {
      gap(24)
      page.drawRectangle({ x: ML, y: y - 6, width: MR - ML, height: 22, color: rgb(1, 0.95, 0.95) })
      txt('WARRANTY - NO CHARGE', ML + 4, y + 2, { font: fontBold, size: 13, color: rgb(0.8, 0, 0) })
      y -= 30
    }

    // ── PHOTOS ────────────────────────────────────────────────────────────────
    const addPhotos = async (list) => {
      let col = 0, rowH = 0
      for (const photo of list) {
        try {
          const imgRes = await fetch(SUPA_URL + '/storage/v1/object/public/submission-photos/' + photo.storage_path)
          if (!imgRes.ok) continue
          const buf = await imgRes.arrayBuffer()
          const ct  = (imgRes.headers.get('content-type') || '')
          const em  = ct.includes('png') ? await doc.embedPng(buf) : await doc.embedJpg(buf)
          const sc  = em.scaleToFit(250, 190)
          const xp  = col === 0 ? ML : ML + 265
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

    const partPhotos = allPhotos.filter(p => p.section && p.section.startsWith('part-'))
    if (partPhotos.length > 0) { section('PART PHOTOS'); await addPhotos(partPhotos) }

    const sigPhotos = allPhotos.filter(p => p.section && p.section.startsWith('sig-'))
    const custSig   = allPhotos.find(p => p.section === 'customer-sig')
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
            const ct  = imgRes.headers.get('content-type') || ''
            const img = ct.includes('png') ? await doc.embedPng(buf) : await doc.embedJpg(buf)
            const sc  = img.scaleToFit(250, 60)
            page.drawImage(img, { x: ML, y: y - sc.height, width: sc.width, height: sc.height })
            y -= sc.height + 8
          }
        } catch (e) { console.warn('sig skip:', e.message) }
      }
    }

    // ── FOOTER ────────────────────────────────────────────────────────────────
    doc.getPages().forEach((pg, i, arr) => {
      pg.drawText(
        'ReliableTrack - Built for Reliable Oilfield Services | Page ' + (i + 1) + ' of ' + arr.length + ' | ' + dateStr,
        { x: ML, y: 18, font: fontReg, size: 8, color: gray }
      )
    })

    const pdfBytes  = await doc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')
    const fileName  = 'ROS-' + jobLabel.replace(/ /g, '-').replace('#', '') +
                      '-' + customer.replace(/[^a-zA-Z0-9]/g, '-') +
                      '-' + dateStr + '.pdf'

    // ── HTML EMAIL ────────────────────────────────────────────────────────────
    const techStr   = techs.join(', ') || 'N/A'
    const partsHtml = parts.length > 0
      ? '<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px;margin:8px 0;width:100%">' +
        '<tr style="background:#1a2332;color:#fff"><th>SKU</th><th>Part</th><th>Qty</th><th>Unit $</th><th>Total</th></tr>' +
        parts.map(p => '<tr><td>' + (p.sku || p.code || '') + '</td><td>' + (p.name || '') + '</td><td>' + (p.qty || 1) +
          '</td><td>$' + Number(p.price || 0).toFixed(2) + '</td><td>$' + (Number(p.qty || 1) * Number(p.price || 0)).toFixed(2) + '</td></tr>').join('') +
        '</table>'
      : '<p style="color:#888;font-size:12px">No parts used</p>'

    const totalsHtml = isWarranty
      ? '<div style="background:#fff0f0;border:2px solid #c00;color:#c00;font-weight:bold;font-size:15px;text-align:center;padding:10px;border-radius:4px;margin-top:10px">WARRANTY - NO CHARGE</div>'
      : '<div style="background:#f9f9f9;border-top:2px solid #e65c00;padding:10px;margin-top:10px;text-align:right">' +
        '<span style="font-size:13px;color:#555">Parts: $' + partsTotal.toFixed(2) + ' | Labor: $' + laborTotal.toFixed(2) + ' | Mileage: $' + mileTotal.toFixed(2) + '</span><br>' +
        '<strong style="color:#e65c00;font-size:16px">TOTAL: $' + grandTotal.toFixed(2) + '</strong></div>'

    const html = '<html><body style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto">' +
      '<div style="background:#1a2332;padding:20px 24px">' +
        '<div style="color:#e65c00;font-weight:800;font-size:20px">RELIABLE OILFIELD SERVICES</div>' +
        '<div style="color:#ccc;font-size:12px;margin-top:2px">ReliableTrack - Built for Reliable Oilfield Services</div>' +
        '<div style="color:#aaa;font-size:11px;margin-top:2px">' + docTitle + ' - ' + jobLabel + '</div>' +
      '</div>' +
      '<div style="background:#f5f5f5;padding:12px 24px;border-bottom:3px solid #e65c00">' +
        '<strong style="color:#1a2332;font-size:15px">' + customer + '</strong>' +
        (location ? '<span style="color:#666;font-size:13px"> - ' + location + '</span>' : '') +
        '<span style="float:right;color:#888;font-size:12px">' + dateStr + '</span>' +
      '</div>' +
      '<div style="padding:16px 24px;border:1px solid #e0e0e0;border-top:none">' +
        '<table style="font-size:13px;width:100%;border-collapse:collapse">' +
          '<tr><td style="padding:5px 0;font-weight:bold;width:140px;color:#1a2332">Type of Work</td><td>' + workType + '</td></tr>' +
          '<tr><td style="padding:5px 0;font-weight:bold;color:#1a2332">Technicians</td><td>' + techStr + '</td></tr>' +
          (s.contact || d.customerContact ? '<tr><td style="padding:5px 0;font-weight:bold;color:#1a2332">Contact</td><td>' + (s.contact || d.customerContact) + '</td></tr>' : '') +
          (s.work_order || d.customerWorkOrder ? '<tr><td style="padding:5px 0;font-weight:bold;color:#1a2332">Cust WO #</td><td>' + (s.work_order || d.customerWorkOrder) + '</td></tr>' : '') +
        '</table>' +
        partsHtml + totalsHtml +
      '</div>' +
      '<p style="font-size:10px;color:#aaa;padding:8px 24px">Sent by ReliableTrack - Built for Reliable Oilfield Services. PDF attached.</p>' +
      '</body></html>'

    const techShort = techs.length > 0 ? techs.map(t => t.split(' ').pop()).join(', ') : 'No Tech'
    const subject   = [customer, location, techShort, workType, docTitle].filter(Boolean).join(' - ')

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
