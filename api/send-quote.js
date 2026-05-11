module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  var Resend = require('resend').Resend
  var resend = new Resend(process.env.RESEND_API_KEY)

  var body = req.body
  var customerName = body.customerName || ''
  var customerEmail = body.customerEmail || ''
  var locationName = body.locationName || ''
  var contact = body.contact || ''
  var laborHours = parseFloat(body.laborHours) || 0
  var laborRate = parseFloat(body.laborRate) || 125
  var parts = body.parts || []
  var notes = body.notes || ''
  var subtotal = parseFloat(body.subtotal) || 0
  var total = parseFloat(body.total) || 0
  var createdBy = body.createdBy || 'Reliable Oilfield Services'
  var quoteDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  var laborTotal = laborHours * laborRate
  var partsTotal = parts.reduce(function(sum, p) { return sum + ((parseFloat(p.qty) || 0) * (parseFloat(p.unit_price) || 0)) }, 0)

  var partsRows = parts.map(function(p) {
    var lineTotal = ((parseFloat(p.qty) || 0) * (parseFloat(p.unit_price) || 0)).toFixed(2)
    return '<tr style="border-bottom:1px solid #e5e7eb"><td style="padding:8px 12px">' + (p.code || '') + '</td><td style="padding:8px 12px">' + (p.description || '') + '</td><td style="padding:8px 12px;text-align:center">' + (p.qty || 0) + '</td><td style="padding:8px 12px;text-align:right">$' + parseFloat(p.unit_price || 0).toFixed(2) + '</td><td style="padding:8px 12px;text-align:right;font-weight:600">$' + lineTotal + '</td></tr>'
  }).join('')

  var htmlContent = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;color:#1a2332;margin:0;padding:0}table{border-collapse:collapse;width:100%}</style></head><body>' +
    '<div style="max-width:800px;margin:0 auto;padding:32px 24px">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">' +
    '<div><h1 style="font-size:28px;font-weight:900;color:#1a2332;margin:0">RELIABLE OILFIELD SERVICES</h1><p style="color:#6b7280;margin:4px 0">Quote / Estimate</p></div>' +
    '<div style="text-align:right"><p style="font-size:13px;color:#6b7280;margin:2px 0">Date: ' + quoteDate + '</p><p style="font-size:13px;color:#6b7280;margin:2px 0">Prepared by: ' + createdBy + '</p></div>' +
    '</div>' +
    '<div style="background:#f9fafb;border-radius:8px;padding:20px;margin-bottom:24px">' +
    '<h3 style="margin:0 0 12px;font-size:15px;color:#4b5563">BILL TO</h3>' +
    '<p style="margin:2px 0;font-weight:700;font-size:16px">' + customerName + '</p>' +
    (locationName ? '<p style="margin:2px 0;color:#6b7280">' + locationName + '</p>' : '') +
    (contact ? '<p style="margin:2px 0;color:#6b7280">' + contact + '</p>' : '') +
    '</div>' +
    '<h3 style="font-size:15px;color:#4b5563;margin-bottom:12px">SCOPE OF WORK</h3>' +
    '<table style="margin-bottom:24px"><thead><tr style="background:#1a2332;color:#fff"><th style="padding:10px 12px;text-align:left">Code</th><th style="padding:10px 12px;text-align:left">Description</th><th style="padding:10px 12px;text-align:center">Qty</th><th style="padding:10px 12px;text-align:right">Unit Price</th><th style="padding:10px 12px;text-align:right">Total</th></tr></thead>' +
    '<tbody>' + partsRows + '</tbody></table>' +
    '<div style="border-top:2px solid #e5e7eb;padding-top:16px">' +
    '<div style="display:flex;justify-content:flex-end"><table style="width:300px">' +
    '<tr><td style="padding:6px 12px;color:#6b7280">Labor (' + laborHours + ' hrs @ $' + laborRate + '/hr)</td><td style="padding:6px 12px;text-align:right">$' + laborTotal.toFixed(2) + '</td></tr>' +
    '<tr><td style="padding:6px 12px;color:#6b7280">Parts</td><td style="padding:6px 12px;text-align:right">$' + partsTotal.toFixed(2) + '</td></tr>' +
    '<tr style="background:#1a2332;color:#fff"><td style="padding:10px 12px;font-weight:800;font-size:16px">TOTAL ESTIMATE</td><td style="padding:10px 12px;text-align:right;font-weight:800;font-size:16px">$' + total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '</td></tr>' +
    '</table></div></div>' +
    (notes ? '<div style="margin-top:24px;background:#f9fafb;border-radius:8px;padding:16px"><h4 style="margin:0 0 8px;color:#4b5563">Notes</h4><p style="margin:0;color:#374151">' + notes + '</p></div>' : '') +
    '<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;color:#9ca3af;font-size:12px"><p>Reliable Oilfield Services | This is an estimate only. Final invoice may vary based on actual work performed.</p></div>' +
    '</div></body></html>'

  try {
    await resend.emails.send({
      from: 'quotes@reliableoilfieldservices.com',
      to: customerEmail,
      subject: 'Quote from Reliable Oilfield Services for ' + customerName,
      html: htmlContent
    })
    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('send-quote error:', err)
    return res.status(500).json({ error: err.message })
  }
}
