// api/push-subscribe.js — Vercel Serverless Function (CommonJS via api/package.json)
//
// Stores / removes the calling user's Web Push subscription so the
// notify-assigned + notify-dispatch lambdas can deliver OS-level push
// notifications later via web-push.
//
// POST   { endpoint, p256dh, auth, user_agent? } → upsert (user_id, endpoint)
// DELETE { endpoint }                            → remove the subscription
//
// Auth: requires the caller's Supabase JWT. user_id is taken from the JWT,
// never from the request body, so a malicious caller can't create subs
// for another user.

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!SUPA_KEY) return res.status(500).json({ error: 'Missing Supabase key' });

  // Auth
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

  const body = req.body || {};
  const endpoint = (body.endpoint || '').trim();
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  // Sanity-cap endpoint length so attackers can't store gigantic strings.
  if (endpoint.length > 2000) return res.status(400).json({ error: 'endpoint too long' });
  // Endpoint must look like a real push-service URL.
  if (!/^https:\/\//.test(endpoint)) return res.status(400).json({ error: 'endpoint must be https://' });

  const headers = {
    apikey: SUPA_KEY,
    Authorization: 'Bearer ' + SUPA_KEY,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  try {
    if (req.method === 'POST') {
      const p256dh = (body.p256dh || '').trim();
      const auth = (body.auth || '').trim();
      if (!p256dh || !auth) return res.status(400).json({ error: 'p256dh + auth required' });
      // Upsert on (user_id, endpoint) — UNIQUE constraint in the table.
      const row = {
        user_id: userId,
        endpoint,
        p256dh,
        auth_key: auth,
        user_agent: typeof body.user_agent === 'string' ? body.user_agent.slice(0, 400) : null,
        updated_at: new Date().toISOString(),
      };
      const r = await fetch(SUPA_URL + '/rest/v1/push_subscriptions?on_conflict=user_id,endpoint', {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify(row),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        console.warn('[push-subscribe] upsert failed:', r.status, t.slice(0, 200));
        return res.status(500).json({ error: 'Subscribe failed' });
      }
      return res.status(200).json({ ok: true });
    }

    // DELETE
    const r = await fetch(
      SUPA_URL + '/rest/v1/push_subscriptions?user_id=eq.' + encodeURIComponent(userId) +
        '&endpoint=eq.' + encodeURIComponent(endpoint),
      { method: 'DELETE', headers }
    );
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.warn('[push-subscribe] delete failed:', r.status, t.slice(0, 200));
      return res.status(500).json({ error: 'Unsubscribe failed' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('push-subscribe error:', e);
    return res.status(500).json({ error: e.message || String(e) });
  }
};
