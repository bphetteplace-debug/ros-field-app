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
 * Build the PDF data object from a submission record.
 * getUrl must be a SYNCHRONOUS function: (storagePath: string) => string URL
 * buildPDFData is async so callers must await it.
 */
export async function buildPDFData(sub, getUrl) {
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

  // Cost calculations (read from top-level columns first, fall back to JSONB)
  const miles       = Number(sub.miles)         || 0;
    const mileageRate = Number(sub.cost_per_mile) || 0;
    const laborHours  = Number(sub.labor_hours)   || 0;
    const laborRate   = Number(sub.labor_rate)    || 0;
    const partsTotal  = Number(d.partsTotal)      || 0;
    const mileageTotal = miles * mileageRate;
    const laborTotal  = Number(d.laborTotal) || (laborHours * laborRate * (Number(d.billableTechs) || 1));
    const grandTotal  = Number(d.grandTotal) || partsTotal + mileageTotal + laborTotal;

  // Photos — resolve every storage_path to a real URL
  // getUrl MUST be a synchronous function (storagePath => string URL)
  const rawPhotos = Array.isArray(sub.photos) ? sub.photos : [];
    const photos = rawPhotos
      .filter(ph => ph && (ph.storage_path || ph.url))
      .map(ph => ({
              url:     ph.url || (getUrl ? getUrl(ph.storage_path) : ph.storage_path),
              caption: ph.caption || '',
              section: ph.section || '',
      }));

  // Parts — attach matching part photos to each part row
  const parts = (Array.isArray(d.parts) ? d.parts : []).map(p => {
        const qty   = Number(p.qty) || 1;
        const price = Number(p.price ?? p.unit_price ?? p.unitPrice) || 0;
        const sku   = String(p.sku || '');

                                                                // Part photos are stored with section = 'part-{sku}'
                                                                const partPhotos = sku
          ? photos.filter(ph => ph.section === ('part-' + sku) || (ph.section && ph.section.startsWith('part-' + sku)))
                                                                        : [];

                                                                return {
                                                                        sku,
                                                                        description: p.description || p.name || '',
                                                                        qty,
                                                                        unit_price:  fmtMoney(price),
                                                                        line_total:  fmtMoney(price * qty),
                                                                        photos:      partPhotos,
                                                                };
  });

  // Normalize job_type to display-name form
  const rawJobType = d.jobType || sub.template || '';
    const jobTypeDisplay =
          (rawJobType === 'PM' || rawJobType === 'pm_flare_combustor' || rawJobType.startsWith('pm'))
        ? 'PM'
            : (rawJobType === 'Service Call' || rawJobType === 'service_call') ? 'Service Call'
            : (rawJobType === 'Repair'       || rawJobType === 'repair')       ? 'Repair'
            : (rawJobType === 'Other'        || rawJobType === 'other')        ? 'Other'
            : rawJobType;

  // WO number shown top-right: always the 10000-series work_order
  const woNumber = String(sub.work_order || sub.pm_number || sub.id || '');

  return {
        wo_number:          woNumber,
        customer:           sub.customer_name || '',
        location:           sub.location_name || '',
        date_long:          fmtDateLong(sub.date),
        job_type:           jobTypeDisplay,
        truck_number:       sub.truck_number || '',
        type_of_work:       sub.work_type || '',
        start_time:         fmtTime(sub.start_time),
        departure_time:     fmtTime(sub.departure_time),
        asset_tag:          sub.asset_tag || d.assetTag || '',
        work_area:          sub.work_area || d.workArea || '',
        contact:            sub.contact   || d.customerContact || '',
        customer_wo_number: d.customerWorkOrder || sub.work_order || '',
        gl_code:            sub.gl_code   || d.glCode || '',
        last_service_date:  d.lastServiceDate || '',
        warranty_work:      d.warrantyWork || false,
        permits_required:   d.permitsRequired || [],
        technicians:        techNames,
        description_of_work: sub.summary || d.description || '',
        reported_issue:     d.reportedIssue || '',
        root_cause:         d.rootCause || '',
        equipment,
        parts,
        mileage_miles:      miles,
        mileage_rate:       String(mileageRate),
        labor_hours:        laborHours,
        labor_rate:         String(laborRate),
        tech_count:         techCount,
        cost_parts:         fmtMoney(partsTotal),
        cost_mileage:       fmtMoney(mileageTotal),
        cost_labor:         fmtMoney(laborTotal),
        cost_total:         fmtMoney(grandTotal),
        photos,
        arrestors:          Array.isArray(d.arrestors) ? d.arrestors : [],
        flares:             Array.isArray(d.flares)    ? d.flares    : [],
        heaters:            Array.isArray(d.heaters)   ? d.heaters   : [],
        sc_equipment:       Array.isArray(d.scEquipment) ? d.scEquipment : [],
        gps_lat:            d.gpsLat  || null,
        gps_lng:            d.gpsLng  || null,
        gps_accuracy:       d.gpsAccuracy || null,
        generated_at: new Date().toLocaleDateString('en-US', {
                month: 'long', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
        }),
  };
}
