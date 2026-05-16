// api/caption-photo.js — Vercel Serverless Function (CommonJS via api/package.json)
//
// Generates a brief one-sentence caption for a photo that a tech has just
// uploaded. Two contexts are supported, picked via the `context` field:
//   - 'expense_item' — describe the item / purchase visible (used by
//     ExpenseReportPage item photos to enrich the description field)
//   - 'service_work' — caption a PM/SC photo, calling out damage / leaks
//     / corrosion / anomalies (used by FormPage photo grid; not yet wired)
//
// Backed by Claude Haiku 4.5 (cheap + fast). Average call is ~1300 input
// tokens (image) + ~30 output tokens ≈ $0.005 each at current pricing.
// At 100 photos/day across the fleet that's ~$15/month.
//
// Auth: requires a Supabase user JWT in Authorization header — same
// pattern as polish-text.js. Photo arrives as base64 in the request body.
// Caps payload at ~5MB to stay under Vercel's serverless body limit.

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5-20251001';

const PROMPTS = {
  expense_item: `Briefly describe what is in this photo for an oilfield service company's expense report. Focus on the item, part, or purchase visible. When brand names, quantities, or sizes are clearly visible, include them. One short sentence (max 12 words). No preamble, no markdown, no quotes — just the caption.

Example outputs:
- Box of 12 cellulose filter cartridges, ChemTech brand
- Two cases of 1/2-13 hex nuts, Grade 8
- Five-gallon container of synthetic gear oil`,
  service_work: `Briefly caption this oilfield service photo for a maintenance work order. Note any damage, leaks, corrosion, soot, fouling, or other anomalies you can clearly see. If equipment is identifiable (heater treater, flame arrestor, flare stack, separator, manifold, valve), name it. One short sentence (max 16 words). No preamble, no markdown, no quotes — just the caption.

Example outputs:
- Cracked flame arrestor on heater 2, heavy soot buildup on inner mesh
- Flare pilot lit, stable blue flame
- Separator with visible oil sheen near valve manifold
- Heater treater firetube, no visible damage`,
};

function detectMediaType(dataUrlOrBase64) {
  if (typeof dataUrlOrBase64 !== 'string') return 'image/jpeg';
  const m = dataUrlOrBase64.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,/);
  if (m) return m[1];
  return 'image/jpeg';
}

function stripDataUrlPrefix(s) {
  if (typeof s !== 'string') return '';
  const idx = s.indexOf('base64,');
  return idx >= 0 ? s.slice(idx + 7) : s;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      error: 'AI captioning not configured. Admin: add ANTHROPIC_API_KEY in Vercel → Project Settings → Environment Variables.',
    });
  }

  const { image, context } = req.body || {};
  if (typeof image !== 'string' || !image) {
    return res.status(400).json({ error: 'image (base64 string) required' });
  }
  // ~6MB cap on base64 payload (roughly 4.5MB binary, well under Vercel
  // 5MB serverless body limit accounting for overhead).
  if (image.length > 6_000_000) {
    return res.status(413).json({ error: 'image too large — compress before upload' });
  }
  const promptKey = (context && PROMPTS[context]) ? context : 'service_work';
  const prompt = PROMPTS[promptKey];
  const mediaType = detectMediaType(image);
  const base64 = stripDataUrlPrefix(image);

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 96,
        system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: 'Caption this photo per the instructions above.' },
          ],
        }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => '');
      console.warn('Anthropic vision API error', anthropicRes.status, errText.slice(0, 300));
      return res.status(502).json({
        error: 'AI captioning backend error (' + anthropicRes.status + ')',
        details: errText.slice(0, 240),
      });
    }

    const data = await anthropicRes.json();
    const raw = (data && data.content && data.content[0] && data.content[0].text) || '';
    // Strip trailing periods, quotes, and "Caption:" prefixes if the model
    // adds them despite instructions.
    const caption = raw
      .trim()
      .replace(/^caption\s*[:\-]\s*/i, '')
      .replace(/^["'“‘]/, '')
      .replace(/["'”’]\s*$/, '')
      .trim();
    return res.status(200).json({ caption, context: promptKey });
  } catch (e) {
    console.warn('caption-photo fetch failed', e);
    return res.status(500).json({ error: 'AI caption request failed: ' + (e.message || e) });
  }
};
