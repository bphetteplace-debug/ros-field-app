// api/send-report.cjs - Vercel Serverless Function (CommonJS, forced CJS via .cjs extension)
// Generates a PDF report (with photos) and emails it via Resend

const SUPA_URL = process.env.VITE_SUPABASE_URL
const SUPA_KEY = process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const TO = ['bphetteplace@reliableoilfieldservices.net','cphetteplace@reliableoilfieldservices.net']

module.exports = async function handler(req, res) {
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
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    const s = rows[0]

    // Normalise: fields live both at top-level AND inside s.data (JSONB column)
    const d = s.data || {}
    const isWarranty = d.warranty_work === true || s.is_warranty === true
    const jobType   = (d.job_type || s.job_type || 'PM') === 'PM' ? 'PM' : 'SC'
    const techs     = Array.isArray(d.techs) ? d.techs : (Array.isArray(s.techs) ? s.techs : [])
    const parts     = Array.isArray(d.parts) ? d.parts : (Array.isArray(s.parts) ? s.parts : [])
    const billable  = d.billable_techs != null ? d.billable_techs : s.billable_techs
    const laborTotal   = parseFloat(d.labor_total   ?? s.labor_total   ?? 0)
    const partsTotal   = parseFloat(d.parts_total   ?? s.parts_total   ?? 0)
    const mileageTotal = parseFloat(d.mileage_total ?? s.mileage_total ?? 0)
    const description  = s.summary || s.description || ''
    const photos = Array.isArray(s.photos) ? s.photos.sort((a,b) => (a.display_order||0)-(b.display_order||0)) : []

    // 2. Build PDF
    const pdfLib = await import('pdf-lib')
    const { PDFDocument, rgb, StandardFonts } = pdfLib
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const { width, height } = page.getSize()
    const bold    = await doc.embedFont(StandardFonts.HelveticaBold)
    const regular = await doc.embedFont(StandardFonts.Helvetica)

    const navy      = rgb(0.102, 0.137, 0.196)
    const orange    = rgb(0.902, 0.361, 0)
    const white     = rgb(1, 1, 1)
    const black     = rgb(0, 0, 0)
    const lightGray = rgb(0.95, 0.95, 0.95)

    const safe = (val) => String(val || '').substring(0, 80)
    const currency = (n) => { const v = parseFloat(n); return isNaN(v) ? '$0.00' : '$' + v.toFixed(2) }

    let y = height - 20
    let curPage = page

    const ensureSpace = (needed) => {
      if (y - needed < 40) {
        curPage = doc.addPage([612, 792])
        y = height - 20
      }
    }

    const drawSection = (title) => {
      ensureSpace(30)
      curPage.drawRectangle({ x: 0, y: y - 20, width, height: 24, color: navy })
      curPage.drawText(title, { x: 10, y: y - 14, size: 11, font: bold, color: white })
      y -= 30
    }

    const drawRow = (label, value, shade) => {
      ensureSpace(20)
      if (shade) curPage.drawRectangle({ x: 0, y: y - 14, width, height: 18, color: lightGray })
      curPage.drawText(label + ':', { x: 10, y: y - 10, size: 9, font: bold, color: black })
      curPage.drawText(safe(value), { x: 150, y: y - 10, size: 9, font: regular, color: black })
      y -= 18
    }

    // Header bar
    curPage.drawRectangle({ x: 0, y: y - 40, width, height: 50, color: navy })
    curPage.drawText('ReliableTrack - Field Report', { x: 20, y: y - 30, size: 16, font: bold, color: white })
    y -= 55

    // Job label
    const jobNum = s.pm_number ? (jobType + ' #' + s.pm_number) : jobType
    curPage.drawText(jobNum, { x: 20, y, size: 14, font: bold, color: orange })
    if (isWarranty) curPage.drawText('WARRANTY', { x: width - 120, y, size: 14, font: bold, color: orange })
    y -= 20

    // Job Info
    drawSection('JOB INFORMATION')
    drawRow('Customer', s.customer_name, false)
    drawRow('Location', s.location_name, true)
    drawRow('Date', s.date, false)
    drawRow('Truck', s.truck_number, true)
    y -= 5

    // Techs & Time
    drawSection('TECHS & TIME')
    drawRow('Technicians', techs.join(', '), false)
    drawRow('Billable Techs', safe(billable), true)
    drawRow('Time on Site', safe(s.labor_hours) + ' hrs', false)
    drawRow('Mileage', safe(s.miles) + ' mi', true)
    y -= 5

    // Work Description
    drawSection('WORK DESCRIPTION')
    const descWords = description.split(' ')
    let line = ''
    for (const word of descWords) {
      const test = line ? line + ' ' + word : word
      if (test.length > 90) {
        ensureSpace(16)
        curPage.drawText(line, { x: 10, y: y - 10, size: 9, font: regular, color: black })
        y -= 14
        line = word
      } else { line = test }
    }
    if (line) {
      ensureSpace(16)
      curPage.drawText(line, { x: 10, y: y - 10, size: 9, font: regular, color: black })
      y -= 14
    }
    y -= 5

    // Parts table
    if (parts.length > 0) {
      drawSection('PARTS USED')
      ensureSpace(20)
      curPage.drawText('SKU',         { x: 10,  y: y - 10, size: 9, font: bold, color: black })
      curPage.drawText('Description', { x: 80,  y: y - 10, size: 9, font: bold, color: black })
      curPage.drawText('Qty',         { x: 380, y: y - 10, size: 9, font: bold, color: black })
      curPage.drawText('Unit Price',  { x: 420, y: y - 10, size: 9, font: bold, color: black })
      curPage.drawText('Total',       { x: 510, y: y - 10, size: 9, font: bold, color: black })
      y -= 18
      parts.forEach(function(p, i) {
        ensureSpace(20)
        const shade = i % 2 === 0
        if (shade) curPage.drawRectangle({ x: 0, y: y - 14, width, height: 18, color: lightGray })
        const lineTotal = (parseFloat(p.price || 0) * parseInt(p.qty || 1)).toFixed(2)
        curPage.drawText(safe(p.sku || p.code || '').substring(0, 12),  { x: 10,  y: y - 10, size: 8, font: regular, color: black })
        curPage.drawText(safe(p.name || p.desc || '').substring(0, 40), { x: 80,  y: y - 10, size: 8, font: regular, color: black })
        curPage.drawText(String(p.qty || 1),    { x: 380, y: y - 10, size: 8, font: regular, color: black })
        curPage.drawText(currency(p.price),     { x: 420, y: y - 10, size: 8, font: regular, color: black })
        curPage.drawText('$' + lineTotal,        { x: 510, y: y - 10, size: 8, font: regular, color: black })
        y -= 16
      })
      y -= 5
    }

    // Cost Summary
    drawSection('COST SUMMARY')
    if (isWarranty) {
      ensureSpace(50)
      curPage.drawRectangle({ x: 150, y: y - 30, width: 300, height: 40, color: orange })
      curPage.drawText('WARRANTY - NO CHARGE', { x: 165, y: y - 18, size: 16, font: bold, color: white })
      y -= 45
    } else {
      const grandTotal = laborTotal + partsTotal + mileageTotal
      drawRow('Labor',   currency(laborTotal),   false)
      drawRow('Parts',   currency(partsTotal),   true)
      drawRow('Mileage', currency(mileageTotal), false)
      ensureSpace(22)
      curPage.drawRectangle({ x: 0, y: y - 14, width, height: 18, color: navy })
      curPage.drawText('TOTAL:', { x: 10, y: y - 10, size: 10, font: bold, color: white })
      curPage.drawText(currency(grandTotal), { x: 150, y: y - 10, size: 10, font: bold, color: white })
      y -= 22
    }
    y -= 10

    // Photos section - embed each photo from Supabase Storage
    if (photos.length > 0) {
      drawSection('PHOTOS (' + photos.length + ')')
      const STORAGE_BASE = SUPA_URL + '/storage/v1/object/public/submission-photos/'
      let photoCol = 0
      const imgW = 270, imgH = 200, margin = 10, cols = 2
      const rowH = imgH + 30

      for (let i = 0; i < photos.length; i++) {
        if (photoCol === 0) ensureSpace(rowH + 20)
        const xPos = margin + photoCol * (imgW + margin)
        const yPos = y - imgH - 10

        try {
          const photoUrl = STORAGE_BASE + photos[i].storage_path
          const imgResp = await fetch(photoUrl)
          if (imgResp.ok) {
            const imgBytes = await imgResp.arrayBuffer()
            const contentType = imgResp.headers.get('content-type') || ''
            let embeddedImg
            if (contentType.includes('png')) {
              embeddedImg = await doc.embedPng(imgBytes)
            } else {
              embeddedImg = await doc.embedJpg(imgBytes)
            }
            const dims = embeddedImg.scaleToFit(imgW, imgH)
            curPage.drawImage(embeddedImg, {
              x: xPos + (imgW - dims.width) / 2,
              y: yPos + (imgH - dims.height) / 2,
              width: dims.width,
              height: dims.height,
            })
          }
        } catch (photoErr) {
          console.error('Photo embed error:', photoErr.message)
          curPage.drawRectangle({ x: xPos, y: yPos, width: imgW, height: imgH, borderColor: lightGray, borderWidth: 1 })
          curPage.drawText('[Photo unavailable]', { x: xPos + 10, y: yPos + imgH/2, size: 9, font: regular, color: lightGray })
        }

        const caption = photos[i].caption || ('Photo ' + (i + 1))
        curPage.drawText(caption.substring(0, 40), { x: xPos, y: yPos - 14, size: 8, font: regular, color: black })

        photoCol++
        if (photoCol >= cols) {
          photoCol = 0
          y -= rowH
        }
      }
      if (photoCol > 0) y -= rowH
    }

    // Footer on each page
    const pageCount = doc.getPageCount()
    for (let pi = 0; pi < pageCount; pi++) {
      const pg = doc.getPage(pi)
      pg.drawText(
        'Generated by ReliableTrack  |  Page ' + (pi+1) + ' of ' + pageCount + '  |  ' + new Date().toLocaleString(),
        { x: 10, y: 20, size: 7, font: regular, color: rgb(0.5, 0.5, 0.5) }
      )
    }

    const pdfBytes  = await doc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')

    // 3. Send email via Resend
    const subject     = 'ReliableTrack Report - ' + jobNum + ' - ' + (s.customer_name || '')
    const techDisplay = techs.join(', ')
    const totalAmt    = currency(laborTotal + partsTotal + mileageTotal)
    const htmlBody =
      '<h2 style="color:#1a2332">ReliableTrack Field Report</h2>' +
      '<p><strong>' + jobNum + '</strong> &mdash; ' + (s.customer_name || '') + ' &mdash; ' + (s.date || '') + '</p>' +
      '<p>Location: ' + (s.location_name || '') + '</p>' +
      '<p>Techs: ' + techDisplay + '</p>' +
      '<p>Time on Site: ' + (s.labor_hours || '') + ' hrs</p>' +
      (isWarranty
        ? '<p style="color:#e65c00;font-weight:bold">WARRANTY - NO CHARGE</p>'
        : '<p>Total: ' + totalAmt + '</p>') +
      (photos.length > 0 ? '<p>' + photos.length + ' photo(s) attached in PDF.</p>' : '') +
      '<hr/><p style="color:#888;font-size:12px">Sent from ReliableTrack &mdash; Reliable Oilfield Services</p>'

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'ReliableTrack <noreply@reliable-oilfield-services.com>',
        to: TO,
        subject,
        html: htmlBody,
        attachments: [{ filename: jobNum.replace(/ /g, '-') + '-report.pdf', content: pdfBase64 }]
      })
    })

    const emailData = await emailRes.json()
    if (!emailRes.ok) {
      console.error('Resend error:', JSON.stringify(emailData))
      return res.status(500).json({ error: 'Email failed', detail: emailData })
    }

    return res.status(200).json({ ok: true, emailId: emailData.id, photos: photos.length })

  } catch (err) {
    console.error('send-report error:', err.message, err.stack)
    return res.status(500).json({ error: err.message })
  }
}
