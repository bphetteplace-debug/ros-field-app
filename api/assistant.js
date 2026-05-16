// api/assistant.js — Vercel Serverless Function (CommonJS via api/package.json)
//
// In-app AI assistant. Tech or admin opens the floating chat, asks a
// natural-language question, and Claude Sonnet answers it using a small
// set of read-only tools that query Supabase via the service-role key.
//
// Auth: requires a Supabase user JWT, same as polish-text / caption-photo.
// We resolve the user (id, email) up-front and inject their identity +
// role into the system prompt so Claude can scope answers correctly
// (e.g. "my truck" → that user's inventory).
//
// Tools are read-only by design — no inserts, updates, deletes, or
// emails. If the user asks the assistant to do something mutating,
// the system prompt instructs Claude to refuse with a friendly note.

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_ROUNDS = 6;

// ──────────────────────────────────────────────────────────────────────
// TOOL IMPLEMENTATIONS — all read-only Supabase queries
// ──────────────────────────────────────────────────────────────────────

async function supaGet(path) {
  const res = await fetch(SUPA_URL + '/rest/v1/' + path, {
    headers: { apikey: SUPA_SERVICE, Authorization: 'Bearer ' + SUPA_SERVICE },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Supabase ' + res.status + ': ' + t.slice(0, 200));
  }
  return res.json();
}

function escapeSupaValue(v) {
  // URL-encode the value so it can't break out of its filter slot.
  // The old `.replace(/[(),%]/g, ' ')` left `*`, `&`, and `=` alone, so
  // a tool argument like `customer_name="foo&status=eq.draft"` could
  // append a second PostgREST filter and scope the query outside intent.
  // Tool arguments come from the model, which is in turn driven by
  // free-text user prompts — assume adversarial input.
  return encodeURIComponent(String(v));
}

const TOOLS = [
  {
    name: 'search_submissions',
    description:
      'Search PM, Service Call, Expense Report, Inspection, and JHA submissions. Use this for any question about past work, customer history, who did what when, revenue, or recent activity. Returns at most 25 most-recent matches with key fields. Multiple filters AND together.',
    input_schema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Case-insensitive partial match on customer_name. Omit for any customer.' },
        location_name: { type: 'string', description: 'Case-insensitive partial match on the job site / location.' },
        tech_name: { type: 'string', description: 'Tech full name as it appears in data.techs[]. Partial match.' },
        type: { type: 'string', enum: ['PM', 'SC', 'EXP', 'INSP', 'JHA', 'ANY'], description: 'Type filter. ANY/omitted returns all types.' },
        status: { type: 'string', enum: ['submitted', 'reviewed', 'invoiced', 'draft', 'any'], description: 'Status filter. "any"/omitted returns all.' },
        date_from: { type: 'string', description: 'ISO date (YYYY-MM-DD). Submissions ON or AFTER this date.' },
        date_to: { type: 'string', description: 'ISO date (YYYY-MM-DD). Submissions ON or BEFORE this date.' },
        limit: { type: 'integer', description: 'Max results to return. Default 10, max 25.' },
      },
    },
  },
  {
    name: 'get_inventory',
    description:
      'Get truck or shop inventory. Returns parts list with code, description, qty on hand, min qty, location. Use this when the user asks about parts on a truck, low stock items, or whether a specific part is available.',
    input_schema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['my_truck', 'tech_truck', 'shop', 'all_trucks'], description: 'my_truck = the asking user\'s truck. tech_truck = pass tech_name to identify. shop = main shop inventory. all_trucks = every tech\'s truck (admin-only context).' },
        tech_name: { type: 'string', description: 'Tech full name (only used when scope=tech_truck).' },
        low_stock_only: { type: 'boolean', description: 'When true, return only parts where qty <= min_qty AND min_qty > 0.' },
      },
      required: ['scope'],
    },
  },
  {
    name: 'list_techs',
    description: 'List all tech profiles (name, email, role, truck_number). Use when the user asks who is on the team or who can do X.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_active_dispatches',
    description: 'List open customer-tracking dispatches (en_route or arrived). Use when the user asks who is currently dispatched to customers.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'recent_activity_summary',
    description:
      'High-level dashboard-style summary of recent submissions: count by type, top customers, top techs by hours. Use when the user asks "how have we been doing" / "what happened this week" type questions.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'Window in days (default 7, max 90).' },
      },
    },
  },
];

function getTypeLabel(s) {
  const data = s.data || {};
  if (s.template === 'pm_flare_combustor') return 'PM';
  if (s.template === 'service_call') return 'SC';
  if (s.template === 'expense_report') return 'EXP';
  if (s.template === 'daily_inspection') return 'INSP';
  if (data.jobType === 'JHA/JSA' || (s.work_type || '').includes('JHA')) return 'JHA';
  if (data.jobType === 'Expense Report') return 'EXP';
  if (data.jobType === 'Daily Inspection') return 'INSP';
  if (data.jobType === 'PM') return 'PM';
  return 'SC';
}

function compactSubmission(s) {
  const d = s.data || {};
  const techs = Array.isArray(d.techs) ? d.techs : [];
  return {
    id: s.id,
    type: getTypeLabel(s),
    wo: s.work_order || s.pm_number || null,
    customer: s.customer_name || null,
    location: s.location_name || null,
    date: s.date || null,
    status: s.status || null,
    techs: techs.length > 0 ? techs : undefined,
    labor_hours: s.labor_hours || undefined,
    summary: (s.summary || '').slice(0, 200) || undefined,
    grand_total: d.grandTotal || undefined,
    expense_total: d.expenseTotal || undefined,
  };
}

async function toolSearchSubmissions(args) {
  const limit = Math.min(Math.max(parseInt(args.limit || 10, 10) || 10, 1), 25);
  const params = ['select=*', 'order=created_at.desc', 'limit=' + limit];
  if (args.customer_name) params.push('customer_name=ilike.*' + escapeSupaValue(args.customer_name) + '*');
  if (args.location_name) params.push('location_name=ilike.*' + escapeSupaValue(args.location_name) + '*');
  if (args.status && args.status !== 'any') params.push('status=eq.' + escapeSupaValue(args.status));
  if (args.date_from) params.push('date=gte.' + escapeSupaValue(args.date_from));
  if (args.date_to) params.push('date=lte.' + escapeSupaValue(args.date_to));
  // Type filter is client-side because it depends on combined fields.
  const rows = await supaGet('submissions?' + params.join('&'));
  let filtered = rows;
  if (args.type && args.type !== 'ANY') {
    filtered = filtered.filter(r => getTypeLabel(r) === args.type);
  }
  if (args.tech_name) {
    const needle = args.tech_name.toLowerCase();
    filtered = filtered.filter(r => {
      const techs = (r.data && Array.isArray(r.data.techs)) ? r.data.techs : [];
      return techs.some(t => String(t).toLowerCase().includes(needle));
    });
  }
  return { count: filtered.length, results: filtered.slice(0, limit).map(compactSubmission) };
}

async function toolGetInventory(args, userCtx) {
  const scope = args.scope;
  if (scope === 'shop') {
    const rows = await supaGet('inventory?inventory_type=eq.shop&select=*');
    return { scope: 'shop', parts: (rows[0] && rows[0].parts) || [] };
  }
  if (scope === 'all_trucks') {
    const rows = await supaGet('inventory?inventory_type=eq.truck&select=*');
    // Join with profile names
    const profiles = await supaGet('profiles?select=id,full_name,truck_number');
    const out = rows.map(r => {
      const p = profiles.find(x => x.id === r.owner_id);
      const parts = (r.parts || []);
      const lowCount = parts.filter(x => x.qty <= x.min_qty && x.min_qty > 0).length;
      return {
        tech_name: (p && p.full_name) || null,
        truck_number: (p && p.truck_number) || null,
        part_count: parts.length,
        low_stock_count: lowCount,
      };
    });
    return { scope: 'all_trucks', trucks: out };
  }
  let ownerId = userCtx.userId;
  if (scope === 'tech_truck') {
    if (!args.tech_name) return { error: 'tech_name is required for scope=tech_truck' };
    const needle = args.tech_name.toLowerCase();
    const profiles = await supaGet('profiles?select=id,full_name');
    const match = profiles.find(p => (p.full_name || '').toLowerCase().includes(needle));
    if (!match) return { error: 'No tech matching "' + args.tech_name + '"' };
    ownerId = match.id;
  }
  const rows = await supaGet('inventory?owner_id=eq.' + ownerId + '&inventory_type=eq.truck&select=*');
  let parts = (rows[0] && rows[0].parts) || [];
  if (args.low_stock_only) parts = parts.filter(p => p.qty <= p.min_qty && p.min_qty > 0);
  return { scope, owner_id: ownerId, parts };
}

async function toolListTechs() {
  const profiles = await supaGet('profiles?select=id,full_name,email,role,truck_number&order=full_name.asc');
  return { count: profiles.length, techs: profiles.map(p => ({ name: p.full_name, email: p.email, role: p.role, truck: p.truck_number })) };
}

async function toolGetActiveDispatches() {
  let rows;
  try {
    rows = await supaGet('active_dispatch?ended_at=is.null&select=tech_name,customer_name,destination_label,status,started_at,tech_lat,tech_lng,eta_seconds');
  } catch (e) {
    // Table might not exist (pre-migration)
    return { count: 0, dispatches: [], note: 'active_dispatch table not available' };
  }
  return { count: rows.length, dispatches: rows };
}

async function toolRecentActivitySummary(args) {
  const days = Math.min(Math.max(parseInt(args.days || 7, 10) || 7, 1), 90);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const rows = await supaGet('submissions?date=gte.' + cutoff + '&select=*&order=date.desc&limit=500');
  const byType = {};
  const byCustomer = {};
  const byTech = {};
  let totalRevenue = 0;
  let totalExpenses = 0;
  for (const r of rows) {
    const t = getTypeLabel(r);
    byType[t] = (byType[t] || 0) + 1;
    if (r.customer_name) byCustomer[r.customer_name] = (byCustomer[r.customer_name] || 0) + 1;
    const techs = (r.data && Array.isArray(r.data.techs)) ? r.data.techs : [];
    for (const tn of techs) byTech[tn] = (byTech[tn] || 0) + parseFloat(r.labor_hours || 0);
    if (t === 'PM' || t === 'SC') totalRevenue += parseFloat((r.data && r.data.grandTotal) || 0);
    if (t === 'EXP') totalExpenses += parseFloat((r.data && r.data.expenseTotal) || 0);
  }
  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ name: k, value: v }));
  return {
    window_days: days,
    since: cutoff,
    total_submissions: rows.length,
    by_type: byType,
    revenue: Number(totalRevenue.toFixed(2)),
    expenses: Number(totalExpenses.toFixed(2)),
    top_customers: top(byCustomer),
    top_techs_by_hours: top(byTech),
  };
}

async function runTool(name, args, userCtx) {
  try {
    if (name === 'search_submissions') return await toolSearchSubmissions(args || {});
    if (name === 'get_inventory') return await toolGetInventory(args || {}, userCtx);
    if (name === 'list_techs') return await toolListTechs();
    if (name === 'get_active_dispatches') return await toolGetActiveDispatches();
    if (name === 'recent_activity_summary') return await toolRecentActivitySummary(args || {});
    return { error: 'Unknown tool: ' + name };
  } catch (e) {
    return { error: 'Tool failed: ' + (e.message || String(e)) };
  }
}

// ──────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — short, specific, role-aware
// ──────────────────────────────────────────────────────────────────────

function buildSystemPrompt(userCtx) {
  return `You are the in-app assistant for ReliableTrack, the field-data app used by Reliable Oilfield Services. The user asking right now is:
- name: ${userCtx.userName || 'unknown'}
- email: ${userCtx.userEmail || 'unknown'}
- role: ${userCtx.isAdmin ? 'admin' : 'tech'}
- supabase user_id: ${userCtx.userId}

You help them look up things in the company's data using the tools provided. When the user refers to "my truck", "my jobs", "my expenses", scope to THIS user (tech_name = their name, owner_id = their user_id).

Your tools are READ-ONLY. You cannot send emails, change statuses, modify inventory, create dispatches, or alter any data. If asked, say so plainly and suggest where in the app they'd do it themselves (e.g. "you can change a submission status from the admin Submissions tab").

Style:
- Be terse and direct. The owner prefers short answers with concrete data, not preamble.
- Show numbers, dates, customer names, WO#'s directly. Use compact tables when 3+ rows.
- One short paragraph or a 3-5 row table per answer is the target.
- Never invent data. If a tool returned no results, say so.
- Dates: prefer "Tue May 12" style or "3 days ago" — not raw ISO.
- Money: $1,234.56 format.

When the user asks a vague question ("what's going on?"), prefer recent_activity_summary first, then suggest specific follow-ups.`;
}

// ──────────────────────────────────────────────────────────────────────
// HANDLER
// ──────────────────────────────────────────────────────────────────────

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
  if (!SUPA_SERVICE) return res.status(503).json({ error: 'Assistant not configured. Admin: add SUPABASE_SERVICE_ROLE_KEY in Vercel env vars.' });
  if (!ANTHROPIC_KEY) return res.status(503).json({ error: 'Assistant not configured. Admin: add ANTHROPIC_API_KEY in Vercel env vars.' });

  // Resolve user via Supabase Auth + profile join
  let userId, userEmail, userName, isAdmin = false;
  try {
    const userRes = await fetch(SUPA_URL + '/auth/v1/user', {
      headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + userToken },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid or expired session' });
    const u = await userRes.json();
    userId = u.id;
    userEmail = u.email;
    // Look up profile for full name + role
    try {
      const profRes = await fetch(SUPA_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(userId) + '&select=full_name,role&limit=1', {
        headers: { apikey: SUPA_SERVICE, Authorization: 'Bearer ' + SUPA_SERVICE },
      });
      if (profRes.ok) {
        const profs = await profRes.json();
        if (profs[0]) {
          userName = profs[0].full_name;
          isAdmin = profs[0].role === 'admin';
        }
      }
    } catch (_) {}
    // Hardcoded admin emails as a fallback (mirrors src/lib/auth.jsx)
    const ADMIN_EMAILS = ['bphetteplace@reliableoilfieldservices.net', 'cphetteplace@reliableoilfieldservices.net', 'demo@reliable-oilfield-services.com'];
    if (ADMIN_EMAILS.includes(userEmail)) isAdmin = true;
  } catch (e) {
    return res.status(500).json({ error: 'Auth check failed: ' + (e.message || e) });
  }

  const { messages: clientMessages, message } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message (string) required' });
  }
  if (message.length > 2000) return res.status(400).json({ error: 'message too long (max 2000 chars)' });

  const userCtx = { userId, userEmail, userName, isAdmin };
  const history = Array.isArray(clientMessages) ? clientMessages.slice(-12) : [];
  // Each history entry should be { role: 'user'|'assistant', content: string }
  const messages = [];
  for (const h of history) {
    if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim()) {
      messages.push({ role: h.role, content: h.content });
    }
  }
  messages.push({ role: 'user', content: message });

  const systemPrompt = buildSystemPrompt(userCtx);
  const toolEvents = []; // surfaced back to client for "show your work" UI

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
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
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          tools: TOOLS,
          messages,
        }),
      });
      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text().catch(() => '');
        console.warn('Anthropic API error', anthropicRes.status, errText.slice(0, 400));
        return res.status(502).json({ error: 'AI backend error (' + anthropicRes.status + ')', details: errText.slice(0, 240) });
      }
      const data = await anthropicRes.json();
      const stop = data.stop_reason;
      const content = data.content || [];

      // Add the assistant's full response to messages — Anthropic API requires
      // the assistant turn to be exact (tool_use blocks) before tool_result.
      messages.push({ role: 'assistant', content });

      if (stop !== 'tool_use') {
        const text = content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
        return res.status(200).json({ reply: text, toolEvents });
      }

      // Execute tools and feed back results
      const toolUses = content.filter(c => c.type === 'tool_use');
      const toolResults = [];
      for (const tu of toolUses) {
        const result = await runTool(tu.name, tu.input || {}, userCtx);
        toolEvents.push({ name: tu.name, input: tu.input, ok: !result?.error });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result).slice(0, 12_000),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }
    return res.status(200).json({ reply: 'Sorry — too many lookup steps. Try a more specific question.', toolEvents });
  } catch (e) {
    console.warn('assistant fetch failed', e);
    return res.status(500).json({ error: 'Assistant request failed: ' + (e.message || e) });
  }
};
