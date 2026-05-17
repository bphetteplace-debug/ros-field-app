// api/_push.js — shared OS-level Web Push helper for the notify lambdas.
//
// Vercel doesn't route files prefixed with `_`, so this stays a private
// import (`require('./_push')`) rather than a public endpoint. Both
// notify-assigned.js and notify-dispatch.js use it to fan a push out to
// every browser the target user has subscribed.
//
// Env vars required for push to actually fire:
//   VITE_VAPID_PUBLIC_KEY  — same value the client embeds (base64url)
//   VAPID_PRIVATE_KEY      — secret pair
//   VAPID_SUBJECT          — "mailto:…" so push services can reach us
// If any are missing, sendPushToUser() is a silent no-op so the email
// path still works end-to-end.

const webpush = require('web-push');

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const VAPID_PUBLIC = process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:bphetteplace@reliableoilfieldservices.net';

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    vapidConfigured = true;
    return true;
  } catch (e) {
    console.warn('[push] setVapidDetails failed:', e?.message || e);
    return false;
  }
}

// Fire a push to every browser the user has subscribed from. Cleans up
// stale subscriptions (410/404) on the fly. Never throws — silent no-op
// when VAPID isn't configured, so the lambda's email path still completes.
async function sendPushToUser(userId, payload) {
  if (!ensureVapid()) return { configured: false, sent: 0 };
  if (!userId || !SUPA_KEY) return { configured: true, sent: 0 };
  try {
    const r = await fetch(
      SUPA_URL + '/rest/v1/push_subscriptions?user_id=eq.' + encodeURIComponent(userId) +
      '&select=id,endpoint,p256dh,auth_key',
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }
    );
    if (!r.ok) return { configured: true, sent: 0 };
    const subs = await r.json();
    if (!Array.isArray(subs) || subs.length === 0) return { configured: true, sent: 0 };

    const body = JSON.stringify(payload);
    let sent = 0;
    const sends = subs.map(async row => {
      const pushSub = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth_key },
      };
      try {
        await webpush.sendNotification(pushSub, body);
        sent++;
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          // Subscription is dead — push service won't deliver anymore.
          // Remove it so we don't keep retrying every notification.
          await fetch(
            SUPA_URL + '/rest/v1/push_subscriptions?id=eq.' + encodeURIComponent(row.id),
            { method: 'DELETE', headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }
          ).catch(() => {});
        } else {
          console.warn('[push] send failed:', (e && e.message) || e);
        }
      }
    });
    await Promise.allSettled(sends);
    return { configured: true, sent };
  } catch (e) {
    console.warn('[push] sendPushToUser exception:', e?.message || e);
    return { configured: true, sent: 0, error: e?.message };
  }
}

module.exports = { sendPushToUser };
