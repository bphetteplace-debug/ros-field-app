// src/lib/submissions.js
// All Supabase calls use direct fetch() REST — supabase-js client hangs silently.
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Default lists used as fallback when settings table is not yet populated
export const DEFAULT_CUSTOMERS = ['Diamondback','High Peak Energy','ExTex','A8 Oilfield Services','Pristine Alliance','KOS'];
export const DEFAULT_TRUCKS = ['0001','0002','0003','0004','0005','0006','0007'];
export const DEFAULT_TECHS = ['Matthew Reid','Vladimir Rivero','Pedro Perez'];
// Round labor hours to the nearest 0.25 increment so quarter-hour
// billing is preserved exactly on save. Techs sometimes type 3.3 or
// 3.8 by habit (the HTML5 step=0.25 input is a soft constraint they
// can bypass); this normalizes to 3.25 / 3.75 before the row reaches
// Postgres, keeping labor totals consistent with how the techs and
// customers expect them to be billed.
export function roundQuarter(n) {
  const num = parseFloat(n);
  if (!isFinite(num)) return 0;
  return Math.round(num * 4) / 4;
}

// Helper: get auth token from localStorage. Exported so other modules
// can avoid duplicating the same prefix/suffix lookup pattern.
export function getAuthToken() {
  const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
  if (!key) return null;
  try { return JSON.parse(localStorage.getItem(key))?.access_token; } catch { return null; }
}

// Direct REST API helper (bypasses supabase-js to avoid Promise hang)
async function supaRest(method, path, body) {
  const token = getAuthToken();
  const headers = {
    'apikey': SUPA_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(SUPA_URL + '/rest/v1/' + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await res.text();
    if (!res.ok) {
      // Don't surface raw PostgREST error bodies in toasts — they leak
      // column names, constraint names, and hints. Log for debug, but
      // throw a clean caller-friendly message. Preserve the Postgres
      // SQLSTATE so saveSubmission's 23505 retry check still works.
      console.warn('[supaRest] ' + method + ' ' + path.split('?')[0] + ' failed:', res.status, (text || '').slice(0, 400));
      let code = '';
      try { const j = JSON.parse(text || '{}'); code = j.code || j.error_code || ''; } catch (_e) {}
      if (code === '23505' || /23505|duplicate key/i.test(text || '')) {
        throw new Error('23505 — duplicate key');
      }
      throw new Error('Request failed (HTTP ' + res.status + ')');
    }
    return text ? JSON.parse(text) : null;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('Save timed out after 30s - check connection');
    throw err;
  }
}

// PM number is no longer a separate counter. Every submission's pm_number is
// the same numeric value as its wo_number (claimed atomically from wo_counter
// via claim_next_wo_number). saveSubmission below derives pm_number from the
// wo_number claim; FormPage claims wo_number once and uses it for both display
// fields. The legacy getNextPmNumber export was removed in May 2026 when the
// 91xx PM range was retired in favour of the unified 10000+ pool.

// ── WORK ORDER NUMBER ── shared counter across ALL form types, never repeats, starts at 10000
// work_order is stored as a numeric string e.g. "10001" — we parse to int to find the max
export async function getNextWoNumber() {
  try {
    // Use atomic DB counter — claims a number instantly, before form is submitted
    // Two techs opening forms simultaneously will always get different numbers
    const result = await supaRest('POST', 'rpc/claim_next_wo_number', {});
    const num = typeof result === 'number' ? result : (result && result.claim_next_wo_number);
    if (typeof num === 'number' && num >= 10000) return num;
    return 10000;
  } catch {
    return 10000;
  }
}

// ── SETTINGS ────────────────────────────────────────────────────────────────────────
export async function fetchSettings() {
  try {
    const data = await supaRest('GET', 'app_settings?select=key,value');
    if (!data || data.length === 0) return null;
    const out = {};
    for (const row of data) out[row.key] = row.value;
    return out;
  } catch (e) {
    console.warn('fetchSettings failed (table may not exist yet):', e.message);
    return null;
  }
}

export async function saveSettings(key, value) {
  const token = getAuthToken();
  const headers = {
    'apikey': SUPA_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation,resolution=merge-duplicates',
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(SUPA_URL + '/rest/v1/app_settings?on_conflict=key', {
    method: 'POST', headers,
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || 'saveSettings failed: ' + res.status);
  return text ? JSON.parse(text) : null;
}

// ── CUSTOMER CONTACTS ──────────────────────────────────────────────────────────
// Address book of named people at each customer. Used to populate the
// searchable dropdown when admin starts a customer-tracking dispatch.
// Seeded with the 83 Diamondback Energy contacts owner imported 2026-05-16;
// these are the bootstrap defaults shown when app_settings.customer_contacts
// has not yet been saved. Once the admin edits + saves anything, the
// stored list takes over completely.
export const DEFAULT_CUSTOMER_CONTACTS = [
  { customer: 'Diamondback', name: 'Angel Aguilera', email: 'aaguilera@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Ashley Castaneda', email: 'acastaneda@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Andy Chalker', email: 'achalker@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Adolfo Chavez', email: 'achavez@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Billy Brookshire', email: 'bbrookshire@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Bill Nall', email: 'bnall@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Brandon Thompson', email: 'bthompson2@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Britni Thompson (DeBusk)', email: 'bthompson3@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Brian Watt', email: 'bwatt@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Banny Wiebe', email: 'bwiebe@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Chris Alvarado', email: 'calvarado@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Christopher Cain', email: 'ccain1@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Callie Marsh', email: 'cmarsh@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Chris Mendoza', email: 'cmendoza@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Christopher Mercer', email: 'cmercer1@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'CMMS System', email: 'CMMS@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Cody Palk', email: 'cpalk@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Cory Sullivan', email: 'csullivan@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Dalton Gray', email: 'dgray@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Delfino Martinez', email: 'dmartinez3@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Daniel Valenzuela', email: 'dvalenzuela@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Darryl Williams', email: 'dwilliams@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Edson Dominguez', email: 'edominguez@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Electrical Dispatch (Group)', email: 'electricaldispatch@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Eduardo Lujan', email: 'elujan@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Eric Smith', email: 'esmith@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Fernando DeHoyos', email: 'fdehoyos@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Fabian Lujan', email: 'flujan@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Gary Cain', email: 'gcain1@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Israel De La Cruz', email: 'idelacruz1@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'I&E Spanish Trails (Group)', email: 'IESpanishTrails@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Josh Barrera', email: 'jbarrera@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Joshua Carson', email: 'jcarson@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Jason Fletcher', email: 'jfletcher@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Joel Gaona', email: 'jgaona1@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Jake Harrison', email: 'jharrison@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Joe Keeler', email: 'jkeeler@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Jimmy Martin', email: 'jmartin3@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Jesse Melendez', email: 'jmelendez1@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Joshua Pallanes', email: 'jpallanes@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Jose Villarreal', email: 'jvillarreal@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Kendall Goodwin', email: 'kgoodwin@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Kenneth Hall', email: 'khall@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Kyle Jordan', email: 'kjordan@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Kendall White', email: 'kwhite@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Mark Allcorn', email: 'mallcorn@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Mauro Barraza', email: 'mbarraza@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Michelle Fuller', email: 'mfuller@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Mark Glenn', email: 'mglenn@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Marlon Hale', email: 'mhale@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Mike Hewtty', email: 'mhewtty@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Matt Jackson', email: 'mjackson@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Michael Mitchell', email: 'mmitchell2@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Mark Ramos', email: 'mramos@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Marco Rodriguez', email: 'mrodriguez@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Mark Vasquez', email: 'mvasquez@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Nolan Box', email: 'nbox@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Nathaniel Cody', email: 'ncody@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Noel Quinonez-Ruiz', email: 'nquinonezruiz@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Obed Infante', email: 'oinfante@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Oscar Valverde', email: 'ovalverde@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Patricia Rendon', email: 'prendon@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Robert Flores', email: 'rflores2@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Robert Heater', email: 'rheater@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Rigoberto Hernandez', email: 'rhernandez2@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Robert Gonzalez', email: 'rgonzalez1@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Roy McNutt', email: 'rmcnutt@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Raul Melgoza', email: 'rmelgoza@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Richard Onzures', email: 'ronzures@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Regan Raines', email: 'rraines@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Ryan Ray', email: 'rray@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Robert Salisbury', email: 'rsalisbury@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Raymond Sanchez', email: 'rsanchez2@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Luke Stroud', email: 'rstroud@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Stephen Mitchell', email: 'smitchell@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Steven Salcedo', email: 'ssalcedo@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Timothy Bernal', email: 'tbernal@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Ty Fisher', email: 'tfisher@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Ty Froman', email: 'tfroman@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Taylor Smith', email: 'tsmith@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Veronica Gardea', email: 'vgardea@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Victoria Taylor', email: 'vtaylor@diamondbackenergy.com' },
  { customer: 'Diamondback', name: 'Will Miller', email: 'wmiller@diamondbackenergy.com' },
];

function normalizeContacts(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const c of arr) {
    if (!c || typeof c !== 'object') continue;
    const email = String(c.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({
      customer: String(c.customer || '').trim(),
      name: String(c.name || '').trim(),
      email,
    });
  }
  return out.sort((a, b) =>
    (a.customer || '').localeCompare(b.customer || '') ||
    (a.name || '').localeCompare(b.name || '')
  );
}

export async function getCustomerContacts() {
  const all = await fetchSettings();
  const stored = all && Array.isArray(all.customer_contacts) ? all.customer_contacts : null;
  if (stored && stored.length) return normalizeContacts(stored);
  return normalizeContacts(DEFAULT_CUSTOMER_CONTACTS);
}

export async function saveCustomerContacts(arr) {
  return saveSettings('customer_contacts', normalizeContacts(arr));
}

// Parse a pasted CSV blob into contact entries. Accepts either
// "email,name" or "name,email" columns; auto-detects which is which by
// checking which column contains '@'. Header line is skipped if present.
export function parseContactsCsv(text, customerLabel) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    // Split on comma or tab, strip surrounding quotes per field
    const cols = line.split(/[,\t]/).map(s => s.trim().replace(/^["']|["']$/g, ''));
    if (cols.length < 1) continue;
    let email = '';
    let name = '';
    if (cols.length === 1) {
      if (cols[0].includes('@')) email = cols[0];
      else continue;
    } else {
      const emailIdx = cols.findIndex(c => c.includes('@'));
      if (emailIdx === -1) continue; // header or junk row
      email = cols[emailIdx];
      name = cols.find((c, i) => i !== emailIdx && c) || '';
    }
    out.push({ customer: (customerLabel || '').trim(), name, email });
  }
  return normalizeContacts(out);
}

// ── AUDIT LOG ────────────────────────────────────────────────────────────────────
// Records sensitive admin actions (status changes, deletes, etc.) to a
// dedicated audit_log table. Failure is swallowed silently — we never want
// audit logging to block the real admin action.
export async function logAudit({ userId, userName, action, targetType, targetId, details }) {
  try {
    await supaRest('POST', 'audit_log', {
      user_id: userId,
      user_name: userName,
      action,
      target_type: targetType,
      target_id: targetId ? String(targetId) : null,
      details: details || null,
    });
  } catch (e) {
    console.warn('audit log write failed:', e.message || e);
  }
}

// ── SHARE LINKS ─────────────────────────────────────────────────────────────────
// Each submission can have a stable random share_token. Admin generates one
// (idempotent — if the row already has a token we reuse it), then anyone with
// the URL can view the submission read-only via the public RPC below.
export async function ensureShareToken(submission) {
  if (submission?.share_token) return submission.share_token;
  if (!submission?.id) throw new Error('Cannot create share link — missing submission id');
  const token = (window.crypto && typeof window.crypto.randomUUID === 'function')
    ? window.crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const updated = await supaRest('PATCH', 'submissions?id=eq.' + encodeURIComponent(submission.id), { share_token: token });
  const row = Array.isArray(updated) ? updated[0] : updated;
  return row?.share_token || token;
}

// Public read of a shared submission — no auth needed; calls the SECURITY
// DEFINER RPC get_shared_submission which gates on the random token.
export async function fetchSharedSubmission(token) {
  if (!token) throw new Error('Missing share token');
  const res = await fetch(SUPA_URL + '/rest/v1/rpc/get_shared_submission', {
    method: 'POST',
    headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Share link not found or expired' + (text ? ': ' + text : ''));
  }
  const payload = await res.json();
  if (!payload || !payload.submission) throw new Error('Share link not found');
  return payload;
}

export async function fetchAuditLog(limit = 200) {
  try {
    const data = await supaRest('GET', 'audit_log?select=*&order=created_at.desc&limit=' + limit);
    return data || [];
  } catch (e) {
    console.warn('fetchAuditLog failed:', e.message || e);
    return [];
  }
}

// ── JOB ASSIGNMENT ───────────────────────────────────────────────────────────────
// Admin creates a draft submission pre-assigned to a tech. The tech then opens
// /edit/:id, fills in remaining details, and submits via the normal flow.
// created_by is set to the tech's user id so EditSubmissionPage's
// canEdit = isAdmin || sub.created_by === user.id check lets the tech edit it.
export async function createAssignedSubmission({
  assignedToUserId,
  assignedByUserId,
  assignedByName,
  customerName,
  locationName,
  customerWorkOrder,
  workType,
  description,
  dueDate,
  jobType,
}) {
  if (!assignedToUserId) throw new Error('assignedToUserId required');
  if (!customerName) throw new Error('customerName required');
  if (!customerWorkOrder) throw new Error('customerWorkOrder required');
  const effectiveJobType = jobType === 'PM' ? 'PM' : 'Service Call';
  const template = effectiveJobType === 'PM' ? 'pm_flare_combustor' : 'service_call';
  const wo = String(await getNextWoNumber());
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    created_by: assignedToUserId,
    pm_number: parseInt(wo, 10),
    status: 'draft',
    template,
    customer_name: customerName,
    location_name: locationName || '',
    work_order: wo,
    work_type: workType || '',
    summary: description || '',
    date: dueDate || today,
    start_time: null,
    departure_time: null,
    miles: 0,
    cost_per_mile: 0,
    labor_hours: 0,
    labor_rate: 0,
    data: {
      jobType: effectiveJobType,
      customerWorkOrder,
      assignedBy: assignedByUserId || null,
      assignedByName: assignedByName || null,
      assignedAt: new Date().toISOString(),
      dueDate: dueDate || null,
      description: description || '',
    },
  };
  const result = await supaRest('POST', 'submissions', payload);
  if (Array.isArray(result) && result.length === 0) throw new Error('Assignment insert returned no row');
  return Array.isArray(result) ? result[0] : result;
}

// ── SUBMISSIONS ────────────────────────────────────────────────────────────────────
// templateOverride: pass 'expense_report' or 'daily_inspection' to override automatic template detection
export async function saveSubmission(formData, userId, templateOverride) {
  const {
    pmNumber, jobType, warrantyWork, customerName, truckNumber, locationName,
    customerContact, customerWorkOrder, woNumber, typeOfWork, glCode, assetTag, workArea,
    date, startTime, departureTime, description, techs, equipment, parts,
    miles, costPerMile, laborHours, hourlyRate, billableTechs,
    arrestors, flares, heaters, scEquipment,
            reportedIssue, rootCause, lastServiceDate, permitsRequired,
    // Expense Report fields
    expenseItems, expenseTotal,
    // Daily Inspection fields
    inspectionType, odometer, checkItems, failCount, allPass, defects,
    // GPS location
    gpsLat, gpsLng, gpsAccuracy,
    jhaSteps, jhaPPE, jhaEmergencyContact, jhaNearestHospital,
    jhaMeetingPoint, jhaAdditionalHazards, jhaCrewMembers, jhaSupervisor, jhaHighRiskCount,
  } = formData;

  // Work order: use the auto-generated one passed in from the form (customerWorkOrder is now numeric)
  // If somehow empty (e.g. offline queue fallback), generate a fresh one
  const effectiveWoNumber = woNumber || String(await getNextWoNumber());

  // pm_number is unified with wo_number — single sequential identifier across PM + SC
  const effectivePmNumber = pmNumber || parseInt(effectiveWoNumber, 10);

  const partsTotal = (parts || []).reduce((sum, p) => sum + (p.price || 0) * (p.qty || 0), 0);
  const mileageTotal = parseFloat(miles || 0) * parseFloat(costPerMile || 1.50);
  const effectiveBillable = parseInt(billableTechs) || (techs || []).length;
  const roundedLaborHours = roundQuarter(laborHours);
  const laborTotal = warrantyWork ? 0 : roundedLaborHours * parseFloat(hourlyRate || 115.00) * effectiveBillable;

  // Determine template
  let template;
  if (templateOverride) {
    template = templateOverride;
  } else if (jobType === 'PM') {
    template = 'pm_flare_combustor';
  } else if (jobType === 'Service Call') {
    template = 'service_call';
  } else if (jobType === 'Expense Report') {
    template = 'expense_report';
  } else if (jobType === 'Daily Inspection') {
    template = 'daily_inspection';
  } else {
    template = 'service_call';
  }

  const payload = {
    created_by: userId,
    pm_number: effectivePmNumber,
    status: 'submitted',
    template,
    customer_name: customerName,
    truck_number: truckNumber,
    location_name: locationName,
    contact: customerContact,
    work_order: effectiveWoNumber,
    work_type: typeOfWork,
    gl_code: glCode,
    asset_tag: assetTag,
    work_area: workArea,
    date,
    start_time: startTime || null,
    departure_time: departureTime || null,
    summary: description,
    miles: parseFloat(miles || 0),
    cost_per_mile: parseFloat(costPerMile || 0),
    labor_hours: roundedLaborHours,
    labor_rate: parseFloat(hourlyRate || 0),
    data: {
      jobType, warrantyWork, techs, equipment, parts, miles, costPerMile,
      laborHours: roundedLaborHours, hourlyRate, billableTechs: effectiveBillable, description,
      glCode, assetTag, workArea, startTime, departureTime, typeOfWork,
      customerWorkOrder: customerWorkOrder || '', customerContact,
      partsTotal, mileageTotal, laborTotal,
      grandTotal: warrantyWork ? 0 : partsTotal + mileageTotal + laborTotal,
      arrestors: jobType === 'PM' ? (arrestors || []) : [],
      flares: jobType === 'PM' ? (flares || []) : [],
      heaters: jobType === 'PM' ? (heaters || []) : [],
      scEquipment: ['Service Call','Repair','Other'].includes(jobType) ? (scEquipment || []) : [],
      reportedIssue: reportedIssue || '',
                  rootCause: rootCause || '',
                  lastServiceDate: lastServiceDate || '',
                  permitsRequired: permitsRequired || [],
      expenseItems: expenseItems || [],
      expenseTotal: expenseTotal || 0,
      // Daily Inspection fields
      inspectionType: inspectionType || null,
      odometer: odometer || null,
      checkItems: checkItems || [],
      failCount: failCount || 0,
      allPass: allPass !== undefined ? allPass : true,
      defects: defects || '',
      // GPS location
      gpsLat: gpsLat || null,
      gpsLng: gpsLng || null,
      gpsAccuracy: gpsAccuracy || null,
      // JHA-specific fields (stored in data JSONB)
      jhaSteps: jhaSteps || [],
      jhaPPE: jhaPPE || [],
      jhaEmergencyContact: jhaEmergencyContact || '',
      jhaNearestHospital: jhaNearestHospital || '',
      jhaMeetingPoint: jhaMeetingPoint || '',
      jhaAdditionalHazards: jhaAdditionalHazards || '',
      jhaCrewMembers: jhaCrewMembers || '',
      jhaSupervisor: jhaSupervisor || '',
      jhaHighRiskCount: jhaHighRiskCount || 0,
    },
  };

  // Retry on duplicate-key error (23505): if the unique constraint on pm_number
  // ever fires, claim a fresh wo_number, update both pm_number + work_order, retry.
  // Up to 3 attempts so a brief race or counter drift doesn't reach the tech.
  let result;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      result = await supaRest('POST', 'submissions', payload);
      break;
    } catch (e) {
      lastError = e;
      const msg = (e && e.message) ? e.message : String(e);
      if (!msg.includes('23505') && !msg.includes('duplicate key')) throw e;
      const freshWo = String(await getNextWoNumber());
      payload.work_order = freshWo;
      payload.pm_number = parseInt(freshWo, 10);
      if (payload.data && payload.data.customerWorkOrder) {
        payload.data.customerWorkOrder = freshWo;
      }
      console.warn('submission INSERT hit duplicate key, retrying with fresh wo_number ' + freshWo + ' (attempt ' + (attempt + 2) + ' of 3)');
    }
  }
  if (!result) throw lastError || new Error('Save failed after 3 attempts');
  if (Array.isArray(result) && result.length === 0) throw new Error('Save returned no data');
  return Array.isArray(result) ? result[0] : result;
}

// ── OFFLINE QUEUE ────────────────────────────────────────────────────────────────
const IDB_NAME = 'ros-offline';
const IDB_STORE = 'queue';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function queueOfflineSubmission(payload) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).add({ ...payload, queuedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

export async function getOfflineQueue() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function removeFromOfflineQueue(id) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

// — PHOTOS ————————————————————————————————————————————————————————————
export async function uploadPhotos(submissionId, photosOrObj, sectionOrOpts, maybeOpts) {
    // Optional progress callback: pass either as the `section` slot (for the
    // object/entries forms where section param isn't used) or as a 4th arg.
    // Called after each photo with { uploaded, failed, total } so the UI can
    // show "Uploading 5 of 21…" instead of a silent 30-second spinner.
    var section = (typeof sectionOrOpts === 'string') ? sectionOrOpts : undefined;
    var opts = (sectionOrOpts && typeof sectionOrOpts === 'object') ? sectionOrOpts : (maybeOpts || {});
    var onProgress = (opts && typeof opts.onProgress === 'function') ? opts.onProgress : null;
    if (!submissionId) return { rows: [], uploaded: 0, failed: 0, total: 0, failedEntries: [] };

    // Normalize input. Accepts:
    //  1. Array of {file/dataUrl, caption}     (legacy: section param applies to all, order = index)
    //  2. { sectionKey: [{file/dataUrl, ...}] } (object form: order = array index per section)
    //  3. Array of {photo, section, order}     (entries-already-normalized form, used by retries
    //                                           so we can preserve the ORIGINAL order index for
    //                                           failed photos and avoid storage-path collisions
    //                                           or duplicate metadata rows)
    const entries = [];
    if (Array.isArray(photosOrObj) && photosOrObj.length > 0
        && photosOrObj[0] && typeof photosOrObj[0] === 'object'
        && 'photo' in photosOrObj[0] && 'section' in photosOrObj[0] && 'order' in photosOrObj[0]) {
          for (const e of photosOrObj) entries.push({ photo: e.photo, section: e.section, order: e.order });
    } else if (Array.isArray(photosOrObj)) {
          const sec = section || 'work';
          photosOrObj.forEach((p, i) => entries.push({ photo: p, section: sec, order: i }));
    } else if (photosOrObj && typeof photosOrObj === 'object') {
          for (const [sec, arr] of Object.entries(photosOrObj)) {
                  if (!Array.isArray(arr)) continue;
                  arr.forEach((p, i) => entries.push({ photo: p, section: sec, order: i }));
          }
    }

    if (entries.length === 0) return { rows: [], uploaded: 0, failed: 0, total: 0, failedEntries: [] };

    const token = getAuthToken();
    const storageBase = SUPA_URL + '/storage/v1/object/submission-photos/';
    const restBase    = SUPA_URL + '/rest/v1/photos';

    // Convert a single entry to a Blob
    async function entryToBlob(photo) {
          if (photo.file instanceof Blob) return photo.file;
          if (photo.dataUrl && typeof photo.dataUrl === 'string' && photo.dataUrl.startsWith('data:')) {
                  const res = await fetch(photo.dataUrl);
                  return res.blob();
          }
          return null;
    }

    // Upload one entry; returns { ok: true, row } on success or { ok: false, reason } on failure.
    // Retries up to 3 times on network/5xx errors. 4xx responses are treated as terminal.
    async function uploadOne(entry) {
          const { photo, section: sec, order } = entry;
          if (!photo) return { ok: false, reason: 'no photo' };

          let blob;
          try {
                  blob = await entryToBlob(photo);
          } catch (e) {
                  console.warn('[uploadPhotos] blob conversion failed for section=' + sec + ' order=' + order + ':', e);
                  return { ok: false, reason: 'blob conversion' };
          }

          if (!blob || blob.size === 0) {
                  console.warn('[uploadPhotos] empty blob for section=' + sec + ' order=' + order);
                  return { ok: false, reason: 'empty blob' };
          }

          const ext =
                  blob.type === 'image/png'         ? 'png'  :
                  blob.type === 'image/webp'        ? 'webp' :
                  blob.type === 'video/mp4'         ? 'mp4'  :
                  blob.type === 'video/webm'        ? 'webm' :
                  blob.type === 'video/quicktime'   ? 'mov'  :
                  (blob.type && blob.type.startsWith('video/')) ? 'mp4' :
                  'jpg';

          const path = submissionId + '/' + sec + '-' + order + '.' + ext;

          const storageHeaders = {
                  'apikey':       SUPA_KEY,
                  'Content-Type': blob.type || 'image/jpeg',
                  'x-upsert':     'true',
          };
          if (token) storageHeaders['Authorization'] = 'Bearer ' + token;

          // Storage upload with retries on network errors and 5xx
          let storageOk = false;
          for (let attempt = 1; attempt <= 3 && !storageOk; attempt++) {
                  try {
                          const upRes = await fetch(storageBase + path, {
                                  method: 'POST', headers: storageHeaders, body: blob,
                          });
                          if (upRes.ok) { storageOk = true; break; }
                          // 4xx is terminal (auth, payload too large, etc.) — don't retry
                          if (upRes.status >= 400 && upRes.status < 500) {
                                  const errText = await upRes.text().catch(() => String(upRes.status));
                                  console.warn('[uploadPhotos] storage ' + upRes.status + ' (terminal) section=' + sec + ' order=' + order + ':', errText);
                                  return { ok: false, reason: 'storage ' + upRes.status };
                          }
                          console.warn('[uploadPhotos] storage ' + upRes.status + ' attempt ' + attempt + '/3 section=' + sec + ' order=' + order);
                  } catch (e) {
                          console.warn('[uploadPhotos] storage network error attempt ' + attempt + '/3 section=' + sec + ' order=' + order + ':', e);
                  }
                  if (!storageOk && attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
          }
          if (!storageOk) return { ok: false, reason: 'storage upload exhausted retries' };

          const metaHeaders = {
                  'apikey':        SUPA_KEY,
                  'Content-Type':  'application/json',
                  'Prefer':        'return=representation',
          };
          if (token) metaHeaders['Authorization'] = 'Bearer ' + token;
          const metaBody = JSON.stringify({
                  submission_id: submissionId,
                  storage_path:  path,
                  caption:       photo.caption || '',
                  display_order: order,
                  section:       sec,
          });

          // Metadata insert with retries on network errors and 5xx
          for (let attempt = 1; attempt <= 3; attempt++) {
                  try {
                          const metaRes = await fetch(restBase, { method: 'POST', headers: metaHeaders, body: metaBody });
                          const metaText = await metaRes.text().catch(() => '');
                          if (metaRes.ok) {
                                  try {
                                          const parsed = metaText ? JSON.parse(metaText) : null;
                                          return { ok: true, row: Array.isArray(parsed) ? parsed[0] : parsed };
                                  } catch (_e) {
                                          return { ok: true, row: { storage_path: path, caption: photo.caption || '', section: sec } };
                                  }
                          }
                          if (metaRes.status >= 400 && metaRes.status < 500) {
                                  console.warn('[uploadPhotos] metadata ' + metaRes.status + ' (terminal):', metaText);
                                  // File is in storage but metadata insert was rejected — orphan
                                  return { ok: false, reason: 'metadata ' + metaRes.status, orphanPath: path };
                          }
                          console.warn('[uploadPhotos] metadata ' + metaRes.status + ' attempt ' + attempt + '/3:', metaText);
                  } catch (e) {
                          console.warn('[uploadPhotos] metadata network error attempt ' + attempt + '/3:', e);
                  }
                  if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
          }
          return { ok: false, reason: 'metadata insert exhausted retries', orphanPath: path };
    }

    // Upload in parallel batches of 3 — gentle enough for cell connections
    // while still being faster than serial.
    const BATCH = 3;
    const rows = [];
    const failedEntries = [];
    let uploaded = 0;
    let failed = 0;
    for (let i = 0; i < entries.length; i += BATCH) {
          const batch = entries.slice(i, i + BATCH);
          const batchResults = await Promise.all(batch.map(uploadOne));
          for (let j = 0; j < batchResults.length; j++) {
                  const r = batchResults[j];
                  if (r && r.ok) { uploaded++; if (r.row) rows.push(r.row); }
                  else { failed++; failedEntries.push(batch[j]); }
          }
          if (onProgress) { try { onProgress({ uploaded, failed, total: entries.length }); } catch (_e) {} }
    }

    return { rows, uploaded, failed, total: entries.length, failedEntries };
}
export async function fetchSubmissions(userId) {
  try {
    const data = await supaRest('GET', 'submissions?select=*&order=created_at.desc&created_by=eq.' + userId);
    return data || [];
  } catch (e) {
    console.error('Fetch submissions error:', e);
    return [];
  }
}

export async function fetchSubmissionById(id) {
  try {
    const data = await supaRest('GET', 'submissions?id=eq.' + encodeURIComponent(id) + '&select=*,photos(*)');
    return data && data.length > 0 ? data[0] : null;
  } catch (e) {
    console.error('Fetch submission error:', e);
    return null;
  }
}

export async function fetchSubmission(id) {
  return fetchSubmissionById(id);
}

// Lookup the most recent prior PM/SC submission for a (customer, location)
// pair. Used by FormPage's "Copy from last visit" smart-fill chip — tech
// enters the same site they've been to before, we offer to pre-fill the
// service-type, parts, equipment, and foreman from the previous job.
// Returns { id, date, template, pm_number, data } or null.
export async function fetchLastVisit(customerName, locationName) {
  if (!customerName || !locationName) return null;
  try {
    const customer = encodeURIComponent(String(customerName).trim());
    const location = encodeURIComponent(String(locationName).trim());
    const data = await supaRest(
      'GET',
      'submissions?customer_name=eq.' + customer +
      '&location_name=eq.' + location +
      '&template=in.(pm_flare_combustor,service_call)' +
      '&order=date.desc,created_at.desc' +
      '&limit=1' +
      '&select=id,date,template,work_type,pm_number,data'
    );
    return Array.isArray(data) && data[0] ? data[0] : null;
  } catch (e) {
    console.warn('[fetchLastVisit] failed:', e?.message || e);
    return null;
  }
}

export function getPhotoUrl(storagePath) {
  if (!storagePath) return null;
  return SUPA_URL + '/storage/v1/object/public/submission-photos/' + storagePath;
}

export async function fetchAllSubmissions() {
  try {
    const data = await supaRest('GET', 'submissions?select=*,profiles!submissions_created_by_fkey(full_name)&order=created_at.desc');
    return data || [];
  } catch (e) {
    console.error('Fetch all submissions error:', e);
    return [];
  }
}

// ── STATUS UPDATE ────────────────────────────────────────────────────────────────
export async function updateSubmissionStatus(id, status) {
  return supaRest('PATCH', 'submissions?id=eq.' + encodeURIComponent(id), { status, updated_at: new Date().toISOString() })
}

// ── DELETE SUBMISSION ────────────────────────────────────────────────────────────
export async function deleteSubmission(id) {
  try { await supaRest('DELETE', 'photos?submission_id=eq.' + encodeURIComponent(id)) } catch(e) {}
  return supaRest('DELETE', 'submissions?id=eq.' + encodeURIComponent(id))
}

// ── UPDATE (EDIT) SUBMISSION ─────────────────────────────────────────────────────
export async function updateSubmission(id, formData) {
  const {
    jobType, warrantyWork, customerName, truckNumber, locationName,
    customerContact, customerWorkOrder, typeOfWork, glCode, assetTag, workArea,
    date, startTime, departureTime, lastServiceDate, description, techs, equipment,
    parts, miles, costPerMile, laborHours, hourlyRate, billableTechs,
            arrestors, flares, heaters, scEquipment,
            reportedIssue, rootCause, permitsRequired,
  } = formData
  const effBill = parseInt(billableTechs)||(techs||[]).length
  const partsTotal = (parts || []).reduce((sum, p) => sum + (p.price || 0) * (p.qty || 0), 0)
  const mileageTotal = parseFloat(miles || 0) * parseFloat(costPerMile || 1.50)
  const roundedLaborHours = roundQuarter(laborHours)
  const laborTotal = warrantyWork ? 0 : roundedLaborHours*parseFloat(hourlyRate||115)*effBill
  const grandTotal = warrantyWork ? 0 : partsTotal+mileageTotal+laborTotal

  // Preserve office-side fields on data JSONB that aren't form-controlled
  // (billing fields: dbWoNumber, foreman, approvedDate, paidDate,
  // paidReference, paymentTerms, billable, nonBillableReason; import
  // tags: importedFrom; any future office-only key). Read existing
  // first then merge form fields on top so the form wins for anything
  // it controls but never clobbers what it doesn't.
  let existingData = {}
  try {
    const rows = await supaRest('GET', 'submissions?id=eq.' + encodeURIComponent(id) + '&select=data')
    if (Array.isArray(rows) && rows[0] && rows[0].data) existingData = rows[0].data
  } catch {
    // If the read fails we still want the write to succeed — at worst
    // we lose the billing-side preservation for this edit.
  }

  return supaRest('PATCH', 'submissions?id=eq.' + encodeURIComponent(id), {
    customer_name: customerName,
    truck_number: truckNumber,
    location_name: locationName,
    contact: customerContact,
    work_type: typeOfWork,
    gl_code: glCode,
    asset_tag: assetTag,
    work_area: workArea,
    date,
    start_time: startTime,
    departure_time: departureTime,
    summary: description,
    miles: parseFloat(miles||0),
    cost_per_mile: parseFloat(costPerMile||1.50),
    labor_hours: roundedLaborHours,
    labor_rate: parseFloat(hourlyRate||115),
    updated_at: new Date().toISOString(),
    data: {
      ...existingData,
      jobType, warrantyWork, techs, equipment, parts, miles, costPerMile,
      laborHours: roundedLaborHours, hourlyRate, billableTechs: effBill, description,
      glCode, assetTag, workArea, startTime, departureTime, typeOfWork, lastServiceDate,
      customerWorkOrder, customerContact,
      partsTotal, mileageTotal, laborTotal, grandTotal,
      arrestors: jobType==='PM' ? (arrestors||[]) : [],
      flares: jobType==='PM' ? (flares||[]) : [],
      heaters: jobType==='PM' ? (heaters||[]) : [],
      scEquipment: ['Service Call','Repair','Other'].includes(jobType) ? (scEquipment||[]) : [],
            reportedIssue: reportedIssue || '',
            rootCause: rootCause || '',
            lastServiceDate: lastServiceDate || '',
            permitsRequired: permitsRequired || [],
    },
  })
}

// ── FINALIZE ASSIGNED DRAFT ──────────────────────────────────────────────────
// Tech opens an admin-assigned draft via /form?resume=:id, fills it out, and
// submits via the normal FormPage flow. Mirrors saveSubmission's payload
// shape but PATCHes the existing row (preserving the pre-claimed pm_number
// and work_order) and flips status to 'submitted'. data.assignedBy /
// assignedByName / assignedAt / dueDate ride through underneath so the audit
// trail of "this was an admin-assigned job" stays on the row forever.
export async function finalizeAssignedDraft(id, formData, templateOverride) {
  const {
    jobType, warrantyWork, customerName, truckNumber, locationName,
    customerContact, customerWorkOrder, typeOfWork, glCode, assetTag, workArea,
    date, startTime, departureTime, description, techs, equipment, parts,
    miles, costPerMile, laborHours, hourlyRate, billableTechs,
    arrestors, flares, heaters, scEquipment,
    reportedIssue, rootCause, lastServiceDate, permitsRequired,
    gpsLat, gpsLng, gpsAccuracy,
  } = formData;

  const partsTotal = (parts || []).reduce((sum, p) => sum + (p.price || 0) * (p.qty || 0), 0);
  const mileageTotal = parseFloat(miles || 0) * parseFloat(costPerMile || 1.50);
  const effectiveBillable = parseInt(billableTechs) || (techs || []).length;
  const roundedLaborHours = roundQuarter(laborHours);
  const laborTotal = warrantyWork ? 0 : roundedLaborHours * parseFloat(hourlyRate || 115.00) * effectiveBillable;
  const grandTotal = warrantyWork ? 0 : partsTotal + mileageTotal + laborTotal;

  let template;
  if (templateOverride) {
    template = templateOverride;
  } else if (jobType === 'PM') {
    template = 'pm_flare_combustor';
  } else if (jobType === 'Service Call') {
    template = 'service_call';
  } else {
    template = 'service_call';
  }

  // Pull existing data first so assignment audit fields + any office-side
  // billing fields the admin stamped on don't get clobbered by the spread.
  let existingData = {};
  try {
    const rows = await supaRest('GET', 'submissions?id=eq.' + encodeURIComponent(id) + '&select=data');
    if (Array.isArray(rows) && rows[0] && rows[0].data) existingData = rows[0].data;
  } catch (_e) {}

  const result = await supaRest('PATCH', 'submissions?id=eq.' + encodeURIComponent(id), {
    status: 'submitted',
    template,
    customer_name: customerName,
    truck_number: truckNumber,
    location_name: locationName,
    contact: customerContact,
    work_type: typeOfWork,
    gl_code: glCode,
    asset_tag: assetTag,
    work_area: workArea,
    date,
    start_time: startTime || null,
    departure_time: departureTime || null,
    summary: description,
    miles: parseFloat(miles || 0),
    cost_per_mile: parseFloat(costPerMile || 0),
    labor_hours: roundedLaborHours,
    labor_rate: parseFloat(hourlyRate || 0),
    updated_at: new Date().toISOString(),
    data: {
      ...existingData,
      jobType, warrantyWork, techs, equipment, parts, miles, costPerMile,
      laborHours: roundedLaborHours, hourlyRate, billableTechs: effectiveBillable, description,
      glCode, assetTag, workArea, startTime, departureTime, typeOfWork,
      customerWorkOrder: customerWorkOrder || '', customerContact,
      partsTotal, mileageTotal, laborTotal, grandTotal,
      arrestors: jobType === 'PM' ? (arrestors || []) : [],
      flares: jobType === 'PM' ? (flares || []) : [],
      heaters: jobType === 'PM' ? (heaters || []) : [],
      scEquipment: ['Service Call', 'Repair', 'Other'].includes(jobType) ? (scEquipment || []) : [],
      reportedIssue: reportedIssue || '',
      rootCause: rootCause || '',
      lastServiceDate: lastServiceDate || '',
      permitsRequired: permitsRequired || [],
      gpsLat: gpsLat || null,
      gpsLng: gpsLng || null,
      gpsAccuracy: gpsAccuracy || null,
    },
  });
  if (Array.isArray(result) && result.length === 0) throw new Error('Finalize returned no row');
  return Array.isArray(result) ? result[0] : result;
}

// ── PARTS CATALOG ────────────────────────────────────────────────────────────
export async function fetchPartsCatalog() {
  try {
    const data = await supaRest('GET', 'parts_catalog?order=category.asc,description.asc')
    return data || []
  } catch(e) {
    console.error('fetchPartsCatalog error:', e)
    return []
  }
}

export async function addPart({ code, description, price, category }) {
  const r = await fetch('/api/parts-catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getAuthToken() || '') },
    body: JSON.stringify({ code: code||'', description, price: parseFloat(price)||0, category: category||'' })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
}

export async function deletePart(id) {
  const r = await fetch('/api/parts-catalog', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getAuthToken() || '') },
    body: JSON.stringify({ id })
  });
  if (!r.ok) {
    const data = await r.json().catch(()=>({}));
    throw new Error(JSON.stringify(data));
  }
}

export async function updatePart(id, { code, description, price, category }) {
  const r = await fetch('/api/parts-catalog', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getAuthToken() || '') },
    body: JSON.stringify({ id, code: code||'', description, price: parseFloat(price)||0, category: category||'' })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
}
