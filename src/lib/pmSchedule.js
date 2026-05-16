// PM Schedule helpers — CRUD against pm_schedule_entries. Schema lives
// in supabase/pm_schedule.sql.
//
// Schema reminder:
//   customer, location_name, service_type, area, well_type,
//   latitude, longitude, assets, ticket_number, shut_in_date,
//   foreman, status, notes, date_completed,
//   submission_id, month_year, imported_from

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

// Canonical status set rendered in the dropdown. Free-text in the DB,
// but the UI nudges admins to these values for consistent filtering /
// dashboards.
export const PM_STATUSES = [
  'Needs Scheduling',
  'Scheduled PM',
  'Open',
  'Flex Schedule',
  'Delayed',
  'Canceled',
  'Completed',
];

export const PM_STATUS_STYLES = {
  'Needs Scheduling': { bg: '#fff7ed', fg: '#c2410c', dot: '#ea580c' },
  'Scheduled PM':     { bg: '#dbeafe', fg: '#1d4ed8', dot: '#2563eb' },
  'Open':             { bg: '#f1f5f9', fg: '#475569', dot: '#94a3b8' },
  'Flex Schedule':    { bg: '#ede9fe', fg: '#6d28d9', dot: '#7c3aed' },
  'Delayed':          { bg: '#fef2f2', fg: '#b91c1c', dot: '#dc2626' },
  'Canceled':         { bg: '#f1f5f9', fg: '#475569', dot: '#9ca3af' },
  'Completed':        { bg: '#ecfdf5', fg: '#047857', dot: '#10b981' },
};

// Fetch a page of schedule entries. Filters are all optional; pass any
// combination of customer / monthYear / status / foreman / search.
export async function fetchPmScheduleEntries({
  customer,
  monthYear,
  status,
  foreman,
  search,
  limit = 1000,
} = {}) {
  const parts = ['select=*', `limit=${limit}`, 'order=shut_in_date.asc.nullslast,location_name.asc'];
  if (customer) parts.push('customer=eq.' + encodeURIComponent(customer));
  if (monthYear) parts.push('month_year=eq.' + encodeURIComponent(monthYear));
  if (status) parts.push('status=eq.' + encodeURIComponent(status));
  if (foreman) parts.push('foreman=eq.' + encodeURIComponent(foreman));
  if (search) {
    const q = search.replace(/[(),]/g, ' ').trim();
    if (q) {
      // Postgres ilike via PostgREST: column=ilike.*term*
      parts.push('or=(location_name.ilike.*' + encodeURIComponent(q) + '*,notes.ilike.*' + encodeURIComponent(q) + '*,ticket_number.ilike.*' + encodeURIComponent(q) + '*)');
    }
  }
  const url = SUPA_URL + '/rest/v1/pm_schedule_entries?' + parts.join('&');
  const res = await fetch(url, { headers: authHeaders(false) });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Fetch PM schedule failed: HTTP ' + res.status + ' ' + t.slice(0, 200));
  }
  return await res.json();
}

// Fetch the customer list with entry counts (for the customer picker
// when more than one customer exists).
export async function fetchPmScheduleCustomers() {
  const url = SUPA_URL + '/rest/v1/pm_schedule_entries?select=customer';
  try {
    const res = await fetch(url, { headers: authHeaders(false) });
    if (!res.ok) return [];
    const rows = await res.json();
    const counts = new Map();
    for (const r of rows || []) {
      const c = (r.customer || '').trim();
      if (!c) continue;
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

function deriveMonthYear(shutInDate) {
  if (!shutInDate) return null;
  const s = String(shutInDate);
  // Accept '2026-05-07', '2026-05-07T00:00:00...', or Date objects
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return m[1] + '-' + m[2];
  return null;
}

export async function createPmScheduleEntry(entry) {
  const payload = {
    ...entry,
    month_year: entry.month_year || deriveMonthYear(entry.shut_in_date),
  };
  const res = await fetch(SUPA_URL + '/rest/v1/pm_schedule_entries', {
    method: 'POST',
    headers: { ...authHeaders(true), Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Create PM entry failed: HTTP ' + res.status + ' ' + t.slice(0, 200));
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function updatePmScheduleEntry(id, patch) {
  const body = { ...patch };
  if ('shut_in_date' in patch) body.month_year = deriveMonthYear(patch.shut_in_date);
  const res = await fetch(SUPA_URL + '/rest/v1/pm_schedule_entries?id=eq.' + id, {
    method: 'PATCH',
    headers: { ...authHeaders(true), Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Update PM entry failed: HTTP ' + res.status + ' ' + t.slice(0, 200));
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function deletePmScheduleEntry(id) {
  const res = await fetch(SUPA_URL + '/rest/v1/pm_schedule_entries?id=eq.' + id, {
    method: 'DELETE',
    headers: authHeaders(false),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Delete PM entry failed: HTTP ' + res.status + ' ' + t.slice(0, 200));
  }
  return true;
}
