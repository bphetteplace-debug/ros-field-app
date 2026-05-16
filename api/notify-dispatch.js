// api/notify-dispatch.js — Vercel Serverless Function (CommonJS via api/package.json)
// Emails a customer the tracking link for an active dispatch.
// Caller (admin client) first creates the active_dispatch row, then calls
// this lambda with the customer email + token. We intentionally do NOT
// expose any DB writes here; this lambda only sends the email.

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'ReliableTrack <reports@reliable-oilfield-services.com>';
const APP_URL = process.env.APP_URL || 'https://pm.reliable-oilfield-services.com';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, customerEmail, customerName, techName, destinationLabel } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token required' });
  if (!customerEmail) return res.status(400).json({ error: 'customerEmail required' });
  if (!RESEND_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY' });

  const trackingUrl = APP_URL + '/track/' + encodeURIComponent(token);
  const safeName = escapeHtml((customerName || '').split(/\s+/)[0] || 'there');
  const safeTech = techName ? escapeHtml(techName) : 'Your technician';
  const safeDest = destinationLabel ? escapeHtml(destinationLabel) : '';
  const subject = 'Your service technician is on the way';

  const destBlock = safeDest
    ? '<div style="margin:14px 0 0;padding:10px 14px;background:#f8fafc;border-radius:6px;font-size:13px;color:#374151"><b style="color:#1a2332">Site:</b> ' + safeDest + '</div>'
    : '';

  const html =
    '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a2332;background:#f5f7fa">'
    + '<div style="background:#0f1f38;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0;text-align:center">'
    +   '<div style="font-size:11px;text-transform:uppercase;font-weight:700;letter-spacing:1.5px;color:#94a3b8">ReliableTrack</div>'
    +   '<div style="font-size:22px;font-weight:800;margin-top:4px">' + safeTech + ' is on the way 🚐</div>'
    + '</div>'
    + '<div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px">'
    +   '<p style="margin:0 0 16px;font-size:15px">Hi ' + safeName + ',</p>'
    +   '<p style="margin:0 0 16px;font-size:14px;line-height:1.6">Good news — Reliable Oilfield Services has dispatched a technician to your site. You can follow their progress live on the map below.</p>'
    +   destBlock
    +   '<div style="margin:26px 0 8px;text-align:center">'
    +     '<a href="' + trackingUrl + '" style="display:inline-block;background:#e65c00;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:800;font-size:15px;box-shadow:0 4px 12px rgba(230,92,0,0.35)">📍 Track your technician</a>'
    +   '</div>'
    +   '<p style="margin:18px 0 0;font-size:11px;color:#888;text-align:center;line-height:1.5">If the button doesn\'t work, paste this link in your browser:<br><span style="color:#555;word-break:break-all">' + trackingUrl + '</span></p>'
    +   '<p style="margin:20px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;text-align:center;border-top:1px solid #f1f5f9;padding-top:14px">This tracking link works for the next 24 hours or until your technician completes the job. No app install needed.</p>'
    + '</div>'
    + '<div style="text-align:center;color:#94a3b8;font-size:11px;margin-top:14px">Reliable Oilfield Services · reports@reliable-oilfield-services.com</div>'
    + '</div>';

  try {
    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [customerEmail],
        subject,
        html,
      }),
    });
    const emailData = await emailResp.json();
    if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
    return res.status(200).json({ ok: true, emailId: emailData.id, trackingUrl });
  } catch (err) {
    console.error('notify-dispatch error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
};
