import { supabase } from './supabase.js';

// Get Supabase URL and key from the environment (injected by Vite)
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Helper: get auth token from localStorage
function getAuthToken() {
  const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
  if (!key) return null;
  try {
    return JSON.parse(localStorage.getItem(key))?.access_token;
  } catch {
    return null;
  }
}

// Direct REST API helper (bypasses supabase-js client to avoid Promise hang)
// 30-second timeout via AbortController to prevent save from stalling
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
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
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
  } catch {
    return 9136;
  }
}

export async function saveSubmission(formData, userId) {
  const {
    pmNumber, jobType, warrantyWork,
    customerName, truckNumber, locationName,
    customerContact, customerWorkOrder, typeOfWork,
    glCode, assetTag, workArea,
    date, startTime, departureTime, lastServiceDate,
    description, techs, equipment, parts,
    miles, costPerMile, laborHours, hourlyRate, billableTechs,
    arrestors, flares, heaters,
  } = formData;

  const partsTotal = (parts || []).reduce((sum, p) => sum + (p.price || 0) * (p.qty || 0), 0);
  const mileageTotal = parseFloat(miles || 0) * parseFloat(costPerMile || 1.50);
  const effectiveBillable = parseInt(billableTechs) || (techs || []).length;
  const laborTotal = warrantyWork ? 0 : parseFloat(laborHours || 0) * parseFloat(hourlyRate || 115.00) * effectiveBillable;

  // Only include columns that actually exist in the submissions table
  const payload = {
    created_by: userId,
    pm_number: pmNumber,
    status: 'submitted',
    template: 'flare_combustor',
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
    miles: parseFloat(miles || 0),
    labor_hours: parseFloat(laborHours || 0),
    // All other data goes in the JSONB data column
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
      lastServiceDate,
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
    },
  };

  const result = await supaRest('POST', 'submissions', payload);
  if (!result || result.length === 0) throw new Error('Save returned no data');
  return Array.isArray(result) ? result[0] : result;
}

export async function uploadPhotos(submissionId, photos, section = 'work') {
  if (!supabase) return [];
  const uploaded = [];
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    if (!photo.dataUrl && !photo.file) continue;
    try {
      let blob;
      if (photo.file instanceof Blob) {
        blob = photo.file;
      } else if (photo.dataUrl) {
        blob = await fetch(photo.dataUrl).then(r => r.blob());
      } else continue;

      const ext = blob.type === 'image/png' ? 'png' : 'jpg';
      const path = submissionId + '/' + section + '-' + i + '.' + ext;
      const { error: upErr } = await supabase.storage
        .from('submission-photos')
        .upload(path, blob, { contentType: blob.type, upsert: true });
      if (upErr) { console.warn('Upload err:', upErr); continue; }

      const token = getAuthToken();
      const headers = { 'apikey': SUPA_KEY, 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const metaRes = await fetch(SUPA_URL + '/rest/v1/photos', {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({
          submission_id: submissionId,
          storage_path: path,
          caption: photo.caption || '',
          display_order: i,
          section,
        }),
      });
      const metaText = await metaRes.text();
      if (metaRes.ok) uploaded.push(metaText ? JSON.parse(metaText)[0] : null);
    } catch (e) {
      console.warn('Photo upload error:', e);
    }
  }
  return uploaded;
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
    const data = await supaRest('GET', 'submissions?id=eq.' + id + '&select=*,photos(*)');
    return data && data.length > 0 ? data[0] : null;
  } catch (e) {
    console.error('Fetch submission error:', e);
    return null;
  }
}

// Alias for backward compatibility with ViewSubmissionPage
export async function fetchSubmission(id) {
  return fetchSubmissionById(id);
}

// Generate public URL for a photo in Supabase Storage
export function getPhotoUrl(storagePath) {
  if (!storagePath) return null;
  return SUPA_URL + '/storage/v1/object/public/submission-photos/' + storagePath;
}
