// api/send-report.js - Vercel Serverless Function (CommonJS via api/package.json)
// Sends HTML email with PDF attachment via Resend
// pdf-lib is lazy-loaded inside handler to avoid Lambda crash
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const TO = process.env.EMAIL_TO ? process.env.EMAIL_TO.split(',').map(e => e.trim()) : ['bphetteplace@reliableoilfieldservices.net'];
const FROM = process.env.RESEND_FROM || 'ReliableTrack <reports@reliable-oilfield-services.com>';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { submissionId , pdfBase64 } = req.body || {};
  if (!submissionId) return res.status(400).json({ error: 'submissionId required' });
  if (!RESEND_KEY) return res.status(500).json({ error: 'Missing RESEND_API_KEY' });
  if (!SUPA_KEY) return res.status(500).json({ error: 'Missing Supabase key' });

  // Auth: require Supabase user JWT. The caller must own the submission OR
  // be an admin (profiles.role='admin'); otherwise unauthenticated callers
  // could spam the office mailbox and abuse the caller-supplied pdfBase64
  // as an arbitrary-attachment relay through the company domain.
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const userToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!userToken) return res.status(401).json({ error: 'Missing auth token' });
  let userId = null;
  try {
    const userRes = await fetch(SUPA_URL + '/auth/v1/user', {
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + userToken },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid or expired session' });
    const userBody = await userRes.json();
    userId = userBody && userBody.id;
    if (!userId) return res.status(401).json({ error: 'Invalid session' });
  } catch (_e) {
    return res.status(500).json({ error: 'Auth check failed' });
  }

  // Reject obviously-invalid pdfBase64 before forwarding to Resend.
  // Real PDFs start with the bytes `%PDF-` (0x25 0x50 0x44 0x46 0x2D).
  if (pdfBase64) {
    if (typeof pdfBase64 !== 'string' || pdfBase64.length > 14_000_000) {
      return res.status(400).json({ error: 'pdfBase64 invalid or too large' });
    }
    try {
      const head = Buffer.from(pdfBase64.slice(0, 12), 'base64').toString('binary');
      if (!head.startsWith('%PDF-')) {
        return res.status(400).json({ error: 'pdfBase64 not a valid PDF' });
      }
    } catch (_e) {
      return res.status(400).json({ error: 'pdfBase64 invalid base64' });
    }
  }

  try {

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

    // Ownership / admin gate.
    if (sub.created_by !== userId) {
      const profRes = await fetch(SUPA_URL + '/rest/v1/profiles?id=eq.' + userId + '&select=role', {
        headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
      });
      let isAdmin = false;
      if (profRes.ok) {
        const profs = await profRes.json();
        isAdmin = profs && profs[0] && profs[0].role === 'admin';
      }
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });
    }

    const d = sub.data || {};
    const photos = sub.photos || [];
    const template = sub.template || 'service_call';

    // Route to appropriate handler
    if (template === 'expense_report') {
              return await sendExpenseReport(res, sub, d, photos, pdfBase64);
    }
    if (template === 'daily_inspection') {
              return await sendInspectionReport(res, sub, d, photos, pdfBase64);
    }
    if (template === 'jha' || (d && d.jobType === 'JHA/JSA')) {
              return await sendJhaReport(res, sub, d, photos, pdfBase64);
    }
    // Default: PM or SC
            return await sendPmScReport(res, sub, d, photos, pdfBase64);

  } catch (err) {
    console.error('send-report error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ HELPERS ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
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
  for (const photo of sectionPhotos) {
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

// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ WORK ORDER PDF GENERATOR ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
async function generateWorkOrderPDF(sub, allPhotos, pdfBase64 = null) {
  var PDFLib = require('pdf-lib');
  var PDFDocument = PDFLib.PDFDocument;
  var rgb = PDFLib.rgb;
  var StandardFonts = PDFLib.StandardFonts;
  var PDFName = PDFLib.PDFName;
  var PDFString = PDFLib.PDFString;

  // sub has flat DB columns + sub.data (jsonb) for parts/techs/etc
  var extra = (sub.data && typeof sub.data === 'object') ? sub.data : {};

  var safeStr = function(v) {
    if (v == null) return '';
    return String(v).replace(/[^\x20-\x7E]/g, '');
  };
  var fmt = function(v) { var s = safeStr(v); return s || '--'; };
  var fmtMoney = function(n) {
    var num = parseFloat(n);
    if (isNaN(num)) return '$0.00';
    return '$' + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  var fmtDate = function(s) {
    if (!s) return '--';
    try {
      var d = new Date(s);
      var r = d.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      return safeStr(r) || '--';
    } catch(e) { return safeStr(s); }
  };

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Pull fields from flat DB columns (primary) with data fallback ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  var woNum    = safeStr(sub.work_order || extra.customerWorkOrder || '');
  var pmNum    = safeStr(sub.pm_number  || '');
  var customer = fmt(sub.customer_name);
  var location = fmt(sub.location_name);
  var contact  = fmt(sub.contact || extra.customerContact);
  var workType = fmt(sub.work_type || extra.typeOfWork);
  var workArea = fmt(sub.work_area || extra.workArea);
  var truckNum = fmt(sub.truck_number);
  var description = safeStr(sub.summary || extra.description || '');
  var dateStr  = fmtDate(sub.submitted_at || sub.created_at);
  var startTime   = fmt(extra.startTime);
  var deptTime    = fmt(extra.departureTime);
  var glCode      = safeStr(sub.gl_code || extra.glCode || '');
  var customerWO  = safeStr(extra.customerWorkOrder || sub.work_order || '');
  var assetTag    = safeStr(sub.asset_tag || extra.assetTag || '');
  var lastSvcDate = safeStr(extra.lastServiceDate || '');
  var jobType     = safeStr(extra.jobType || sub.template || '');
  var isPM        = jobType === 'PM' || jobType.startsWith('pm');
  var permits     = Array.isArray(extra.permitsRequired) ? extra.permitsRequired.map(p => safeStr(p)) : [];
  var arrestors   = isPM && Array.isArray(extra.arrestors) ? extra.arrestors : [];
  var flares      = isPM && Array.isArray(extra.flares) ? extra.flares : [];
  var heaters     = isPM && Array.isArray(extra.heaters) ? extra.heaters : [];
  var reportedIssue = safeStr(extra.reportedIssue || '');
  var rootCause     = safeStr(extra.rootCause || '');

  // Technicians
  var techNames = [];
  if (Array.isArray(extra.techs)) {
    techNames = extra.techs.map(function(t) {
      return safeStr(typeof t === 'string' ? t : (t.name || t.label || String(t)));
    }).filter(Boolean);
  }

  // Parts
  var parts = Array.isArray(extra.parts) ? extra.parts : [];

  // Cost figures ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ prefer flat DB columns
  var laborHours   = parseFloat(sub.labor_hours  || extra.laborHours  || 0) || 0;
  var laborRate    = parseFloat(sub.labor_rate   || extra.hourlyRate  || 0) || 0;
  var mileage      = parseFloat(sub.miles        || extra.miles       || 0) || 0;
  var mileageRate  = parseFloat(sub.cost_per_mile|| extra.costPerMile || 0) || 0;
  var partsTotal   = parts.reduce(function(s, p) {
    return s + (parseFloat(p.total || 0) || (parseFloat(p.unit_price||p.price||0) * parseFloat(p.qty||p.quantity||1)));
  }, 0);
  var laborTotal   = laborHours * laborRate;
  var mileageTotal = mileage * mileageRate;
  var grandTotal   = partsTotal + laborTotal + mileageTotal;

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Create PDF ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  var pdfDoc = await PDFDocument.create();
  var page   = pdfDoc.addPage([612, 792]);
  var W = 612; var H = 792;
  var hFont  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  var hBold  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  var navy     = rgb(0.059, 0.122, 0.220);
  var orange   = rgb(0.902, 0.361, 0.000);
  var white    = rgb(1,1,1);
  var lightGray= rgb(0.93, 0.93, 0.93);
  var midGray  = rgb(0.55, 0.55, 0.55);
  var darkGray = rgb(0.18, 0.18, 0.18);
  var altRow   = rgb(0.97, 0.97, 0.97);

  var M = 30; // margin
  var y = H - M;

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ HEADER ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  page.drawRectangle({ x:0, y:H-72, width:W, height:72, color:navy });
  page.drawText('RELIABLE OILFIELD SERVICES', { x:M, y:H-26, size:14, font:hBold, color:white });
  page.drawText('ReliableTrack Field Report', { x:M, y:H-44, size:9, font:hFont, color:rgb(0.75,0.75,0.75) });

  // Job type badge
  var badge = jobType.toLowerCase().includes('pm') ? 'PM' : 'SC';
  var badgeClr = badge === 'PM' ? rgb(0.086,0.627,0.294) : orange;
  page.drawRectangle({ x:W-100, y:H-54, width:30, height:18, color:badgeClr });
  page.drawText(badge, { x:W-94, y:H-46, size:9, font:hBold, color:white });

  // WO number top-right
  page.drawText('Work Order No.', { x:W-80, y:H-20, size:7, font:hFont, color:rgb(0.75,0.75,0.75) });
  page.drawText(woNum || '--', { x:W-80, y:H-34, size:10, font:hBold, color:white });

  y = H - 78;

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ DATE BAR ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  page.drawRectangle({ x:M, y:y-15, width:W-M*2, height:15, color:lightGray });
  page.drawText(dateStr, { x:M+4, y:y-11, size:8, font:hFont, color:darkGray });
  y -= 22;

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ INFO GRID (3 cols x 3 rows) ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  var gridFields = [
    ['CUSTOMER', customer],
    ['LOCATION / SITE', location],
    ['CUSTOMER WO #', customerWO],
    ['GL CODE', glCode],
    ['ASSET TAG', assetTag],
    ['LAST SERVICE DATE', lastSvcDate],
    ['TYPE OF WORK', workType],
    ['WORK AREA', workArea],
    ['SITE CONTACT', contact],
    ['START TIME', startTime],
    ['DEPARTURE TIME', deptTime],
    ['TRUCK #', truckNum],
  ];
  var cols = 3;
  var cW = (W-M*2)/cols;
  var cH = 34;
  for (var gi=0; gi<gridFields.length; gi++) {
    var col = gi % cols;
    var row = Math.floor(gi / cols);
    var cx  = M + col * cW;
    var cy  = y - row * cH;
    page.drawRectangle({ x:cx, y:cy-cH, width:cW, height:cH, color: row%2===0 ? white : altRow, borderColor:rgb(0.82,0.82,0.82), borderWidth:0.5 });
    page.drawText(gridFields[gi][0], { x:cx+5, y:cy-11, size:6, font:hBold, color:midGray });
    var val = gridFields[gi][1];
    if (val) {
      page.drawText(val.substring(0,35), { x:cx+5, y:cy-23, size:9, font:hBold, color:darkGray });
    } else {
      page.drawLine({ start:{x:cx+5,y:cy-23}, end:{x:cx+cW-8,y:cy-23}, thickness:0.5, color:midGray });
    }
  }
  y -= Math.ceil(gridFields.length/cols)*cH + 8;

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ FIELD TECHNICIANS ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  page.drawRectangle({ x:M, y:y-16, width:W-M*2, height:16, color:navy });
  page.drawText('FIELD TECHNICIANS', { x:M+6, y:y-11, size:8, font:hBold, color:white });
  y -= 22;
  if (techNames.length > 0) {
    var tx = M+4;
    for (var ti=0; ti<techNames.length; ti++) {
      var tn = techNames[ti].substring(0,28);
      var tw = Math.min(hBold.widthOfTextAtSize(tn, 9)+14, 200);
      if (tx+tw > W-M) { tx=M+4; y-=20; }
      page.drawRectangle({ x:tx, y:y-14, width:tw, height:14, color:navy });
      page.drawText(tn, { x:tx+6, y:y-10, size:8, font:hBold, color:white });
      tx += tw+6;
    }
  } else {
    page.drawText('--', { x:M+4, y:y-10, size:9, font:hFont, color:midGray });
  }
  y -= 22;

  // -- SITE LOCATION / GPS --
  // Mirrors the client-side WorkOrderPDFTemplate "Site Sign & GPS" section
  // for the lambda fallback path. Only renders if a fix was captured.
  // Adds a clickable Google Maps link annotation over the URL line.
  var gpsLat = typeof extra.gpsLat === 'number' ? extra.gpsLat : (extra.gpsLat ? parseFloat(extra.gpsLat) : null);
  var gpsLng = typeof extra.gpsLng === 'number' ? extra.gpsLng : (extra.gpsLng ? parseFloat(extra.gpsLng) : null);
  var gpsAccuracy = typeof extra.gpsAccuracy === 'number' ? extra.gpsAccuracy : (extra.gpsAccuracy ? parseFloat(extra.gpsAccuracy) : null);
  if (gpsLat != null && gpsLng != null && !isNaN(gpsLat) && !isNaN(gpsLng) && y > 90) {
    var gpsBlockH = 50;
    if (y - gpsBlockH < 30) { page = pdfDoc.addPage([612, 792]); y = H - 40; }
    page.drawRectangle({ x:M, y:y-16, width:W-M*2, height:16, color:navy });
    page.drawText('SITE LOCATION (GPS)', { x:M+6, y:y-11, size:8, font:hBold, color:white });
    y -= 20;
    var coordStr = gpsLat.toFixed(6) + ', ' + gpsLng.toFixed(6);
    page.drawText('Pin:  ' + coordStr, { x:M+5, y:y-2, size:9, font:hBold, color:darkGray });
    if (gpsAccuracy != null && !isNaN(gpsAccuracy)) {
      page.drawText('+/- ' + Math.round(gpsAccuracy) + ' m', { x:M+330, y:y-2, size:8, font:hFont, color:midGray });
    }
    y -= 13;
    var mapsUrl = 'https://maps.google.com/?q=' + gpsLat + ',' + gpsLng;
    var linkText = 'View on Google Maps';
    var linkWidth = hFont.widthOfTextAtSize(linkText, 9);
    var linkY = y - 2;
    page.drawText(linkText, { x:M+5, y:linkY, size:9, font:hBold, color:rgb(0.0, 0.4, 0.85) });
    page.drawLine({ start:{x:M+5, y:linkY-1.5}, end:{x:M+5+linkWidth, y:linkY-1.5}, thickness:0.5, color:rgb(0.0, 0.4, 0.85) });
    try {
      var linkAnnot = pdfDoc.context.register(
        pdfDoc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [M+5, linkY-2, M+5+linkWidth, linkY+9],
          Border: [0, 0, 0],
          A: { Type: 'Action', S: 'URI', URI: PDFString.of(mapsUrl) },
        })
      );
      var existingAnnots = page.node.get(PDFName.of('Annots'));
      if (existingAnnots && typeof existingAnnots.push === 'function') {
        existingAnnots.push(linkAnnot);
      } else {
        page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([linkAnnot]));
      }
    } catch (e) { /* non-clickable fallback — text + URL still legible */ }
    y -= 18;
  }

  //ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ DESCRIPTION OF WORK ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  page.drawRectangle({ x:M, y:y-16, width:W-M*2, height:16, color:navy });
  page.drawText('DESCRIPTION OF WORK', { x:M+6, y:y-11, size:8, font:hBold, color:white });
  y -= 20;
  if (description) {
    var words = description.split(' ');
    var lineText = '';
    for (var wi=0; wi<words.length; wi++) {
      var test = lineText ? lineText+' '+words[wi] : words[wi];
      if (hFont.widthOfTextAtSize(test,9) > W-M*2-10 && lineText) {
        if (y < 110) break;
        page.drawText(lineText, { x:M+5, y:y-4, size:9, font:hFont, color:darkGray });
        y -= 13; lineText = words[wi];
      } else { lineText = test; }
    }
    if (lineText && y >= 110) {
      page.drawText(lineText, { x:M+5, y:y-4, size:9, font:hFont, color:darkGray });
      y -= 13;
    }
  } else {
    page.drawLine({ start:{x:M+5,y:y-8}, end:{x:W-M-5,y:y-8}, thickness:0.5, color:lightGray });
    y -= 14;
  }
  y -= 6;

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ PHOTOS ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  // Ã¢ÂÂÃ¢ÂÂ PERMITS REQUIRED Ã¢ÂÂÃ¢ÂÂ
  // -- REPORTED ISSUE (SC) --
  if (reportedIssue && y > 90) {
    page.drawRectangle({ x:M, y:y-16, width:W-M*2, height:16, color:navy });
    page.drawText('REPORTED ISSUE', { x:M+6, y:y-11, size:8, font:hBold, color:white });
    y -= 20;
    var riWords = reportedIssue.split(' ');
    var riLine = '';
    for (var ri=0; ri<riWords.length; ri++) {
      var riTest = riLine ? riLine+' '+riWords[ri] : riWords[ri];
      if (hFont.widthOfTextAtSize(riTest,9) > W-M*2-10 && riLine) {
        if (y < 110) break;
        page.drawText(riLine, { x:M+5, y:y-4, size:9, font:hFont, color:darkGray });
        y -= 13; riLine = riWords[ri];
      } else { riLine = riTest; }
    }
    if (riLine && y >= 110) { page.drawText(riLine, { x:M+5, y:y-4, size:9, font:hFont, color:darkGray }); y -= 13; }
    y -= 6;
  }

  // -- ROOT CAUSE (SC) --
  if (rootCause && y > 90) {
    page.drawRectangle({ x:M, y:y-16, width:W-M*2, height:16, color:navy });
    page.drawText('ROOT CAUSE', { x:M+6, y:y-11, size:8, font:hBold, color:white });
    y -= 20;
    var rcWords = rootCause.split(' ');
    var rcLine = '';
    for (var rc=0; rc<rcWords.length; rc++) {
      var rcTest = rcLine ? rcLine+' '+rcWords[rc] : rcWords[rc];
      if (hFont.widthOfTextAtSize(rcTest,9) > W-M*2-10 && rcLine) {
        if (y < 110) break;
        page.drawText(rcLine, { x:M+5, y:y-4, size:9, font:hFont, color:darkGray });
        y -= 13; rcLine = rcWords[rc];
      } else { rcLine = rcTest; }
    }
    if (rcLine && y >= 110) { page.drawText(rcLine, { x:M+5, y:y-4, size:9, font:hFont, color:darkGray }); y -= 13; }
    y -= 6;
  }

    if (permits.length > 0 && y > 90) {
    page.drawRectangle({ x:M, y:y-16, width:W-M*2, height:16, color:navy });
    page.drawText('PERMITS REQUIRED', { x:M+6, y:y-11, size:8, font:hBold, color:white });
    y -= 20;
    var permStr = permits.join(' | ');
    page.drawText(permStr.substring(0,80), { x:M+4, y:y-4, size:8, font:hFont, color:darkGray });
    y -= 18;
  }

  // Ã¢ÂÂÃ¢ÂÂ FLAME ARRESTORS Ã¢ÂÂÃ¢ÂÂ
  if (arrestors.length > 0 && y > 90) {
    page.drawRectangle({ x:M, y:y-16, width:W-M*2, height:16, color:navy });
    page.drawText('FLAME ARRESTORS (' + arrestors.length + ')', { x:M+6, y:y-11, size:8, font:hBold, color:white });
    y -= 20;
    for (var ai=0; ai<arrestors.length; ai++) {
      var arr = arrestors[ai];
      var arrId = safeStr(arr.arrestorId || arr.tagNumber || 'Unlabeled');
      var arrLine = '#'+(ai+1)+' '+arrId+' | Cond: '+safeStr(arr.condition||'-')+(arr.filterChanged?' | Filter Changed':'')+safeStr(arr.notes?' | '+arr.notes:'');
      if (y < 60) break;
      page.drawText(arrLine.substring(0,90), { x:M+4, y:y-4, size:8, font:hFont, color:darkGray });
      y -= 13;
    }
    y -= 6;
  }

  // Ã¢ÂÂÃ¢ÂÂ FLARES / COMBUSTORS Ã¢ÂÂÃ¢ÂÂ
  if (flares.length > 0 && y > 90) {
    page.drawRectangle({ x:M, y:y-16, width:W-M*2, height:16, color:navy });
    page.drawText('FLARES / COMBUSTORS (' + flares.length + ')', { x:M+6, y:y-11, size:8, font:hBold, color:white });
    y -= 20;
    for (var fi=0; fi<flares.length; fi++) {
      var flr = flares[fi];
      var flrId = safeStr(flr.flareId || flr.serialNumber || 'Unlabeled');
      var flrLine = '#'+(fi+1)+' '+flrId+' | Cond: '+safeStr(flr.condition||'-')+' | Pilot: '+(flr.pilotLit?'Lit':'Not Lit')+safeStr(flr.lastIgnitionDate?' | Last Ign: '+flr.lastIgnitionDate:'')+safeStr(flr.notes?' | '+flr.notes:'');
      if (y < 60) break;
      page.drawText(flrLine.substring(0,90), { x:M+4, y:y-4, size:8, font:hFont, color:darkGray });
      y -= 13;
    }
    y -= 6;
  }

  // Ã¢ÂÂÃ¢ÂÂ HEATER TREATERS Ã¢ÂÂÃ¢ÂÂ
  if (heaters.length > 0 && y > 90) {
    page.drawRectangle({ x:M, y:y-16, width:W-M*2, height:16, color:navy });
    page.drawText('HEATER TREATERS (' + heaters.length + ')', { x:M+6, y:y-11, size:8, font:hBold, color:white });
    y -= 20;
    for (var hi=0; hi<heaters.length; hi++) {
      var htr = heaters[hi];
      var htrId = safeStr(htr.heaterId || htr.unitId || 'Unlabeled');
      var htrLine = '#'+(hi+1)+' '+htrId+' | Cond: '+safeStr(htr.condition||'-')+' | Firetube: '+safeStr(htr.firetubeCondition||'-')+safeStr(htr.lastCleanDate?' | Last Clean: '+htr.lastCleanDate:'')+safeStr(htr.notes?' | '+htr.notes:'');
      if (y < 60) break;
      page.drawText(htrLine.substring(0,90), { x:M+4, y:y-4, size:8, font:hFont, color:darkGray });
      y -= 13;
    }
    y -= 6;
  }

  // Work Photos. Filter out signatures (rendered in sign-off) and part photos
  // (rendered inline next to each part below).
  if (Array.isArray(allPhotos)) {
    var workPhotos = allPhotos.filter(function(p) {
      if (!p) return false;
      if (p.section === 'customer-sig') return false;
      if (p.section && p.section.startsWith('sig-')) return false;
      if (p.section && p.section.startsWith('part-')) return false;
      return true;
    });
    if (workPhotos.length > 0) {
      // Section header
      if (y - 30 < 30) { page = pdfDoc.addPage([612, 792]); y = H - 40; }
      page.drawRectangle({ x:M, y:y-16, width:W-M*2, height:16, color:navy });
      page.drawText('WORK PHOTOS', { x:M+6, y:y-11, size:8, font:hBold, color:white });
      y -= 22;
      var photoW = (W-M*2-12)/3;
      var photoH = photoW * 0.75;
      var px = M; var photoCount = 0;
      for (var phi=0; phi<workPhotos.length; phi++) {
        var photo = workPhotos[phi];
        if (!photo.storage_path) continue;
        // New page if next row won't fit
        if (photoCount % 3 === 0 && y - photoH < 30) {
          page = pdfDoc.addPage([612, 792]); y = H - 40;
        }
        try {
          var pBytes = await fetchPhotoBytes(photo.storage_path);
          if (!pBytes) continue;
          var pImg;
          try { pImg = await pdfDoc.embedJpg(pBytes); } catch(e2) {
            try { pImg = await pdfDoc.embedPng(pBytes); } catch(e3) { continue; }
          }
          page.drawImage(pImg, { x:px, y:y-photoH, width:photoW, height:photoH });
          px += photoW+6; photoCount++;
          if (photoCount % 3 === 0) { px=M; y-=photoH+6; }
        } catch(e) { /* skip failed photo */ }
      }
      if (photoCount > 0 && photoCount % 3 !== 0) y -= photoH+6;
      y -= 6;
    }
  }

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ PARTS & MATERIALS ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  if (parts.length > 0) {
    // Section header (and column header) — break to new page if not enough room
    if (y - 36 < 30) { page = pdfDoc.addPage([612, 792]); y = H - 40; }
    page.drawRectangle({ x:M, y:y-16, width:W-M*2, height:16, color:navy });
    page.drawText('PARTS & MATERIALS', { x:M+6, y:y-11, size:8, font:hBold, color:white });
    y -= 22;
    page.drawRectangle({ x:M, y:y-14, width:W-M*2, height:14, color:lightGray });
    page.drawText('Description',  { x:M+5,   y:y-10, size:7, font:hBold, color:darkGray });
    page.drawText('Part #',       { x:M+270,  y:y-10, size:7, font:hBold, color:darkGray });
    page.drawText('Qty',          { x:M+360,  y:y-10, size:7, font:hBold, color:darkGray });
    page.drawText('Unit $',       { x:M+395,  y:y-10, size:7, font:hBold, color:darkGray });
    page.drawText('Total',        { x:M+448,  y:y-10, size:7, font:hBold, color:darkGray });
    y -= 14;
    for (var pi=0; pi<parts.length; pi++) {
      var p = parts[pi];
      // Look up photos for this part by section name "part-<sku>"
      var partSku = safeStr(p.sku||p.part_number||p.part_no||p.partNumber||p.code||'');
      var partPhotosForRow = (Array.isArray(allPhotos) && partSku)
        ? allPhotos.filter(function(ph) { return ph && ph.section === 'part-' + partSku; })
        : [];
      var rowH = 14 + (partPhotosForRow.length > 0 ? 56 : 0);
      // New page if this row + photos won't fit
      if (y - rowH < 30) {
        page = pdfDoc.addPage([612, 792]); y = H - 40;
        // Re-draw the column header on the new page so the table reads right
        page.drawRectangle({ x:M, y:y-14, width:W-M*2, height:14, color:lightGray });
        page.drawText('Description',  { x:M+5,   y:y-10, size:7, font:hBold, color:darkGray });
        page.drawText('Part #',       { x:M+270,  y:y-10, size:7, font:hBold, color:darkGray });
        page.drawText('Qty',          { x:M+360,  y:y-10, size:7, font:hBold, color:darkGray });
        page.drawText('Unit $',       { x:M+395,  y:y-10, size:7, font:hBold, color:darkGray });
        page.drawText('Total',        { x:M+448,  y:y-10, size:7, font:hBold, color:darkGray });
        y -= 14;
      }
      var pDesc  = safeStr(p.description||p.name||p.part_description||'').substring(0,42);
      var pNum   = partSku.substring(0,18);
      var pQty   = safeStr(p.qty||p.quantity||'1');
      var pUnit  = fmtMoney(p.unit_price||p.price||p.unitPrice||0);
      var pTot   = fmtMoney(p.total||(parseFloat(p.unit_price||p.price||p.unitPrice||0)*parseFloat(p.qty||1)));
      page.drawRectangle({ x:M, y:y-14, width:W-M*2, height:14, color:pi%2===0?white:altRow });
      page.drawText(pDesc, { x:M+5,   y:y-10, size:8, font:hFont, color:darkGray });
      page.drawText(pNum,  { x:M+270,  y:y-10, size:8, font:hFont, color:darkGray });
      page.drawText(pQty,  { x:M+360,  y:y-10, size:8, font:hFont, color:darkGray });
      page.drawText(pUnit, { x:M+390,  y:y-10, size:8, font:hFont, color:darkGray });
      page.drawText(pTot,  { x:M+443,  y:y-10, size:8, font:hFont, color:darkGray });
      y -= 14;
      // Inline part photos under the row
      if (partPhotosForRow.length > 0) {
        var ppSize = 50;
        var ppx = M + 10;
        var rendered = 0;
        for (var ppi = 0; ppi < partPhotosForRow.length && rendered < 8; ppi++) {
          var pp = partPhotosForRow[ppi];
          if (!pp.storage_path) continue;
          try {
            var ppB = await fetchPhotoBytes(pp.storage_path);
            if (!ppB) continue;
            var ppI;
            try { ppI = await pdfDoc.embedJpg(ppB); } catch(e1) {
              try { ppI = await pdfDoc.embedPng(ppB); } catch(e2) { continue; }
            }
            page.drawImage(ppI, { x: ppx, y: y - ppSize - 2, width: ppSize, height: ppSize });
            ppx += ppSize + 4;
            rendered++;
          } catch(e) { /* skip */ }
        }
        if (rendered > 0) y -= ppSize + 6;
      }
    }
    y -= 6;
  }

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ COST SUMMARY ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  // Cost Summary — needs ~95px (header 22 + 3 rows × 14 + total 28 + padding).
  // ALWAYS render this section. Add a new page if not enough room rather than
  // silently dropping it (which is what hid hours/mileage/cost/total from the
  // PDF for any submission with lots of photos).
  {
    if (y - 95 < 30) { page = pdfDoc.addPage([612, 792]); y = H - 40; }
    var sX = W/2; var sW = W/2-M;
    page.drawRectangle({ x:M, y:y-16, width:W-M*2, height:16, color:navy });
    page.drawText('COST SUMMARY', { x:M+6, y:y-11, size:8, font:hBold, color:white });
    y -= 22;
    var costRows = [
      ['Parts & Materials:', fmtMoney(partsTotal)],
      ['Labor ('+(Math.round(laborHours * 100) / 100)+' hrs @ '+fmtMoney(laborRate)+'/hr):', fmtMoney(laborTotal)],
      ['Mileage ('+mileage+' mi @ '+fmtMoney(mileageRate)+'/mi):', fmtMoney(mileageTotal)],
    ];
    for (var ci=0; ci<costRows.length; ci++) {
      page.drawRectangle({ x:sX, y:y-14, width:sW, height:14, color:ci%2===0?white:altRow });
      page.drawText(costRows[ci][0], { x:sX+5,    y:y-10, size:8, font:hFont, color:darkGray });
      page.drawText(costRows[ci][1], { x:sX+sW-60, y:y-10, size:8, font:hBold, color:darkGray });
      y -= 14;
    }
    page.drawLine({ start:{x:sX,y:y-2}, end:{x:W-M,y:y-2}, thickness:0.5, color:orange });
    y -= 4;
    page.drawRectangle({ x:sX, y:y-20, width:sW, height:20, color:navy });
    page.drawText('GRAND TOTAL:', { x:sX+5, y:y-14, size:9, font:hBold, color:orange });
    page.drawText(fmtMoney(grandTotal), { x:sX+sW-70, y:y-14, size:11, font:hBold, color:white });
    y -= 28;
  }

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ SIGN-OFF ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  // Sign-off section: stack ALL tech signatures vertically in the left column,
  // customer signature on the right. Was rendering only the first tech sig
  // because it used `.find` instead of looping all sig-* photos.
  {
    var techSigs = Array.isArray(allPhotos)
      ? allPhotos.filter(function(p) { return p && p.section && p.section.startsWith('sig-'); })
      : [];
    var sigBoxH = 44;       // line + signature image + label per tech
    var techBlockH = Math.max(sigBoxH, techSigs.length * sigBoxH);
    var neededH = Math.max(techBlockH, 64) + 12;
    if (y - neededH < 30) { page = pdfDoc.addPage([612, 792]); y = H - 40; }
    y -= 10;
    var sw = (W-M*2)/2-8;
    var techStartY = y;
    // Tech sigs (left column)
    if (techSigs.length === 0) {
      page.drawLine({ start:{x:M,y:y-34}, end:{x:M+sw,y:y-34}, thickness:0.5, color:midGray });
      page.drawText('Technician Signature', { x:M, y:y-44, size:7, font:hFont, color:midGray });
      y -= sigBoxH;
    } else {
      for (var ti = 0; ti < techSigs.length; ti++) {
        var tSP = techSigs[ti];
        page.drawLine({ start:{x:M,y:y-34}, end:{x:M+sw,y:y-34}, thickness:0.5, color:midGray });
        try {
          var sB = await fetchPhotoBytes(tSP.storage_path);
          if (sB) {
            var sI;
            try { sI = await pdfDoc.embedPng(sB); } catch(e1) { try { sI = await pdfDoc.embedJpg(sB); } catch(e2){} }
            if (sI) page.drawImage(sI, { x:M+2, y:y-36, width:120, height:32 });
          }
        } catch(e) {}
        var label = (tSP.section || '').replace('sig-','') + ' Signature';
        page.drawText(label.substring(0,40), { x:M, y:y-44, size:7, font:hFont, color:midGray });
        y -= sigBoxH;
      }
    }
    // Customer sig (right column, top-aligned with first tech sig)
    var cy = techStartY;
    page.drawLine({ start:{x:W/2+4,y:cy-34}, end:{x:W-M,y:cy-34}, thickness:0.5, color:midGray });
    var cSP = Array.isArray(allPhotos) ? allPhotos.find(function(p) { return p && p.section === 'customer-sig'; }) : null;
    if (cSP) {
      try {
        var cB = await fetchPhotoBytes(cSP.storage_path);
        if (cB) {
          var cI;
          try { cI = await pdfDoc.embedPng(cB); } catch(e3) { try { cI = await pdfDoc.embedJpg(cB); } catch(e4){} }
          if (cI) page.drawImage(cI, { x:W/2+6, y:cy-36, width:150, height:32 });
        }
      } catch(e) {}
    }
    page.drawText('Customer Signature / Approval', { x:W/2+4, y:cy-44, size:7, font:hFont, color:midGray });
    // Make sure y advances past whichever column is taller
    if (cy - sigBoxH < y) y = cy - sigBoxH;
    y -= 12;
  }

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ FOOTER ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  page.drawRectangle({ x:0, y:0, width:W, height:28, color:navy });
  page.drawText('Reliable Oilfield Services  |  ReliableTrack  |  reliableoilfieldservices.net', {
    x:M, y:10, size:7, font:hFont, color:rgb(0.75,0.75,0.75)
  });
  page.drawText('WO# '+woNum+'  |  '+safeStr(new Date().toLocaleDateString('en-US')), {
    x:W-170, y:10, size:7, font:hFont, color:rgb(0.75,0.75,0.75)
  });

  var pdfBytes = await pdfDoc.save();
  return pdfBytes;
}


async function sendPmScReport(res, sub, d, photos, pdfBase64 = null) {
  const isPM = sub.template === 'pm_flare_combustor';
  const pmNum = sub.pm_number || '';
  const label = isPM ? 'PM #' + (sub.work_order || pmNum) : 'SC #' + (sub.work_order || pmNum);
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

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Build PDF ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
    var pdfB64;
      if (pdfBase64) {
              pdfB64 = pdfBase64;
      } else {
              const pdfBytes = await generateWorkOrderPDF(sub, photos, null);
              pdfB64 = Buffer.from(pdfBytes).toString('base64');
      }

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
    + '<div style="text-align:center;padding:12px;color:#999;font-size:11px">ReliableTrack ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ¢ Reliable Oilfield Services</div>'
    + '</div>';

  // SC video links
  var scVids2 = photos.filter(function(p) { return p.section === 'arrival-video' || p.section === 'departure-video'; });
  var videoEmailHtml2 = '';
  if (!isPM && scVids2.length > 0) {
    var vRows2 = scVids2.map(function(v) {
      var vLbl2 = v.section === 'arrival-video' ? 'Arrival - Before Work' : 'Departure - After Work';
      var vLink2 = SUPA_URL + '/storage/v1/object/public/submission-photos/' + (v.storage_path || '');
      return '<tr><td style="padding:8px;font-weight:bold;font-size:13px;width:200px">' + vLbl2 + '</td>'
        + '<td style="padding:8px;font-size:13px"><a href="' + vLink2 + '" style="color:#1a56db">Download</a></td></tr>';
    }).join('');
    videoEmailHtml2 = '<h3 style="color:#102558;border-bottom:2px solid #ef6600;padding-bottom:6px">Arrival and Departure Videos</h3>'
      + '<p style="font-size:12px;color:#666;margin-bottom:8px">Click links to download.</p>'
      + '<table style="width:100%;border-collapse:collapse;margin-bottom:20px">' + vRows2 + '</table>';
  }

  const emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: TO,
      subject: label + ' - ' + (sub.customer_name||'') + ' - ' + fmtDate(sub.date),
      html: html + videoEmailHtml2,
      attachments: [{ filename: label.replace('#','').replace(' ','-') + '-report.pdf', content: pdfB64 }],
    }),
  });

  const emailData = await emailResp.json();
  if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
  return res.status(200).json({ ok: true, emailId: emailData.id });
}

// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ EXPENSE REPORT ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
async function sendExpenseReport(res, sub, d, photos, pdfBase64 = null) {
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
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
  const pdfB64 = pdfBase64 || Buffer.from(pdfBytes).toString('base64');

  // Photo HTML
  const photoHtml = photos.map(function(p) {
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

// ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ DAILY INSPECTION REPORT ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
async function sendInspectionReport(res, sub, d, photos, pdfBase64 = null) {
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
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
  const pdfB64 = pdfBase64 || Buffer.from(pdfBytes).toString('base64');

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
      subject: (allPass ? '\u2713 All Pass - Vehicle Inspection' : '\u26a0\ufe0f URGENT: ' + failCount + ' DEFECT(S) FOUND - Vehicle Inspection') + ' - ' + (sub.truck_number||'') + ' - ' + techName + ' - ' + fmtDate(sub.date),
      html,
      attachments: [{ filename: 'inspection-' + (sub.truck_number||'truck') + '-' + (sub.date||'') + '.pdf', content: pdfB64 }],
    }),
  });
  const emailData = await emailResp.json();
  if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
  return res.status(200).json({ ok: true, emailId: emailData.id });
}


// -- JHA / JSA REPORT --
async function sendJhaReport(res, sub, d, photos, pdfBase64 = null) {
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
  var steps = Array.isArray(d.jhaSteps) ? d.jhaSteps : [];
  var ppeList = Array.isArray(d.jhaPPE) ? d.jhaPPE : [];
  var techName = d.techs && d.techs.length ? d.techs[0] : '';
  var crew = d.jhaCrewMembers || '';
  var supervisor = d.jhaSupervisor || '';
  var emergency = d.jhaEmergencyContact || '';
  var hospital = d.jhaNearestHospital || '';
  var muster = d.jhaMeetingPoint || '';
  var extraNotes = d.jhaAdditionalHazards || '';
  var highRisk = steps.filter(function(s){return s.risk === 'High' || s.risk === 'Critical';}).length;

  var pdfDoc = await PDFDocument.create();
  var boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  var regFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  var NAVY = rgb(0.063, 0.149, 0.290);
  var GREEN = rgb(0.024, 0.588, 0.416);
  var RED = rgb(0.85, 0.1, 0.1);
  var ORANGE = rgb(0.937, 0.400, 0.000);
  var WHITE = rgb(1, 1, 1);
  var LGRAY = rgb(0.95, 0.95, 0.95);

  var page = pdfDoc.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 742, width: 612, height: 50, color: NAVY });
  page.drawCircle({ x: 35, y: 767, size: 18, color: GREEN });
  page.drawText('R', { x: 29, y: 761, size: 14, font: boldFont, color: WHITE });
  page.drawText('Job Hazard Analysis / JSA', { x: 58, y: 756, size: 14, font: boldFont, color: WHITE });
  page.drawText(fmtDate(sub.date) + ' | ' + (sub.location_name || sub.customer_name || ''), { x: 58, y: 744, size: 9, font: regFont, color: rgb(0.7,0.7,0.7) });
  page.drawRectangle({ x: 0, y: 740, width: 612, height: 2, color: GREEN });

  var y = 720;
  if (highRisk > 0) {
    page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 16, color: RED });
    page.drawText('WARNING: ' + highRisk + ' HIGH/CRITICAL RISK STEP(S) - SUPERVISOR APPROVAL REQUIRED', { x: 54, y: y + 1, size: 9, font: boldFont, color: WHITE });
    y -= 24;
  }

  page.drawText('Lead Tech: ' + techName, { x: 50, y, size: 9, font: regFont, color: NAVY });
  page.drawText('Date: ' + fmtDate(sub.date), { x: 250, y, size: 9, font: regFont, color: NAVY });
  page.drawText('Truck: ' + (sub.truck_number || ''), { x: 400, y, size: 9, font: regFont, color: NAVY });
  y -= 13;
  page.drawText('Site: ' + (sub.location_name || sub.customer_name || ''), { x: 50, y, size: 9, font: regFont, color: NAVY });
  if (supervisor) page.drawText('Supervisor: ' + supervisor, { x: 300, y, size: 9, font: regFont, color: NAVY });
  y -= 13;
  if (crew) { page.drawText('Crew: ' + crew, { x: 50, y, size: 9, font: regFont, color: NAVY }); y -= 13; }
  y -= 6;

  // Hazard Steps
  page.drawText('HAZARD IDENTIFICATION & CONTROLS', { x: 50, y, size: 9, font: boldFont, color: NAVY });
  y -= 6;
  page.drawRectangle({ x: 50, y: y - 1, width: 512, height: 2, color: GREEN });
  y -= 12;

  // Table headers
  page.drawRectangle({ x: 50, y: y - 14, width: 512, height: 16, color: NAVY });
  page.drawText('#', { x: 54, y: y - 11, size: 7, font: boldFont, color: WHITE });
  page.drawText('Task Step', { x: 68, y: y - 11, size: 7, font: boldFont, color: WHITE });
  page.drawText('Hazard', { x: 210, y: y - 11, size: 7, font: boldFont, color: WHITE });
  page.drawText('Controls', { x: 340, y: y - 11, size: 7, font: boldFont, color: WHITE });
  page.drawText('Risk', { x: 540, y: y - 11, size: 7, font: boldFont, color: WHITE });
  y -= 18;

  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    if (y < 60) break;
    var riskColor = (s.risk === 'Critical' || s.risk === 'High') ? RED : (s.risk === 'Medium' ? ORANGE : GREEN);
    if (i % 2 === 1) page.drawRectangle({ x: 50, y: y - 14, width: 512, height: 16, color: LGRAY });
    page.drawText(String(i + 1), { x: 54, y: y - 10, size: 7, font: regFont, color: NAVY });
    page.drawText(String(s.taskStep || '').substring(0, 20), { x: 68, y: y - 10, size: 7, font: regFont, color: NAVY });
    page.drawText(String(s.hazard || '').substring(0, 20), { x: 210, y: y - 10, size: 7, font: regFont, color: NAVY });
    page.drawText(String(s.controls || '').substring(0, 28), { x: 340, y: y - 10, size: 7, font: regFont, color: NAVY });
    page.drawText(String(s.risk || 'Med'), { x: 540, y: y - 10, size: 7, font: boldFont, color: riskColor });
    y -= 16;
  }
  y -= 8;

  // PPE
  if (ppeList.length > 0 && y > 80) {
    page.drawText('REQUIRED PPE: ' + ppeList.join(', '), { x: 50, y, size: 8, font: regFont, color: NAVY });
    y -= 14;
  }

  // Emergency
  if ((emergency || hospital) && y > 80) {
    page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 1, color: RED });
    y -= 10;
    page.drawText('EMERGENCY INFO', { x: 50, y, size: 9, font: boldFont, color: RED });
    y -= 12;
    if (emergency) { page.drawText('Contact: ' + emergency, { x: 54, y, size: 8, font: regFont, color: NAVY }); y -= 11; }
    if (hospital) { page.drawText('Hospital: ' + hospital, { x: 54, y, size: 8, font: regFont, color: NAVY }); y -= 11; }
    if (muster) { page.drawText('Muster Point: ' + muster, { x: 54, y, size: 8, font: regFont, color: NAVY }); y -= 11; }
  }

  if (extraNotes && y > 80) {
    y -= 6;
    page.drawText('Notes: ' + String(extraNotes).substring(0, 120), { x: 50, y, size: 8, font: regFont, color: rgb(0.4,0.4,0.4) });
  }

  var pdfBytes = await pdfDoc.save();
  var pdfB64 = pdfBase64 || Buffer.from(pdfBytes).toString('base64');

  // Build step rows HTML
  var stepRows = steps.map(function(s, i) {
    var riskBg = s.risk === 'Critical' ? '#7c3aed' : s.risk === 'High' ? '#dc2626' : s.risk === 'Medium' ? '#d97706' : '#16a34a';
    return '<tr>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:bold;width:24px">' + (i+1) + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px">' + (s.taskStep||'') + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;color:#dc2626">' + (s.hazard||'') + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;color:#16a34a">' + (s.controls||'') + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center"><span style="background:' + riskBg + ';color:#fff;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:bold">' + (s.risk||'Med') + '</span></td>' +
      '</tr>';
  }).join('');

  var ppeHtml = ppeList.length > 0 ? ppeList.map(function(p){return '<span style="display:inline-block;background:#eef2ff;border:1px solid #1a2332;color:#1a2332;padding:3px 10px;border-radius:12px;font-size:12px;margin:3px">' + p + '</span>';}).join('') : '<em style="color:#888">None specified</em>';

  var subjectFlag = highRisk > 0 ? '[HIGH RISK] ' : '';

  var html = '<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">' +
    '<div style="background:#102558;padding:20px 24px;border-radius:6px 6px 0 0">' +
    '<span style="display:inline-block;background:#059669;color:#fff;font-weight:bold;font-size:18px;width:36px;height:36px;line-height:36px;text-align:center;border-radius:50%;margin-right:12px">R</span>' +
    '<span style="color:#fff;font-size:20px;font-weight:bold">Job Hazard Analysis / JSA</span>' +
    '</div>' +
    '<div style="background:#059669;height:4px"></div>' +
    '<div style="padding:24px;background:#fff;border:1px solid #ddd;border-top:none">' +
    (highRisk > 0 ? '<div style="background:#fef2f2;border:2px solid #dc2626;border-radius:6px;padding:12px;margin-bottom:16px;font-weight:bold;color:#dc2626;text-align:center">\u26a0\ufe0f ' + highRisk + ' HIGH/CRITICAL RISK STEP(S) IDENTIFIED &mdash; SUPERVISOR APPROVAL REQUIRED BEFORE STARTING WORK</div>' : '<div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:6px;padding:10px;margin-bottom:16px;font-weight:bold;color:#16a34a;text-align:center">&#10003; All Risk Levels Acceptable</div>') +
    '<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:16px">' +
    '<tr><td style="padding:5px;background:#f5f5f5;font-weight:bold">Lead Tech</td><td style="padding:5px">' + techName + '</td><td style="padding:5px;background:#f5f5f5;font-weight:bold">Date</td><td style="padding:5px">' + fmtDate(sub.date) + '</td></tr>' +
    '<tr><td style="padding:5px;background:#f5f5f5;font-weight:bold">Site / Location</td><td style="padding:5px" colspan="3">' + (sub.location_name || sub.customer_name || '') + '</td></tr>' +
    (supervisor ? '<tr><td style="padding:5px;background:#f5f5f5;font-weight:bold">Supervisor</td><td style="padding:5px" colspan="3">' + supervisor + '</td></tr>' : '') +
    (crew ? '<tr><td style="padding:5px;background:#f5f5f5;font-weight:bold">Crew</td><td style="padding:5px" colspan="3">' + crew + '</td></tr>' : '') +
    (sub.work_order ? '<tr><td style="padding:5px;background:#f5f5f5;font-weight:bold">Work Order</td><td style="padding:5px" colspan="3">' + sub.work_order + '</td></tr>' : '') +
    (sub.summary ? '<tr><td style="padding:5px;background:#f5f5f5;font-weight:bold">Job Description</td><td style="padding:5px" colspan="3">' + sub.summary + '</td></tr>' : '') +
    '</table>' +
    '<h3 style="color:#102558;border-bottom:2px solid #059669;padding-bottom:6px">Hazard Identification &amp; Controls</h3>' +
    '<table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px">' +
    '<thead><tr style="background:#102558;color:#fff">' +
    '<th style="padding:8px;text-align:left;width:24px">#</th>' +
    '<th style="padding:8px;text-align:left">Task Step</th>' +
    '<th style="padding:8px;text-align:left;color:#fca5a5">Hazard(s)</th>' +
    '<th style="padding:8px;text-align:left;color:#86efac">Control Measures</th>' +
    '<th style="padding:8px;text-align:center;width:70px">Risk</th>' +
    '</tr></thead><tbody>' + stepRows + '</tbody></table>' +
    '<h3 style="color:#102558;border-bottom:2px solid #059669;padding-bottom:6px">Required PPE</h3>' +
    '<div style="margin-bottom:20px">' + ppeHtml + '</div>' +
    '<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:14px;border-radius:4px;margin-bottom:16px">' +
    '<strong style="color:#dc2626">Emergency Information</strong><br><br>' +
    (emergency ? '<b>Contact:</b> ' + emergency + '<br>' : '') +
    (hospital ? '<b>Nearest Hospital:</b> ' + hospital + '<br>' : '') +
    (muster ? '<b>Muster Point:</b> ' + muster : '') +
    '</div>' +
    (extraNotes ? '<div style="background:#f0f4ff;border-left:4px solid #102558;padding:12px;border-radius:4px;margin-bottom:16px"><strong style="color:#102558">Additional Hazards / Notes</strong><p style="margin:6px 0 0;color:#444;font-size:13px">' + extraNotes + '</p></div>' : '') +
    '</div>' +
    '<div style="text-align:center;padding:12px;color:#999;font-size:11px">ReliableTrack \u2022 Reliable Oilfield Services</div>' +
    '</div>';

  var emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: TO,
      subject: subjectFlag + 'JHA/JSA - ' + (sub.location_name || sub.customer_name || '') + ' - ' + techName + ' - ' + fmtDate(sub.date),
      html: html,
      attachments: [{ filename: 'JHA-' + (sub.date||'') + '-' + techName.replace(/ /g,'-') + '.pdf', content: pdfB64 }],
    }),
  });
  var emailData = await emailResp.json();
  if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
  return res.status(200).json({ ok: true, emailId: emailData.id });
}


// -- JHA / JSA REPORT --
async function sendJhaReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts, pdfBase64 = null) {
  var steps = Array.isArray(d.jhaSteps) ? d.jhaSteps : [];
  var ppeList = Array.isArray(d.jhaPPE) ? d.jhaPPE : [];
  var techName = d.techs && d.techs.length ? d.techs[0] : (sub.location_name || '');
  var crew = d.jhaCrewMembers || '';
  var supervisor = d.jhaSupervisor || '';
  var emergency = d.jhaEmergencyContact || '';
  var hospital = d.jhaNearestHospital || '';
  var muster = d.jhaMeetingPoint || '';
  var extraNotes = d.jhaAdditionalHazards || '';
  var highRisk = steps.filter(function(s){return s.risk === 'High' || s.risk === 'Critical';}).length;
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

  var page = pdfDoc.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 742, width: 612, height: 50, color: NAVY });
  page.drawCircle({ x: 35, y: 767, size: 18, color: GREEN });
  page.drawText('R', { x: 29, y: 761, size: 14, font: boldFont, color: WHITE });
  page.drawText('Job Hazard Analysis / JSA', { x: 58, y: 756, size: 14, font: boldFont, color: WHITE });
  page.drawText(fmtDate(sub.date) + ' | ' + siteName, { x: 58, y: 744, size: 9, font: regFont, color: rgb(0.7,0.7,0.7) });
  page.drawRectangle({ x: 0, y: 740, width: 612, height: 2, color: GREEN });

  var y = 720;
  if (highRisk > 0) {
    page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 16, color: RED });
    page.drawText('WARNING: ' + highRisk + ' HIGH/CRITICAL RISK STEP(S) - SUPERVISOR APPROVAL REQUIRED', { x: 54, y: y + 1, size: 8, font: boldFont, color: WHITE });
    y -= 22;
  }
  page.drawText('Lead Tech: ' + techName, { x: 50, y, size: 9, font: regFont, color: NAVY });
  page.drawText('Date: ' + fmtDate(sub.date), { x: 250, y, size: 9, font: regFont, color: NAVY });
  page.drawText('Truck: ' + (sub.truck_number || ''), { x: 400, y, size: 9, font: regFont, color: NAVY });
  y -= 13;
  page.drawText('Site: ' + siteName, { x: 50, y, size: 9, font: regFont, color: NAVY });
  if (supervisor) page.drawText('Supervisor: ' + supervisor, { x: 300, y, size: 9, font: regFont, color: NAVY });
  y -= 13;
  if (crew) { page.drawText('Crew: ' + crew, { x: 50, y, size: 9, font: regFont, color: NAVY }); y -= 13; }
  y -= 6;
  page.drawText('HAZARD IDENTIFICATION & CONTROLS', { x: 50, y, size: 9, font: boldFont, color: NAVY });
  y -= 6;
  page.drawRectangle({ x: 50, y: y - 1, width: 512, height: 2, color: GREEN });
  y -= 14;
  page.drawRectangle({ x: 50, y: y - 14, width: 512, height: 16, color: NAVY });
  page.drawText('#', { x: 54, y: y - 11, size: 7, font: boldFont, color: WHITE });
  page.drawText('Task Step', { x: 68, y: y - 11, size: 7, font: boldFont, color: WHITE });
  page.drawText('Hazard(s)', { x: 215, y: y - 11, size: 7, font: boldFont, color: WHITE });
  page.drawText('Controls', { x: 345, y: y - 11, size: 7, font: boldFont, color: WHITE });
  page.drawText('Risk', { x: 543, y: y - 11, size: 7, font: boldFont, color: WHITE });
  y -= 18;
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    if (y < 60) break;
    var rc = (s.risk === 'Critical' || s.risk === 'High') ? RED : (s.risk === 'Medium' ? AMBER : GREEN);
    if (i % 2 === 1) page.drawRectangle({ x: 50, y: y - 14, width: 512, height: 16, color: LGRAY });
    page.drawText(String(i + 1), { x: 54, y: y - 10, size: 7, font: regFont, color: NAVY });
    page.drawText(String(s.taskStep || '').substring(0, 22), { x: 68, y: y - 10, size: 7, font: regFont, color: NAVY });
    page.drawText(String(s.hazard || '').substring(0, 22), { x: 215, y: y - 10, size: 7, font: regFont, color: NAVY });
    page.drawText(String(s.controls || '').substring(0, 26), { x: 345, y: y - 10, size: 7, font: regFont, color: NAVY });
    page.drawText(String(s.risk || 'Med'), { x: 540, y: y - 10, size: 7, font: boldFont, color: rc });
    y -= 16;
  }
  y -= 8;
  if (ppeList.length > 0 && y > 80) {
    page.drawText('REQUIRED PPE: ' + ppeList.join(', '), { x: 50, y, size: 8, font: regFont, color: NAVY });
    y -= 14;
  }
  if ((emergency || hospital) && y > 80) {
    page.drawRectangle({ x: 50, y: y - 2, width: 512, height: 1, color: RED });
    y -= 10;
    page.drawText('EMERGENCY INFO', { x: 50, y, size: 9, font: boldFont, color: RED });
    y -= 12;
    if (emergency) { page.drawText('Contact: ' + emergency, { x: 54, y, size: 8, font: regFont, color: NAVY }); y -= 11; }
    if (hospital) { page.drawText('Hospital: ' + hospital, { x: 54, y, size: 8, font: regFont, color: NAVY }); y -= 11; }
    if (muster) { page.drawText('Muster: ' + muster, { x: 54, y, size: 8, font: regFont, color: NAVY }); y -= 11; }
  }
  if (extraNotes && y > 80) {
    y -= 6;
    page.drawText('Notes: ' + String(extraNotes).substring(0, 120), { x: 50, y, size: 8, font: regFont, color: rgb(0.4,0.4,0.4) });
  }
  var pdfBytes = await pdfDoc.save();
  var pdfB64 = pdfBase64 || Buffer.from(pdfBytes).toString('base64');

  // Build step rows for HTML
  var stepRows = steps.map(function(s, i) {
    var riskColor = s.risk === 'Critical' ? '#7c3aed' : s.risk === 'High' ? '#dc2626' : s.risk === 'Medium' ? '#d97706' : '#16a34a';
    return '<tr><td style="padding:7px 8px;border-bottom:1px solid #eee;font-weight:700;color:#102558">' + (i+1) + '</td>'
      + '<td style="padding:7px 8px;border-bottom:1px solid #eee">' + (s.taskStep||'')+'</td>'
      + '<td style="padding:7px 8px;border-bottom:1px solid #eee;color:#dc2626">' + (s.hazard||'')+'</td>'
      + '<td style="padding:7px 8px;border-bottom:1px solid #eee;color:#16a34a">' + (s.controls||'')+'</td>'
      + '<td style="padding:7px 8px;border-bottom:1px solid #eee;font-weight:700;color:' + riskColor + '">' + (s.risk||'Med')+'</td></tr>';
  }).join('');

  var subjectPrefix = highRisk > 0 ? ('\u26a0\ufe0f URGENT JHA - ' + highRisk + ' HIGH RISK - ') : '\u2713 JHA/JSA - ';

  var html = '<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">'
    + '<div style="background:#102558;padding:20px 24px;border-radius:6px 6px 0 0">'
    + '<span style="display:inline-block;background:#059669;color:#fff;font-weight:bold;font-size:18px;width:36px;height:36px;line-height:36px;text-align:center;border-radius:50%;margin-right:12px">R</span>'
    + '<span style="color:#fff;font-size:20px;font-weight:bold">Job Hazard Analysis / JSA</span>'
    + '</div>'
    + '<div style="background:#059669;height:4px"></div>'
    + '<div style="padding:24px;background:#fff;border:1px solid #ddd;border-top:none">'
    + (highRisk > 0 ? '<div style="background:#fef2f2;border:2px solid #dc2626;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-weight:bold;color:#991b1b">\u26a0\ufe0f ' + highRisk + ' HIGH/CRITICAL RISK STEP(S) IDENTIFIED ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Supervisor approval required before starting work</div>' : '')
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
    + (ppeList.length > 0 ? '<h3 style="color:#102558;border-bottom:2px solid #059669;padding-bottom:6px">Required PPE</h3><p style="font-size:13px">' + ppeList.join(' &bull; ') + '</p>' : '')
    + '<h3 style="color:#dc2626;border-bottom:2px solid #dc2626;padding-bottom:6px">Emergency Information</h3>'
    + '<table style="width:100%;font-size:13px;border-collapse:collapse">'
    + (emergency ? '<tr><td style="padding:5px;background:#fff5f5;font-weight:bold;width:180px">Emergency Contact</td><td style="padding:5px">' + emergency + '</td></tr>' : '')
    + (hospital ? '<tr><td style="padding:5px;background:#fff5f5;font-weight:bold">Nearest Hospital</td><td style="padding:5px">' + hospital + '</td></tr>' : '')
    + (muster ? '<tr><td style="padding:5px;background:#fff5f5;font-weight:bold">Muster Point</td><td style="padding:5px">' + muster + '</td></tr>' : '')
    + '</table>'
    + (extraNotes ? '<div style="background:#f0f9ff;border-left:4px solid #0891b2;padding:12px;margin-top:16px;border-radius:4px"><strong>Additional Hazards / Notes:</strong><p style="margin:6px 0 0;color:#444">' + extraNotes + '</p></div>' : '')
    + '</div><div style="text-align:center;padding:12px;color:#999;font-size:11px">ReliableTrack &bull; Reliable Oilfield Services</div></div>';

  var emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: TO,
      subject: subjectPrefix + siteName + ' - ' + techName + ' - ' + fmtDate(sub.date),
      html: html,
      attachments: [{ filename: 'jha-' + (sub.date||'') + '.pdf', content: pdfB64 }],
    }),
  });
  var emailData = await emailResp.json();
  if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
  return res.status(200).json({ ok: true, emailId: emailData.id });
}
