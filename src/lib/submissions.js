// src/lib/submissions.js
// All Supabase calls use direct fetch() REST — supabase-js client hangs silently.

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Helper: get auth token from localStorage
function getAuthToken() {
  const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
  if (!key) return null;
  try { return JSON.parse(localStorage.getItem(key))?.access_token; } catch { return null; }
}

// Direct REST API helper (bypasses supabase-js to avoid Promise hang)
// 30-second timeout via AbortController
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
    pmNumber, jobType, warrantyWork, customerName, truckNumber,
    locationName, customerContact, customerWorkOrder, typeOfWork,
    glCode, assetTag, workArea, date, startTime, departureTime,
    description, techs, equipment, parts, miles, costPerMile,
    laborHours, hourlyRate, billableTechs,
    arrestors, flares, heaters,
  } = formData;

  const partsTotal = (parts || []).reduce((sum, p) => sum + (p.price || 0) * (p.qty || 0), 0);
  const mileageTotal = parseFloat(miles || 0) * parseFloat(costPerMile || 1.50);
  const effectiveBillable = parseInt(billableTechs) || (techs || []).length;
  const laborTotal = warrantyWork ? 0 : parseFloat(laborHours || 0) * parseFloat(hourlyRate || 115.00) * effectiveBillable;

  // Only send columns that actually exist in the DB schema.
  // Extra fields (parts detail, totals, techs, equipment) go in data JSONB.
  const payload = {
    created_by: userId,
    pm_number: pmNumber,
    status: 'submitted',
    template: jobType === 'PM' ? 'pm_flare_combustor' : 'service_call',
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
    cost_per_mile: parseFloat(costPerMile || 1.50),
    labor_hours: parseFloat(laborHours || 0),
    labor_rate: parseFloat(hourlyRate || 115.00),
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
    },
  };

  const result = await supaRest('POST', 'submissions', payload);
  if (!result || result.length === 0) throw new Error('Save returned no data');
  return Array.isArray(result) ? result[0] : result;
}

export async function uploadPhotos(submissionId, photos, section = 'work') {
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

      // Use direct fetch() to storage REST — never supabase-js .storage which hangs
      const token = getAuthToken();
      const storageHeaders = {
        'apikey': SUPA_KEY,
        'Content-Type': blob.type || 'image/jpeg',
        'x-upsert': 'true',
      };
      if (token) storageHeaders['Authorization'] = 'Bearer ' + token;

      const upRes = await fetch(SUPA_URL + '/storage/v1/object/submission-photos/' + path, {
        method: 'POST',
        headers: storageHeaders,
        body: blob,
      });
      if (!upRes.ok) {
        const errText = await upRes.text();
        console.warn('Upload err:', errText);
        continue;
      }

      // Store photo metadata
      const metaHeaders = {
        'apikey': SUPA_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      };
      if (token) metaHeaders['Authorization'] = 'Bearer ' + token;

      const metaRes = await fetch(SUPA_URL + '/rest/v1/photos', {
        method: 'POST',
        headers: metaHeaders,
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


// Fetch ALL submissions (admin only) — no user filter
export async function fetchAllSubmissions() {
  try {
    const data = await supaRest('GET', 'submissions?select=*,profiles(full_name)&order=created_at.desc');
    return data || [];
  } catch (e) {
    console.error('Fetch all submissions error:', e);
    return [];
  }
}
