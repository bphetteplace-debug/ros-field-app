// api/send-report.js - Vercel Serverless Function (CommonJS via api/package.json)
// Sends HTML email via Resend. NO top-level require() to avoid Vercel module crash.

const SUPA_URL   = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co'
const SUPA_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
// When domain is verified, restore both: bphetteplace + cphetteplace
const TO = process.env.EMAIL_TO
  ? process.env.EMAIL_TO.split(',')
  : ['bphetteplace@reliableoilfieldservices.net']

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { submissionId, userToken } = req.body || {}
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' })
  if (!RESEND_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY' })
  if (!SUPA_KEY)   return res.status(500).json({ error: 'Missing Supabase key' })

  const authToken = userToken || SUPA_KEY

  try {
    // Fetch submission with photos joined
    const r = await fetch(
      `${SUPA_URL}/rest/v1/submissions?id=eq.${submissionId}&select=*,photos(id,storage_path,caption,display_order,section)&limit=1`,
      { headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${authToken}` } }
    )
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found', detail: JSON.stringify(rows) })
    }
    const s = rows[0]
    const d = s.data || {}

    // Normalize fields - top-level columns + data JSONB fallbacks
    const jobType    = s.work_type  || d.job_type    || 'PM'
    const pmNum      = s.pm_number  || d.pm_number   || ''
    const customer   = s.customer_name || d.customer_name || ''
    const location   = s.location_name || d.location_name || ''
    const truck      = s.truck_number  || d.truck_number  || ''
    const dateStr    = s.date       || d.date         || ''
    const techs      = Array.isArray(d.techs) ? d.techs : (Array.isArray(s.techs) ? s.techs : [])
    const parts      = Array.isArray(d.parts) ? d.parts : (Array.isArray(s.parts) ? s.parts : [])
    const laborHours = parseFloat(d.labor_hours || s.labor_hours || 0)
    const miles      = parseFloat(d.miles || s.miles || 0)
    const laborTotal = parseFloat(d.labor_total  || 0)
    const partsTotal = parseFloat(d.parts_total  || 0)
    const mileTotal  = parseFloat(d.mileage_total || 0)
    const grandTotal = parseFloat(d.grand_total   || 0)
    const isWarranty = d.warranty_work === true || d.warranty_work === 'true'
    const summary    = s.summary    || d.summary    || d.notes || ''
    const equipment  = d.equipment  || {}
    const photos     = Array.isArray(s.photos) ? s.photos : []

    const jobLabel = jobType.toLowerCase().includes('pm') ? 'PM' : 'SC'
    const subject  = `ReliableTrack ${jobLabel} #${pmNum} - ${customer} - ${dateStr}`

    // Parts rows HTML
    const partsRows = parts.map(p => `
      <tr>
        <td style="padding:4px 8px;border:1px solid #ddd">${p.sku||p.code||''}</td>
        <td style="padding:4px 8px;border:1px solid #ddd">${p.name||p.desc||''}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;text-align:center">${p.qty||1}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;text-align:right">$${((p.price||0)*(p.qty||1)).toFixed(2)}</td>
      </tr>`).join('')

    // Equipment sections
    const arrestors = Array.isArray(equipment.arrestors) ? equipment.arrestors : []
    const flares    = Array.isArray(equipment.flares)    ? equipment.flares    : []
    const heaters   = Array.isArray(equipment.heaters)   ? equipment.heaters   : []

    const arrestorRows = arrestors.map((a,i) => `
      <tr>
        <td style="padding:4px 8px;border:1px solid #ddd">Arrestor ${i+1}</td>
        <td style="padding:4px 8px;border:1px solid #ddd">${a.id||''}</td>
        <td style="padding:4px 8px;border:1px solid #ddd">${a.condition||''}</td>
        <td style="padding:4px 8px;border:1px solid #ddd">${a.filterCleaned?'Filter Cleaned':''} ${a.notes||''}</td>
      </tr>`).join('')

    const flareRows = flares.map((f,i) => `
      <tr>
        <td style="padding:4px 8px;border:1px solid #ddd">Flare ${i+1}</td>
        <td style="padding:4px 8px;border:1px solid #ddd">${f.id||''}</td>
        <td style="padding:4px 8px;border:1px solid #ddd">${f.condition||''}</td>
        <td style="padding:4px 8px;border:1px solid #ddd">${f.pilotLit?'Pilot Lit':''} ${f.notes||''}</td>
      </tr>`).join('')

    const heaterRows = heaters.map((h,i) => `
      <tr>
        <td style="padding:4px 8px;border:1px solid #ddd">Heater ${i+1}</td>
        <td style="padding:4px 8px;border:1px solid #ddd">${h.serialNumber||h.id||''}</td>
        <td style="padding:4px 8px;border:1px solid #ddd">${h.condition||''}</td>
        <td style="padding:4px 8px;border:1px solid #ddd">${(h.firetubes||[]).length} firetube(s)</td>
      </tr>`).join('')

    // Build HTML email body
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:Arial,sans-serif;color:#222;max-width:800px;margin:0 auto;padding:20px">

<div style="background:#1a2332;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0">
  <h1 style="margin:0;font-size:20px">ReliableTrack - Reliable Oilfield Services</h1>
  <p style="margin:4px 0 0;font-size:14px;opacity:0.8">${jobLabel} #${pmNum} Field Report</p>
</div>

<div style="border:1px solid #ddd;border-top:none;padding:20px;border-radius:0 0 6px 6px">
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
    <tr>
      <td style="padding:4px 8px;font-weight:bold;width:130px">Customer:</td>
      <td style="padding:4px 8px">${customer}</td>
      <td style="padding:4px 8px;font-weight:bold;width:130px">Job Type:</td>
      <td style="padding:4px 8px">${jobType}</td>
    </tr>
    <tr>
      <td style="padding:4px 8px;font-weight:bold">Location:</td>
      <td style="padding:4px 8px">${location}</td>
      <td style="padding:4px 8px;font-weight:bold">Date:</td>
      <td style="padding:4px 8px">${dateStr}</td>
    </tr>
    <tr>
      <td style="padding:4px 8px;font-weight:bold">Truck:</td>
      <td style="padding:4px 8px">${truck}</td>
      <td style="padding:4px 8px;font-weight:bold">WO #:</td>
      <td style="padding:4px 8px">${jobLabel} #${pmNum}</td>
    </tr>
    <tr>
      <td style="padding:4px 8px;font-weight:bold">Techs:</td>
      <td style="padding:4px 8px" colspan="3">${techs.join(', ')}</td>
    </tr>
    <tr>
      <td style="padding:4px 8px;font-weight:bold">Labor Hours:</td>
      <td style="padding:4px 8px">${laborHours}</td>
      <td style="padding:4px 8px;font-weight:bold">Miles:</td>
      <td style="padding:4px 8px">${miles}</td>
    </tr>
  </table>

  ${summary ? `<div style="background:#f8f8f8;padding:12px;border-radius:4px;margin-bottom:16px">
    <strong>Summary / Notes:</strong><br>${summary}
  </div>` : ''}

  ${isWarranty ? `<div style="background:#fff3cd;border:2px solid #ffc107;padding:10px;border-radius:4px;margin-bottom:16px;text-align:center;font-weight:bold;font-size:16px;letter-spacing:1px">
    WARRANTY - NO CHARGE
  </div>` : ''}

  ${parts.length > 0 ? `
  <h3 style="background:#1a2332;color:#fff;padding:8px 12px;margin:16px 0 8px;border-radius:4px">PARTS USED</h3>
  <table style="width:100%;border-collapse:collapse">
    <tr style="background:#f0f0f0">
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">SKU</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Description</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:center">Qty</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:right">Total</th>
    </tr>
    ${partsRows}
  </table>` : ''}

  ${!isWarranty ? `
  <h3 style="background:#1a2332;color:#fff;padding:8px 12px;margin:16px 0 8px;border-radius:4px">COST SUMMARY</h3>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:4px 8px;border:1px solid #eee">Labor (${laborHours} hrs @ $115/hr)</td><td style="padding:4px 8px;border:1px solid #eee;text-align:right">$${laborTotal.toFixed(2)}</td></tr>
    <tr><td style="padding:4px 8px;border:1px solid #eee">Parts</td><td style="padding:4px 8px;border:1px solid #eee;text-align:right">$${partsTotal.toFixed(2)}</td></tr>
    <tr><td style="padding:4px 8px;border:1px solid #eee">Mileage (${miles} mi @ $1.50/mi)</td><td style="padding:4px 8px;border:1px solid #eee;text-align:right">$${mileTotal.toFixed(2)}</td></tr>
    <tr style="font-weight:bold;background:#f0f0f0">
      <td style="padding:6px 8px;border:1px solid #ddd">TOTAL</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:right">$${grandTotal.toFixed(2)}</td>
    </tr>
  </table>` : ''}

  ${arrestors.length > 0 ? `
  <h3 style="background:#1a2332;color:#fff;padding:8px 12px;margin:16px 0 8px;border-radius:4px">FLAME ARRESTORS</h3>
  <table style="width:100%;border-collapse:collapse">
    <tr style="background:#f0f0f0">
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">#</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Arrestor ID</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Condition</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Notes</th>
    </tr>
    ${arrestorRows}
  </table>` : ''}

  ${flares.length > 0 ? `
  <h3 style="background:#1a2332;color:#fff;padding:8px 12px;margin:16px 0 8px;border-radius:4px">FLARES</h3>
  <table style="width:100%;border-collapse:collapse">
    <tr style="background:#f0f0f0">
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">#</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Flare ID</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Condition</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Status</th>
    </tr>
    ${flareRows}
  </table>` : ''}

  ${heaters.length > 0 ? `
  <h3 style="background:#1a2332;color:#fff;padding:8px 12px;margin:16px 0 8px;border-radius:4px">HEATER TREATERS</h3>
  <table style="width:100%;border-collapse:collapse">
    <tr style="background:#f0f0f0">
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">#</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Serial #</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Condition</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Firetubes</th>
    </tr>
    ${heaterRows}
  </table>` : ''}

  ${photos.length > 0 ? `
  <h3 style="background:#1a2332;color:#fff;padding:8px 12px;margin:16px 0 8px;border-radius:4px">PHOTOS (${photos.length})</h3>
  <p style="color:#666;font-size:13px;margin:0">${photos.map(p => p.caption || p.section || 'Photo').join(' | ')}</p>
  <p style="color:#888;font-size:12px;font-style:italic">Photo thumbnails available in the ReliableTrack app</p>` : ''}

  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#888;text-align:center">
    Generated by ReliableTrack &bull; ${new Date().toLocaleString()} &bull; ID: ${submissionId.substring(0,8)}
  </div>
</div>

</body>
</html>`

    // Send via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_KEY}`
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'ReliableTrack <onboarding@resend.dev>',
        to: TO,
        subject,
        html
      })
    })

    if (!emailRes.ok) {
      const errBody = await emailRes.text()
      console.error('Resend error:', emailRes.status, errBody)
      return res.status(502).json({ error: 'Email send failed', detail: errBody })
    }

    const emailData = await emailRes.json()
    console.log('Email sent:', emailData.id)
    return res.status(200).json({ ok: true, emailId: emailData.id })

  } catch (err) {
    console.error('send-report error:', err)
    return res.status(500).json({ error: err.message })
  }
}
