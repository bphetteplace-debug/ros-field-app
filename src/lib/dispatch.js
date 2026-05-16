// Customer-tracking dispatch helpers — client for the active_dispatch table
// + the public get_active_dispatch RPC. Schema lives in
// supabase/active_dispatch.sql.

import { getAuthToken } from './submissions';

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function authHeaders(includeContent) {
  const token = getAuthToken();
  const h = {
    apikey: SUPA_KEY,
    Authorization: 'Bearer ' + (token || SUPA_KEY),
  };
  if (includeContent) h['Content-Type'] = 'application/json';
  return h;
}

// ──────────────────────────────────────────────────────────────────────
// PUBLIC — used by the customer-facing /track/:token page
// ──────────────────────────────────────────────────────────────────────

// Calls the get_active_dispatch RPC. Returns the dispatch object or null
// if expired / invalid / completed. Uses the anon key only — never the
// signed-in user's token, since this is meant to work for anonymous
// visitors.
export async function fetchActiveDispatch(token) {
  if (!token) return null;
  try {
    const res = await fetch(SUPA_URL + '/rest/v1/rpc/get_active_dispatch', {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY,
        Authorization: 'Bearer ' + SUPA_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_token: token }),
    });
    if (!res.ok) {
      // 404 / RPC-not-found will land here when the migration hasn't run yet.
      // Returning null lets the page render its "expired" state cleanly.
      return null;
    }
    const body = await res.json();
    return body || null;
  } catch (e) {
    console.warn('[dispatch] fetchActiveDispatch failed:', e);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────
// AUTHENTICATED — admin creates, tech updates location, anyone marks done
// ──────────────────────────────────────────────────────────────────────

// Admin: create a new dispatch row. Returns the inserted row.
export async function createDispatch({
  submissionId,
  techId,
  techName,
  customerName,
  customerEmail,
  destinationLat,
  destinationLng,
  destinationLabel,
}) {
  const payload = {
    submission_id: submissionId || null,
    tech_id: techId,
    tech_name: techName || null,
    customer_name: customerName,
    customer_email: customerEmail || null,
    destination_lat: destinationLat != null ? Number(destinationLat) : null,
    destination_lng: destinationLng != null ? Number(destinationLng) : null,
    destination_label: destinationLabel || null,
    status: 'en_route',
  };
  const res = await fetch(SUPA_URL + '/rest/v1/active_dispatch', {
    method: 'POST',
    headers: { ...authHeaders(true), Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Create dispatch failed: HTTP ' + res.status + ' ' + t.slice(0, 200));
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// Tech: post a single location update. Updates tech_lat/lng/updated_at +
// optionally eta_seconds. RLS allows this only when tech_id = auth.uid().
export async function updateDispatchLocation(dispatchId, { lat, lng, etaSeconds }) {
  const body = {
    tech_lat: Number(lat),
    tech_lng: Number(lng),
    tech_updated_at: new Date().toISOString(),
  };
  if (etaSeconds != null) body.eta_seconds = Math.round(etaSeconds);
  const res = await fetch(SUPA_URL + '/rest/v1/active_dispatch?id=eq.' + dispatchId, {
    method: 'PATCH',
    headers: { ...authHeaders(true), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Update location failed: HTTP ' + res.status + ' ' + t.slice(0, 200));
  }
  return true;
}

// Tech or admin: flip status. Trigger sets ended_at automatically for
// arrived / completed / cancelled.
export async function setDispatchStatus(dispatchId, status) {
  const res = await fetch(SUPA_URL + '/rest/v1/active_dispatch?id=eq.' + dispatchId, {
    method: 'PATCH',
    headers: { ...authHeaders(true), Prefer: 'return=minimal' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Set status failed: HTTP ' + res.status + ' ' + t.slice(0, 200));
  }
  return true;
}

// Tech-side: fetch active dispatches belonging to the current tech.
// RLS limits results to tech_id = auth.uid(). Empty array if none.
export async function fetchMyActiveDispatches() {
  const url =
    SUPA_URL +
    '/rest/v1/active_dispatch?ended_at=is.null&select=*&order=started_at.desc';
  try {
    const res = await fetch(url, { headers: authHeaders(false) });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.warn('[dispatch] fetchMyActiveDispatches failed:', e);
    return [];
  }
}

// Admin: list all open dispatches across techs.
export async function fetchOpenDispatches() {
  const url =
    SUPA_URL +
    '/rest/v1/active_dispatch?ended_at=is.null&select=*&order=started_at.desc';
  try {
    const res = await fetch(url, { headers: authHeaders(false) });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.warn('[dispatch] fetchOpenDispatches failed:', e);
    return [];
  }
}

// Format an ETA in seconds as a human-friendly string. Used by both the
// customer page and the tech widget.
export function formatEta(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return 'less than a minute';
  if (seconds < 90) return 'about a minute';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return 'about ' + mins + ' minute' + (mins === 1 ? '' : 's');
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24)
    return (
      'about ' +
      hrs +
      ' hour' +
      (hrs === 1 ? '' : 's') +
      (remMins > 0 ? ' ' + remMins + ' min' : '')
    );
  return 'more than a day';
}

// Format the customer's "last updated" timestamp as a relative string.
export function formatRelativeTime(ts) {
  if (!ts) return null;
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + ' seconds ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' minute' + (m === 1 ? '' : 's') + ' ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
  return 'a while ago';
}

// Build a Mapbox Directions API URL for a driving ETA between two coords.
// Returns null if the token isn't set, so callers can fall back to
// straight-line distance.
export function mapboxDirectionsUrl(fromLat, fromLng, toLat, toLng) {
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (!token) return null;
  if (
    fromLat == null ||
    fromLng == null ||
    toLat == null ||
    toLng == null
  )
    return null;
  return (
    'https://api.mapbox.com/directions/v5/mapbox/driving/' +
    fromLng +
    ',' +
    fromLat +
    ';' +
    toLng +
    ',' +
    toLat +
    '?overview=false&access_token=' +
    encodeURIComponent(token)
  );
}

// Compute a straight-line distance in miles between two GPS coords. Used
// as a fallback when Mapbox isn't configured. Haversine formula.
export function distanceMiles(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 3958.8; // earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
