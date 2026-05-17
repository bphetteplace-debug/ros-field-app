// api/translate.js — Vercel Serverless Function (CommonJS via api/package.json)
//
// Translates free-form Spanish text into natural professional English for
// the PDF / customer-facing surfaces. Used by FormPage's submit flow when
// the tech is filling out a work order in Spanish — the submission row
// stores both the Spanish original AND the English translation, and the
// PDF prefers the English copy.
//
// Auth: requires a Supabase user JWT (same pattern as caption-photo.js +
// polish-text.js). Backed by Claude Haiku 4.5 — cheap + fast (~$0.001 per
// typical work-order field).
//
// Request body: { fields: { fieldName: spanishText, ... } } — batched so
// one HTTP round-trip handles description + reportedIssue + rootCause +
// notes in a single Haiku call.
// Response: { translations: { fieldName: englishText, ... } }

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You translate field-service text written by oilfield technicians from Spanish into natural professional English suitable for a customer-facing PDF work order.

Rules:
- Return ONLY the translation. No preamble, no quotes, no markdown, no commentary.
- Preserve technical terms accurately (heater treater = "heater treater", flare = "flare", flame arrestor = "flame arrestor", firetube = "firetube", separator, manifold, valve, gasket, regulator, pilot, burner, etc.).
- Keep numbers, part codes, asset IDs, GPS coords, and timestamps exactly as written.
- If the input is already English, return it unchanged.
- If the input is empty or just whitespace, return an empty string.
- Match the technician's tone: brief, factual, plain.`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth (same JWT check pattern as the other lambdas).
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const userToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!userToken) return res.status(401).json({ error: 'Missing auth token' });
  if (!SUPA_ANON) return res.status(500).json({ error: 'Server missing Supabase anon key' });
  try {
    const userRes = await fetch(SUPA_URL + '/auth/v1/user', {
      headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + userToken },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid or expired session' });
  } catch (_e) {
    return res.status(500).json({ error: 'Auth check failed' });
  }

  if (!ANTHROPIC_KEY) {
    return res.status(503).json({
      error: 'AI translation not configured. Admin: add ANTHROPIC_API_KEY in Vercel.',
    });
  }

  const body = req.body || {};
  const fields = body.fields;
  if (!fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'fields object required' });
  }

  // Filter empty / non-string values up front so we don't waste tokens.
  const work = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' && v.trim()) work[k] = v;
  }
  if (Object.keys(work).length === 0) {
    return res.status(200).json({ translations: {} });
  }

  // Batched single-call approach: pass a JSON object to Claude and ask for
  // a JSON object back with the same keys. Cheaper + faster than N calls.
  const userPrompt = `Translate each field value below from Spanish to English. Reply with ONLY a valid JSON object with the same keys and the translated values — no markdown fences, no preamble.

Input:
${JSON.stringify(work, null, 2)}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text().catch(() => '');
      return res.status(502).json({ error: 'Anthropic error', details: t.slice(0, 400) });
    }

    const aiBody = await aiRes.json();
    const text = (aiBody.content && aiBody.content[0] && aiBody.content[0].text) || '';

    // Parse the model's JSON output. Be lenient — strip markdown fences
    // and extract the first {...} block so a stray "Here is..." prefix
    // doesn't break the parse.
    let translations = {};
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) translations = JSON.parse(match[0]);
    } catch (parseErr) {
      // Fallback: return the original strings so the PDF still has SOMETHING
      // rather than blanks. The submission's audit trail keeps the Spanish.
      console.warn('[translate] JSON parse failed:', parseErr?.message);
      translations = work;
    }

    // Defensive: only keep keys that were asked for, only string values.
    const out = {};
    for (const k of Object.keys(work)) {
      const v = translations[k];
      out[k] = typeof v === 'string' ? v : work[k];
    }

    return res.status(200).json({ translations: out });
  } catch (err) {
    console.error('[translate] error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
};
