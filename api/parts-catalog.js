// api/parts-catalog.js - Serverless endpoint for parts_catalog CRUD
// Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS for admin operations
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      .end();
  }

  if (!SUPA_KEY) return res.status(500).json({ error: 'Missing Supabase key' });

  const headers = {
    'apikey': SUPA_KEY,
    'Authorization': 'Bearer ' + SUPA_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  try {
    const method = req.method;
    const body = req.body || {};

    if (method === 'GET') {
      // Return all parts ordered
      const r = await fetch(SUPA_URL + '/rest/v1/parts_catalog?order=category.asc,description.asc', { headers });
      const data = await r.json();
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(r.ok ? 200 : r.status).json(data);
    }

    if (method === 'POST') {
      // Add new part
      const { code, description, price, category } = body;
      if (!description) return res.status(400).json({ error: 'description required' });
      const payload = JSON.stringify({ code: code || '', description, price: parseFloat(price) || 0, category: category || '' });
      const r = await fetch(SUPA_URL + '/rest/v1/parts_catalog', { method: 'POST', headers, body: payload });
      const data = await r.json();
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(r.ok ? 201 : r.status).json(data);
    }

    if (method === 'PATCH') {
      // Update part by id
      const { id, code, description, price, category } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const payload = JSON.stringify({ code: code || '', description, price: parseFloat(price) || 0, category: category || '' });
      const r = await fetch(SUPA_URL + '/rest/v1/parts_catalog?id=eq.' + id, { method: 'PATCH', headers, body: payload });
      const data = await r.json();
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(r.ok ? 200 : r.status).json(data);
    }

    if (method === 'DELETE') {
      // Delete part by id
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const r = await fetch(SUPA_URL + '/rest/v1/parts_catalog?id=eq.' + id, { method: 'DELETE', headers });
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(r.ok ? 204 : r.status).end();
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('parts-catalog error:', err);
    return res.status(500).json({ error: err.message });
  }
};
