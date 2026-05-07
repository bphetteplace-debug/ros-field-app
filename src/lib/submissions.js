import { supabase } from './supabase';

export async function getNextPmNumber() {
  const { data, error } = await supabase
    .from('submissions')
    .select('pm_number')
    .order('pm_number', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return 9136;
  return (data[0].pm_number || 9135) + 1;
}

export async function saveSubmission(formData, userId) {
  const {
    pmNumber, jobType, warrantyWork, customerName, truckNumber,
    locationName, customerContact, customerWorkOrder, typeOfWork,
    glCode, assetTag, workArea, date, startTime, departureTime,
    description, techs, equipment, parts, miles, costPerMile,
    laborHours, hourlyRate, billableTechs,
  } = formData;

  // parts should include {sku, name, qty, price}
  const partsTotal = (parts || []).reduce((sum, p) => sum + (p.price || 0) * (p.qty || 0), 0);
  const mileageTotal = parseFloat(miles || 0) * parseFloat(costPerMile || 1.34);
  const effectiveBillable = parseInt(billableTechs) || (techs || []).length;
  const laborTotal = warrantyWork ? 0 :
    parseFloat(laborHours || 0) * parseFloat(hourlyRate || 123.62) * effectiveBillable;

  // Insert without .select().single() to avoid RLS SELECT blocking the return
  const { error: insertError } = await supabase
    .from('submissions')
    .insert({
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
    });

  if (insertError) throw insertError;

  // Fetch the newly inserted submission (RLS SELECT should allow this since created_by = auth.uid())
  const { data, error: selectError } = await supabase
    .from('submissions')
    .select('*')
    .eq('created_by', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (selectError) throw selectError;
  return data;
}

export async function uploadPhotos(submissionId, photos, section = 'work') {
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
      await supabase.from('photos').insert({
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
  const { data } = supabase.storage
    .from('submission-photos')
    .getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function fetchSubmissions(userId) {
  const { data, error } = await supabase
    .from('submissions')
    .select('id, pm_number, work_type, customer_name, location_name, date, status, data, created_at, submitted_at')
    .eq('created_by', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchSubmission(id) {
  const { data, error } = await supabase
    .from('submissions')
    .select('*, photos (id, storage_path, caption, display_order, section)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
        }
