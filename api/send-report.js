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
  const isPM      = sub.template === 'pm_flare_combustor'
  const jobLabel  = d.jobType || (isPM ? 'Preventive Maintenance' : 'Service Call')
  const woNum     = sub.work_order || sub.pm_number || ''
  const label     = 'WO #' + woNum

  // ── Colours ────────────────────────────────────────────────────────────────
  const NAVY    = rgb(0.059, 0.122, 0.220)   // #0f1f38
  const NAVYMD  = rgb(0.102, 0.180, 0.290)   // #1a2e4a
  const ORANGE  = rgb(0.902, 0.361, 0.000)   // #e65c00
  const GREEN   = rgb(0.102, 0.431, 0.235)   // #1a6e3c — PM accent
  const ACCNT   = isPM ? GREEN : ORANGE
  const WHITE   = rgb(1, 1, 1)
  const LTGRAY  = rgb(0.94, 0.94, 0.96)
  const MDGRAY  = rgb(0.55, 0.55, 0.60)
  const DKGRAY  = rgb(0.25, 0.25, 0.30)
  const AMBER   = rgb(0.87, 0.42, 0.00)

  // ── Create PDF ──────────────────────────────────────────────────────────────
  const pdfDoc  = await PDFDocument.create()
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const regFont  = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const PW = 612, PH = 792
  const ML = 48, MR = 48, MT = 36

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function newPage() {
    const p = pdfDoc.addPage([PW, PH])
    return { page: p, y: PH - MT }
  }

  function safeText(page, text, opts) {
    if (!text) return
    const str = String(text)
    // Clip to page width so nothing overflows
    const maxW = opts.maxWidth || (PW - ML - MR)
    const size = opts.size || 10
    const font = opts.font || regFont
    const measured = font.widthOfTextAtSize(str, size)
    if (measured > maxW) {
      // Truncate with ellipsis
      let s = str
      while (s.length > 3 && font.widthOfTextAtSize(s + '…', size) > maxW) s = s.slice(0, -1)
      page.drawText(s + '…', { ...opts, text: undefined })
      return
    }
    page.drawText(str, opts)
  }

  function sectionHeader(page, y, title, accent) {
    // Colored left bar + bold title
    page.drawRectangle({ x: ML, y: y - 2, width: 4, height: 16, color: accent || ACCNT })
    page.drawRectangle({ x: ML + 4, y: y - 2, width: PW - ML - MR - 4, height: 16, color: LTGRAY })
    safeText(page, title.toUpperCase(), { x: ML + 10, y: y + 2, size: 8, font: boldFont, color: NAVYMD })
    return y - 26
  }

  function field(page, y, label, value, x, w) {
    safeText(page, label, { x: x, y: y + 12, size: 7, font: regFont, color: MDGRAY })
    page.drawRectangle({ x: x, y: y, width: w, height: 14, color: LTGRAY })
    safeText(page, String(value || '—'), { x: x + 4, y: y + 3, size: 9, font: regFont, color: DKGRAY, maxWidth: w - 8 })
    return y - 28
  }

  function hline(page, y) {
    page.drawRectangle({ x: ML, y: y, width: PW - ML - MR, height: 0.5, color: LTGRAY })
  }

  function dollar(n) { return '$' + (parseFloat(n) || 0).toFixed(2) }
  function fmtD(s) { if (!s) return '' ; try { return new Date(s + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) } catch(e) { return s } }

  // ══════════════════════════════════════════════════════════════════
  // PAGE 1
  // ══════════════════════════════════════════════════════════════════
  let { page, y } = newPage()

  // ── Hero banner ─────────────────────────────────────────────────────────
  const bannerH = 72
  // Background gradient-like: navy rect + accent strip
  page.drawRectangle({ x: 0, y: PH - bannerH, width: PW, height: bannerH, color: NAVY })
  page.drawRectangle({ x: 0, y: PH - bannerH, width: 6, height: bannerH, color: ACCNT })

  // Logo
  if (logoImageBytes) {
    try {
      const logoImg = await pdfDoc.embedPng(logoImageBytes).catch(() => pdfDoc.embedJpg(logoImageBytes))
      page.drawImage(logoImg, { x: ML, y: PH - bannerH + 14, width: 40, height: 40 })
    } catch(e) {}
  }

  // "WORK ORDER REPORT" small label
  page.drawText('WORK ORDER REPORT', { x: ML + 50, y: PH - 24, size: 8, font: boldFont, color: ACCNT })
  // Company
  page.drawText('Reliable Oilfield Services', { x: ML + 50, y: PH - 35, size: 9, font: boldFont, color: WHITE })

  // WO Number — large and prominent
  const woLabel = 'WO #' + woNum
  page.drawText(woLabel, { x: PW / 2 - 60, y: PH - 34, size: 22, font: boldFont, color: WHITE })

  // Job type pill
  const pillW = 140
  page.drawRectangle({ x: PW / 2 - 60, y: PH - bannerH + 10, width: pillW, height: 16, color: ACCNT })
  safeText(page, jobLabel, { x: PW / 2 - 56, y: PH - bannerH + 14, size: 8, font: boldFont, color: WHITE, maxWidth: pillW - 8 })

  // Date top right
  page.drawText(fmtD(sub.date), { x: PW - MR - 90, y: PH - 26, size: 9, font: regFont, color: WHITE })
  page.drawText('Generated ' + new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}), { x: PW - MR - 110, y: PH - 38, size: 7, font: regFont, color: rgb(0.6,0.6,0.7) })

  y = PH - bannerH - 20


  // ── JOB INFORMATION ──────────────────────────────────────────────────────
  y = sectionHeader(page, y, 'Job Information')

  // Row 1: Customer | Location | Date
  field(page, y, 'Customer', sub.customer_name, ML, 175)
  field(page, y, 'Location / Well', sub.location_name, ML + 183, 175)
  field(page, y, 'Date', fmtD(sub.date), ML + 366, 150)
  y -= 28

  // Row 2: Contact | Work Order | Truck #
  field(page, y, 'Contact', sub.contact, ML, 175)
  field(page, y, 'WO Number', sub.work_order || sub.pm_number, ML + 183, 120)
  field(page, y, 'Truck #', sub.truck_number, ML + 311, 100)
  field(page, y, 'Start Time', sub.start_time || '', ML + 419, 97)
  y -= 28

  // Row 3: Work Type | GL Code | Asset Tag | Work Area
  field(page, y, 'Type of Work', sub.work_type, ML, 120)
  field(page, y, 'GL Code', sub.gl_code, ML + 128, 90)
  field(page, y, 'Asset Tag', sub.asset_tag, ML + 226, 110)
  field(page, y, 'Work Area', sub.work_area, ML + 344, 172)
  y -= 36

  // Warranty badge
  if (d.warrantyWork) {
    page.drawRectangle({ x: ML, y: y + 4, width: 130, height: 16, color: GREEN })
    page.drawText('WARRANTY — NO CHARGE', { x: ML + 4, y: y + 7, size: 8, font: boldFont, color: WHITE })
    y -= 24
  }


  // ── TECHNICIANS ────────────────────────────────────────────────────────────
  y = sectionHeader(page, y, 'Technicians')
  const techs = Array.isArray(d.techs) ? d.techs : []
  if (techs.length === 0) {
    safeText(page, 'No technicians listed', { x: ML + 6, y: y, size: 9, font: regFont, color: MDGRAY })
    y -= 18
  } else {
    // Two columns of tech names
    techs.forEach(function(t, idx) {
      const techName = typeof t === 'string' ? t : (t.name || t.tech || JSON.stringify(t))
      const col = idx % 2
      const row = Math.floor(idx / 2)
      const tx = ML + col * 250
      const ty = y - row * 16
      if (ty < 60) return
      page.drawRectangle({ x: tx, y: ty - 2, width: 6, height: 6, color: ACCNT })
      safeText(page, techName, { x: tx + 10, y: ty, size: 9, font: regFont, color: DKGRAY, maxWidth: 230 })
    })
    y -= Math.ceil(techs.length / 2) * 16 + 6
  }
  y -= 8

  // ── WORK DESCRIPTION ───────────────────────────────────────────────────────
  y = sectionHeader(page, y, 'Work Description')
  const descLines = (sub.summary || '').match(/.{1,95}/g) || ['No description provided']
  descLines.slice(0, 8).forEach(function(ln) {
    if (y < 80) return
    safeText(page, ln, { x: ML + 4, y: y, size: 9, font: regFont, color: DKGRAY })
    y -= 14
  })
  y -= 10

  // ── REPORTED ISSUE / ROOT CAUSE (SC/Repair) ────────────────────────────────
  if (!isPM && (d.reportedIssue || d.rootCause)) {
    y = sectionHeader(page, y, 'Issue Details')
    if (d.reportedIssue) {
      safeText(page, 'Reported Issue:', { x: ML + 4, y: y, size: 8, font: boldFont, color: DKGRAY })
      y -= 14
      const riLines = String(d.reportedIssue).match(/.{1,90}/g) || []
      riLines.slice(0, 4).forEach(function(ln) {
        safeText(page, ln, { x: ML + 12, y: y, size: 9, font: regFont, color: DKGRAY })
        y -= 13
      })
    }
    if (d.rootCause) {
      safeText(page, 'Root Cause:', { x: ML + 4, y: y, size: 8, font: boldFont, color: DKGRAY })
      y -= 14
      const rcLines = String(d.rootCause).match(/.{1,90}/g) || []
      rcLines.slice(0, 4).forEach(function(ln) {
        safeText(page, ln, { x: ML + 12, y: y, size: 9, font: regFont, color: DKGRAY })
        y -= 13
      })
    }
    y -= 8
  }


  // ── EQUIPMENT WORKED ON (SC/Repair) ────────────────────────────────────────
  const scEq = Array.isArray(d.scEquipment) ? d.scEquipment : []
  if (!isPM && scEq.length > 0) {
    if (y < 120) { let np = newPage(); page = np.page; y = np.y }
    y = sectionHeader(page, y, 'Equipment Worked On')
    scEq.slice(0, 12).forEach(function(eq, i) {
      const eqName = typeof eq === 'string' ? eq : (eq.name || eq.label || JSON.stringify(eq))
      const col = i % 3
      const row = Math.floor(i / 3)
      const ex = ML + col * 170
      const ey = y - row * 16
      if (ey < 60) return
      page.drawRectangle({ x: ex, y: ey - 2, width: 6, height: 6, color: ACCNT })
      safeText(page, eqName, { x: ex + 10, y: ey, size: 9, font: regFont, color: DKGRAY, maxWidth: 155 })
    })
    y -= Math.ceil(scEq.length / 3) * 16 + 10
  }

  // ── PARTS / MATERIALS ──────────────────────────────────────────────────────
  const parts = Array.isArray(d.parts) ? d.parts.filter(function(p){ return p && p.name }) : []
  if (parts.length > 0) {
    if (y < 140) { let np = newPage(); page = np.page; y = np.y }
    y = sectionHeader(page, y, 'Parts & Materials')

    // Table header
    page.drawRectangle({ x: ML, y: y, width: PW - ML - MR, height: 16, color: NAVYMD })
    page.drawText('Part / Description', { x: ML + 4, y: y + 4, size: 8, font: boldFont, color: WHITE })
    page.drawText('Qty', { x: ML + 300, y: y + 4, size: 8, font: boldFont, color: WHITE })
    page.drawText('Unit $', { x: ML + 355, y: y + 4, size: 8, font: boldFont, color: WHITE })
    page.drawText('Total', { x: ML + 420, y: y + 4, size: 8, font: boldFont, color: WHITE })
    y -= 18

    parts.slice(0, 30).forEach(function(p, i) {
      if (y < 60) return
      const rowBg = i % 2 === 0 ? WHITE : LTGRAY
      page.drawRectangle({ x: ML, y: y - 2, width: PW - ML - MR, height: 15, color: rowBg })
      safeText(page, p.name || '', { x: ML + 4, y: y + 2, size: 8, font: regFont, color: DKGRAY, maxWidth: 285 })
      safeText(page, String(p.qty || ''), { x: ML + 304, y: y + 2, size: 8, font: regFont, color: DKGRAY })
      safeText(page, p.unitPrice != null ? dollar(p.unitPrice) : '', { x: ML + 355, y: y + 2, size: 8, font: regFont, color: DKGRAY })
      const tot = (parseFloat(p.qty)||0) * (parseFloat(p.unitPrice)||0)
      safeText(page, tot > 0 ? dollar(tot) : '', { x: ML + 420, y: y + 2, size: 8, font: boldFont, color: DKGRAY })
      hline(page, y - 2)
      y -= 15
    })
    y -= 8
  }


  // ── PM EQUIPMENT ────────────────────────────────────────────────────────────
  if (isPM) {
    const arrestors = Array.isArray(d.arrestors) ? d.arrestors.filter(function(a){ return a && a.arrestorId }) : []
    const flares    = Array.isArray(d.flares)    ? d.flares.filter(function(f){ return f && f.flareId }) : []
    const heaters   = Array.isArray(d.heaters)   ? d.heaters.filter(function(h){ return h && h.heaterId }) : []

    if (arrestors.length > 0) {
      if (y < 120) { let np = newPage(); page = np.page; y = np.y }
      y = sectionHeader(page, y, 'Flame Arrestors')
      page.drawRectangle({ x: ML, y: y, width: PW - ML - MR, height: 14, color: NAVYMD })
      page.drawText('ID', { x: ML + 4, y: y + 3, size: 7, font: boldFont, color: WHITE })
      page.drawText('Condition', { x: ML + 100, y: y + 3, size: 7, font: boldFont, color: WHITE })
      page.drawText('Filter Changed', { x: ML + 230, y: y + 3, size: 7, font: boldFont, color: WHITE })
      page.drawText('Notes', { x: ML + 340, y: y + 3, size: 7, font: boldFont, color: WHITE })
      y -= 16
      arrestors.slice(0, 15).forEach(function(a, i) {
        if (y < 60) return
        const bg = i % 2 === 0 ? WHITE : LTGRAY
        page.drawRectangle({ x: ML, y: y - 2, width: PW - ML - MR, height: 14, color: bg })
        safeText(page, a.arrestorId, { x: ML + 4, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 90 })
        safeText(page, a.condition || '', { x: ML + 100, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 125 })
        safeText(page, a.filterChanged ? 'Yes' : 'No', { x: ML + 230, y: y + 1, size: 8, font: regFont, color: DKGRAY })
        safeText(page, a.notes || '', { x: ML + 340, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 170 })
        y -= 14
      })
      y -= 10
    }

    if (flares.length > 0) {
      if (y < 120) { let np = newPage(); page = np.page; y = np.y }
      y = sectionHeader(page, y, 'Flares / Combustors')
      page.drawRectangle({ x: ML, y: y, width: PW - ML - MR, height: 14, color: NAVYMD })
      page.drawText('ID', { x: ML + 4, y: y + 3, size: 7, font: boldFont, color: WHITE })
      page.drawText('Condition', { x: ML + 100, y: y + 3, size: 7, font: boldFont, color: WHITE })
      page.drawText('Pilot Lit', { x: ML + 240, y: y + 3, size: 7, font: boldFont, color: WHITE })
      page.drawText('Notes', { x: ML + 310, y: y + 3, size: 7, font: boldFont, color: WHITE })
      y -= 16
      flares.slice(0, 15).forEach(function(f, i) {
        if (y < 60) return
        const bg = i % 2 === 0 ? WHITE : LTGRAY
        page.drawRectangle({ x: ML, y: y - 2, width: PW - ML - MR, height: 14, color: bg })
        safeText(page, f.flareId, { x: ML + 4, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 90 })
        safeText(page, f.condition || '', { x: ML + 100, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 135 })
        safeText(page, f.pilotLit ? 'Yes' : 'No', { x: ML + 240, y: y + 1, size: 8, font: regFont, color: DKGRAY })
        safeText(page, f.notes || '', { x: ML + 310, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 200 })
        y -= 14
      })
      y -= 10
    }

    if (heaters.length > 0) {
      if (y < 120) { let np = newPage(); page = np.page; y = np.y }
      y = sectionHeader(page, y, 'Heater Treaters')
      page.drawRectangle({ x: ML, y: y, width: PW - ML - MR, height: 14, color: NAVYMD })
      page.drawText('ID', { x: ML + 4, y: y + 3, size: 7, font: boldFont, color: WHITE })
      page.drawText('Condition', { x: ML + 100, y: y + 3, size: 7, font: boldFont, color: WHITE })
      page.drawText('Last Cleaned', { x: ML + 240, y: y + 3, size: 7, font: boldFont, color: WHITE })
      page.drawText('Firetubes', { x: ML + 340, y: y + 3, size: 7, font: boldFont, color: WHITE })
      page.drawText('Notes', { x: ML + 400, y: y + 3, size: 7, font: boldFont, color: WHITE })
      y -= 16
      heaters.slice(0, 15).forEach(function(h, i) {
        if (y < 60) return
        const bg = i % 2 === 0 ? WHITE : LTGRAY
        page.drawRectangle({ x: ML, y: y - 2, width: PW - ML - MR, height: 14, color: bg })
        safeText(page, h.heaterId, { x: ML + 4, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 90 })
        safeText(page, h.condition || '', { x: ML + 100, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 135 })
        safeText(page, h.lastCleanDate ? fmtD(h.lastCleanDate) : '', { x: ML + 240, y: y + 1, size: 8, font: regFont, color: DKGRAY })
        safeText(page, String(h.firetubeCnt || ''), { x: ML + 340, y: y + 1, size: 8, font: regFont, color: DKGRAY })
        safeText(page, h.notes || '', { x: ML + 400, y: y + 1, size: 8, font: regFont, color: DKGRAY, maxWidth: 110 })
        y -= 14
      })
      y -= 10
    }
  }


  // ── COST SUMMARY ────────────────────────────────────────────────────────────
  if (y < 160) { let np = newPage(); page = np.page; y = np.y }
  y = sectionHeader(page, y, 'Cost Summary')

  const summaryW = 260
  const summaryX = PW - MR - summaryW

  function costRow(label, amount, isBold, isTotal) {
    if (y < 60) return
    const bg = isTotal ? ACCNT : (isBold ? NAVYMD : WHITE)
    const fc = isTotal || isBold ? WHITE : DKGRAY
    page.drawRectangle({ x: summaryX, y: y - 2, width: summaryW, height: 16, color: bg })
    safeText(page, label, { x: summaryX + 8, y: y + 2, size: isTotal ? 10 : 9, font: isBold||isTotal ? boldFont : regFont, color: fc, maxWidth: summaryW - 80 })
    safeText(page, dollar(amount), { x: summaryX + summaryW - 65, y: y + 2, size: isTotal ? 10 : 9, font: isBold||isTotal ? boldFont : regFont, color: fc })
    hline(page, y - 2)
    y -= 18
  }

  if (d.warrantyWork) {
    page.drawRectangle({ x: summaryX, y: y - 2, width: summaryW, height: 16, color: GREEN })
    safeText(page, 'WARRANTY — NO CHARGE', { x: summaryX + 8, y: y + 2, size: 9, font: boldFont, color: WHITE })
    y -= 20
  } else {
    costRow('Parts & Materials', d.partsTotal, false)
    costRow('Mileage (' + (sub.miles||'0') + ' mi)', d.mileageTotal, false)
    costRow('Labor', d.laborTotal, false)
    costRow('TOTAL DUE', d.grandTotal, false, true)
  }

  y -= 20

  // ── FOOTER ──────────────────────────────────────────────────────────────────
  // Draw footer on every page
  pdfDoc.getPages().forEach(function(pg) {
    pg.drawRectangle({ x: 0, y: 0, width: PW, height: 28, color: NAVY })
    pg.drawRectangle({ x: 0, y: 28, width: PW, height: 1, color: ACCNT })
    pg.drawText('Powered by ReliableTrack  |  Reliable Oilfield Services', { x: ML, y: 10, size: 7, font: regFont, color: rgb(0.5,0.55,0.65) })
    pg.drawText('WO #' + woNum + '  |  ' + fmtD(sub.date), { x: PW - MR - 150, y: 10, size: 7, font: regFont, color: rgb(0.5,0.55,0.65) })
  })

  // ── Serialize PDF ───────────────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save()
  const pdfB64   = Buffer.from(pdfBytes).toString('base64')

  // ── Build email HTML ────────────────────────────────────────────────────────
  const parts = Array.isArray(d.parts) ? d.parts.filter(function(p){ return p && p.name }) : []
  const partsRows = parts.map(function(p) {
    const tot = (parseFloat(p.qty)||0) * (parseFloat(p.unitPrice)||0)
    return `<tr><td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${p.name||''}</td><td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:center;">${p.qty||''}</td><td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right;">${tot>0?dollar(tot):''}</td></tr>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .wrap{max-width:640px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)}
    .hero{background:linear-gradient(135deg,#0f1f38 0%,${isPM?'#1a6e3c':'#c25c00'} 100%);padding:32px 32px 28px;color:#fff}
    .hero-label{font-size:11px;font-weight:700;letter-spacing:2px;opacity:.6;text-transform:uppercase;margin-bottom:6px}
    .hero-wo{font-size:28px;font-weight:900;letter-spacing:-0.5px;margin-bottom:8px}
    .hero-type{display:inline-block;background:rgba(255,255,255,0.15);border-radius:20px;padding:3px 14px;font-size:12px;font-weight:600;margin-bottom:4px}
    .hero-meta{font-size:12px;opacity:.7;margin-top:8px}
    .body{padding:24px 32px}
    .section{margin-bottom:22px}
    .section-title{font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${isPM?'#1a6e3c':'#c25c00'};border-left:3px solid ${isPM?'#1a6e3c':'#c25c00'};padding-left:10px;margin-bottom:10px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:4px}
    .field label{display:block;font-size:10px;color:#888;font-weight:600;margin-bottom:2px;text-transform:uppercase}
    .field span{display:block;font-size:13px;color:#1a2332;font-weight:500}
    table{width:100%;border-collapse:collapse}
    th{background:#1a2332;color:#fff;padding:8px;font-size:11px;text-align:left;font-weight:600}
    .cost-row{display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px}
    .cost-total{background:${isPM?'#1a6e3c':'#e65c00'};color:#fff;font-weight:700;font-size:14px;border-radius:0 0 6px 6px;padding:10px 12px;display:flex;justify-content:space-between}
    .footer{background:#0f1f38;color:rgba(255,255,255,0.4);font-size:11px;padding:14px 32px;text-align:center}
  </style></head><body>
  <div class="wrap">
    <div class="hero">
      <div class="hero-label">Work Order Report &mdash; Reliable Oilfield Services</div>
      <div class="hero-wo">WO #${woNum}</div>
      <div class="hero-type">${jobLabel}</div>
      <div class="hero-meta">${fmtD(sub.date)} &nbsp;&bull;&nbsp; ${sub.customer_name||''} &nbsp;&bull;&nbsp; ${sub.location_name||''}</div>
    </div>
    <div class="body">
      <div class="section">
        <div class="section-title">Job Information</div>
        <div class="grid">
          <div class="field"><label>Customer</label><span>${sub.customer_name||'—'}</span></div>
          <div class="field"><label>Location</label><span>${sub.location_name||'—'}</span></div>
          <div class="field"><label>WO Number</label><span>${sub.work_order||sub.pm_number||'—'}</span></div>
          <div class="field"><label>Truck #</label><span>${sub.truck_number||'—'}</span></div>
          <div class="field"><label>Date</label><span>${fmtD(sub.date)}</span></div>
          <div class="field"><label>Contact</label><span>${sub.contact||'—'}</span></div>
          <div class="field"><label>Type of Work</label><span>${sub.work_type||'—'}</span></div>
          <div class="field"><label>Work Area</label><span>${sub.work_area||'—'}</span></div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">Work Description</div>
        <div style="font-size:13px;color:#1a2332;line-height:1.6;">${(sub.summary||'').replace(/\n/g,'<br>')}</div>
      </div>
      ${parts.length>0?`<div class="section"><div class="section-title">Parts & Materials</div><table><thead><tr><th>Part / Description</th><th>Qty</th><th style="text-align:right">Total</th></tr></thead><tbody>${partsRows}</tbody></table></div>`:''}
      <div class="section">
        <div class="section-title">Cost Summary</div>
        <div style="background:#f8f9fa;border-radius:6px;overflow:hidden;border:1px solid #eee">
          ${d.warrantyWork?
            '<div style="background:#1a6e3c;color:#fff;padding:12px;font-weight:700;text-align:center;font-size:13px">WARRANTY — NO CHARGE</div>'
            :`<div class="cost-row"><span>Parts &amp; Materials</span><span>${dollar(d.partsTotal)}</span></div>
               <div class="cost-row"><span>Mileage</span><span>${dollar(d.mileageTotal)}</span></div>
               <div class="cost-row"><span>Labor</span><span>${dollar(d.laborTotal)}</span></div>
               <div class="cost-total"><span>TOTAL DUE</span><span>${dollar(d.grandTotal)}</span></div>`
          }
        </div>
      </div>
    </div>
    <div class="footer">Powered by ReliableTrack &nbsp;&bull;&nbsp; Reliable Oilfield Services</div>
  </div>
  </body></html>`

  // ── Video links (SC/Repair) ─────────────────────────────────────────────────
  let videoEmailHtml2 = ''
  const vidKeys = Object.keys(photos).filter(function(k){ return k.startsWith('video_') })
  if (vidKeys.length > 0) {
    videoEmailHtml2 = '<div style="max-width:640px;margin:12px auto;padding:16px 24px;background:#fff;border-radius:8px;"><strong style="color:#e65c00">Video Links</strong><ul style="margin:8px 0;padding-left:20px;">' +
      vidKeys.map(function(k){ return '<li><a href="' + photos[k] + '" style="color:#2563eb">' + k.replace('video_','').replace('_',' ') + '</a></li>' }).join('') +
      '</ul></div>'
  }

  // ── Send via Resend ─────────────────────────────────────────────────────────
  const emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: TO,
      subject: label + ' - ' + (sub.customer_name||'') + ' - ' + fmtD(sub.date),
      html: html + videoEmailHtml2,
      attachments: [{ filename: 'WorkOrder_' + woNum + '.pdf', content: pdfB64 }]
    })
  })
  const emailData = await emailResp.json()
  if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData })
  return res.status(200).json({ ok: true, emailId: emailData.id })
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
