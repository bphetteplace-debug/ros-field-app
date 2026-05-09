// api/send-report.js - Vercel Serverless Function (CommonJS via api/package.json)
// Sends HTML email with PDF attachment via Resend
// pdf-lib is lazy-loaded inside handler to avoid Lambda crash
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const TO = process.env.EMAIL_TO ? process.env.EMAIL_TO.split(',').map(e => e.trim()) : ['bphetteplace@reliableoilfieldservices.net'];
const FROM = process.env.RESEND_FROM || 'ReliableTrack <reports@reliable-oilfield-services.com>';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { submissionId } = req.body || {};
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' });
  if (!RESEND_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY' });
  if (!SUPA_KEY) return res.status(500).json({ error: 'Missing Supabase key' });

  try {
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

    // Fetch submission + photos
    const subRes = await fetch(
      SUPA_URL + '/rest/v1/submissions?id=eq.' + submissionId + '&select=*,photos(id,storage_path,caption,display_order,section)',
      { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }
    );
    if (!subRes.ok) {
      const txt = await subRes.text();
      return res.status(500).json({ error: 'Supabase fetch failed: ' + txt });
    }
    const rows = await subRes.json();
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Submission not found' });
    const sub = rows[0];
    const d = sub.data || {};
    const photos = sub.photos || [];
    const template = sub.template || 'service_call';

    // Route to appropriate handler
    if (template === 'expense_report') {
      return await sendExpenseReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts);
    }
    if (template === 'daily_inspection') {
      return await sendInspectionReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts);
    }
    // Default: PM or SC
    return await sendPmScReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts);

  } catch (err) {
    console.error('send-report error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ── HELPERS ──────────────────────────────────────────────────────────────
function fmt(n) { return '$' + parseFloat(n || 0).toFixed(2); }
function fmtDate(s) { if (!s) return ''; try { return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return s; } }

async function fetchPhotoBytes(storagePath) {
  try {
    const r = await fetch(SUPA_URL + '/storage/v1/object/public/submission-photos/' + storagePath);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return new Uint8Array(buf);
  } catch { return null; }
}

async function embedPhotosOnPage(pdfDoc, page, photos, section, rgb, maxW, startY) {
  const sectionPhotos = photos.filter(p => p.section === section || (!p.section && section === 'work'));
  let y = startY;
  for (const photo of sectionPhotos.slice(0, 6)) {
    if (y < 80) break;
    const bytes = await fetchPhotoBytes(photo.storage_path);
    if (!bytes) continue;
    try {
      const ext = (photo.storage_path || '').split('.').pop().toLowerCase();
      const img = ext === 'png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      const scale = Math.min(maxW / img.width, 120 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: 50, y: y - h, width: w, height: h });
      y -= (h + 10);
    } catch { /* skip bad photo */ }
  }
  return y;
}

// ── PM / SC REPORT ───────────────────────────────────────────────────────
async function sendPmScReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts) {
  const isPM = sub.template === 'pm_flare_combustor';
  const pmNum = sub.pm_number || '';
  const label = isPM ? 'PM #' + pmNum : 'SC #' + pmNum;
  const techs = Array.isArray(d.techs) ? d.techs : [];
  const parts = Array.isArray(d.parts) ? d.parts : [];
  const arrestors = Array.isArray(d.arrestors) ? d.arrestors : [];
  const flares = Array.isArray(d.flares) ? d.flares : [];
  const heaters = Array.isArray(d.heaters) ? d.heaters : [];
  const scEquipment = Array.isArray(d.scEquipment) ? d.scEquipment : [];
  const partsTotal = parseFloat(d.partsTotal || 0);
  const mileageTotal = parseFloat(d.mileageTotal || 0);
  const laborTotal = parseFloat(d.laborTotal || 0);
  const grandTotal = parseFloat(d.grandTotal || 0);

  // ── Build PDF ────────────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const NAVY = rgb(0.063, 0.149, 0.290);
  const ORANGE = rgb(0.937, 0.400, 0.000);
  const WHITE = rgb(1, 1, 1);
  const GRAY = rgb(0.5, 0.5, 0.5);
  const LGRAY = rgb(0.95, 0.95, 0.95);

  function addPage(doc) {
    const pg = doc.addPage([612, 792]);
    // Header bar
    pg.drawRectangle({ x: 0, y: 742, width: 612, height: 50, color: NAVY });
    // Logo circle
    pg.drawCircle({ x: 35, y: 767, size: 18, color: ORANGE });
    pg.drawText('R', { x: 29, y: 761, size: 14, font: boldFont, color: WHITE });
    pg.drawText('ReliableTrack', { x: 58, y: 762, size: 14, font: boldFont, color: WHITE });
    pg.drawText('Reliable Oilfield Services', { x: 58, y: 750, size: 8, font: regFont, color: rgb(0.7, 0.7, 0.7) });
    // Orange accent line
    pg.drawRectangle({ x: 0, y: 740, width: 612, height: 2, color: ORANGE });
    return pg;
  }

  const page = addPage(pdfDoc);
  let y = 725;

  function drawField(label, value, x, fieldY, w) {
    page.drawText(label, { x, y: fieldY + 13, size: 7, font: regFont, color: GRAY });
    page.drawRectangle({ x, y: fieldY, width: w, height: 14, color: LGRAY });
    page.drawText(String(value || ''), { x: x + 3, y: fieldY + 3, size: 9, font: regFont, color: NAVY });
  }

  // Title
  page.drawText(label + ' - ' + (isPM ? 'Preventive Maintenance' : 'Service Call'), { x: 50, y, size: 16, font: boldFont, color: NAVY });
  y -= 12;
  page.drawRectangle({ x: 50, y, width: 512, height: 2, color: ORANGE });
  y -= 20;

  // Job info row 1
  drawField('Customer', sub.customer_name, 50, y, 180);
  drawField('Location', sub.location_name, 240, y, 180);
  drawField('Date', fmtDate(sub.date), 430, y, 130);
  y -= 32;
  drawField('Contact', sub.contact, 50, y, 130);
  drawField('Work Order', sub.work_order, 190, y, 130);
  drawField('Type of Work', sub.work_type, 330, y, 120);
  drawField('Truck', sub.truck_number, 460, y, 100);
  y -= 32;
  drawField('GL Code', sub.gl_code, 50, y, 120);
  drawField('Asset Tag', sub.asset_tag, 180, y, 120);
  drawField('Work Area', sub.work_area, 310, y, 120);
  drawField('Techs', techs.join(', '), 440, y, 120);
  y -= 32;

  // Warranty badge
  if (d.warrantyWork) {
    page.drawRectangle({ x: 50, y: y - 2, width: 110, height: 16, color: rgb(0.2, 0.6, 0.2) });
    page.drawText('WARRANTY - NO CHARGE', { x: 54, y: y + 1, size: 8, font: boldFont, color: WHITE });
    y -= 26;
  }

  // Description
  page.drawText('WORK DESCRIPTION', { x: 50, y, size: 9, font: boldFont, color: NAVY });
  y -= 14;
  page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 2, color: ORANGE });
  y -= 14;
  const desc = String(sub.summary || d.description || '');
  const words = desc.split(' ');
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (test.length > 90) {
      page.drawText(line, { x: 50, y, size: 9, font: regFont, color: rgb(0.2, 0.2, 0.2) });
      y -= 13;
      line = word;
      if (y < 150) break;
    } else {
      line = test;
    }
  }
  if (line) { page.drawText(line, { x: 50, y, size: 9, font: regFont, color: rgb(0.2, 0.2, 0.2) }); y -= 13; }
  y -= 10;

  // Parts table
  if (parts.length > 0) {
    page.drawText('PARTS & MATERIALS', { x: 50, y, size: 9, font: boldFont, color: NAVY });
    y -= 14;
    page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 2, color: ORANGE });
    y -= 4;
    // Table header
    page.drawRectangle({ x: 50, y: y - 14, width: 512, height: 16, color: NAVY });
    page.drawText('SKU', { x: 54, y: y - 11, size: 8, font: boldFont, color: WHITE });
    page.drawText('Description', { x: 130, y: y - 11, size: 8, font: boldFont, color: WHITE });
    page.drawText('Qty', { x: 430, y: y - 11, size: 8, font: boldFont, color: WHITE });
    page.drawText('Unit Price', { x: 460, y: y - 11, size: 8, font: boldFont, color: WHITE });
    page.drawText('Total', { x: 530, y: y - 11, size: 8, font: boldFont, color: WHITE });
    y -= 18;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (y < 80) break;
      if (i % 2 === 1) page.drawRectangle({ x: 50, y: y - 12, width: 512, height: 14, color: LGRAY });
      page.drawText(String(p.sku || ''), { x: 54, y: y - 9, size: 8, font: regFont, color: rgb(0.2,0.2,0.2) });
      const descStr = String(p.description || p.name || '').substring(0, 50);
      page.drawText(descStr, { x: 130, y: y - 9, size: 8, font: regFont, color: rgb(0.2,0.2,0.2) });
      page.drawText(String(p.qty || 1), { x: 430, y: y - 9, size: 8, font: regFont, color: rgb(0.2,0.2,0.2) });
      page.drawText(fmt(p.price), { x: 460, y: y - 9, size: 8, font: regFont, color: rgb(0.2,0.2,0.2) });
      page.drawText(fmt((p.price || 0) * (p.qty || 1)), { x: 530, y: y - 9, size: 8, font: regFont, color: rgb(0.2,0.2,0.2) });
      y -= 14;
    }
    y -= 6;
  }

  // PM Equipment sections
  if (isPM) {
    if (arrestors.length > 0) {
      if (y < 100) { const pg2 = addPage(pdfDoc); y = 720; }
      page.drawText('ARRESTORS', { x: 50, y, size: 9, font: boldFont, color: NAVY });
      y -= 14;
      page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 2, color: ORANGE });
      y -= 14;
      for (const a of arrestors) {
        if (y < 80) break;
        page.drawText(String(a.id || '') + ' - ' + String(a.notes || ''), { x: 54, y, size: 8, font: regFont, color: rgb(0.2,0.2,0.2) });
        y -= 12;
      }
      y -= 6;
    }
    if (flares.length > 0) {
      if (y < 100) { const pg2 = addPage(pdfDoc); y = 720; }
      page.drawText('FLARES', { x: 50, y, size: 9, font: boldFont, color: NAVY });
      y -= 14;
      page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 2, color: ORANGE });
      y -= 14;
      for (const f of flares) {
        if (y < 80) break;
        const fts = Array.isArray(f.flareTypes) ? f.flareTypes : [];
        page.drawText(String(f.id || '') + ' - ' + fts.join(', ') + ' ' + String(f.notes || ''), { x: 54, y, size: 8, font: regFont, color: rgb(0.2,0.2,0.2) });
        y -= 12;
      }
      y -= 6;
    }
    if (heaters.length > 0) {
      if (y < 100) { const pg2 = addPage(pdfDoc); y = 720; }
      page.drawText('HEATERS / OTHER', { x: 50, y, size: 9, font: boldFont, color: NAVY });
      y -= 14;
      page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 2, color: ORANGE });
      y -= 14;
      for (const h of heaters) {
        if (y < 80) break;
        page.drawText(String(h.id || '') + ' - ' + String(h.type || '') + ' ' + String(h.notes || ''), { x: 54, y, size: 8, font: regFont, color: rgb(0.2,0.2,0.2) });
        y -= 12;
      }
      y -= 6;
    }
  } else {
    // SC Equipment
    if (scEquipment.length > 0) {
      if (y < 100) { const pg2 = addPage(pdfDoc); y = 720; }
      page.drawText('EQUIPMENT SERVICED', { x: 50, y, size: 9, font: boldFont, color: NAVY });
      y -= 14;
      page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 2, color: ORANGE });
      y -= 14;
      for (const e of scEquipment) {
        if (y < 80) break;
        page.drawText(String(e.type || '') + (e.notes ? ': ' + String(e.notes) : ''), { x: 54, y, size: 8, font: regFont, color: rgb(0.2,0.2,0.2) });
        y -= 12;
      }
      y -= 6;
    }
  }

  // Cost summary
  if (y < 140) { const pg2 = addPage(pdfDoc); y = 720; }
  page.drawText('COST SUMMARY', { x: 50, y, size: 9, font: boldFont, color: NAVY });
  y -= 14;
  page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 2, color: ORANGE });
  y -= 18;
  page.drawText('Parts', { x: 54, y, size: 9, font: regFont, color: rgb(0.3,0.3,0.3) });
  page.drawText(fmt(partsTotal), { x: 500, y, size: 9, font: regFont, color: rgb(0.3,0.3,0.3) });
  y -= 14;
  page.drawText('Mileage (' + parseFloat(sub.miles || 0).toFixed(0) + ' mi)', { x: 54, y, size: 9, font: regFont, color: rgb(0.3,0.3,0.3) });
  page.drawText(fmt(mileageTotal), { x: 500, y, size: 9, font: regFont, color: rgb(0.3,0.3,0.3) });
  y -= 14;
  page.drawText('Labor', { x: 54, y, size: 9, font: regFont, color: rgb(0.3,0.3,0.3) });
  page.drawText(fmt(laborTotal), { x: 500, y, size: 9, font: regFont, color: rgb(0.3,0.3,0.3) });
  y -= 14;
  page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 1, color: NAVY });
  y -= 16;
  page.drawText('TOTAL', { x: 54, y, size: 11, font: boldFont, color: NAVY });
  page.drawText(fmt(grandTotal), { x: 495, y, size: 11, font: boldFont, color: ORANGE });
  y -= 24;

  // Photos
  const workPhotos = photos.filter(p => !p.section || p.section === 'work');
  if (workPhotos.length > 0 && y > 120) {
    page.drawText('PHOTOS', { x: 50, y, size: 9, font: boldFont, color: NAVY });
    y -= 14;
    page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 2, color: ORANGE });
    y -= 14;
    await embedPhotosOnPage(pdfDoc, page, photos, 'work', rgb, 200, y);
  }

  const pdfBytes = await pdfDoc.save();
  const pdfB64 = Buffer.from(pdfBytes).toString('base64');

  // Build email HTML
  const partsRows = parts.map(function(p) {
    return '<tr><td>' + (p.sku||'') + '</td><td>' + (p.description||p.name||'') + '</td><td>' + (p.qty||1) + '</td><td>' + fmt(p.price) + '</td><td>' + fmt((p.price||0)*(p.qty||1)) + '</td></tr>';
  }).join('');

  const html = '<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">'
    + '<div style="background:#102558;padding:20px 24px;border-radius:6px 6px 0 0">'
    + '<span style="display:inline-block;background:#ef6600;color:#fff;font-weight:bold;font-size:18px;width:36px;height:36px;line-height:36px;text-align:center;border-radius:50%;margin-right:12px">R</span>'
    + '<span style="color:#fff;font-size:20px;font-weight:bold">ReliableTrack</span>'
    + '<span style="color:rgba(255,255,255,0.7);font-size:13px;margin-left:12px">Reliable Oilfield Services</span>'
    + '</div>'
    + '<div style="background:#ef6600;height:4px"></div>'
    + '<div style="padding:24px;background:#fff;border:1px solid #ddd;border-top:none">'
    + '<h2 style="color:#102558;margin:0 0 4px">' + label + '</h2>'
    + '<p style="color:#666;margin:0 0 20px;font-size:14px">' + (isPM ? 'Preventive Maintenance Report' : 'Service Call Report') + '</p>'
    + '<table style="width:100%;border-collapse:collapse;margin-bottom:20px">'
    + '<tr><td style="padding:6px;background:#f5f5f5;font-weight:bold;width:140px;font-size:13px">Customer</td><td style="padding:6px;font-size:13px">' + (sub.customer_name||'') + '</td><td style="padding:6px;background:#f5f5f5;font-weight:bold;width:140px;font-size:13px">Location</td><td style="padding:6px;font-size:13px">' + (sub.location_name||'') + '</td></tr>'
    + '<tr><td style="padding:6px;background:#f5f5f5;font-weight:bold;font-size:13px">Date</td><td style="padding:6px;font-size:13px">' + fmtDate(sub.date) + '</td><td style="padding:6px;background:#f5f5f5;font-weight:bold;font-size:13px">Truck</td><td style="padding:6px;font-size:13px">' + (sub.truck_number||'') + '</td></tr>'
    + '<tr><td style="padding:6px;background:#f5f5f5;font-weight:bold;font-size:13px">Techs</td><td style="padding:6px;font-size:13px" colspan="3">' + techs.join(', ') + '</td></tr>'
    + '</table>'
    + (d.warrantyWork ? '<div style="background:#22c55e;color:#fff;padding:8px 14px;border-radius:4px;margin-bottom:16px;font-weight:bold">WARRANTY WORK - NO CHARGE</div>' : '')
    + '<div style="background:#f0f4ff;border-left:4px solid #ef6600;padding:14px;border-radius:4px;margin-bottom:20px">'
    + '<strong style="color:#102558">Work Description</strong>'
    + '<p style="margin:8px 0 0;color:#444;font-size:13px;white-space:pre-line">' + (sub.summary||d.description||'') + '</p>'
    + '</div>'
    + (parts.length > 0 ? '<h3 style="color:#102558;border-bottom:2px solid #ef6600;padding-bottom:6px">Parts &amp; Materials</h3>'
      + '<table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px">'
      + '<thead><tr style="background:#102558;color:#fff">'
      + '<th style="padding:8px;text-align:left">SKU</th><th style="padding:8px;text-align:left">Description</th>'
      + '<th style="padding:8px;text-align:right">Qty</th><th style="padding:8px;text-align:right">Unit</th><th style="padding:8px;text-align:right">Total</th>'
      + '</tr></thead><tbody>' + partsRows + '</tbody>'
      + '</table>' : '')
    + '<h3 style="color:#102558;border-bottom:2px solid #ef6600;padding-bottom:6px">Cost Summary</h3>'
    + '<table style="width:100%;border-collapse:collapse;font-size:13px">'
    + '<tr><td style="padding:6px">Parts</td><td style="padding:6px;text-align:right">' + fmt(partsTotal) + '</td></tr>'
    + '<tr><td style="padding:6px">Mileage (' + parseFloat(sub.miles||0).toFixed(0) + ' mi)</td><td style="padding:6px;text-align:right">' + fmt(mileageTotal) + '</td></tr>'
    + '<tr><td style="padding:6px">Labor</td><td style="padding:6px;text-align:right">' + fmt(laborTotal) + '</td></tr>'
    + '<tr style="background:#102558;color:#fff;font-weight:bold"><td style="padding:8px">TOTAL</td><td style="padding:8px;text-align:right;color:#ef6600">' + fmt(grandTotal) + '</td></tr>'
    + '</table>'
    + '</div>'
    + '<div style="text-align:center;padding:12px;color:#999;font-size:11px">ReliableTrack • Reliable Oilfield Services</div>'
    + '</div>';

  const emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: TO,
      subject: label + ' - ' + (sub.customer_name||'') + ' - ' + fmtDate(sub.date),
      html,
      attachments: [{ filename: label.replace('#','').replace(' ','-') + '-report.pdf', content: pdfB64 }],
    }),
  });

  const emailData = await emailResp.json();
  if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
  return res.status(200).json({ ok: true, emailId: emailData.id });
}

// ── EXPENSE REPORT ───────────────────────────────────────────────────────
async function sendExpenseReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts) {
  const items = Array.isArray(d.expenseItems) ? d.expenseItems : [];
  const total = parseFloat(d.expenseTotal || 0);
  const techName = d.techs && d.techs.length ? d.techs[0] : (sub.created_by || '');

  const pdfDoc = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const NAVY = rgb(0.063, 0.149, 0.290);
  const PURPLE = rgb(0.45, 0.18, 0.69);
  const WHITE = rgb(1, 1, 1);
  const LGRAY = rgb(0.95, 0.95, 0.95);

  const page = pdfDoc.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 742, width: 612, height: 50, color: NAVY });
  page.drawCircle({ x: 35, y: 767, size: 18, color: PURPLE });
  page.drawText('R', { x: 29, y: 761, size: 14, font: boldFont, color: WHITE });
  page.drawText('ReliableTrack - Expense Report', { x: 58, y: 756, size: 14, font: boldFont, color: WHITE });
  page.drawRectangle({ x: 0, y: 740, width: 612, height: 2, color: PURPLE });

  let y = 720;
  page.drawText('Technician: ' + (sub.truck_number || techName || ''), { x: 50, y, size: 10, font: regFont, color: NAVY });
  page.drawText('Date: ' + fmtDate(sub.date), { x: 350, y, size: 10, font: regFont, color: NAVY });
  y -= 20;

  // Table header
  page.drawRectangle({ x: 50, y: y - 14, width: 512, height: 16, color: NAVY });
  page.drawText('Category', { x: 54, y: y - 11, size: 8, font: boldFont, color: WHITE });
  page.drawText('Vendor / Description', { x: 160, y: y - 11, size: 8, font: boldFont, color: WHITE });
  page.drawText('Amount', { x: 530, y: y - 11, size: 8, font: boldFont, color: WHITE });
  y -= 18;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (y < 80) break;
    if (i % 2 === 1) page.drawRectangle({ x: 50, y: y - 12, width: 512, height: 14, color: LGRAY });
    page.drawText(String(it.category || ''), { x: 54, y: y - 9, size: 8, font: regFont, color: NAVY });
    page.drawText(String(it.description || '').substring(0, 60), { x: 160, y: y - 9, size: 8, font: regFont, color: NAVY });
    page.drawText(fmt(it.amount), { x: 530, y: y - 9, size: 8, font: regFont, color: NAVY });
    y -= 14;
  }

  y -= 6;
  page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 1, color: NAVY });
  y -= 14;
  page.drawText('TOTAL', { x: 54, y, size: 11, font: boldFont, color: NAVY });
  page.drawText(fmt(total), { x: 525, y, size: 11, font: boldFont, color: PURPLE });

  if (sub.summary) {
    y -= 24;
    page.drawText('Notes: ' + String(sub.summary).substring(0, 120), { x: 50, y, size: 9, font: regFont, color: rgb(0.4,0.4,0.4) });
  }

  const pdfBytes = await pdfDoc.save();
  const pdfB64 = Buffer.from(pdfBytes).toString('base64');

  // Photo HTML
  const photoHtml = photos.slice(0, 8).map(function(p) {
    const url = SUPA_URL + '/storage/v1/object/public/submission-photos/' + p.storage_path;
    return '<img src="' + url + '" style="max-width:200px;max-height:150px;margin:6px;border-radius:4px;border:1px solid #ddd" />';
  }).join('');

  const itemRows = items.map(function(it) {
    return '<tr><td style="padding:8px;border-bottom:1px solid #eee">' + (it.category||'') + '</td>'
      + '<td style="padding:8px;border-bottom:1px solid #eee">' + (it.description||'') + '</td>'
      + '<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">' + fmt(it.amount) + '</td></tr>';
  }).join('');

  const html = '<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">'
    + '<div style="background:#102558;padding:20px 24px;border-radius:6px 6px 0 0">'
    + '<span style="display:inline-block;background:#7c2fcb;color:#fff;font-weight:bold;font-size:18px;width:36px;height:36px;line-height:36px;text-align:center;border-radius:50%;margin-right:12px">R</span>'
    + '<span style="color:#fff;font-size:20px;font-weight:bold">Expense Report</span>'
    + '</div>'
    + '<div style="background:#7c2fcb;height:4px"></div>'
    + '<div style="padding:24px;background:#fff;border:1px solid #ddd;border-top:none">'
    + '<table style="width:100%;font-size:13px;margin-bottom:20px"><tr>'
    + '<td><strong>Tech:</strong> ' + (sub.truck_number || techName) + '</td>'
    + '<td><strong>Date:</strong> ' + fmtDate(sub.date) + '</td>'
    + '</tr></table>'
    + '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">'
    + '<thead><tr style="background:#102558;color:#fff"><th style="padding:8px;text-align:left">Category</th><th style="padding:8px;text-align:left">Description</th><th style="padding:8px;text-align:right">Amount</th></tr></thead>'
    + '<tbody>' + itemRows + '</tbody>'
    + '<tfoot><tr style="background:#102558;color:#fff;font-weight:bold"><td colspan="2" style="padding:8px">TOTAL</td><td style="padding:8px;text-align:right;color:#b86bff">' + fmt(total) + '</td></tr></tfoot>'
    + '</table>'
    + (sub.summary ? '<p style="color:#666;font-size:13px"><strong>Notes:</strong> ' + sub.summary + '</p>' : '')
    + (photoHtml ? '<h3 style="color:#102558">Receipt &amp; Item Photos</h3><div>' + photoHtml + '</div>' : '')
    + '</div></div>';

  const emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: TO,
      subject: 'Expense Report - ' + (sub.truck_number || techName) + ' - ' + fmtDate(sub.date) + ' - ' + fmt(total),
      html,
      attachments: [{ filename: 'expense-report-' + (sub.date||'') + '.pdf', content: pdfB64 }],
    }),
  });
  const emailData = await emailResp.json();
  if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
  return res.status(200).json({ ok: true, emailId: emailData.id });
}

// ── DAILY INSPECTION REPORT ──────────────────────────────────────────────
async function sendInspectionReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts) {
  const checks = Array.isArray(d.checkItems) ? d.checkItems : [];
  const failCount = parseInt(d.failCount || 0);
  const allPass = d.allPass !== false;
  const inspType = d.inspectionType || 'Pre-Trip';
  const techName = d.techs && d.techs.length ? d.techs[0] : '';

  const pdfDoc = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const NAVY = rgb(0.063, 0.149, 0.290);
  const TEAL = rgb(0.063, 0.58, 0.58);
  const RED = rgb(0.85, 0.1, 0.1);
  const GREEN = rgb(0.1, 0.65, 0.2);
  const WHITE = rgb(1, 1, 1);
  const LGRAY = rgb(0.95, 0.95, 0.95);

  const page = pdfDoc.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 742, width: 612, height: 50, color: NAVY });
  page.drawCircle({ x: 35, y: 767, size: 18, color: TEAL });
  page.drawText('R', { x: 29, y: 761, size: 14, font: boldFont, color: WHITE });
  page.drawText('Daily Vehicle Inspection', { x: 58, y: 756, size: 14, font: boldFont, color: WHITE });
  page.drawText(inspType + ' | ' + (sub.truck_number || '') + ' | ' + fmtDate(sub.date), { x: 58, y: 744, size: 9, font: regFont, color: rgb(0.7,0.7,0.7) });
  page.drawRectangle({ x: 0, y: 740, width: 612, height: 2, color: TEAL });

  let y = 720;
  page.drawText('Tech: ' + techName, { x: 50, y, size: 10, font: regFont, color: NAVY });
  page.drawText('Odometer: ' + (d.odometer || 'N/A'), { x: 250, y, size: 10, font: regFont, color: NAVY });
  if (!allPass) {
    page.drawRectangle({ x: 420, y: y - 2, width: 140, height: 16, color: RED });
    page.drawText(failCount + ' DEFECT(S) FOUND', { x: 425, y: y + 1, size: 9, font: boldFont, color: WHITE });
  } else {
    page.drawRectangle({ x: 420, y: y - 2, width: 140, height: 16, color: GREEN });
    page.drawText('ALL ITEMS PASSED', { x: 425, y: y + 1, size: 9, font: boldFont, color: WHITE });
  }
  y -= 24;

  // Group checks by section
  const sections = {};
  for (const c of checks) {
    const sec = c.section || 'General';
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push(c);
  }

  for (const [secName, items] of Object.entries(sections)) {
    if (y < 60) { pdfDoc.addPage([612, 792]); y = 750; }
    page.drawText(secName.toUpperCase(), { x: 50, y, size: 9, font: boldFont, color: NAVY });
    y -= 4;
    page.drawRectangle({ x: 50, y: y - 1, width: 512, height: 1, color: TEAL });
    y -= 10;
    for (const item of items) {
      if (y < 60) break;
      const statusColor = item.status === 'Fail' ? RED : item.status === 'N/A' ? rgb(0.5,0.5,0.5) : GREEN;
      page.drawRectangle({ x: 50, y: y - 10, width: 8, height: 10, color: statusColor });
      page.drawText(String(item.label || ''), { x: 64, y: y - 8, size: 8, font: regFont, color: rgb(0.2,0.2,0.2) });
      page.drawText(String(item.status || 'Pass'), { x: 520, y: y - 8, size: 8, font: boldFont, color: statusColor });
      y -= 12;
    }
    y -= 4;
  }

  if (d.defects && y > 60) {
    y -= 6;
    page.drawText('DEFECT NOTES:', { x: 50, y, size: 9, font: boldFont, color: RED });
    y -= 12;
    page.drawText(String(d.defects).substring(0, 120), { x: 50, y, size: 8, font: regFont, color: RED });
  }

  const pdfBytes = await pdfDoc.save();
  const pdfB64 = Buffer.from(pdfBytes).toString('base64');

  // Build checklist HTML table by section
  let checklistHtml = '';
  for (const [secName, items] of Object.entries(sections)) {
    checklistHtml += '<h4 style="color:#102558;margin:12px 0 4px">' + secName + '</h4>'
      + '<table style="width:100%;font-size:12px;border-collapse:collapse">';
    for (const item of items) {
      const color = item.status === 'Fail' ? '#dc2626' : item.status === 'N/A' ? '#6b7280' : '#16a34a';
      checklistHtml += '<tr><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">' + (item.label||'') + '</td>'
        + '<td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:bold;color:' + color + '">' + (item.status||'Pass') + '</td></tr>';
    }
    checklistHtml += '</table>';
  }

  const statusBadge = allPass
    ? '<span style="background:#16a34a;color:#fff;padding:4px 12px;border-radius:12px;font-weight:bold">&#10003; ALL PASS</span>'
    : '<span style="background:#dc2626;color:#fff;padding:4px 12px;border-radius:12px;font-weight:bold">&#9888; ' + failCount + ' DEFECT(S)</span>';

  const html = '<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">'
    + '<div style="background:#102558;padding:20px 24px;border-radius:6px 6px 0 0">'
    + '<span style="display:inline-block;background:#0ea5a5;color:#fff;font-weight:bold;font-size:18px;width:36px;height:36px;line-height:36px;text-align:center;border-radius:50%;margin-right:12px">R</span>'
    + '<span style="color:#fff;font-size:20px;font-weight:bold">Daily Vehicle Inspection</span>'
    + '</div>'
    + '<div style="background:#0ea5a5;height:4px"></div>'
    + '<div style="padding:24px;background:#fff;border:1px solid #ddd;border-top:none">'
    + '<table style="width:100%;font-size:13px;margin-bottom:16px"><tr>'
    + '<td><strong>Tech:</strong> ' + techName + '</td>'
    + '<td><strong>Truck:</strong> ' + (sub.truck_number||'') + '</td>'
    + '<td><strong>Date:</strong> ' + fmtDate(sub.date) + '</td>'
    + '<td><strong>Type:</strong> ' + inspType + '</td>'
    + '</tr><tr>'
    + '<td colspan="2"><strong>Odometer:</strong> ' + (d.odometer||'N/A') + '</td>'
    + '<td colspan="2">' + statusBadge + '</td>'
    + '</tr></table>'
    + checklistHtml
    + (d.defects ? '<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px;margin-top:16px;border-radius:4px"><strong style="color:#dc2626">Defect Notes:</strong><p style="margin:6px 0 0;color:#444">' + d.defects + '</p></div>' : '')
    + '</div></div>';

  const emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: TO,
      subject: (allPass ? '\u2713 ' : '\u26a0\ufe0f ') + 'Vehicle Inspection - ' + (sub.truck_number||'') + ' - ' + techName + ' - ' + fmtDate(sub.date),
      html,
      attachments: [{ filename: 'inspection-' + (sub.truck_number||'truck') + '-' + (sub.date||'') + '.pdf', content: pdfB64 }],
    }),
  });
  const emailData = await emailResp.json();
  if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
  return res.status(200).json({ ok: true, emailId: emailData.id });
}
