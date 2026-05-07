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
async function supaRest(method, path, body) {
  const token = getAuthToken();
  const headers = {
    'apikey': SUPA_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(SUPA_URL + '/rest/v1/' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || 'Request failed: ' + res.status);
  return text ? JSON.parse(text) : null;
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
    pmNumber, jobType, warrantyWork, customerName, truckNumber,
    locationName, customerContact, customerWorkOrder, typeOfWork,
    glCode, assetTag, workArea, date, startTime, departureTime,
    description, techs, equipment, parts, miles, costPerMile,
    laborHours, hourlyRate, billableTechs,
  } = formData;

  const partsTotal = (parts || []).reduce((sum, p) => sum + (p.price || 0) * (p.qty || 0), 0);
  const mileageTotal = parseFloat(miles || 0) * parseFloat(costPerMile || 1.34);
  const effectiveBillable = parseInt(billableTechs) || (techs || []).length;
  const laborTotal = warrantyWork ? 0 :
    parseFloat(laborHours || 0) * parseFloat(hourlyRate || 123.62) * effectiveBillable;

  const payload = {
    created_by: userId,
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
    date: date,
    start_time: startTime,
    departure_time: departureTime,
    summary: description,
    miles: parseFloat(miles || 0),
    cost_per_mile: parseFloat(costPerMile || 1.34),
    labor_hours: parseFloat(laborHours || 0),
    labor_rate: parseFloat(hourlyRate || 123.62),
    submitted_at: new Date().toISOString(),
    data: {
      job_type: jobType,
      warranty_work: warrantyWork,
      techs,
      equipment,
      parts,
      billable_techs: effectiveBillable,
      parts_total: partsTotal,
      mileage_total: mileageTotal,
      labor_total: laborTotal,
      grand_total: warrantyWork ? 0 : partsTotal + mileageTotal + laborTotal,
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
    if (!photo.dataUrl) continue;
    try {
      const res = await fetch(photo.dataUrl);
      const blob = await res.blob();
      const ext = blob.type.includes('png') ? 'png' : 'jpg';
      const path = `${submissionId}/${section}-${i}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('submission-photos')
        .upload(path, blob, { contentType: blob.type, upsert: true });
      if (uploadError) { console.error('Upload error:', uploadError); continue; }
      await supaRest('POST', 'photos', {
        submission_id: submissionId,
        section,
        storage_path: path,
        caption: photo.caption || '',
        display_order: uploaded.length,
      });
      uploaded.push(path);
    } catch (err) {
      console.error('Photo error:', err);
    }
  }
  return uploaded;
}

export function getPhotoUrl(storagePath) {
  if (!supabase) return '';
  const { data } = supabase.storage
    .from('submission-photos')
    .getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function fetchSubmissions(userId) {
  const data = await supaRest('GET',
    'submissions?select=id,pm_number,work_type,customer_name,location_name,date,status,data,created_at,submitted_at' +
    '&created_by=eq.' + userId +
    '&order=created_at.desc'
  );
  return data || [];
}

export async function fetchSubmission(id) {
  const data = await supaRest('GET',
    'submissions?select=*,photos(id,storage_path,caption,display_order,section)&id=eq.' + id
  );
  if (!data || data.length === 0) throw new Error('Submission not found');
  return data[0];
                                          }
