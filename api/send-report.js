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
    if (!rows?.length) return res.status(404).json({ error: 'Not found' })
    const s = rows[0]

    // 2. Build PDF
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const { width, height } = page.getSize()
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const reg = await doc.embedFont(StandardFonts.Helvetica)
    const navy = rgb(26/255, 35/255, 50/255)
    const orange = rgb(230/255, 92/255, 0)
    const white = rgb(1,1,1)
    const gray = rgb(0.5,0.5,0.5)

    let y = height - 40
    // Header
    page.drawRectangle({ x:0, y:height-70, width, height:70, color:navy })
    page.drawText('RELIABLE OILFIELD SERVICES', { x:20, y:height-30, size:16, font:bold, color:white })
    page.drawText('ReliableTrack Field Report', { x:20, y:height-52, size:10, font:reg, color:rgb(0.8,0.8,0.8) })
    y = height - 90

    const jobLabel = s.job_type === 'Service Call' ? 'SC' : 'PM'
    const pmDisplay = `${jobLabel} #${s.pm_number}`
    page.drawText(pmDisplay, { x:20, y, size:18, font:bold, color:orange })
    y -= 10
    page.drawLine({ start:{x:20,y}, end:{x:width-20,y}, thickness:1, color:rgb(0.8,0.8,0.8) })
    y -= 22

    const sec = (title) => {
      page.drawRectangle({ x:20, y:y-18, width:width-40, height:18, color:navy })
      page.drawText(title, { x:24, y:y-13, size:9, font:bold, color:white })
      y -= 30
    }
    const fld = (lbl, val, xl, xv) => {
      page.drawText(lbl+':', { x:xl, y, size:8, font:bold, color:gray })
      const v = String(val||'—').substring(0,35)
      page.drawText(v, { x:xv, y, size:8, font:reg })
    }

    sec('JOB INFORMATION')
    fld('Customer', s.customer_name, 20, 90); fld('Date', s.date, 340, 380); y-=14
    fld('Location', s.location_name, 20, 90); fld('Truck', s.truck_number, 340, 380); y-=14
    fld('Work Order', s.customer_work_order, 20, 95); fld('GL Code', s.gl_code, 340, 380); y-=14
    fld('Work Type', s.type_of_work, 20, 90); fld('Asset', s.asset_tag, 340, 380); y-=20

    if (s.warranty_work) {
      page.drawRectangle({ x:380, y:y-26, width:200, height:30, color:rgb(1,0.95,0.8), borderColor:orange, borderWidth:2 })
      page.drawText('WARRANTY — NO CHARGE', { x:388, y:y-16, size:8.5, font:bold, color:orange })
      y -= 10
    }

    sec('TECHNICIANS & TIME')
    fld('Techs', Array.isArray(s.techs)?s.techs.join(', '):s.techs, 20, 65); y-=14
    fld('Start', s.start_time, 20, 65); fld('End', s.departure_time, 200, 235); fld('Hours', s.labor_hours, 380, 420); y-=14
    fld('Billable Techs', s.billable_techs, 20, 110); y-=20

    sec('DESCRIPTION OF WORK')
    const desc = String(s.description||'—')
    const words = desc.split(' ')
    let line = ''
    for (const w of words) {
      if ((line+w).length > 95) { page.drawText(line.trim(),{x:20,y,size:8,font:reg}); y-=12; line=w+' '; if(y<180)break }
      else line+=w+' '
    }
    if (line.trim()) { page.drawText(line.trim(),{x:20,y,size:8,font:reg}); y-=12 }
    y -= 8

    const parts = Array.isArray(s.parts)?s.parts:[]
    if (parts.length > 0) {
      sec('PARTS & MATERIALS')
      page.drawText('QTY',{x:20,y,size:8,font:bold}); page.drawText('SKU',{x:55,y,size:8,font:bold})
      page.drawText('DESCRIPTION',{x:140,y,size:8,font:bold}); page.drawText('UNIT',{x:420,y,size:8,font:bold})
      page.drawText('TOTAL',{x:480,y,size:8,font:bold}); y-=4
      page.drawLine({start:{x:20,y},end:{x:width-20,y},thickness:0.5,color:rgb(0.7,0.7,0.7)}); y-=12
      for (const p of parts) {
        if (y < 140) break
        const qty=p.qty||1, price=parseFloat(p.price)||0, tot=qty*price
        page.drawText(String(qty),{x:20,y,size:7.5,font:reg})
        page.drawText(String(p.sku||'').substring(0,16),{x:55,y,size:7.5,font:reg})
        page.drawText(String(p.name||'').substring(0,36),{x:140,y,size:7.5,font:reg})
        page.drawText(`$${price.toFixed(2)}`,{x:420,y,size:7.5,font:reg})
        page.drawText(`$${tot.toFixed(2)}`,{x:480,y,size:7.5,font:reg})
        y -= 12
      }
      y -= 6
    }

    if (!s.warranty_work && y > 120) {
      sec('COST SUMMARY')
      const cr = (lbl, val, isBold) => {
        page.drawText(lbl,{x:320,y,size:8.5,font:isBold?bold:reg})
        page.drawText(`$${parseFloat(val||0).toFixed(2)}`,{x:490,y,size:8.5,font:isBold?bold:reg})
        y-=14
      }
      cr('Parts & Materials:', s.parts_total, false)
      cr(`Labor (${s.billable_techs||1} tech x ${s.labor_hours||0} hr @ $${s.hourly_rate||0}/hr):`, s.labor_total, false)
      if (parseFloat(s.mileage_total||0)>0) cr(`Mileage (${s.miles||0} mi @ $${s.cost_per_mile||0}/mi):`, s.mileage_total, false)
      page.drawLine({start:{x:318,y:y+10},end:{x:width-20,y:y+10},thickness:0.5}); y-=4
      cr('GRAND TOTAL:', s.total, true)
    }

    // Footer
    page.drawLine({start:{x:20,y:40},end:{x:width-20,y:40},thickness:0.5,color:gray})
    page.drawText(`Generated by ReliableTrack | ${new Date().toLocaleDateString()}`,{x:20,y:26,size:7,font:reg,color:gray})
    page.drawText(`Reliable Oilfield Services | ${pmDisplay}`,{x:380,y:26,size:7,font:reg,color:gray})

    const pdfBytes = await doc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')

    // 3. Email via Resend
    const subject = `[${pmDisplay}] ${s.customer_name} — ${s.location_name} (${s.date})`
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'ReliableTrack <onboarding@resend.dev>',
        to: TO,
        subject,
        html: `<div style="font-family:Arial,sans-serif">
          <div style="background:#1a2332;padding:16px;border-radius:4px 4px 0 0">
            <h2 style="color:#fff;margin:0">Reliable Oilfield Services</h2>
            <p style="color:#ccc;margin:4px 0 0">ReliableTrack Field Report</p>
          </div>
          <div style="padding:20px;border:1px solid #ddd;border-top:none;border-radius:0 0 4px 4px">
            <h3 style="color:#e65c00;margin-top:0">${pmDisplay} — ${s.customer_name}</h3>
            <p><b>Location:</b> ${s.location_name||'—'}</p>
            <p><b>Date:</b> ${s.date||'—'}</p>
            <p><b>Techs:</b> ${Array.isArray(s.techs)?s.techs.join(', '):(s.techs||'—')}</p>
            <p><b>Type of Work:</b> ${s.type_of_work||'—'}</p>
            ${!s.warranty_work?`<p><b>Total:</b> $${parseFloat(s.total||0).toFixed(2)}</p>`:'<p style="color:#e65c00;font-weight:bold">WARRANTY — NO CHARGE</p>'}
            <p style="color:#666;margin-top:16px">Full report attached as PDF.</p>
          </div></div>`,
        attachments: [{
const SUPA_URL = process.env.VITE_SUPABASE_URL
const SUPA_KEY = process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const TO = ['bphetteplace@reliableoilfieldservices.net','cphetteplace@reliableoilfieldservices.net']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { submissionId } = req.body
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' })
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/submissions?id=eq.${submissionId}&select=*`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    })
    const rows = await r.json()
    if (!rows?.length) return res.status(404).json({ error: 'Not found' })
    const s = rows[0]

    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const { width, height } = page.getSize()
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const reg = await doc.embedFont(StandardFonts.Helvetica)
    const navy = rgb(26/255,35/255,50/255), orange = rgb(230/255,92/255,0)
    const white = rgb(1,1,1), gray = rgb(0.5,0.5,0.5)
    let y = height - 40

    page.drawRectangle({ x:0, y:height-70, width, height:70, color:navy })
    page.drawText('RELIABLE OILFIELD SERVICES', { x:20, y:height-30, size:16, font:bold, color:white })
    page.drawText('ReliableTrack Field Report', { x:20, y:height-52, size:10, font:reg, color:rgb(0.8,0.8,0.8) })
    y = height - 90
    const jobLabel = s.job_type === 'Service Call' ? 'SC' : 'PM'
    const pmDisplay = jobLabel + ' #' + s.pm_number
    page.drawText(pmDisplay, { x:20, y, size:18, font:bold, color:orange })
    y -= 10; page.drawLine({ start:{x:20,y}, end:{x:width-20,y}, thickness:1, color:rgb(0.8,0.8,0.8) }); y -= 22

    const sec = (title) => { page.drawRectangle({x:20,y:y-18,width:width-40,height:18,color:navy}); page.drawText(title,{x:24,y:y-13,size:9,font:bold,color:white}); y-=30 }
    const fld = (lbl,val,xl,xv) => { page.drawText(lbl+':',{x:xl,y,size:8,font:bold,color:gray}); page.drawText(String(val||'--').substring(0,35),{x:xv,y,size:8,font:reg}) }

    sec('JOB INFORMATION')
    fld('Customer',s.customer_name,20,90); fld('Date',s.date,340,375); y-=14
    fld('Location',s.location_name,20,90); fld('Truck',s.truck_number,340,375); y-=14
    fld('Work Order',s.customer_work_order,20,98); fld('GL Code',s.gl_code,340,375); y-=14
    fld('Work Type',s.type_of_work,20,90); fld('Asset',s.asset_tag,340,375); y-=20
    if (s.warranty_work) { page.drawRectangle({x:370,y:y-26,width:220,height:30,color:rgb(1,0.95,0.8),borderColor:orange,borderWidth:2}); page.drawText('WARRANTY -- NO CHARGE',{x:378,y:y-16,size:8.5,font:bold,color:orange}); y-=10 }

    sec('TECHNICIANS & TIME')
    fld('Techs',Array.isArray(s.techs)?s.techs.join(', '):s.techs,20,65); y-=14
    fld('Start',s.start_time,20,65); fld('End',s.departure_time,200,235); fld('Hours',s.labor_hours,380,420); y-=14
    fld('Billable Techs',s.billable_techs,20,110); y-=20

    sec('DESCRIPTION OF WORK')
    const words = String(s.description||'--').split(' '); let line=''
    for (const w of words) { if((line+w).length>95){page.drawText(line.trim(),{x:20,y,size:8,font:reg});y-=12;line=w+' ';if(y<180)break}else line+=w+' ' }
    if(line.trim()){page.drawText(line.trim(),{x:20,y,size:8,font:reg});y-=12}
    y-=8

    const parts = Array.isArray(s.parts)?s.parts:[]
    if(parts.length>0){
      sec('PARTS & MATERIALS')
      page.drawText('QTY',{x:20,y,size:8,font:bold}); page.drawText('SKU',{x:55,y,size:8,font:bold}); page.drawText('DESCRIPTION',{x:140,y,size:8,font:bold}); page.drawText('UNIT',{x:420,y,size:8,font:bold}); page.drawText('TOTAL',{x:480,y,size:8,font:bold}); y-=4
      page.drawLine({start:{x:20,y},end:{x:width-20,y},thickness:0.5,color:rgb(0.7,0.7,0.7)}); y-=12
      for(const p of parts){
        if(y<140)break
        const qty=p.qty||1,price=parseFloat(p.price)||0,tot=qty*price
        page.drawText(String(qty),{x:20,y,size:7.5,font:reg}); page.drawText(String(p.sku||'').substring(0,16),{x:55,y,size:7.5,font:reg}); page.drawText(String(p.name||'').substring(0,36),{x:140,y,size:7.5,font:reg}); page.drawText('$'+price.toFixed(2),{x:420,y,size:7.5,font:reg}); page.drawText('$'+tot.toFixed(2),{x:480,y,size:7.5,font:reg}); y-=12
      }
      y-=6
    }

    if(!s.warranty_work&&y>120){
      sec('COST SUMMARY')
      const cr=(lbl,val,isBold)=>{ page.drawText(lbl,{x:300,y,size:8.5,font:isBold?bold:reg}); page.drawText('$'+parseFloat(val||0).toFixed(2),{x:490,y,size:8.5,font:isBold?bold:reg}); y-=14 }
      cr('Parts & Materials:',s.parts_total,false)
      cr('Labor ('+( s.billable_techs||1)+' tech x '+(s.labor_hours||0)+' hr @ $'+(s.hourly_rate||0)+'/hr):',s.labor_total,false)
      if(parseFloat(s.mileage_total||0)>0)cr('Mileage ('+(s.miles||0)+' mi @ $'+(s.cost_per_mile||0)+'/mi):',s.mileage_total,false)
      page.drawLine({start:{x:298,y:y+10},end:{x:width-20,y:y+10},thickness:0.5}); y-=4
      cr('GRAND TOTAL:',s.total,true)
    }

    page.drawLine({start:{x:20,y:40},end:{x:width-20,y:40},thickness:0.5,color:gray})
    page.drawText('Generated by ReliableTrack | '+new Date().toLocaleDateString(),{x:20,y:26,size:7,font:reg,color:gray})
    page.drawText('Reliable Oilfield Services | '+pmDisplay,{x:360,y:26,size:7,font:reg,color:gray})

    const pdfBytes = await doc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')

    const subject = '['+pmDisplay+'] '+s.customer_name+' -- '+s.location_name+' ('+s.date+')'
    const emailRes = await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{Authorization:'Bearer '+RESEND_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        from:'ReliableTrack <onboarding@resend.dev>',
        to:TO, subject,
        html:'<div style="font-family:Arial,sans-serif"><div style="background:#1a2332;padding:16px;border-radius:4px 4px 0 0"><h2 style="color:#fff;margin:0">Reliable Oilfield Services</h2><p style="color:#ccc;margin:4px 0 0">ReliableTrack Field Report</p></div><div style="padding:20px;border:1px solid #ddd;border-top:none;border-radius:0 0 4px 4px"><h3 style="color:#e65c00;margin-top:0">'+pmDisplay+' -- '+s.customer_name+'</h3><p><b>Location:</b> '+(s.location_name||'--')+'</p><p><b>Date:</b> '+(s.date||'--')+'</p><p><b>Techs:</b> '+(Array.isArray(s.techs)?s.techs.join(', '):(s.techs||'--'))+'</p><p><b>Type of Work:</b> '+(s.type_of_work||'--')+'</p>'+(!s.warranty_work?'<p><b>Total:</b> $'+parseFloat(s.total||0).toFixed(2)+'</p>':'<p style="color:#e65c00;font-weight:bold">WARRANTY -- NO CHARGE</p>')+'<p style="color:#666;margin-top:16px">Full report attached as PDF.</p></div></div>',
        attachments:[{filename:pmDisplay.replace(' ','').replace('#','')+'-'+s.customer_name.replace(/\s+/g,'-')+'.pdf',content:pdfBase64}]
      })
    })
    const emailData = await emailRes.json()
    if(!emailRes.ok){console.error('Resend error:',emailData);return res.status(500).json({error:'Email failed',details:emailData})}
    return res.status(200).json({success:true,emailId:emailData.id})
  } catch(err){
    console.error('send-report error:',err)
    return res.status(500).json({error:err.message})
  }
                      }
