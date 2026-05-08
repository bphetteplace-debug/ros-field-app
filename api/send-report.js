// api/send-report.js - Vercel Serverless Function (ESM, works with "type":"module" in package.json)
// Generates a PDF report (with photos) and emails it via Resend

const SUPA_URL = process.env.VITE_SUPABASE_URL
const SUPA_KEY = process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const TO = ['bphetteplace@reliableoilfieldservices.net','cphetteplace@reliableoilfieldservices.net']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { submissionId } = req.body
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' })

  try {
    // 1. Fetch submission + photos from Supabase
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
    const jobType    = d.job_type    || s.job_type    || 'PM'
    const techs      = Array.isArray(d.techs)   ? d.techs   : []
    const parts      = Array.isArray(d.parts)   ? d.parts   : []
    const workType   = d.work_type   || ''
    const truckNum   = d.truck_number || s.truck_number || ''
    const laborHours = d.labor_hours  || s.labor_hours  || 0
    const miles      = d.miles        || s.miles        || 0
    const laborTotal = d.labor_total  || 0
    const partsTotal = d.parts_total  || 0
    const mileTotal  = d.mileage_total || 0
    const grandTotal = d.grand_total  || (laborTotal + partsTotal + mileTotal)
    const isWarranty = d.is_warranty  || false
    const pmNum      = s.pm_number   || '????'
    const customer   = s.customer_name || ''
    const location   = s.location_name || ''
    const dateStr    = s.date || new Date().toISOString().slice(0,10)
    const summary    = s.summary || d.summary || d.description || ''
    const allPhotos  = Array.isArray(s.photos) ? s.photos : []

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

    function drawRow(label, value, bold = false) {
      ensureSpace(18)
      drawText(label + ':', marginL, y, { font: fontBold, size: 10 })
      drawText(value, marginL + 120, y, { font: bold ? fontBold : fontRegular, size: 10 })
      y -= 16
    }

    // --- HEADER ---
    const rosOrange = rgb(0.902, 0.361, 0)
    page.drawRectangle({ x: 0, y: pageH - 60, width: pageW, height: 60, color: rgb(0.1,0.137,0.196) })
    drawText('RELIABLE OILFIELD SERVICES', marginL, pageH - 25, { font: fontBold, size: 16, color: rosOrange })
    const jobLabel = jobType === 'PM' ? 'PM #' + pmNum : 'SC #' + pmNum
    drawText(jobLabel, marginR - 80, pageH - 20, { font: fontBold, size: 14, color: rgb(1,1,1) })
    drawText('ReliableTrack Field Report', marginL, pageH - 45, { font: fontRegular, size: 10, color: rgb(0.8,0.8,0.8) })
    y = pageH - 80

    // --- JOB INFO ---
    drawSection('JOB INFORMATION')
    drawRow('Customer', customer)
    drawRow('Location', location)
    drawRow('Date', dateStr)
    drawRow('Job Type', jobType)
    drawRow('Work Type', workType)
    drawRow('Truck', truckNum)
    drawRow('Technicians', techs.join(', '))
    drawRow('Labor Hours', String(laborHours) + ' hrs')
    drawRow('Mileage', String(miles) + ' mi')
    if (summary) {
      ensureSpace(30)
      drawText('Summary:', marginL, y, { font: fontBold, size: 10 })
      y -= 14
      const words = summary.split(' ')
      let line = ''
      for (const w of words) {
        if ((line + w).length > 80) {
          ensureSpace(14)
          drawText(line, marginL + 10, y, { size: 10 })
          y -= 14
          line = w + ' '
        } else {
          line += w + ' '
        }
      }
      if (line.trim()) {
        ensureSpace(14)
        drawText(line, marginL + 10, y, { size: 10 })
        y -= 14
      }
    }
    y -= 8

    // --- PARTS ---
    if (parts.length > 0) {
      drawSection('PARTS USED')
      ensureSpace(16)
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
        drawText('$' + Number(p.price || 0).toFixed(2), marginL + 370, y, { size: 9 })
        drawText('$' + (Number(p.qty || 1) * Number(p.price || 0)).toFixed(2), marginL + 430, y, { size: 9 })
        y -= 14
      }
      y -= 8
    }

    // --- TOTALS ---
    drawSection('TOTALS')
    if (!isWarranty) {
      drawRow('Labor', '$' + Number(laborTotal).toFixed(2))
      drawRow('Parts', '$' + Number(partsTotal).toFixed(2))
      drawRow('Mileage', '$' + Number(mileTotal).toFixed(2))
      ensureSpace(20)
      page.drawRectangle({ x: marginL, y: y - 6, width: marginR - marginL, height: 18, color: rgb(0.95,0.95,0.95) })
      drawText('GRAND TOTAL:', marginL + 4, y, { font: fontBold, size: 11 })
      drawText('$' + Number(grandTotal).toFixed(2), marginR - 80, y, { font: fontBold, size: 11, color: rosOrange })
      y -= 26
    } else {
      ensureSpace(20)
      page.drawRectangle({ x: marginL, y: y - 6, width: marginR - marginL, height: 18, color: rgb(1, 0.95, 0.95) })
      drawText('WARRANTY — NO CHARGE', marginL + 4, y, { font: fontBold, size: 13, color: rgb(0.8,0,0) })
      y -= 26
    }

    // --- PHOTOS ---
    const generalPhotos = allPhotos.filter(p => !p.section || p.section === 'general')
    if (generalPhotos.length > 0) {
      drawSection('PHOTOS')
      let col = 0
      for (const photo of generalPhotos) {
        ensureSpace(220)
        const url = SUPA_URL + '/storage/v1/object/public/submission-photos/' + photo.storage_path
        try {
          const imgRes = await fetch(url)
          if (!imgRes.ok) continue
          const imgBuf = await imgRes.arrayBuffer()
          const ct = imgRes.headers.get('content-type') || ''
          let embeddedImg
          if (ct.includes('png')) {
            embeddedImg = await doc.embedPng(imgBuf)
          } else {
            embeddedImg = await doc.embedJpg(imgBuf)
          }
          const scaled = embeddedImg.scaleToFit(250, 190)
          const xPos = col === 0 ? marginL : marginL + 265
          if (col === 0 && y - scaled.height - 30 < 40) {
            ensureSpace(scaled.height + 30)
          }
          page.drawImage(embeddedImg, { x: xPos, y: y - scaled.height, width: scaled.width, height: scaled.height })
          if (photo.caption) {
            drawText(photo.caption, xPos, y - scaled.height - 12, { size: 8, color: rgb(0.4,0.4,0.4) })
          }
          if (col === 0) {
            col = 1
          } else {
            y -= (scaled.height + 30)
            col = 0
          }
        } catch (photoErr) {
          console.error('Failed to embed photo:', photo.storage_path, photoErr.message)
        }
      }
      if (col === 1) y -= 220
      y -= 8
    }

    // --- SIGNATURES ---
    const sigPhotos = allPhotos.filter(p => p.section && p.section.startsWith('sig-'))
    const custSig = allPhotos.find(p => p.section === 'customer-sig')
    if (sigPhotos.length > 0 || custSig) {
      drawSection('SIGNATURES')
      for (const sig of sigPhotos) {
        ensureSpace(90)
        const techName = sig.section.replace('sig-', '')
        drawText(techName, marginL, y, { font: fontBold, size: 9 })
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
        } catch(e) {}
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
        } catch(e) {}
      }
    }

    // --- PAGE FOOTERS ---
    const pages = doc.getPages()
    const totalPages = pages.length
    for (let i = 0; i < totalPages; i++) {
      const pg = pages[i]
      pg.drawText(
        'Generated by ReliableTrack | Page ' + (i+1) + ' of ' + totalPages + ' | ' + dateStr,
        { x: marginL, y: 20, font: fontRegular, size: 8, color: rgb(0.5,0.5,0.5) }
      )
    }

    // 3. Serialize PDF
    const pdfBytes = await doc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')

    // 4. Send via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + RESEND_KEY
      },
      body: JSON.stringify({
        from: 'ReliableTrack <noreply@reliable-oilfield-services.com>',
        to: TO,
        subject: jobLabel + ' — ' + customer + ' — ' + location + ' (' + dateStr + ')',
        html: '<p>Please find the attached field report for <strong>' + customer + '</strong> at ' + location + ' on ' + dateStr + '.</p><p>Submitted via ReliableTrack.</p>',
        attachments: [{
          filename: 'ROS-' + jobLabel.replace(' ', '-').replace('#', '') + '-' + customer.replace(/\s+/g,'-') + '.pdf',
          content: pdfBase64
        }]
      })
    })

    if (!emailRes.ok) {
      const errText = await emailRes.text()
      console.error('Resend error:', emailRes.status, errText)
      return res.status(500).json({ error: 'Email failed: ' + errText })
    }

    const emailData = await emailRes.json()
    return res.status(200).json({ ok: true, emailId: emailData.id })

  } catch (err) {
    console.error('send-report error:', err)
    return res.status(500).json({ error: err.message })
  }
}
