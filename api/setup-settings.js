// api/setup-settings.js - ONE-TIME setup endpoint (CommonJS)
// Call GET /api/setup-settings once to:
//   1. Create the app_settings table (using Supabase pg RPC)
//   2. Seed default values
//   3. Make the submission-photos bucket public

const SUPA_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co'
const SUPA_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const PROJ_REF  = 'idddbbvotykfairirmwn'
const MGMT_TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN // optional, for CREATE TABLE

module.exports = async function handler(req, res) {
  if (!SUPA_KEY) return res.status(500).json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' })
  const results = []

  // 1. Create app_settings table via Supabase Management API (requires SUPABASE_MANAGEMENT_TOKEN)
  //    Fallback: try to upsert directly (works if table already exists)
  if (MGMT_TOKEN) {
    const createSql = `
      CREATE TABLE IF NOT EXISTS public.app_settings (
        key         TEXT PRIMARY KEY,
        value       JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
      DO $$ BEGIN
        CREATE POLICY "All authenticated read" ON public.app_settings FOR SELECT TO authenticated USING (true);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        CREATE POLICY "Authenticated insert" ON public.app_settings FOR INSERT TO authenticated WITH CHECK (true);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        CREATE POLICY "Authenticated update" ON public.app_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `;
    const mgmtRes = await fetch('https://api.supabase.com/v1/projects/' + PROJ_REF + '/database/query', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + MGMT_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: createSql })
    });
    results.push({ step: 'create_table', status: mgmtRes.status, body: (await mgmtRes.text()).substring(0, 200) });
  } else {
    results.push({ step: 'create_table', skipped: true, reason: 'No SUPABASE_MANAGEMENT_TOKEN — table must be created manually via SQL Editor' });
  }

  // 2. Seed default values (upsert — works only if table exists)
  const seedData = [
    { key: 'customers', value: ['Diamondback','High Peak Energy','ExTex','A8 Oilfield Services','Pristine Alliance','KOS'], updated_at: new Date().toISOString() },
    { key: 'trucks',    value: ['0001','0002','0003','0004','0005','0006','0007'],                                         updated_at: new Date().toISOString() },
    { key: 'techs',     value: ['Matthew Reid','Vladimir Rivero','Pedro Perez'],                                          updated_at: new Date().toISOString() }
  ];
  const seedRes = await fetch(SUPA_URL + '/rest/v1/app_settings?on_conflict=key', {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=ignore-duplicates'
    },
    body: JSON.stringify(seedData)
  });
  const seedBody = await seedRes.text();
  results.push({ step: 'seed', status: seedRes.status, ok: seedRes.ok, body: seedBody.substring(0, 200) });

  // 3. Make submission-photos bucket public
  const bucketRes = await fetch(SUPA_URL + '/storage/v1/bucket/submission-photos', {
    method: 'PUT',
    headers: {
      apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ public: true, file_size_limit: 52428800, allowed_mime_types: ['image/jpeg','image/png','image/webp','image/heic'] })
  });
  const bucketBody = await bucketRes.text();
  results.push({ step: 'bucket_public', status: bucketRes.status, ok: bucketRes.ok, body: bucketBody.substring(0, 200) });

  const tableCreated = results.find(r => r.step === 'create_table');
  const seeded       = results.find(r => r.step === 'seed');

  return res.status(200).json({
    ok: seeded?.ok || false,
    note: !MGMT_TOKEN ? 'Add SUPABASE_MANAGEMENT_TOKEN env var in Vercel to auto-create the table, OR run docs/setup-app-settings.sql in Supabase SQL Editor.' : undefined,
    results
  });
}
