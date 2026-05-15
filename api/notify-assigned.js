// api/notify-assigned.js — Vercel Serverless Function (CommonJS via api/package.json)
// Sends an email to a tech when an admin assigns them a new draft submission
// via the "Assign Job" tab in the admin portal. The tech opens the deep link,
// completes any missing fields, and submits through the normal flow.

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'ReliableTrack <reports@reliable-oilfield-services.com>';
const APP_URL = process.env.APP_URL || 'https://pm.reliable-oilfield-services.com';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(s) {
  if (!s) return '';
  try {
    return new Date(/T/.test(s) ? s : s + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return s; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { submissionId, recipientEmail, recipientName, assignedByName } = req.body || {};
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' });
  if (!recipientEmail) return res.status(400).json({ error: 'recipientEmail required' });
  if (!RESEND_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY' });
  if (!SUPA_KEY) return res.status(500).json({ error: 'Missing Supabase key' });

  try {
    const subRes = await fetch(
      SUPA_URL + '/rest/v1/submissions?id=eq.' + encodeURIComponent(submissionId) + '&select=*',
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }
    );
    if (!subRes.ok) {
      const txt = await subRes.text();
      return res.status(500).json({ error: 'Supabase fetch failed: ' + txt });
    }
    const rows = await subRes.json();
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Submission not found' });
    const sub = rows[0];
    const d = sub.data || {};

    const jobType = d.jobType || (sub.template === 'pm_flare_combustor' ? 'PM' : 'Service Call');
    const woNumber = sub.work_order || sub.pm_number || '';
    const editUrl = APP_URL + '/edit/' + sub.id;
    const subject = 'New ' + jobType + ' assigned — ' + (sub.customer_name || '') + ' (#' + woNumber + ')';
    const greetingName = (recipientName || '').split(/\s+/)[0] || 'team';

    const rows2 = [
      ['Customer', sub.customer_name],
      ['Location', sub.location_name],
      ['Customer WO/PO #', d.customerWorkOrder],
      ['Type of Work', sub.work_type],
      ['Due', fmtDate(d.dueDate)],
      ['Assigned by', assignedByName || d.assignedByName || 'Office'],
    ].filter(r => r[1]);

    const tableRows = rows2.map(r =>
      '<tr><td style="padding:8px 10px;font-weight:600;font-size:13px;color:#555;width:140px;border-bottom:1px solid #eee">' + escapeHtml(r[0]) + '</td>'
      + '<td style="padding:8px 10px;font-size:13px;color:#1a2332;border-bottom:1px solid #eee">' + escapeHtml(r[1]) + '</td></tr>'
    ).join('');

    const description = d.description || sub.summary || '';
    const descBlock = description
      ? '<div style="margin:18px 0 0 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #e35b04;border-radius:4px"><div style="font-size:11px;text-transform:uppercase;font-weight:700;color:#888;letter-spacing:0.5px;margin-bottom:4px">Description</div><div style="font-size:13px;color:#333;line-height:1.5;white-space:pre-wrap">' + escapeHtml(description) + '</div></div>'
      : '';

    const html =
      '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a2332">'
      + '<div style="background:#1a2332;color:#fff;padding:20px;border-radius:10px 10px 0 0">'
      +   '<div style="font-size:11px;text-transform:uppercase;font-weight:700;letter-spacing:1px;color:#e35b04">RELIABLETRACK · Dispatch</div>'
      +   '<div style="font-size:20px;font-weight:800;margin-top:4px">New ' + escapeHtml(jobType) + ' Assigned</div>'
      +   '<div style="font-size:13px;color:#aaa;margin-top:2px">WO #' + escapeHtml(String(woNumber)) + '</div>'
      + '</div>'
      + '<div style="background:#fff;border:1px solid #eee;border-top:none;padding:20px;border-radius:0 0 10px 10px">'
      +   '<p style="margin:0 0 14px 0;font-size:14px">Hi ' + escapeHtml(greetingName) + ',</p>'
      +   '<p style="margin:0 0 16px 0;font-size:14px;line-height:1.5">A new job has been assigned to you. Tap the button below to open it in the app, fill in remaining details, and submit when complete.</p>'
      +   '<table style="width:100%;border-collapse:collapse;margin:8px 0 0 0">' + tableRows + '</table>'
      +   descBlock
      +   '<div style="margin:22px 0 8px 0;text-align:center">'
      +     '<a href="' + editUrl + '" style="display:inline-block;background:#e35b04;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px">Open Job in App →</a>'
      +   '</div>'
      +   '<p style="margin:18px 0 0 0;font-size:11px;color:#888;text-align:center">If the button doesn\'t work, paste this link into your browser:<br><span style="color:#555">' + editUrl + '</span></p>'
      + '</div>'
      + '<div style="text-align:center;color:#aaa;font-size:11px;margin-top:14px">Reliable Oilfield Services · reports@reliable-oilfield-services.com</div>'
      + '</div>';

    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [recipientEmail],
        subject,
        html,
      }),
    });
    const emailData = await emailResp.json();
    if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
    return res.status(200).json({ ok: true, emailId: emailData.id });
  } catch (err) {
    console.error('notify-assigned error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
};
