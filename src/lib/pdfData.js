// src/lib/pdfData.js
// Helpers to map a Supabase submission record to WorkOrderPDFData shape
// Used by DownloadPDFButton (client) and api/send-report.js (server)

export const fmtMoney = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);

export const fmtDateLong = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
};

export const fmtTime = (d) => {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{1,2}:\d{2}/.test(d)) return d.substring(0, 5);
  return new Date(d).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
};

/**
 * Maps a Supabase submission record to the WorkOrderPDFData shape.
 * @param {object} sub - Submission record from fetchSubmission()
 * @param {function} [getUrl] - Optional: getUrl(storagePath) => string
 * @returns {object} WorkOrderPDFData
 */
export function buildPDFData(sub, getUrl) {
  const d = sub.data || {};

  // Field technicians
  const techNames = Array.isArray(d.techs)
    ? d.techs.map(t => (typeof t === 'string' ? t : t.name || t.label || String(t)))
    : [];
  const techCount = Number(d.billableTechs) || techNames.length || 1;

  // Equipment list
  const equipment = [
    ...(Array.isArray(d.equipment) ? d.equipment : []),
    ...(Array.isArray(d.scEquipment) ? d.scEquipment : []),
  ].filter(Boolean);

  // Parts
  const parts = (Array.isArray(d.parts) ? d.parts : []).map(p => {
    const qty = Number(p.qty) || 1;
    const price = Number(p.price ?? p.unit_price ?? p.unitPrice) || 0;
    return {
      sku: String(p.sku || ''),
      description: p.description || p.name || '',
      qty,
      unit_price: fmtMoney(price),
      line_total: fmtMoney(price * qty),
    };
  });

  // Cost calculations
  const miles = Number(sub.miles) || 0;
  const mileageRate = Number(sub.cost_per_mile) || 0;
  const laborHours = Number(sub.labor_hours) || 0;
  const laborRate = Number(sub.labor_rate) || 0;

  const partsTotal = Number(d.partsTotal) || parts.reduce((s, p) => {
    const num = parseFloat((p.line_total || '0').replace(/[$,]/g, ''));
    return s + num;
  }, 0);
  const mileageTotal = Number(d.mileageTotal) || miles * mileageRate;
  const laborTotal = Number(d.laborTotal) || laborHours * laborRate * techCount;
  const grandTotal = Number(d.grandTotal) || partsTotal + mileageTotal + laborTotal;

  // Photos
  const photos = (Array.isArray(sub.photos) ? sub.photos : [])
    .filter(ph => ph && (ph.storage_path || ph.url))
    .map(ph => ({
      url: ph.url || (getUrl ? getUrl(ph.storage_path) : ph.storage_path),
      caption: ph.caption || ph.section || '',
    }));

  // WO number (pm_number is the job number in this schema)
  const woNumber = String(sub.pm_number || sub.work_order || sub.id || '').padStart(5, '0');

  return {
    wo_number: woNumber,
    customer: sub.customer_name || '',
    location: sub.location_name || '',
    date_long: fmtDateLong(sub.date),
    job_type: d.jobType || sub.template || '',
    truck_number: sub.truck_number || '',
    type_of_work: sub.work_type || '',
    start_time: fmtTime(sub.start_time),
    departure_time: fmtTime(sub.departure_time),
    asset_tag: sub.asset_tag || d.assetTag || '',
    work_area: sub.work_area || d.workArea || '',
    contact: sub.contact || d.customerContact || '',
        customer_wo_number: d.customerWorkOrder || sub.work_order || '',
    gl_code: sub.gl_code || d.glCode || '',
        last_service_date: d.lastServiceDate || '',
        warranty_work: d.warrantyWork || false,
        permits_required: d.permitsRequired || [],
    technicians: techNames,
    description_of_work: sub.summary || d.description || '',
        reported_issue: d.reportedIssue || '',
        root_cause: d.rootCause || '',
    equipment,
    parts,
    mileage_miles: miles,
    mileage_rate: String(mileageRate),
    labor_hours: laborHours,
    labor_rate: String(laborRate),
    tech_count: techCount,
    cost_parts: fmtMoney(partsTotal),
    cost_mileage: fmtMoney(mileageTotal),
    cost_labor: fmtMoney(laborTotal),
    cost_total: fmtMoney(grandTotal),
    photos,
        arrestors: Array.isArray(d.arrestors) ? d.arrestors : [],
        flares: Array.isArray(d.flares) ? d.flares : [],
        heaters: Array.isArray(d.heaters) ? d.heaters : [],
        sc_equipment: Array.isArray(d.scEquipment) ? d.scEquipment : [],
    generated_at: new Date().toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }),
  };
}
