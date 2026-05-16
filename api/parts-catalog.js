// api/parts-catalog.js - Serverless endpoint for parts_catalog CRUD
// Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS for admin operations
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Reject anything that doesn't look like a UUID or a short text key, so a
// malicious caller can't smuggle PostgREST query params into the URL path.
const SAFE_ID = /^[A-Za-z0-9._-]{1,80}$/;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPA_KEY) return res.status(500).json({ error: 'Missing Supabase key' });

  // Auth: any authenticated user can read; admin only for writes. Was: every
  // method ran with service-role and no auth, leaving the entire catalog
  // world-writable to anyone on the internet.
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

  const method = req.method;
  const isWrite = method === 'POST' || method === 'PATCH' || method === 'DELETE';
  if (isWrite) {
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
  }

  const headers = {
    'apikey': SUPA_KEY,
    'Authorization': 'Bearer ' + SUPA_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  try {
    const body = req.body || {};

    if (method === 'GET') {
      // Return all parts ordered
      const r = await fetch(SUPA_URL + '/rest/v1/parts_catalog?order=category.asc,description.asc', { headers });
      const data = await r.json();
      return res.status(r.ok ? 200 : r.status).json(data);
    }

    if (method === 'POST') {
      // Add new part
      const { code, description, price, category } = body;
      if (!description) return res.status(400).json({ error: 'description required' });
      const payload = JSON.stringify({ code: code || '', description, price: parseFloat(price) || 0, category: category || '' });
      const r = await fetch(SUPA_URL + '/rest/v1/parts_catalog', { method: 'POST', headers, body: payload });
      const data = await r.json();
      return res.status(r.ok ? 201 : r.status).json(data);
    }

    if (method === 'PATCH') {
      // Update part by id
      const { id, code, description, price, category } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      if (!SAFE_ID.test(String(id))) return res.status(400).json({ error: 'invalid id format' });
      const payload = JSON.stringify({ code: code || '', description, price: parseFloat(price) || 0, category: category || '' });
      const r = await fetch(SUPA_URL + '/rest/v1/parts_catalog?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers, body: payload });
      const data = await r.json();
      return res.status(r.ok ? 200 : r.status).json(data);
    }

    if (method === 'DELETE') {
      // Delete part by id
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      if (!SAFE_ID.test(String(id))) return res.status(400).json({ error: 'invalid id format' });
      const r = await fetch(SUPA_URL + '/rest/v1/parts_catalog?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers });
      return res.status(r.ok ? 204 : r.status).end();
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('parts-catalog error:', err);
    return res.status(500).json({ error: err.message });
  }
};
