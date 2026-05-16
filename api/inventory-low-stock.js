// api/inventory-low-stock.js - Vercel Cron Job (CommonJS via api/package.json)
// Scans every truck inventory record, groups parts at or below their min_qty
// by truck owner, and emails the admin a single restock alert. Triggered on
// the schedule defined in vercel.json (default: Monday 7am Central).
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const TO_RAW = process.env.LOW_STOCK_EMAIL_TO || process.env.EMAIL_TO || 'bphetteplace@reliableoilfieldservices.net';
const FROM = process.env.RESEND_FROM || 'ReliableTrack <reports@reliable-oilfield-services.com>';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = async function handler(req, res) {
  // Require CRON_SECRET. Was: check was *optional* — if the env var was
  // unset, the endpoint was publicly POSTable and could trigger a real
  // restock-alert email at attacker pace. Vercel cron requests include
  // `Authorization: Bearer ${CRON_SECRET}` automatically when configured,
  // so admin just needs the env var set in Vercel (Production scope).
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ error: 'CRON_SECRET not configured' });
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!SUPA_KEY) return res.status(500).json({ error: 'Missing Supabase key' });
  if (!RESEND_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY' });

  try {
    // Fetch all truck inventory rows (service role bypasses RLS)
    const invRes = await fetch(
      SUPA_URL + '/rest/v1/inventory?inventory_type=eq.truck&select=*',
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }
    );
    if (!invRes.ok) {
      const txt = await invRes.text();
      return res.status(500).json({ error: 'inventory fetch failed: ' + txt });
    }
    const inventories = await invRes.json();

    // Find low-stock parts per truck
    const trucksWithLowStock = [];
    for (const inv of inventories) {
      const lowParts = (inv.parts || []).filter(p =>
        p.min_qty != null && Number(p.min_qty) > 0 &&
        Number(p.qty || 0) <= Number(p.min_qty)
      );
      if (lowParts.length > 0) trucksWithLowStock.push({ owner_id: inv.owner_id, parts: lowParts });
    }

    if (trucksWithLowStock.length === 0) {
      return res.status(200).json({ ok: true, message: 'No low-stock parts; no email sent.' });
    }

    // Look up tech names for each owner
    const ownerIds = trucksWithLowStock.map(t => t.owner_id).filter(Boolean);
    let nameById = {};
    if (ownerIds.length > 0) {
      const profRes = await fetch(
        SUPA_URL + '/rest/v1/profiles?id=in.(' + ownerIds.join(',') + ')&select=id,full_name,truck_number',
        { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }
      );
      if (profRes.ok) {
        const profiles = await profRes.json();
        for (const p of profiles) nameById[p.id] = { name: p.full_name || '', truck: p.truck_number || '' };
      }
    }

    const totalParts = trucksWithLowStock.reduce((sum, t) => sum + t.parts.length, 0);
    const truckCount = trucksWithLowStock.length;
    const subject = '🔧 ROS Inventory: ' + totalParts + ' part' + (totalParts !== 1 ? 's' : '') +
                    ' low across ' + truckCount + ' truck' + (truckCount !== 1 ? 's' : '');

    let html = '<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a2332;">';
    html += '<h2 style="color: #1a2332; margin: 0 0 6px; font-size: 20px;">🔧 Truck Inventory Restock Alert</h2>';
    html += '<p style="color: #666; font-size: 13px; margin: 0 0 20px;">The following parts are at or below their minimum quantity. Restock before the next job.</p>';

    for (const t of trucksWithLowStock) {
      const meta = nameById[t.owner_id] || {};
      const heading = meta.name
        ? escapeHtml(meta.name) + (meta.truck ? ' &middot; Truck ' + escapeHtml(meta.truck) : '')
        : 'Unknown tech (' + String(t.owner_id || '').slice(0, 8) + ')';

      html += '<div style="background: #fef3c7; border-left: 4px solid #d97706; padding: 12px 14px; margin-bottom: 14px; border-radius: 4px;">';
      html += '<div style="font-weight: 700; color: #1a2332; margin-bottom: 8px;">' + heading + '</div>';
      html += '<table style="width: 100%; border-collapse: collapse; font-size: 13px;">';
      html += '<thead><tr style="background: rgba(0,0,0,0.04); color: #555; font-size: 11px; text-transform: uppercase;">';
      html += '<th style="padding: 4px 8px; text-align: left;">Part</th>';
      html += '<th style="padding: 4px 8px; text-align: right;">On hand</th>';
      html += '<th style="padding: 4px 8px; text-align: right;">Min</th>';
      html += '<th style="padding: 4px 8px; text-align: left;">Location</th>';
      html += '</tr></thead><tbody>';
      for (const p of t.parts) {
        const code = escapeHtml(p.code || '—');
        const desc = escapeHtml(p.description || '');
        const qty = Number(p.qty || 0);
        const minQty = Number(p.min_qty || 0);
        const loc = escapeHtml(p.location || '');
        html += '<tr style="border-bottom: 1px solid rgba(0,0,0,0.06);">';
        html += '<td style="padding: 5px 8px;"><strong>' + code + '</strong>' + (desc ? ' &mdash; ' + desc : '') + '</td>';
        html += '<td style="padding: 5px 8px; text-align: right; color: #dc2626; font-weight: 700;">' + qty + '</td>';
        html += '<td style="padding: 5px 8px; text-align: right; color: #666;">' + minQty + '</td>';
        html += '<td style="padding: 5px 8px; color: #666;">' + loc + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      html += '</div>';
    }

    html += '<p style="color: #888; font-size: 11px; margin-top: 24px;">';
    html += 'Automated alert from ReliableTrack. View or edit inventory at ';
    html += '<a href="https://pm.reliable-oilfield-services.com/inventory" style="color: #1a56db;">pm.reliable-oilfield-services.com/inventory</a>.';
    html += '</p></div>';

    const to = TO_RAW.split(',').map(e => e.trim()).filter(Boolean);
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      return res.status(500).json({ error: 'Resend send failed: ' + errText });
    }

    return res.status(200).json({ ok: true, truckCount, partCount: totalParts });
  } catch (e) {
    return res.status(500).json({ error: 'unexpected: ' + (e && e.message ? e.message : String(e)) });
  }
};
