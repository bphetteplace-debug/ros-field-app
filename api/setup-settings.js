// api/setup-settings.js - ONE-TIME setup endpoint (CommonJS)
// Call GET /api/setup-settings once to create the app_settings table and seed it
// This uses the service role key so it can create tables and policies

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

module.exports = async function handler(req, res) {
  if (!SUPA_KEY) return res.status(500).json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' })

  const results = []

  // Helper: run a SQL statement via Supabase REST upsert/insert
  const insert = async (table, rows) => {
    const r = await fetch(SUPA_URL + '/rest/v1/' + table + '?on_conflict=key', {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY,
        Authorization: 'Bearer ' + SUPA_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal,resolution=ignore-duplicates'
      },
      body: JSON.stringify(rows)
    })
    return { table, status: r.status, ok: r.ok }
  }

  // Try to seed the settings table (will fail with 404 if table doesn't exist yet)
  const seed = await insert('app_settings', [
    { key: 'customers', value: ['Diamondback','High Peak Energy','ExTex','A8 Oilfield Services','Pristine Alliance','KOS'] },
    { key: 'trucks',    value: ['0001','0002','0003','0004','0005','0006','0007'] },
    { key: 'techs',     value: ['Matthew Reid','Vladimir Rivero','Pedro Perez'] }
  ])
  results.push(seed)

  if (seed.status === 404) {
    return res.status(200).json({
      message: 'app_settings table does not exist yet. Please run the SQL from docs/setup-app-settings.sql in your Supabase SQL Editor first.',
      results
    })
  }

  // Make submission-photos bucket public
  const bucketRes = await fetch(SUPA_URL + '/storage/v1/bucket/submission-photos', {
    method: 'PUT',
    headers: {
      apikey: SUPA_KEY,
      Authorization: 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ public: true, file_size_limit: 52428800, allowed_mime_types: ['image/jpeg','image/png','image/webp','image/gif'] })
  })
  results.push({ bucket: 'submission-photos', status: bucketRes.status, ok: bucketRes.ok, body: await bucketRes.text() })

  return res.status(200).json({ ok: true, results })
}
