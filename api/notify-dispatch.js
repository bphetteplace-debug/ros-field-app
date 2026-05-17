// api/notify-dispatch.js — Vercel Serverless Function (CommonJS via api/package.json)
// Emails a customer the tracking link for an active dispatch.
// Caller (admin client) first creates the active_dispatch row, then calls
// this lambda with the customer email + token. We intentionally do NOT
// expose any DB writes here; this lambda only sends the email.

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'ReliableTrack <reports@reliable-oilfield-services.com>';
const APP_URL = process.env.APP_URL || 'https://pm.reliable-oilfield-services.com';
const { sendPushToUser } = require('./_push');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, customerEmail, customerName, techName, destinationLabel } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token required' });
  if (!customerEmail) return res.status(400).json({ error: 'customerEmail required' });
  if (!RESEND_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY' });
  if (!SUPA_KEY) return res.status(500).json({ error: 'Missing Supabase key' });

  // Auth: admin-only. Lambda emits "your tech is on the way" emails from
  // the company domain — wide open it's a perfect phishing relay.
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const userToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!userToken) return res.status(401).json({ error: 'Missing auth token' });
  let userId = null;
  try {
    const userRes = await fetch(SUPA_URL + '/auth/v1/user', {
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + userToken },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid or expired session' });
    const userBody = await userRes.json();
    userId = userBody && userBody.id;
    if (!userId) return res.status(401).json({ error: 'Invalid session' });
  } catch (_e) {
    return res.status(500).json({ error: 'Auth check failed' });
  }
  try {
    const profRes = await fetch(SUPA_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(userId) + '&select=role', {
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
    });
    if (!profRes.ok) return res.status(403).json({ error: 'Forbidden' });
    const profs = await profRes.json();
    if (!profs || profs[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  } catch (_e) {
    return res.status(500).json({ error: 'Role check failed' });
  }

  // Verify the dispatch token actually exists, so attackers can't fake
  // tracking URLs in the email. Also grab tech_id + id so we can fan a
  // push notification to the tech after the email goes out.
  let dispatchId = null, techId = null;
  try {
    const dispRes = await fetch(
      SUPA_URL + '/rest/v1/active_dispatch?share_token=eq.' + encodeURIComponent(token) + '&select=id,tech_id&limit=1',
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } },
    );
    if (!dispRes.ok) return res.status(500).json({ error: 'Dispatch lookup failed' });
    const dispRows = await dispRes.json();
    if (!Array.isArray(dispRows) || dispRows.length === 0) {
      return res.status(404).json({ error: 'Dispatch token not found' });
    }
    dispatchId = dispRows[0].id;
    techId = dispRows[0].tech_id;
  } catch (_e) {
    return res.status(500).json({ error: 'Dispatch verify failed' });
  }

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

    // Best-effort OS-level push to the tech being dispatched. Silent no-op
    // when VAPID env vars aren't configured.
    let pushResult = null;
    try {
      pushResult = await sendPushToUser(techId, {
        title: '📍 New dispatch',
        body: 'Heading to ' + (destinationLabel || customerName || 'customer site'),
        url: '/submissions',
        tag: 'dispatch-' + (dispatchId || ''),
      });
    } catch (e) { console.warn('[notify-dispatch] push send failed:', e?.message || e); }

    return res.status(200).json({ ok: true, emailId: emailData.id, trackingUrl, push: pushResult });
  } catch (err) {
    console.error('notify-dispatch error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
};
