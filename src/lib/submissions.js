// src/lib/submissions.js
// All Supabase calls use direct fetch() REST — supabase-js client hangs silently.
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Default lists used as fallback when settings table is not yet populated
export const DEFAULT_CUSTOMERS = ['Diamondback','High Peak Energy','ExTex','A8 Oilfield Services','Pristine Alliance','KOS'];
export const DEFAULT_TRUCKS = ['0001','0002','0003','0004','0005','0006','0007'];
export const DEFAULT_TECHS = ['Matthew Reid','Vladimir Rivero','Pedro Perez'];

// Helper: get auth token from localStorage
function getAuthToken() {
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
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await res.text();
    if (!res.ok) throw new Error(text || 'Request failed: ' + res.status);
    return text ? JSON.parse(text) : null;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('Save timed out after 30s - check connection');
    throw err;
  }
}

export async function getNextPmNumber() {
  try {
    const data = await supaRest('GET', 'submissions?select=pm_number&order=pm_number.desc&limit=1');
    if (!data || data.length === 0) return 9136;
    return (data[0].pm_number || 9135) + 1;
  } catch { return 9136; }
}

// ── SETTINGS ────────────────────────────────────────────────────────────────────────────
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
    method: 'POST', headers, body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || 'saveSettings failed: ' + res.status);
  return text ? JSON.parse(text) : null;
}

// ── SUBMISSIONS ──────────────────────────────────────────────────────────────────────
// templateOverride: pass 'expense_report' or 'daily_inspection' to override automatic template detection
export async function saveSubmission(formData, userId, templateOverride) {
  const {
    pmNumber, jobType, warrantyWork, customerName, truckNumber, locationName,
    customerContact, customerWorkOrder, typeOfWork, glCode, assetTag, workArea,
    date, startTime, departureTime, description, techs, equipment, parts,
    miles, costPerMile, laborHours, hourlyRate, billableTechs,
    arrestors, flares, heaters, scEquipment,
    // Expense Report fields
    expenseItems, expenseTotal,
    // Daily Inspection fields
    inspectionType, odometer, checkItems, failCount, allPass, defects,
  } = formData;

  const partsTotal = (parts || []).reduce((sum, p) => sum + (p.price || 0) * (p.qty || 0), 0);
  const mileageTotal = parseFloat(miles || 0) * parseFloat(costPerMile || 1.50);
  const effectiveBillable = parseInt(billableTechs) || (techs || []).length;
  const laborTotal = warrantyWork ? 0 : parseFloat(laborHours || 0) * parseFloat(hourlyRate || 115.00) * effectiveBillable;

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
    pm_number: pmNumber || null,
    status: 'submitted',
    template,
    customer_name: customerName,
    truck_number: truckNumber,
    location_name: locationName,
    contact: customerContact,
    work_order: customerWorkOrder,
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
    labor_hours: parseFloat(laborHours || 0),
    labor_rate: parseFloat(hourlyRate || 0),
    data: {
      jobType,
      warrantyWork,
      techs,
      equipment,
      parts,
      miles,
      costPerMile,
      laborHours,
      hourlyRate,
      billableTechs: effectiveBillable,
      description,
      glCode,
      assetTag,
      workArea,
      startTime,
      departureTime,
      typeOfWork,
      customerWorkOrder,
      customerContact,
      partsTotal,
      mileageTotal,
      laborTotal,
      grandTotal: warrantyWork ? 0 : partsTotal + mileageTotal + laborTotal,
      arrestors: jobType === 'PM' ? (arrestors || []) : [],
      flares: jobType === 'PM' ? (flares || []) : [],
      heaters: jobType === 'PM' ? (heaters || []) : [],
      scEquipment: jobType === 'Service Call' ? (scEquipment || []) : [],
      // Expense Report fields
      expenseItems: expenseItems || [],
      expenseTotal: expenseTotal || 0,
      // Daily Inspection fields
      inspectionType: inspectionType || null,
      odometer: odometer || null,
      checkItems: checkItems || [],
      failCount: failCount || 0,
      allPass: allPass !== undefined ? allPass : true,
      defects: defects || '',
    },
  };

  const result = await supaRest('POST', 'submissions', payload);
  if (!result || result.length === 0) throw new Error('Save returned no data');
  return Array.isArray(result) ? result[0] : result;
}

// ── OFFLINE QUEUE ──────────────────────────────────────────────────────────────────────
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

// ── PHOTOS ──────────────────────────────────────────────────────────────────────────────
export async function uploadPhotos(submissionId, photos, section = 'work') {
  const uploaded = [];
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    if (!photo.dataUrl && !photo.file) continue;
    try {
      let blob;
      if (photo.file instanceof Blob) { blob = photo.file; }
      else if (photo.dataUrl) { blob = await fetch(photo.dataUrl).then(r => r.blob()); }
      else continue;
      const ext = blob.type === 'image/png' ? 'png' : 'jpg';
      const path = submissionId + '/' + section + '-' + i + '.' + ext;
      const token = getAuthToken();
      const storageHeaders = { 'apikey': SUPA_KEY, 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'true' };
      if (token) storageHeaders['Authorization'] = 'Bearer ' + token;
      const upRes = await fetch(SUPA_URL + '/storage/v1/object/submission-photos/' + path, { method: 'POST', headers: storageHeaders, body: blob });
      if (!upRes.ok) { console.warn('Upload err:', await upRes.text()); continue; }
      const metaHeaders = { 'apikey': SUPA_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
      if (token) metaHeaders['Authorization'] = 'Bearer ' + token;
      const metaRes = await fetch(SUPA_URL + '/rest/v1/photos', {
        method: 'POST', headers: metaHeaders,
        body: JSON.stringify({ submission_id: submissionId, storage_path: path, caption: photo.caption || '', display_order: i, section }),
      });
      const metaText = await metaRes.text();
      if (metaRes.ok) uploaded.push(metaText ? JSON.parse(metaText)[0] : null);
    } catch (e) { console.warn('Photo upload error:', e); }
  }
  return uploaded;
}

export async function fetchSubmissions(userId) {
  try {
    const data = await supaRest('GET', 'submissions?select=*&order=created_at.desc&created_by=eq.' + userId);
    return data || [];
  } catch (e) { console.error('Fetch submissions error:', e); return []; }
}

export async function fetchSubmissionById(id) {
  try {
    const data = await supaRest('GET', 'submissions?id=eq.' + id + '&select=*,photos(*)');
    return data && data.length > 0 ? data[0] : null;
  } catch (e) { console.error('Fetch submission error:', e); return null; }
}

export async function fetchSubmission(id) { return fetchSubmissionById(id); }

export function getPhotoUrl(storagePath) {
  if (!storagePath) return null;
  return SUPA_URL + '/storage/v1/object/public/submission-photos/' + storagePath;
}

export async function fetchAllSubmissions() {
  try {
    const data = await supaRest('GET', 'submissions?select=*,profiles!submissions_created_by_fkey(full_name)&order=created_at.desc');
    return data || [];
  } catch (e) { console.error('Fetch all submissions error:', e); return []; }
}

// ── STATUS UPDATE ──────────────────────────────────────────────────────────────────────
export async function updateSubmissionStatus(id, status) {
  return supaRest('PATCH', 'submissions?id=eq.' + id, { status, updated_at: new Date().toISOString() })
}

// ── DELETE SUBMISSION ──────────────────────────────────────────────────────────────────
export async function deleteSubmission(id) {
  try { await supaRest('DELETE', 'photos?submission_id=eq.' + id) } catch(e) {}
  return supaRest('DELETE', 'submissions?id=eq.' + id)
}

// ── UPDATE (EDIT) SUBMISSION ────────────────────────────────────────────────────────────────
export async function updateSubmission(id, formData) {
  const {
    jobType, warrantyWork, customerName, truckNumber, locationName,
    customerContact, customerWorkOrder, typeOfWork, glCode, assetTag, workArea,
    date, startTime, departureTime, lastServiceDate, description, techs, equipment,
    parts, miles, costPerMile, laborHours, hourlyRate, billableTechs,
    arrestors, flares, heaters, scEquipment,
  } = formData
  const partsTotal = (parts||[]).reduce((s,p)=>s+(p.price||0)*(p.qty||0),0)
  const mileageTotal = parseFloat(miles||0)*parseFloat(costPerMile||1.50)
  const effBill = parseInt(billableTechs)||(techs||[]).length
  const laborTotal = warrantyWork ? 0 : parseFloat(laborHours||0)*parseFloat(hourlyRate||115)*effBill
  const grandTotal = warrantyWork ? 0 : partsTotal+mileageTotal+laborTotal
  return supaRest('PATCH', 'submissions?id=eq.' + id, {
    customer_name: customerName,
    truck_number: truckNumber,
    location_name: locationName,
    contact: customerContact,
    work_order: customerWorkOrder,
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
    labor_hours: parseFloat(laborHours||0),
    labor_rate: parseFloat(hourlyRate||115),
    updated_at: new Date().toISOString(),
    data: {
      jobType, warrantyWork, techs, equipment, parts, miles, costPerMile, laborHours, hourlyRate,
      billableTechs: effBill, description, glCode, assetTag, workArea, startTime, departureTime,
      typeOfWork, lastServiceDate, customerWorkOrder, customerContact,
      partsTotal, mileageTotal, laborTotal, grandTotal,
      arrestors: jobType==='PM' ? (arrestors||[]) : [],
      flares: jobType==='PM' ? (flares||[]) : [],
      heaters: jobType==='PM' ? (heaters||[]) : [],
      scEquipment: jobType==='Service Call' ? (scEquipment||[]) : [],
    },
  })
}
