// api/polish-text.js — Vercel Serverless Function (CommonJS via api/package.json)
//
// Cleans up voice-dictated text from field techs: grammar, spelling,
// capitalization, punctuation, and common speech-to-text mishearings.
// Preserves the original meaning and technical terminology — does NOT
// rewrite for brevity or style.
//
// Backed by Claude Haiku 4.5 (newest small/fast model). Average call is
// ~150 input + ~80 output tokens ≈ $0.0004 each. At 100 submissions/day
// with 5 polishes per submission that's roughly $6/month.
//
// Auth: requires a Supabase user JWT in the Authorization header so this
// endpoint isn't an open LLM API. The lambda calls Supabase's /auth/v1/user
// with the token and rejects if it doesn't return 200.
//
// Prompt caching: the system prompt is marked cache_control:ephemeral so
// repeat calls from the same tech within ~5 min share a cache prefix.

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are polishing oilfield service-report text that a field technician dictated using voice recognition on their phone. Your job is to fix:

- Grammar (subject/verb agreement, tense consistency)
- Spelling (including industrial / oilfield technical terms: arrestor, flare, separator, treater, BMS, kickoff line, flow line, casing, tubing, blowdown, scrubber, dehy, glycol, choke, etc.)
- Capitalization (proper sentence case — first letter of each sentence, proper nouns)
- Punctuation (periods, commas, sentence breaks, hyphens in compound terms)
- Common voice-to-text mishearings (homophones — e.g. "their" vs "there", "lose" vs "loose", "seal" vs "seel")
- Run-on phrases (split into sentences where the tech clearly paused or finished a thought)

You MUST NOT:
- Change the meaning of what was said
- Add information not present in the original (no inferred details, no "and we should also…" additions)
- Rewrite for style, brevity, formality, or tone
- Translate to another language
- Add summaries, headings, bullets, or commentary
- Add quote marks around your output

If the text is already well-formed, return it unchanged. If the input is empty or only whitespace, return an empty string.

Return ONLY the polished text. No preamble, no explanation, no markdown.`;

module.exports = async function handler(req, res) {
  // CORS — only same-origin needed, but be permissive for the techs.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: require Supabase user JWT.
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
    // Surface a clear, actionable error so admin knows what to fix instead
    // of "AI polish failed" being a mystery in the field.
    return res.status(503).json({
      error: 'AI polish not configured. Admin: add ANTHROPIC_API_KEY in Vercel → Project Settings → Environment Variables.'
    });
  }

  const { text } = req.body || {};
  if (typeof text !== 'string') return res.status(400).json({ error: 'text (string) required' });
  const trimmed = text.trim();
  if (!trimmed) return res.status(200).json({ polished: '' });
  if (trimmed.length > 6000) return res.status(400).json({ error: 'text too long (max 6000 chars)' });

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
        max_tokens: 2048,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: trimmed }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => '');
      console.warn('Anthropic API error', anthropicRes.status, errText.slice(0, 300));
      return res.status(502).json({
        error: 'AI polish backend error (' + anthropicRes.status + ')',
        details: errText.slice(0, 240),
      });
    }

    const data = await anthropicRes.json();
    const polished = (data && data.content && data.content[0] && data.content[0].text) || trimmed;
    return res.status(200).json({ polished: polished.trim() });
  } catch (e) {
    console.warn('polish-text fetch failed', e);
    return res.status(500).json({ error: 'AI polish request failed: ' + (e.message || e) });
  }
};
