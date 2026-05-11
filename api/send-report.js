// api/send-report.js - Vercel Serverless Function (CommonJS via api/package.json)
// Sends HTML email with PDF attachment via Resend
// pdf-lib is lazy-loaded inside handler to avoid Lambda crash
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const TO = process.env.EMAIL_TO ? process.env.EMAIL_TO.split(',').map(e => e.trim()) : ['bphetteplace@reliableoilfieldservices.net'];
const FROM = process.env.RESEND_FROM || 'ReliableTrack <reports@reliable-oilfield-services.com>';

// ROS logo URL — served from the app's own domain (no CORS issues in Lambda)
const ROS_LOGO_URL = 'https://pm.reliable-oilfield-services.com/ros-logo.png';

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

    // Pre-fetch ROS logo bytes (shared across all report types)
    var logoImageBytes = null;
    try {
      var logoRes = await fetch(ROS_LOGO_URL);
      if (logoRes.ok) {
        var logoBuf = await logoRes.arrayBuffer();
        logoImageBytes = new Uint8Array(logoBuf);
      }
    } catch(e) { /* logo optional — don't fail report */ }

    // Route to appropriate handler
    if (template === 'expense_report') {
      return await sendExpenseReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts, logoImageBytes);
    }
    if (template === 'daily_inspection') {
      return await sendInspectionReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts, logoImageBytes);
    }
    if (template === 'jha' || (d && d.jobType === 'JHA/JSA')) {
      return await sendJhaReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts, logoImageBytes);
    }
    // Default: PM or SC
    return await sendPmScReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts, logoImageBytes);
  } catch (err) {
    console.error('send-report error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ── HELPERS ────────────────────────────────────────────────────────────────
function fmt(n) { return '$' + parseFloat(n || 0).toFixed(2); }
function fmtDate(s) {
  if (!s) return '';
  try { return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return s; }
}

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
      page.drawImage(img, { x: 54, y: y - h, width: w, height: h });
      y -= (h + 10);
    } catch { /* skip bad photo */ }
  }
  return y;
}

// ── BRANDED PAGE BUILDER ──────────────────────────────────────────────────
// Returns an async function addPage(doc) that adds a fully-branded page
// accentColor: rgb() value for the accent line and report-type badge
// reportTypeLabel: short label shown in top-right badge (e.g. 'PM', 'SC', 'JHA')
async function buildPageFactory(pdfDoc, boldFont, regFont, rgb, accentColor, reportTypeLabel, logoImageBytes) {
  // Try to embed logo once per PDF
  var logoImg = null;
  if (logoImageBytes) {
    try { logoImg = await pdfDoc.embedPng(logoImageBytes); } catch(e) {}
  }
  var WHITE = rgb(1, 1, 1);
  var NAVY = rgb(0.063, 0.149, 0.290);
  var LGRAY = rgb(0.88, 0.88, 0.88);

  return function addPage(doc) {
    var pg = doc.addPage([612, 792]);

    // ── Header background ──────────────────────────────────────────────
    pg.drawRectangle({ x: 0, y: 736, width: 612, height: 56, color: NAVY });

    // ── ROS Logo ──────────────────────────────────────────────────────
    if (logoImg) {
      // Draw logo at left, centred vertically in header: 50x50 at x=12, y=738
      pg.drawImage(logoImg, { x: 12, y: 738, width: 50, height: 50 });
    } else {
      // Fallback: draw a circle with ROS initials
      pg.drawCircle({ x: 37, y: 763, size: 22, color: accentColor });
      pg.drawText('ROS', { x: 25, y: 757, size: 10, font: boldFont, color: WHITE });
    }

    // ── Company name block (right of logo) ────────────────────────────
    pg.drawText('Reliable Oilfield Services', { x: 70, y: 763, size: 15, font: boldFont, color: WHITE });
    pg.drawText('reliable-oilfield-services.com', { x: 70, y: 749, size: 8, font: regFont, color: rgb(0.72, 0.72, 0.72) });

    // ── Report type badge (right side) ────────────────────────────────
    pg.drawRectangle({ x: 490, y: 746, width: 110, height: 24, color: accentColor });
    pg.drawText(reportTypeLabel, { x: 496, y: 752, size: 10, font: boldFont, color: WHITE });

    // ── Orange / accent underline ─────────────────────────────────────
    pg.drawRectangle({ x: 0, y: 734, width: 612, height: 3, color: accentColor });

    // ── Footer: Powered by ReliableTrack ─────────────────────────────
    pg.drawRectangle({ x: 0, y: 0, width: 612, height: 20, color: NAVY });
    pg.drawText('Powered by ReliableTrack™  |  Reliable Oilfield Services', { x: 160, y: 6, size: 7, font: regFont, color: LGRAY });

    return pg;
  };
}

// ── PM / SC REPORT ─────────────────────────────────────────────────────────
async function sendPmScReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts, logoImageBytes) {
  const isPM = sub.template === 'pm_flare_combustor';
  const jobLabel = d.jobType || (isPM ? 'Preventive Maintenance' : 'Service Call');
  const woNum = sub.work_order || sub.pm_number || '';
  const woLabel = 'WO #' + woNum;

  // Colors
  const NAVY   = rgb(0.059, 0.122, 0.220);
  const NAVYMD = rgb(0.102, 0.180, 0.290);
  const ORANGE = rgb(0.902, 0.361, 0.000);
  const GREEN  = rgb(0.102, 0.431, 0.235);
  const ACCNT  = isPM ? GREEN : ORANGE;
  const WHITE  = rgb(1, 1, 1);
  const LTGRAY = rgb(0.94, 0.94, 0.96);
  const MDGRAY = rgb(0.55, 0.55, 0.60);
  const DKGRAY = rgb(0.25, 0.25, 0.30);

  // PDF setup
  const pdfDoc  = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regFont  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const PW = 612, PH = 792;
  const ML = 48, MR = 48, MT = 36;

  // Helper: add a new page
  function newPage() {
    const p = pdfDoc.addPage([PW, PH]);
    // Navy footer bar on every page
    p.drawRectangle({ x: 0, y: 0, width: PW, height: 24, color: NAVY });
    p.drawText('Powered by ReliableTrack | Reliable Oilfield Services', { x: 148, y: 8, size: 7, font: regFont, color: WHITE });
    p.drawText(woLabel, { x: PW - MR - 60, y: 8, size: 7, font: boldFont, color: WHITE });
    return { page: p, y: PH - MT };
  }

  // Helper: safe text draw (clips to maxWidth)
  function safeText(page, text, opts) {
    if (!text) return;
    var str = String(text);
    var maxW = opts.maxWidth || (PW - ML - MR);
    var sz = opts.size || 10;
    var ft = opts.font || regFont;
    var approxW = str.length * sz * 0.55;
    if (approxW > maxW) {
      var charsPerLine = Math.floor(maxW / (sz * 0.55));
      str = str.slice(0, Math.max(charsPerLine - 1, 3)) + '...';
    }
    page.drawText(str, { x: opts.x, y: opts.y, size: sz, font: ft, color: opts.color || DKGRAY });
  }

  // Helper: section header bar
  function sectionHeader(page, y, title) {
    page.drawRectangle({ x: ML, y: y - 2, width: 4, height: 16, color: ACCNT });
    page.drawRectangle({ x: ML + 4, y: y - 2, width: PW - ML - MR - 4, height: 16, color: LTGRAY });
    safeText(page, title.toUpperCase(), { x: ML + 10, y: y + 2, size: 8, font: boldFont, color: NAVYMD });
    return y - 26;
  }

  // Helper: field block (label + value box)
  function field(page, y, label, value, x, w) {
    safeText(page, label, { x: x, y: y + 12, size: 7, font: regFont, color: MDGRAY });
    page.drawRectangle({ x: x, y: y, width: w, height: 14, color: LTGRAY });
    safeText(page, String(value || '--'), { x: x + 4, y: y + 3, size: 9, font: regFont, color: DKGRAY, maxWidth: w - 8 });
    return y - 28;
  }

  // Helper: horizontal divider
  function hline(page, y) {
    page.drawRectangle({ x: ML, y: y, width: PW - ML - MR, height: 0.5, color: LTGRAY });
  }

  // Helper: dollar format
  function dollar(n) { return '$' + (parseFloat(n) || 0).toFixed(2); }

  // Helper: date format
  function fmtD(s) {
    if (!s) return '';
    try { return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return s; }
  }

  // Data arrays
  var parts     = Array.isArray(d.parts) ? d.parts.filter(function(p) { return p && p.name; }) : [];
  var techs     = Array.isArray(d.techs) ? d.techs.filter(function(t) { return t && t.name; }) : [];
  var arrestors = Array.isArray(d.arrestors) ? d.arrestors.filter(function(a) { return a && a.id; }) : [];
  var flares    = Array.isArray(d.flares) ? d.flares.filter(function(f) { return f && f.flareId; }) : [];
  var heaters   = Array.isArray(d.heaterTreaters) ? d.heaterTreaters.filter(function(h) { return h && h.id; }) : [];
  var scEq      = Array.isArray(d.equipmentWorkedOn) ? d.equipmentWorkedOn.filter(function(e) { return e; }) : [];

  // === PAGE 1 ===
  var np0 = newPage();
  var page = np0.page;
  var y = np0.y;

  // --- Hero Banner ---
  var bannerH = 80;
  page.drawRectangle({ x: 0, y: PH - bannerH, width: PW, height: bannerH, color: NAVY });
  page.drawRectangle({ x: 0, y: PH - bannerH, width: PW, height: 6, color: ACCNT });

  // Logo (if available)
  if (logoImageBytes) {
    try {
      var logoImg = await pdfDoc.embedPng(logoImageBytes);
      page.drawImage(logoImg, { x: ML, y: PH - bannerH + 16, width: 36, height: 36 });
    } catch (e) { /* logo optional */ }
  }

  // Report title
  safeText(page, 'WORK ORDER REPORT', { x: ML + 46, y: PH - bannerH + 52, size: 8, font: boldFont, color: ACCNT });
  // WO Number
  safeText(page, woLabel, { x: ML + 46, y: PH - bannerH + 30, size: 22, font: boldFont, color: WHITE });
  // Job type pill
  var pillW = jobLabel.length * 7 + 16;
  page.drawRectangle({ x: ML + 46, y: PH - bannerH + 10, width: pillW, height: 16, color: ACCNT });
  safeText(page, jobLabel, { x: ML + 50, y: PH - bannerH + 14, size: 8, font: boldFont, color: WHITE, maxWidth: pillW - 8 });

  y = PH - bannerH - 10;

  // --- Job Information ---
  y = sectionHeader(page, y, 'Job Information');

  // Row 1: Customer | Location
  field(page, y, 'Customer', sub.customer_name, ML, 240);
  field(page, y, 'Location / Site', sub.location_name, ML + 252, 264);
  y -= 30;

  // Row 2: Date | WO Number | Truck
  field(page, y, 'Date', fmtD(sub.date), ML, 150);
  field(page, y, 'WO Number', sub.work_order || sub.pm_number, ML + 162, 150);
  field(page, y, 'Truck / Unit', sub.truck_number, ML + 324, 180);
  y -= 30;

  // Row 3: Job Type | Warranty | Work Area
  field(page, y, 'Job Type', jobLabel, ML, 150);
  field(page, y, 'Warranty', d.warrantyWork ? 'Yes - No Charge' : 'No - Standard Billing', ML + 162, 180);
  field(page, y, 'Work Area', sub.work_area, ML + 354, 150);
  y -= 30;

  // Warranty notice banner
  if (d.warrantyWork) {
    page.drawRectangle({ x: ML, y: y - 2, width: PW - ML - MR, height: 16, color: ORANGE });
    safeText(page, 'WARRANTY WORK -- NO CHARGE', { x: ML + 4, y: y + 7, size: 8, font: boldFont, color: WHITE });
    y -= 20;
  }

  y -= 8;

  // --- Technicians ---
  y = sectionHeader(page, y, 'Technicians');
  if (techs.length > 0) {
    techs.forEach(function(t, idx) {
      var col = idx % 2;
      var row = Math.floor(idx / 2);
      var tx = ML + col * 250;
      var ty = y - row * 16;
      page.drawRectangle({ x: tx, y: ty - 2, width: 6, height: 6, color: ACCNT });
      safeText(page, t.name, { x: tx + 10, y: ty, size: 9, font: regFont, color: DKGRAY, maxWidth: 230 });
    });
    y -= (Math.ceil(techs.length / 2) * 16) + 8;
  } else {
    safeText(page, 'No technicians recorded', { x: ML + 4, y: y, size: 9, font: regFont, color: MDGRAY });
    y -= 18;
  }

  y -= 8;

  // --- Work Description ---
  y = sectionHeader(page, y, 'Work Description');
  var descText = d.description || d.workPerformed || 'No description provided.';
  var descLines = descText.split('\n').slice(0, 8);
  descLines.forEach(function(ln) {
    if (y < 100) { var npD = newPage(); page = npD.page; y = npD.y; }
    safeText(page, ln, { x: ML + 4, y: y, size: 9, font: regFont, color: DKGRAY });
    y -= 14;
  });

  if (d.reportedIssue) {
    y -= 6;
    safeText(page, 'Reported Issue:', { x: ML + 4, y: y, size: 8, font: boldFont, color: DKGRAY });
    y -= 14;
    safeText(page, d.reportedIssue, { x: ML + 8, y: y, size: 9, font: regFont, color: DKGRAY });
    y -= 14;
  }
  if (d.rootCause) {
    safeText(page, 'Root Cause:', { x: ML + 4, y: y, size: 8, font: boldFont, color: DKGRAY });
    y -= 14;
    safeText(page, d.rootCause, { x: ML + 8, y: y, size: 9, font: regFont, color: DKGRAY });
    y -= 14;
  }

  y -= 8;

  // --- Equipment Worked On (SC only) ---
  if (!isPM && scEq.length > 0) {
    if (y < 140) { var npEq = newPage(); page = npEq.page; y = npEq.y; }
    y = sectionHeader(page, y, 'Equipment Worked On');
    scEq.forEach(function(e, idx) {
      var col = idx % 3;
      var row = Math.floor(idx / 3);
      var ex = ML + col * 170;
      var ey = y - row * 16;
      if (ey < 100) return;
      page.drawRectangle({ x: ex, y: ey - 2, width: 4, height: 4, color: ACCNT });
      safeText(page, String(e), { x: ex + 8, y: ey, size: 9, font: regFont, color: DKGRAY, maxWidth: 158 });
    });
    y -= (Math.ceil(scEq.length / 3) * 16) + 8;
  }

  // --- Parts Used ---
  if (parts.length > 0) {
    if (y < 160) { var npPt = newPage(); page = npPt.page; y = npPt.y; }
    y = sectionHeader(page, y, 'Parts Used');
    // Table header
    page.drawRectangle({ x: ML, y: y, width: PW - ML - MR, height: 16, color: NAVYMD });
    safeText(page, 'Part Description', { x: ML + 4, y: y + 4, size: 7, font: boldFont, color: WHITE });
    safeText(page, 'Qty', { x: ML + 310, y: y + 4, size: 7, font: boldFont, color: WHITE });
    safeText(page, 'Unit Price', { x: ML + 350, y: y + 4, size: 7, font: boldFont, color: WHITE });
    safeText(page, 'Total', { x: ML + 420, y: y + 4, size: 7, font: boldFont, color: WHITE });
    y -= 18;

    parts.slice(0, 20).forEach(function(p, i) {
      if (y < 80) { var npPt2 = newPage(); page = npPt2.page; y = npPt2.y; }
      var rowBg = i % 2 === 0 ? WHITE : LTGRAY;
      page.drawRectangle({ x: ML, y: y - 2, width: PW - ML - MR, height: 15, color: rowBg });
      safeText(page, p.name, { x: ML + 4, y: y + 2, size: 8, font: regFont, color: DKGRAY, maxWidth: 300 });
      safeText(page, String(p.qty || 1), { x: ML + 314, y: y + 2, size: 8, font: regFont, color: DKGRAY });
      var unitP = parseFloat(p.unitPrice || p.price || 0);
      var tot = unitP * (parseFloat(p.qty) || 1);
      if (unitP > 0) safeText(page, dollar(unitP), { x: ML + 350, y: y + 2, size: 8, font: regFont, color: DKGRAY });
      if (tot > 0) safeText(page, dollar(tot), { x: ML + 420, y: y + 2, size: 8, font: boldFont, color: DKGRAY });
      y -= 16;
    });
    y -= 8;
  }

  // --- PM Equipment (PM only) ---
  if (isPM) {

    // Flame Arrestors
    if (arrestors.length > 0) {
      if (y < 160) { var npAr = newPage(); page = npAr.page; y = npAr.y; }
      y = sectionHeader(page, y, 'Flame Arrestors');
      page.drawRectangle({ x: ML, y: y, width: PW - ML - MR, height: 14, color: NAVYMD });
      safeText(page, 'ID', { x: ML + 4, y: y + 3, size: 7, font: boldFont, color: WHITE });
      safeText(page, 'Type', { x: ML + 80, y: y + 3, size: 7, font: boldFont, color: WHITE });
      safeText(page, 'Condition', { x: ML + 160, y: y + 3, size: 7, font: boldFont, color: WHITE });
      safeText(page, 'Cleaned', { x: ML + 260, y: y + 3, size: 7, font: boldFont, color: WHITE });
      safeText(page, 'Filter Changed', { x: ML + 330, y: y + 3, size: 7, font: boldFont, color: WHITE });
      y -= 16;
      arrestors.slice(0, 15).forEach(function(a, i) {
        if (y < 80) { var npAr2 = newPage(); page = npAr2.page; y = npAr2.y; }
        var bg = i % 2 === 0 ? WHITE : LTGRAY;
        page.drawRectangle({ x: ML, y: y - 2, width: PW - ML - MR, height: 14, color: bg });
        safeText(page, String(a.id || ''), { x: ML + 4, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 72 });
        safeText(page, String(a.type || ''), { x: ML + 80, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 76 });
        safeText(page, String(a.condition || ''), { x: ML + 160, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 96 });
        safeText(page, a.cleaned ? 'Yes' : 'No', { x: ML + 260, y: y + 1, size: 8, font: regFont, color: DKGRAY });
        safeText(page, a.filterChanged ? 'Yes' : 'No', { x: ML + 330, y: y + 1, size: 8, font: regFont, color: DKGRAY });
        y -= 15;
      });
      y -= 8;
    }

    // Flares
    if (flares.length > 0) {
      if (y < 160) { var npFl = newPage(); page = npFl.page; y = npFl.y; }
      y = sectionHeader(page, y, 'Flares');
      page.drawRectangle({ x: ML, y: y, width: PW - ML - MR, height: 14, color: NAVYMD });
      safeText(page, 'Flare ID', { x: ML + 4, y: y + 3, size: 7, font: boldFont, color: WHITE });
      safeText(page, 'Type', { x: ML + 100, y: y + 3, size: 7, font: boldFont, color: WHITE });
      safeText(page, 'Condition', { x: ML + 200, y: y + 3, size: 7, font: boldFont, color: WHITE });
      safeText(page, 'Cleaned', { x: ML + 320, y: y + 3, size: 7, font: boldFont, color: WHITE });
      y -= 16;
      flares.slice(0, 15).forEach(function(f, i) {
        if (y < 80) { var npFl2 = newPage(); page = npFl2.page; y = npFl2.y; }
        var bg = i % 2 === 0 ? WHITE : LTGRAY;
        page.drawRectangle({ x: ML, y: y - 2, width: PW - ML - MR, height: 14, color: bg });
        safeText(page, String(f.flareId || ''), { x: ML + 4, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 92 });
        safeText(page, String(f.type || ''), { x: ML + 100, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 96 });
        safeText(page, String(f.condition || ''), { x: ML + 200, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 116 });
        safeText(page, f.cleaned ? 'Yes' : 'No', { x: ML + 320, y: y + 1, size: 8, font: regFont, color: DKGRAY });
        y -= 15;
      });
      y -= 8;
    }

    // Heater Treaters
    if (heaters.length > 0) {
      if (y < 160) { var npHt = newPage(); page = npHt.page; y = npHt.y; }
      y = sectionHeader(page, y, 'Heater Treaters');
      page.drawRectangle({ x: ML, y: y, width: PW - ML - MR, height: 14, color: NAVYMD });
      safeText(page, 'ID', { x: ML + 4, y: y + 3, size: 7, font: boldFont, color: WHITE });
      safeText(page, 'Type', { x: ML + 80, y: y + 3, size: 7, font: boldFont, color: WHITE });
      safeText(page, 'Condition', { x: ML + 200, y: y + 3, size: 7, font: boldFont, color: WHITE });
      safeText(page, 'Firetubes', { x: ML + 340, y: y + 3, size: 7, font: boldFont, color: WHITE });
      y -= 16;
      heaters.slice(0, 15).forEach(function(h, i) {
        if (y < 80) { var npHt2 = newPage(); page = npHt2.page; y = npHt2.y; }
        var bg = i % 2 === 0 ? WHITE : LTGRAY;
        page.drawRectangle({ x: ML, y: y - 2, width: PW - ML - MR, height: 14, color: bg });
        safeText(page, String(h.id || ''), { x: ML + 4, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 72 });
        safeText(page, String(h.type || ''), { x: ML + 80, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 116 });
        safeText(page, String(h.condition || ''), { x: ML + 200, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 136 });
        safeText(page, String(h.firetubeCnt || ''), { x: ML + 340, y: y + 1, size: 8, font: regFont, color: DKGRAY });
        y -= 15;
      });
      y -= 8;
    }
  } // end isPM equipment

  // --- Cost Summary ---
  if (y < 200) { var npCost = newPage(); page = npCost.page; y = npCost.y; }
  y -= 8;
  y = sectionHeader(page, y, 'Cost Summary');

  var summaryW = 260;
  var summaryX = PW - MR - summaryW;

  function costRow(label, amount, isBold, isTotal) {
    if (y < 60) return;
    var bg = isTotal ? ACCNT : (isBold ? NAVYMD : WHITE);
    var fc = (isTotal || isBold) ? WHITE : DKGRAY;
    page.drawRectangle({ x: summaryX, y: y - 2, width: summaryW, height: 16, color: bg });
    safeText(page, label, { x: summaryX + 8, y: y + 2, size: isTotal ? 10 : 9, font: (isBold || isTotal) ? boldFont : regFont, color: fc, maxWidth: summaryW - 80 });
    safeText(page, dollar(amount), { x: summaryX + summaryW - 65, y: y + 2, size: isTotal ? 10 : 9, font: (isBold || isTotal) ? boldFont : regFont, color: fc });
    hline(page, y - 2);
    y -= 18;
  }

  if (d.warrantyWork) {
    costRow('TOTAL DUE (WARRANTY)', 0, false, true);
  } else {
    costRow('Parts', d.partsTotal, false, false);
    costRow('Labor', d.laborTotal, false, false);
    costRow('Mileage (' + (sub.miles || '0') + ' mi)', d.mileageTotal, false, false);
    costRow('TOTAL DUE', d.grandTotal, false, true);
  }

  // --- Serialize PDF ---
  var pdfBytes = await pdfDoc.save();
  var pdfB64 = Buffer.from(pdfBytes).toString('base64');

  // --- Build Email HTML ---
  var partsRows = parts.map(function(p) {
    var unitP = parseFloat(p.unitPrice || p.price || 0);
    var tot = unitP * (parseFloat(p.qty) || 1);
    return '<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">' + (p.name || '') + '</td>'
      + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">' + (p.qty || 1) + '</td>'
      + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">' + (unitP > 0 ? dollar(unitP) : '') + '</td>'
      + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">' + (tot > 0 ? dollar(tot) : '') + '</td></tr>';
  }).join('');

  var accentHex = isPM ? '#1a6e3c' : '#e65c00';
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    + 'body{font-family:Arial,sans-serif;background:#f3f4f6;margin:0;padding:0}'
    + '.wrap{max-width:640px;margin:0 auto;background:#fff}'
    + '.hero{background:linear-gradient(135deg,#0f1f38 0%,' + (isPM ? '#1a3a28' : '#2a1200') + ' 100%);padding:32px;color:#fff}'
    + '.hero-label{font-size:11px;font-weight:700;letter-spacing:2px;color:' + accentHex + ';text-transform:uppercase;margin-bottom:8px}'
    + '.hero-wo{font-size:32px;font-weight:900;margin-bottom:6px}'
    + '.hero-pill{display:inline-block;background:' + accentHex + ';color:#fff;font-size:11px;font-weight:700;padding:3px 12px;border-radius:20px}'
    + '.body{padding:24px 32px}'
    + '.section{margin-bottom:20px}'
    + '.sec-title{font-size:11px;font-weight:700;letter-spacing:1px;color:#0f1f38;text-transform:uppercase;border-left:4px solid ' + accentHex + ';padding-left:8px;margin-bottom:10px}'
    + '.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
    + '.field label{font-size:10px;color:#666;display:block;margin-bottom:2px}'
    + '.field span{font-size:13px;font-weight:600;color:#111}'
    + '.tbl{width:100%;border-collapse:collapse;font-size:13px}'
    + '.tbl th{background:#0f1f38;color:#fff;padding:8px;text-align:left;font-size:11px}'
    + '.cost-box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:16px;max-width:280px;margin-left:auto}'
    + '.cost-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb;font-size:13px}'
    + '.cost-total{display:flex;justify-content:space-between;padding:10px 12px;background:' + accentHex + ';color:#fff;border-radius:4px;font-weight:700;font-size:15px;margin-top:8px}'
    + '.footer{background:#0f1f38;color:#aaa;text-align:center;font-size:11px;padding:14px}'
    + '</style></head><body><div class="wrap">';

  html += '<div class="hero">'
    + '<div class="hero-label">Work Order Report</div>'
    + '<div class="hero-wo">' + woLabel + '</div>'
    + '<div class="hero-pill">' + jobLabel + '</div>'
    + '</div>';

  html += '<div class="body">';

  html += '<div class="section"><div class="sec-title">Job Details</div><div class="grid">'
    + '<div class="field"><label>WO Number</label><span>' + (sub.work_order || sub.pm_number || '--') + '</span></div>'
    + '<div class="field"><label>Date</label><span>' + fmtD(sub.date) + '</span></div>'
    + '<div class="field"><label>Customer</label><span>' + (sub.customer_name || '--') + '</span></div>'
    + '<div class="field"><label>Location</label><span>' + (sub.location_name || '--') + '</span></div>'
    + '<div class="field"><label>Job Type</label><span>' + jobLabel + '</span></div>'
    + '<div class="field"><label>Truck</label><span>' + (sub.truck_number || '--') + '</span></div>'
    + '<div class="field"><label>Work Area</label><span>' + (sub.work_area || '--') + '</span></div>'
    + '<div class="field"><label>Warranty</label><span>' + (d.warrantyWork ? 'Yes - No Charge' : 'No - Standard Billing') + '</span></div>'
    + '</div></div>';

  if (techs.length > 0) {
    html += '<div class="section"><div class="sec-title">Technicians</div>'
      + techs.map(function(t) { return '<span style="margin-right:12px;font-size:13px">' + t.name + '</span>'; }).join('')
      + '</div>';
  }

  if (parts.length > 0) {
    html += '<div class="section"><div class="sec-title">Parts Used</div>'
      + '<table class="tbl"><thead><tr>'
      + '<th>Part Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th>'
      + '</tr></thead><tbody>' + partsRows + '</tbody></table></div>';
  }

  html += '<div class="section"><div class="sec-title">Cost Summary</div>'
    + '<div class="cost-box">';

  if (d.warrantyWork) {
    html += '<div class="cost-total"><span>WARRANTY - NO CHARGE</span><span>$0.00</span></div>';
  } else {
    html += '<div class="cost-row"><span>Parts</span><span>' + dollar(d.partsTotal) + '</span></div>';
    html += '<div class="cost-row"><span>Labor</span><span>' + dollar(d.laborTotal) + '</span></div>';
    html += '<div class="cost-row"><span>Mileage</span><span>' + dollar(d.mileageTotal) + '</span></div>';
    html += '<div class="cost-total"><span>TOTAL DUE</span><span>' + dollar(d.grandTotal) + '</span></div>';
  }

  html += '</div></div>';
  html += '</div>';

  html += '<div class="footer">Powered by ReliableTrack | Reliable Oilfield Services | ' + woLabel + '</div>';
  html += '</div></body></html>';

  // --- Video links (SC only) ---
  var videoHtml = '';
  if (!isPM && photos) {
    var vidKeys = Object.keys(photos).filter(function(k) { return k.startsWith('video_') && photos[k]; });
    if (vidKeys.length > 0) {
      videoHtml += '<div style="padding:16px 32px"><strong>Video Links:</strong><ul>';
      vidKeys.forEach(function(k) {
        videoHtml += '<li><a href="' + photos[k] + '" style="color:#2563eb">' + k.replace('video_', '').replace(/_/g, ' ') + '</a></li>';
      });
      videoHtml += '</ul></div>';
    }
  }

  // --- Send via Resend ---
  var RESEND_KEY = process.env.RESEND_API_KEY;
  var FROM = 'ReliableTrack <reports@pm.reliable-oilfield-services.com>';
  var TO = 'bphetteplace@reliableoilfieldservices.net';
  var emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: TO,
      subject: woLabel + ' - ' + (sub.customer_name || '') + ' - ' + fmtD(sub.date),
      html: html + videoHtml,
      attachments: [{ filename: 'WorkOrder_' + woNum + '.pdf', content: pdfB64 }]
    })
  });
  var emailData = await emailResp.json();
  if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
  return res.status(200).json({ ok: true, emailId: emailData.id });
}


async function sendExpenseReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts, logoImageBytes) {
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

  const addPage = await buildPageFactory(pdfDoc, boldFont, regFont, rgb, PURPLE, 'Expense Report', logoImageBytes);
  const page = addPage(pdfDoc);
  let y = 720;

  page.drawText('EXPENSE REPORT', { x: 54, y: y, size: 16, font: boldFont, color: NAVY }); y -= 12;
  page.drawRectangle({ x: 54, y: y, width: 504, height: 2, color: PURPLE }); y -= 20;
  page.drawText('Technician: ' + (sub.truck_number || techName || ''), { x: 54, y: y, size: 10, font: regFont, color: NAVY });
  page.drawText('Date: ' + fmtDate(sub.date), { x: 350, y: y, size: 10, font: regFont, color: NAVY });
  y -= 20;

  page.drawRectangle({ x: 54, y: y - 14, width: 504, height: 16, color: NAVY });
  page.drawText('Category', { x: 54, y: y - 11, size: 8, font: boldFont, color: WHITE });
  page.drawText('Vendor / Description', { x: 160, y: y - 11, size: 8, font: boldFont, color: WHITE });
  page.drawText('Amount', { x: 530, y: y - 11, size: 8, font: boldFont, color: WHITE });
  y -= 18;

  for (let i = 0; i < items.length; i++) {
    const it = items[i]; if (y < 80) break;
    if (i % 2 === 1) page.drawRectangle({ x: 54, y: y - 12, width: 504, height: 14, color: LGRAY });
    page.drawText(String(it.category || ''), { x: 54, y: y - 9, size: 8, font: regFont, color: NAVY });
    page.drawText(String(it.description || '').substring(0, 60), { x: 160, y: y - 9, size: 8, font: regFont, color: NAVY });
    page.drawText(fmt(it.amount), { x: 530, y: y - 9, size: 8, font: regFont, color: NAVY });
    y -= 14;
  }
  y -= 6;
  page.drawRectangle({ x: 54, y: y - 2, width: 504, height: 1, color: NAVY }); y -= 14;
  page.drawText('TOTAL', { x: 54, y: y, size: 11, font: boldFont, color: NAVY });
  page.drawText(fmt(total), { x: 525, y: y, size: 11, font: boldFont, color: PURPLE });

  if (sub.summary) {
    y -= 24;
    page.drawText('Notes: ' + String(sub.summary).substring(0, 120), { x: 54, y: y, size: 9, font: regFont, color: rgb(0.4,0.4,0.4) });
  }

  const pdfBytes = await pdfDoc.save();
  const pdfB64 = Buffer.from(pdfBytes).toString('base64');

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
    + '<div style="background:#102558;padding:16px 24px;border-radius:6px 6px 0 0;display:flex;align-items:center">'
    + '<img src="https://pm.reliable-oilfield-services.com/ros-logo.png" style="width:52px;height:52px;margin-right:14px;filter:invert(1);flex-shrink:0" />'
    + '<div><div style="color:#fff;font-size:19px;font-weight:bold;line-height:1.2">Reliable Oilfield Services</div>'
    + '<div style="color:rgba(255,255,255,0.6);font-size:11px">reliable-oilfield-services.com</div></div>'
    + '</div>'
    + '<div style="background:#7c2fcb;height:4px"></div>'
    + '<div style="padding:24px;background:#fff;border:1px solid #ddd;border-top:none">'
    + '<h2 style="color:#102558;margin:0 0 16px">Expense Report</h2>'
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
    + '</div>'
    + '<div style="text-align:center;padding:10px;color:#999;font-size:11px;border-top:1px solid #eee">Powered by ReliableTrack™ &bull; Reliable Oilfield Services</div>'
    + '</div>';

  const emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: TO,
      subject: 'Expense Report - ' + (sub.truck_number || techName) + ' - ' + fmtDate(sub.date) + ' - ' + fmt(total),
      html: html,
      attachments: [{ filename: 'expense-report-' + (sub.date||'') + '.pdf', content: pdfB64 }],
    }),
  });
  const emailData = await emailResp.json();
  if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
  return res.status(200).json({ ok: true, emailId: emailData.id });
}

// ── DAILY INSPECTION REPORT ───────────────────────────────────────────────
async function sendInspectionReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts, logoImageBytes) {
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

  const addPage = await buildPageFactory(pdfDoc, boldFont, regFont, rgb, TEAL, 'Vehicle Inspection', logoImageBytes);
  const page = addPage(pdfDoc);
  let y = 720;

  page.drawText('DAILY VEHICLE INSPECTION', { x: 54, y: y, size: 14, font: boldFont, color: NAVY }); y -= 12;
  page.drawRectangle({ x: 54, y: y, width: 504, height: 2, color: TEAL }); y -= 20;

  page.drawText('Tech: ' + techName, { x: 54, y: y, size: 10, font: regFont, color: NAVY });
  page.drawText('Odometer: ' + (d.odometer || 'N/A'), { x: 250, y: y, size: 10, font: regFont, color: NAVY });
  page.drawText(inspType + ' | Truck: ' + (sub.truck_number || ''), { x: 54, y: y - 14, size: 9, font: regFont, color: NAVY });

  if (!allPass) {
    page.drawRectangle({ x: 420, y: y - 2, width: 140, height: 16, color: RED });
    page.drawText(failCount + ' DEFECT(S) FOUND', { x: 425, y: y + 1, size: 9, font: boldFont, color: WHITE });
  } else {
    page.drawRectangle({ x: 420, y: y - 2, width: 140, height: 16, color: GREEN });
    page.drawText('ALL ITEMS PASSED', { x: 425, y: y + 1, size: 9, font: boldFont, color: WHITE });
  }
  y -= 30;

  const sections = {};
  for (const c of checks) {
    const sec = c.section || 'General';
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push(c);
  }

  for (const [secName, items] of Object.entries(sections)) {
    if (y < 60) { addPage(pdfDoc); y = 720; }
    page.drawText(secName.toUpperCase(), { x: 54, y: y, size: 9, font: boldFont, color: NAVY }); y -= 4;
    page.drawRectangle({ x: 54, y: y - 1, width: 504, height: 1, color: TEAL }); y -= 10;
    for (const item of items) {
      if (y < 60) break;
      const statusColor = item.status === 'Fail' ? RED : item.status === 'N/A' ? rgb(0.5,0.5,0.5) : GREEN;
      page.drawRectangle({ x: 54, y: y - 10, width: 8, height: 10, color: statusColor });
      page.drawText(String(item.label || ''), { x: 64, y: y - 8, size: 8, font: regFont, color: rgb(0.2,0.2,0.2) });
      page.drawText(String(item.status || 'Pass'), { x: 520, y: y - 8, size: 8, font: boldFont, color: statusColor });
      y -= 12;
    }
    y -= 4;
  }

  if (d.defects && y > 60) {
    y -= 6;
    page.drawText('DEFECT NOTES:', { x: 54, y: y, size: 9, font: boldFont, color: RED }); y -= 12;
    page.drawText(String(d.defects).substring(0, 120), { x: 54, y: y, size: 8, font: regFont, color: RED });
  }

  const pdfBytes = await pdfDoc.save();
  const pdfB64 = Buffer.from(pdfBytes).toString('base64');

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
    + '<div style="background:#102558;padding:16px 24px;border-radius:6px 6px 0 0;display:flex;align-items:center">'
    + '<img src="https://pm.reliable-oilfield-services.com/ros-logo.png" style="width:52px;height:52px;margin-right:14px;filter:invert(1);flex-shrink:0" />'
    + '<div><div style="color:#fff;font-size:19px;font-weight:bold;line-height:1.2">Reliable Oilfield Services</div>'
    + '<div style="color:rgba(255,255,255,0.6);font-size:11px">reliable-oilfield-services.com</div></div>'
    + '</div>'
    + '<div style="background:#0ea5a5;height:4px"></div>'
    + '<div style="padding:24px;background:#fff;border:1px solid #ddd;border-top:none">'
    + '<h2 style="color:#102558;margin:0 0 16px">Daily Vehicle Inspection</h2>'
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
    + '</div>'
    + '<div style="text-align:center;padding:10px;color:#999;font-size:11px;border-top:1px solid #eee">Powered by ReliableTrack™ &bull; Reliable Oilfield Services</div>'
    + '</div>';

  const emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: TO,
      subject: (allPass ? '✓ All Pass - Vehicle Inspection' : '⚠️ URGENT: ' + failCount + ' DEFECT(S) FOUND - Vehicle Inspection')
        + ' - ' + (sub.truck_number||'') + ' - ' + techName + ' - ' + fmtDate(sub.date),
      html: html,
      attachments: [{ filename: 'inspection-' + (sub.truck_number||'truck') + '-' + (sub.date||'') + '.pdf', content: pdfB64 }],
    }),
  });
  const emailData = await emailResp.json();
  if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
  return res.status(200).json({ ok: true, emailId: emailData.id });
}

// ── JHA / JSA REPORT ─────────────────────────────────────────────────────
async function sendJhaReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts, logoImageBytes) {
  var steps = Array.isArray(d.jhaSteps) ? d.jhaSteps : [];
  var ppeList = Array.isArray(d.jhaPPE) ? d.jhaPPE : [];
  var techName = d.techs && d.techs.length ? d.techs[0] : '';
  var crew = d.jhaCrewMembers || '';
  var supervisor = d.jhaSupervisor || '';
  var emergency = d.jhaEmergencyContact || '';
  var hospital = d.jhaNearestHospital || '';
  var muster = d.jhaMeetingPoint || '';
  var extraNotes = d.jhaAdditionalHazards || '';
  var highRisk = steps.filter(function(s){ return s.risk === 'High' || s.risk === 'Critical'; }).length;
  var siteName = sub.location_name || sub.customer_name || '';

  var pdfDoc = await PDFDocument.create();
  var boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  var regFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  var NAVY = rgb(0.063, 0.149, 0.290);
  var GREEN = rgb(0.024, 0.588, 0.416);
  var RED = rgb(0.85, 0.1, 0.1);
  var AMBER = rgb(0.937, 0.400, 0.000);
  var WHITE = rgb(1, 1, 1);
  var LGRAY = rgb(0.95, 0.95, 0.95);

  var addPage = await buildPageFactory(pdfDoc, boldFont, regFont, rgb, GREEN, 'Job Hazard Analysis', logoImageBytes);
  var page = addPage(pdfDoc);
  var y = 720;

  page.drawText('JOB HAZARD ANALYSIS / JSA', { x: 54, y: y, size: 14, font: boldFont, color: NAVY }); y -= 12;
  page.drawRectangle({ x: 54, y: y, width: 504, height: 2, color: GREEN }); y -= 18;

  if (highRisk > 0) {
    page.drawRectangle({ x: 54, y: y - 2, width: 504, height: 16, color: RED });
    page.drawText('WARNING: ' + highRisk + ' HIGH/CRITICAL RISK STEP(S) - SUPERVISOR APPROVAL REQUIRED', { x: 54, y: y + 1, size: 8, font: boldFont, color: WHITE });
    y -= 22;
  }

  page.drawText('Lead Tech: ' + techName, { x: 54, y: y, size: 9, font: regFont, color: NAVY });
  page.drawText('Date: ' + fmtDate(sub.date), { x: 250, y: y, size: 9, font: regFont, color: NAVY });
  page.drawText('Truck: ' + (sub.truck_number || ''), { x: 400, y: y, size: 9, font: regFont, color: NAVY });
  y -= 13;
  page.drawText('Site: ' + siteName, { x: 54, y: y, size: 9, font: regFont, color: NAVY });
  if (supervisor) page.drawText('Supervisor: ' + supervisor, { x: 300, y: y, size: 9, font: regFont, color: NAVY });
  y -= 13;
  if (crew) { page.drawText('Crew: ' + crew, { x: 54, y: y, size: 9, font: regFont, color: NAVY }); y -= 13; }
  y -= 6;

  page.drawText('HAZARD IDENTIFICATION & CONTROLS', { x: 54, y: y, size: 9, font: boldFont, color: NAVY }); y -= 6;
  page.drawRectangle({ x: 54, y: y - 1, width: 504, height: 2, color: GREEN }); y -= 14;

  page.drawRectangle({ x: 54, y: y - 14, width: 504, height: 16, color: NAVY });
  page.drawText('#', { x: 54, y: y - 11, size: 7, font: boldFont, color: WHITE });
  page.drawText('Task Step', { x: 68, y: y - 11, size: 7, font: boldFont, color: WHITE });
  page.drawText('Hazard(s)', { x: 215, y: y - 11, size: 7, font: boldFont, color: WHITE });
  page.drawText('Controls', { x: 345, y: y - 11, size: 7, font: boldFont, color: WHITE });
  page.drawText('Risk', { x: 543, y: y - 11, size: 7, font: boldFont, color: WHITE });
  y -= 18;

  for (var i = 0; i < steps.length; i++) {
    var s = steps[i]; if (y < 60) break;
    var rc = (s.risk === 'Critical' || s.risk === 'High') ? RED : (s.risk === 'Medium' ? AMBER : GREEN);
    if (i % 2 === 1) page.drawRectangle({ x: 54, y: y - 14, width: 504, height: 16, color: LGRAY });
    page.drawText(String(i + 1), { x: 54, y: y - 10, size: 7, font: regFont, color: NAVY });
    page.drawText(String(s.taskStep || '').substring(0, 22), { x: 68, y: y - 10, size: 7, font: regFont, color: NAVY });
    page.drawText(String(s.hazard || '').substring(0, 22), { x: 215, y: y - 10, size: 7, font: regFont, color: NAVY });
    page.drawText(String(s.controls || '').substring(0, 26), { x: 345, y: y - 10, size: 7, font: regFont, color: NAVY });
    page.drawText(String(s.risk || 'Med'), { x: 540, y: y - 10, size: 7, font: boldFont, color: rc });
    y -= 16;
  }
  y -= 8;

  if (ppeList.length > 0 && y > 80) {
    page.drawText('REQUIRED PPE: ' + ppeList.join(', '), { x: 54, y: y, size: 8, font: regFont, color: NAVY }); y -= 14;
  }

  if ((emergency || hospital) && y > 80) {
    page.drawRectangle({ x: 54, y: y - 2, width: 504, height: 1, color: RED }); y -= 10;
    page.drawText('EMERGENCY INFO', { x: 54, y: y, size: 9, font: boldFont, color: RED }); y -= 12;
    if (emergency) { page.drawText('Contact: ' + emergency, { x: 54, y: y, size: 8, font: regFont, color: NAVY }); y -= 11; }
    if (hospital) { page.drawText('Hospital: ' + hospital, { x: 54, y: y, size: 8, font: regFont, color: NAVY }); y -= 11; }
    if (muster) { page.drawText('Muster: ' + muster, { x: 54, y: y, size: 8, font: regFont, color: NAVY }); y -= 11; }
  }

  if (extraNotes && y > 80) {
    y -= 6;
    page.drawText('Notes: ' + String(extraNotes).substring(0, 120), { x: 54, y: y, size: 8, font: regFont, color: rgb(0.4,0.4,0.4) });
  }

  var pdfBytes = await pdfDoc.save();
  var pdfB64 = Buffer.from(pdfBytes).toString('base64');

  var stepRows = steps.map(function(s, i) {
    var riskColor = s.risk === 'Critical' ? '#7c3aed' : s.risk === 'High' ? '#dc2626' : s.risk === 'Medium' ? '#d97706' : '#16a34a';
    return '<tr><td style="padding:7px 8px;border-bottom:1px solid #eee;font-weight:700;color:#102558">' + (i+1) + '</td>'
      + '<td style="padding:7px 8px;border-bottom:1px solid #eee">' + (s.taskStep||'') + '</td>'
      + '<td style="padding:7px 8px;border-bottom:1px solid #eee;color:#dc2626">' + (s.hazard||'') + '</td>'
      + '<td style="padding:7px 8px;border-bottom:1px solid #eee;color:#16a34a">' + (s.controls||'') + '</td>'
      + '<td style="padding:7px 8px;border-bottom:1px solid #eee;font-weight:700;color:' + riskColor + '">' + (s.risk||'Med') + '</td></tr>';
  }).join('');

  var ppeHtml = ppeList.length > 0
    ? ppeList.map(function(p){ return '<span style="display:inline-block;background:#eef2ff;border:1px solid #1a2332;color:#1a2332;padding:3px 10px;border-radius:12px;font-size:12px;margin:3px">' + p + '</span>'; }).join('')
    : '<em style="color:#888">None specified</em>';

  var subjectPrefix = highRisk > 0 ? '⚠️ URGENT JHA - ' + highRisk + ' HIGH RISK - ' : '✓ JHA/JSA - ';

  var html = '<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">'
    + '<div style="background:#102558;padding:16px 24px;border-radius:6px 6px 0 0;display:flex;align-items:center">'
    + '<img src="https://pm.reliable-oilfield-services.com/ros-logo.png" style="width:52px;height:52px;margin-right:14px;filter:invert(1);flex-shrink:0" />'
    + '<div><div style="color:#fff;font-size:19px;font-weight:bold;line-height:1.2">Reliable Oilfield Services</div>'
    + '<div style="color:rgba(255,255,255,0.6);font-size:11px">reliable-oilfield-services.com</div></div>'
    + '</div>'
    + '<div style="background:#059669;height:4px"></div>'
    + '<div style="padding:24px;background:#fff;border:1px solid #ddd;border-top:none">'
    + '<h2 style="color:#102558;margin:0 0 16px">Job Hazard Analysis / JSA</h2>'
    + (highRisk > 0 ? '<div style="background:#fef2f2;border:2px solid #dc2626;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-weight:bold;color:#991b1b">⚠️ ' + highRisk + ' HIGH/CRITICAL RISK STEP(S) IDENTIFIED — Supervisor approval required before starting work</div>' : '')
    + '<table style="width:100%;font-size:13px;margin-bottom:20px;border-collapse:collapse">'
    + '<tr><td style="padding:5px;background:#f5f5f5;font-weight:bold;width:140px">Lead Tech</td><td style="padding:5px">' + techName + '</td><td style="padding:5px;background:#f5f5f5;font-weight:bold;width:140px">Date</td><td style="padding:5px">' + fmtDate(sub.date) + '</td></tr>'
    + '<tr><td style="padding:5px;background:#f5f5f5;font-weight:bold">Site / Location</td><td style="padding:5px">' + siteName + '</td><td style="padding:5px;background:#f5f5f5;font-weight:bold">Truck</td><td style="padding:5px">' + (sub.truck_number||'') + '</td></tr>'
    + (supervisor ? '<tr><td style="padding:5px;background:#f5f5f5;font-weight:bold">Supervisor</td><td style="padding:5px" colspan="3">' + supervisor + '</td></tr>' : '')
    + (crew ? '<tr><td style="padding:5px;background:#f5f5f5;font-weight:bold">Crew</td><td style="padding:5px" colspan="3">' + crew + '</td></tr>' : '')
    + (sub.summary || d.jobDescription ? '<tr><td style="padding:5px;background:#f5f5f5;font-weight:bold">Task Description</td><td style="padding:5px" colspan="3">' + (sub.summary||d.jobDescription||'') + '</td></tr>' : '')
    + '</table>'
    + '<h3 style="color:#102558;border-bottom:2px solid #059669;padding-bottom:6px;margin-bottom:8px">Hazard Identification &amp; Controls</h3>'
    + '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px">'
    + '<thead><tr style="background:#102558;color:#fff"><th style="padding:8px;text-align:left">#</th><th style="padding:8px;text-align:left">Task Step</th><th style="padding:8px;text-align:left">Hazard(s)</th><th style="padding:8px;text-align:left">Control Measures</th><th style="padding:8px;text-align:left">Risk</th></tr></thead>'
    + '<tbody>' + stepRows + '</tbody></table>'
    + (ppeList.length > 0 ? '<h3 style="color:#102558;border-bottom:2px solid #059669;padding-bottom:6px">Required PPE</h3><div style="margin-bottom:20px">' + ppeHtml + '</div>' : '')
    + '<h3 style="color:#dc2626;border-bottom:2px solid #dc2626;padding-bottom:6px">Emergency Information</h3>'
    + '<table style="width:100%;font-size:13px;border-collapse:collapse">'
    + (emergency ? '<tr><td style="padding:5px;background:#fff5f5;font-weight:bold;width:180px">Emergency Contact</td><td style="padding:5px">' + emergency + '</td></tr>' : '')
    + (hospital ? '<tr><td style="padding:5px;background:#fff5f5;font-weight:bold">Nearest Hospital</td><td style="padding:5px">' + hospital + '</td></tr>' : '')
    + (muster ? '<tr><td style="padding:5px;background:#fff5f5;font-weight:bold">Muster Point</td><td style="padding:5px">' + muster + '</td></tr>' : '')
    + '</table>'
    + (extraNotes ? '<div style="background:#f0f9ff;border-left:4px solid #0891b2;padding:12px;margin-top:16px;border-radius:4px"><strong>Additional Hazards / Notes:</strong><p style="margin:6px 0 0;color:#444">' + extraNotes + '</p></div>' : '')
    + '</div>'
    + '<div style="text-align:center;padding:10px;color:#999;font-size:11px;border-top:1px solid #eee">Powered by ReliableTrack™ &bull; Reliable Oilfield Services</div>'
    + '</div>';

  var emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: TO,
      subject: subjectPrefix + siteName + ' - ' + techName + ' - ' + fmtDate(sub.date),
      html: html,
      attachments: [{ filename: 'jha-' + (sub.date||'') + '.pdf', content: pdfB64 }],
    }),
  });
  var emailData = await emailResp.json();
  if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
  return res.status(200).json({ ok: true, emailId: emailData.id });
}
