// api/send-report.js — Vercel Serverless Function
// Generates a PDF report and emails it via Resend

const SUPA_URL = process.env.VITE_SUPABASE_URL
const SUPA_KEY = process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const TO = ['bphetteplace@reliableoilfieldservices.net','cphetteplace@reliableoilfieldservices.net']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { submissionId } = req.body
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' })

  try {
    // 1. Fetch submission
    const r = await fetch(`${SUPA_URL}/rest/v1/submissions?id=eq.${submissionId}&select=*`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    })
    const rows = await r.json()
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    const s = rows[0]

    // 2. Build PDF
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const { width, height } = page.getSize()
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const regular = await doc.embedFont(StandardFonts.Helvetica)

    const navy = rgb(0.102, 0.137, 0.196)
    const orange = rgb(0.902, 0.361, 0)
    const white = rgb(1,1,1)
    const black = rgb(0,0,0)
    const lightGray = rgb(0.95, 0.95, 0.95)

    const safe = (val) => String(val||'—').substring(0, 80)
    const currency = (n) => {
      const v = parseFloat(n)
      return isNaN(v) ? '$0.00' : '$' + v.toFixed(2)
    }

    let y = height - 20

    // Header bar
    page.drawRectangle({ x: 0, y: y - 40, width, height: 50, color: navy })
    page.drawText('ReliableTrack — Field Report', {
      x: 20, y: y - 30, size: 16, font: bold, color: white
    })
    y -= 55

    // Job label
    const isWarranty = s.is_warranty === true
    const jobType = s.job_type === 'PM' ? 'PM' : 'SC'
    const jobNum = s.pm_number ? `${jobType} #${s.pm_number}` : jobType
    page.drawText(jobNum, { x: 20, y, size: 14, font: bold, color: orange })
    if (isWarranty) {
      page.drawText('WARRANTY', { x: width - 120, y, size: 14, font: bold, color: orange })
    }
    y -= 20

    const drawSection = (title, startY) => {
      page.drawRectangle({ x: 0, y: startY - 20, width, height: 24, color: navy })
      page.drawText(title, { x: 10, y: startY - 14, size: 11, font: bold, color: white })
      return startY - 30
    }

    const drawRow = (label, value, rowY, shade) => {
      if (shade) page.drawRectangle({ x: 0, y: rowY - 14, width, height: 18, color: lightGray })
      page.drawText(label + ':', { x: 10, y: rowY - 10, size: 9, font: bold, color: black })
      page.drawText(safe(value), { x: 150, y: rowY - 10, size: 9, font: regular, color: black })
      return rowY - 18
    }

    // Job Info section
    y = drawSection('JOB INFORMATION', y)
    y = drawRow('Customer', s.customer_name, y, false)
    y = drawRow('Location', s.location_name, y, true)
    y = drawRow('Date', s.date, y, false)
    y = drawRow('Truck', s.truck_number, y, true)
    y -= 5

    // Techs & Time section
    y = drawSection('TECHS & TIME', y)
    const techList = Array.isArray(s.techs) ? s.techs.join(', ') : safe(s.techs)
    y = drawRow('Technicians', techList, y, false)
    y = drawRow('Billable Techs', safe(s.billable_techs), y, true)
    y = drawRow('Time on Site', safe(s.time_on_site) + ' hrs', y, false)
    y = drawRow('Mileage', safe(s.mileage) + ' mi', y, true)
    y -= 5

    // Work Description
// Generates a PDF report and emails it via Resend

const SUPA_URL = process.env.VITE_SUPABASE_URL
const SUPA_KEY = process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const TO = ['bphetteplace@reliableoilfieldservices.net','cphetteplace@reliableoilfieldservices.net']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { submissionId } = req.body
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' })

  try {
    // 1. Fetch submission
    const r = await fetch(`${SUPA_URL}/rest/v1/submissions?id=eq.${submissionId}&select=*`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    })
    const rows = await r.json()
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    const s = rows[0]

    // 2. Build PDF
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const { width, height } = page.getSize()
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const regular = await doc.embedFont(StandardFonts.Helvetica)

    const navy = rgb(0.102, 0.137, 0.196)
    const orange = rgb(0.902, 0.361, 0)
    const white = rgb(1,1,1)
    const black = rgb(0,0,0)
    const lightGray = rgb(0.95, 0.95, 0.95)

    const safe = (val) => String(val||'').substring(0, 80)
    const currency = (n) => {
      const v = parseFloat(n)
      return isNaN(v) ? '$0.00' : '$' + v.toFixed(2)
    }

    let y = height - 20

    // Header bar
    page.drawRectangle({ x: 0, y: y - 40, width, height: 50, color: navy })
    page.drawText('ReliableTrack - Field Report', {
      x: 20, y: y - 30, size: 16, font: bold, color: white
    })
    y -= 55

    // Job label
    const isWarranty = s.is_warranty === true
    const jobType = s.job_type === 'PM' ? 'PM' : 'SC'
    const jobNum = s.pm_number ? (jobType + ' #' + s.pm_number) : jobType
    page.drawText(jobNum, { x: 20, y, size: 14, font: bold, color: orange })
    if (isWarranty) {
      page.drawText('WARRANTY', { x: width - 120, y, size: 14, font: bold, color: orange })
    }
    y -= 20

    const drawSection = (title, startY) => {
      page.drawRectangle({ x: 0, y: startY - 20, width, height: 24, color: navy })
      page.drawText(title, { x: 10, y: startY - 14, size: 11, font: bold, color: white })
      return startY - 30
    }

    const drawRow = (label, value, rowY, shade) => {
      if (shade) page.drawRectangle({ x: 0, y: rowY - 14, width, height: 18, color: lightGray })
      page.drawText(label + ':', { x: 10, y: rowY - 10, size: 9, font: bold, color: black })
      page.drawText(safe(value), { x: 150, y: rowY - 10, size: 9, font: regular, color: black })
      return rowY - 18
    }

    // Job Info section
    y = drawSection('JOB INFORMATION', y)
    y = drawRow('Customer', s.customer_name, y, false)
    y = drawRow('Location', s.location_name, y, true)
    y = drawRow('Date', s.date, y, false)
    y = drawRow('Truck', s.truck_number, y, true)
    y -= 5

    // Techs & Time section
    y = drawSection('TECHS & TIME', y)
    const techList = Array.isArray(s.techs) ? s.techs.join(', ') : safe(s.techs)
    y = drawRow('Technicians', techList, y, false)
    y = drawRow('Billable Techs', safe(s.billable_techs), y, true)
    y = drawRow('Time on Site', safe(s.time_on_site) + ' hrs', y, false)
    y = drawRow('Mileage', safe(s.mileage) + ' mi', y, true)
    y -= 5

    // Work Description
    y = drawSection('WORK DESCRIPTION', y)
    const desc = String(s.description || '')
    const descLines = []
    for (let start = 0; start < desc.length || descLines.length === 0; start += 90) {
      descLines.push(desc.substring(start, start + 90))
      if (start + 90 >= desc.length) break
    }
    if (descLines.length === 0) descLines.push('')
    for (const line of descLines) {
      page.drawText(line, { x: 10, y: y - 10, size: 9, font: regular, color: black })
      y -= 14
    }
    y -= 5

    // Parts table
    const parts = Array.isArray(s.parts) ? s.parts : []
    if (parts.length > 0) {
      y = drawSection('PARTS USED', y)
      page.drawText('SKU', { x: 10, y: y - 10, size: 9, font: bold, color: black })
      page.drawText('Description', { x: 80, y: y - 10, size: 9, font: bold, color: black })
      page.drawText('Qty', { x: 380, y: y - 10, size: 9, font: bold, color: black })
      page.drawText('Unit Price', { x: 420, y: y - 10, size: 9, font: bold, color: black })
      page.drawText('Total', { x: 510, y: y - 10, size: 9, font: bold, color: black })
      y -= 18
      parts.forEach(function(p, i) {
        const shade = i % 2 === 0
        if (shade) page.drawRectangle({ x: 0, y: y - 14, width, height: 18, color: lightGray })
        const lineTotal = (parseFloat(p.price||0) * parseInt(p.qty||1)).toFixed(2)
        page.drawText(safe(p.sku).substring(0,12), { x: 10, y: y - 10, size: 8, font: regular, color: black })
        page.drawText(safe(p.name).substring(0,40), { x: 80, y: y - 10, size: 8, font: regular, color: black })
        page.drawText(String(p.qty||1), { x: 380, y: y - 10, size: 8, font: regular, color: black })
        page.drawText(currency(p.price), { x: 420, y: y - 10, size: 8, font: regular, color: black })
        page.drawText('$' + lineTotal, { x: 510, y: y - 10, size: 8, font: regular, color: black })
        y -= 16
      })
      y -= 5
    }

    // Cost summary or warranty stamp
    y = drawSection('COST SUMMARY', y)
    if (isWarranty) {
      page.drawRectangle({ x: 150, y: y - 30, width: 300, height: 40, color: orange })
      page.drawText('WARRANTY - NO CHARGE', { x: 165, y: y - 18, size: 16, font: bold, color: white })
      y -= 45
    } else {
      const laborTotal = parseFloat(s.labor_total || 0)
      const partsTotal = parseFloat(s.parts_total || 0)
      const mileageTotal = parseFloat(s.mileage_total || 0)
      const grandTotal = laborTotal + partsTotal + mileageTotal
      y = drawRow('Labor', currency(laborTotal), y, false)
      y = drawRow('Parts', currency(partsTotal), y, true)
      y = drawRow('Mileage', currency(mileageTotal), y, false)
      page.drawRectangle({ x: 0, y: y - 14, width, height: 18, color: navy })
      page.drawText('TOTAL:', { x: 10, y: y - 10, size: 10, font: bold, color: white })
      page.drawText(currency(grandTotal), { x: 150, y: y - 10, size: 10, font: bold, color: white })
      y -= 22
    }

    // Footer
    page.drawText('Generated by ReliableTrack on ' + new Date().toLocaleString(), {
      x: 10, y: 20, size: 7, font: regular, color: rgb(0.5,0.5,0.5)
    })

    const pdfBytes = await doc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')

    // 3. Send email via Resend
    const subject = 'ReliableTrack Report - ' + jobNum + ' - ' + (s.customer_name || '')
    const techDisplay = Array.isArray(s.techs) ? s.techs.join(', ') : (s.techs || '')
    const totalAmt = currency(String(parseFloat(s.labor_total||0)+parseFloat(s.parts_total||0)+parseFloat(s.mileage_total||0)))
    const body = '<h2 style="color:#1a2332">ReliableTrack Field Report</h2>' +
      '<p><strong>' + jobNum + '</strong> - ' + (s.customer_name || '') + ' - ' + (s.date || '') + '</p>' +
      '<p>Location: ' + (s.location_name || '') + '</p>' +
      '<p>Techs: ' + techDisplay + '</p>' +
      '<p>Time on Site: ' + (s.time_on_site || '') + ' hrs</p>' +
      (isWarranty ? '<p style="color:#e65c00;font-weight:bold">WARRANTY - NO CHARGE</p>' : '<p>Total: ' + totalAmt + '</p>') +
      '<hr/><p style="color:#888;font-size:12px">Sent from ReliableTrack</p>'

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'ReliableTrack <noreply@reliable-oilfield-services.com>',
        to: TO,
        subject,
        html: body,
        attachments: [{
          filename: jobNum.replace(/ /g,'-') + '-report.pdf',
          content: pdfBase64
        }]
      })
    })

    const emailData = await emailRes.json()
    if (!emailRes.ok) {
      console.error('Resend error:', JSON.stringify(emailData))
      return res.status(500).json({ error: 'Email failed', detail: emailData })
    }

    return res.status(200).json({ ok: true, emailId: emailData.id })

  } catch (err) {
    console.error('send-report error:', err)
    return res.status(500).json({ error: err.message })
  }
}
