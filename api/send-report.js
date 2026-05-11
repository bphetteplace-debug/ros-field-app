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
    if (template === 'jha' || (d && d.jobType === 'JHA/JSA')) {
      return await sendJhaReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts);
    }
    // Default: PM or SC
    return await sendPmScReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts);

  } catch (err) {
    console.error('send-report error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ââ HELPERS ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
  const sectionPhotos = photos.filter(p => p.section === section || (section === 'general' && (!p.section || p.section === 'work' || p.section === 'general')));
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

// ââ PM / SC REPORT âââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function sendPmScReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts) {
  const isPM = sub.template === 'pm_flare_combustor';
  const woNum = sub.work_order || sub.pm_number || '';
  const jobTypeLabel = d.jobType || (isPM ? 'Preventive Maintenance' : 'Service Call');
  const techs = Array.isArray(d.techs) ? d.techs : [];
  const parts = Array.isArray(d.parts) ? d.parts : [];
  const partsTotal = parseFloat(d.partsTotal || 0);
  const mileageTotal = parseFloat(d.mileageTotal || 0);
  const laborTotal = parseFloat(d.laborTotal || 0);
  const grandTotal = partsTotal + mileageTotal + laborTotal;
  var fmtMoney = function(n) { return '$' + parseFloat(n || 0).toFixed(2); };

  var BLACK = rgb(0, 0, 0);
  var WHITE = rgb(1, 1, 1);
  var GRAY = rgb(0.5, 0.5, 0.5);
  var LGRAY = rgb(0.94, 0.94, 0.94);
  var MGRAY = rgb(0.75, 0.75, 0.75);
  var DKGRAY = rgb(0.25, 0.25, 0.25);
  var GREEN = rgb(0.1, 0.6, 0.1);

  var pdfDoc = await PDFDocument.create();
  var regFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  var boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  var logoImg = null;
  try {
    var brandResp = await fetch(SUPA_URL + '/rest/v1/app_settings?key=eq.branding&select=value', { headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY } });
    var brandData = brandResp.ok ? await brandResp.json() : [];
    var brandVal = (brandData[0] && brandData[0].value) || {};
    var logoUrl = brandVal.logo_url || 'https://pm.reliable-oilfield-services.com/ros-logo.png';
    var logoBytes = null;
    if (logoUrl.startsWith('data:')) {
      var b64 = logoUrl.split(',')[1];
      logoBytes = Buffer.from(b64, 'base64');
    } else {
      var logoResp = await fetch(logoUrl);
      if (logoResp.ok) logoBytes = new Uint8Array(await logoResp.arrayBuffer());
    }
    if (logoBytes) {
      try { logoImg = await pdfDoc.embedPng(logoBytes); } catch(e2) {
        try { logoImg = await pdfDoc.embedJpg(logoBytes); } catch(e3) { logoImg = null; }
      }
    }
  } catch (e) { logoImg = null; }
  var logoDims = logoImg ? logoImg.scale(0.17) : null;
    if (logoImg) {
      pg.drawImage(logoImg, { x: MARGIN, y: PAGE_H - MARGIN - logoDims.height, width: logoDims.width, height: logoDims.height });
    } else {
      pg.drawCircle({ x: MARGIN + 22, y: PAGE_H - MARGIN - 22, size: 22, borderColor: BLACK, borderWidth: 2, color: WHITE });
      pg.drawText('ROS', { x: MARGIN + 10, y: PAGE_H - MARGIN - 28, size: 9, font: boldFont, color: BLACK });
    }
    var titleW = boldFont.widthOfTextAtSize('ROS Service Work Order', 18);
    pg.drawText('ROS Service Work Order', { x: PAGE_W / 2 - titleW / 2, y: PAGE_H - MARGIN - 20, size: 18, font: boldFont, color: BLACK });
    var subW = regFont.widthOfTextAtSize('Reliable Oilfield Services', 10);
    pg.drawText('Reliable Oilfield Services', { x: PAGE_W / 2 - subW / 2, y: PAGE_H - MARGIN - 35, size: 10, font: regFont, color: DKGRAY });
    var dateStr = sub.date ? sub.date.substring(0, 7).replace('-', '/') : '';
    pg.drawText('No. ' + dateStr + ' ' + woNum, { x: PAGE_W - MARGIN - 110, y: PAGE_H - MARGIN - 20, size: 9, font: regFont, color: BLACK });
    pg.drawRectangle({ x: MARGIN, y: PAGE_H - HEADER_H + 2, width: CONTENT_W, height: 1, color: MGRAY });
  }

  function drawFooter(pg) {
    pg.drawText('ID: ' + String(sub.id || '').substring(0, 40), { x: MARGIN, y: 12, size: 7, font: regFont, color: GRAY });
    pg.drawText('Page ' + String(pageNum), { x: PAGE_W - MARGIN - 40, y: 12, size: 7, font: boldFont, color: GRAY });
  }

  function drawSectionBar(pg, title, yPos) {
    pg.drawRectangle({ x: MARGIN, y: yPos - 4, width: CONTENT_W, height: 20, color: BLACK });
    var tw = boldFont.widthOfTextAtSize(title, 10);
    pg.drawText(title, { x: PAGE_W / 2 - tw / 2, y: yPos, size: 10, font: boldFont, color: WHITE });
    return yPos - 28;
  }

  function drawField(pg, label, value, x, yPos) {
    pg.drawText(label + ':', { x: x, y: yPos + 12, size: 7, font: boldFont, color: DKGRAY });
    pg.drawText(String(value || '').substring(0, 30), { x: x, y: yPos, size: 9, font: regFont, color: BLACK });
  }

  function newPage() {
    var pg = pdfDoc.addPage([PAGE_W, PAGE_H]);
    drawHeader(pg);
    return pg;
  }

  var page = newPage();
  var y = PAGE_H - HEADER_H - 8;

  // CUSTOMER INFORMATION
  y = drawSectionBar(page, 'Customer Information', y);
  y -= 6;
  var C1 = MARGIN;
  var C2 = MARGIN + CONTENT_W / 3;
  var C3 = MARGIN + (CONTENT_W / 3) * 2;
  drawField(page, 'Customer Name', sub.customer_name || d.customer, C1, y);
  drawField(page, 'Truck Number', sub.truck_number || d.truck, C2, y);
  drawField(page, 'Date', fmtDate(sub.date), C3, y);
  y -= 28;
  drawField(page, 'Location', sub.location_name || d.location, C1, y);
  drawField(page, 'Contact', sub.contact || d.contact, C2, y);
  drawField(page, 'Type of Work', jobTypeLabel, C3, y);
  y -= 28;
  drawField(page, 'GL Code', sub.gl_code || d.glCode, C1, y);
  drawField(page, 'Asset Tag', sub.asset_tag || d.assetTag, C2, y);
  drawField(page, 'Work Area', sub.work_area || d.workArea, C3, y);
  y -= 28;
  drawField(page, 'Work Order', sub.work_order, C1, y);
  drawField(page, 'Technician(s)', techs.join(', '), C2, y);
  if (d.warrantyWork) {
    page.drawRectangle({ x: C3, y: y - 2, width: 130, height: 16, color: GREEN });
    page.drawText('WARRANTY - NO CHARGE', { x: C3 + 4, y: y + 1, size: 8, font: boldFont, color: WHITE });
  }
  y -= 28;

  // Site sign + GPS
  var sitePhoto = photos.find(function(p) { return p.section === 'site-sign' || p.section === 'arrival-photo' || p.section === 'site_sign'; });
  var gpsPhoto = photos.find(function(p) { return p.section === 'gps' || p.section === 'map' || p.section === 'gps-map'; });
  var PH2 = 96;
  var PW2 = CONTENT_W / 2 - 4;
  page.drawText('Site Sign:', { x: C1, y: y + 10, size: 7, font: boldFont, color: DKGRAY });
  page.drawText('GPS Map:', { x: C2, y: y + 10, size: 7, font: boldFont, color: DKGRAY });
  page.drawRectangle({ x: C1, y: y - PH2, width: PW2, height: PH2, color: LGRAY });
  page.drawRectangle({ x: C2, y: y - PH2, width: PW2, height: PH2, color: LGRAY });
  if (sitePhoto) {
    var sb = await fetchPhotoBytes(sitePhoto.storage_path);
    var simg = await embedImg(sb);
    if (simg) {
      var ss = simg.scaleToFit(PW2 - 4, PH2 - 4);
      page.drawImage(simg, { x: C1 + (PW2 - ss.width) / 2, y: y - PH2 + (PH2 - ss.height) / 2, width: ss.width, height: ss.height });
    }
  }
  if (gpsPhoto) {
    var gb = await fetchPhotoBytes(gpsPhoto.storage_path);
    var gimg = await embedImg(gb);
    if (gimg) {
      var gs = gimg.scaleToFit(PW2 - 4, PH2 - 4);
      page.drawImage(gimg, { x: C2 + (PW2 - gs.width) / 2, y: y - PH2 + (PH2 - gs.height) / 2, width: gs.width, height: gs.height });
    }
  }
  y -= PH2 + 10;

  // DESCRIPTION OF WORK
  if (y < 120) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 8; }
  y = drawSectionBar(page, 'Description of Work', y);
  y -= 4;
  var desc = String(sub.summary || d.workDescription || d.description || d.notes || '');
  if (desc) {
    var words = desc.split(/\s+/);
    var line = '';
    for (var wi = 0; wi < words.length; wi++) {
      var word = words[wi];
      var test = line ? line + ' ' + word : word;
      if (regFont.widthOfTextAtSize(test, 10) > CONTENT_W - 4) {
        if (y < FOOTER_H + 18) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 8; }
        page.drawText(line, { x: MARGIN, y: y, size: 10, font: regFont, color: BLACK });
        y -= 14;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      if (y < FOOTER_H + 18) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 8; }
      page.drawText(line, { x: MARGIN, y: y, size: 10, font: regFont, color: BLACK });
      y -= 14;
    }
  }
  y -= 8;

  // COMPLETED WORK PHOTOS
  var skipSecs = ['site-sign','arrival-photo','site_sign','gps','map','gps-map','signature','sig','arrival-video','departure-video'];
  var jobPhotos = photos.filter(function(p) {
    var sec = p.section || '';
    if (skipSecs.indexOf(sec) >= 0) return false;
    if (sec.indexOf('tech-sig') === 0) return false;
    if (sec.indexOf('part-') === 0) return false;
    return true;
  });
  if (jobPhotos.length > 0) {
    if (y < 150) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 8; }
    y = drawSectionBar(page, 'Completed Work', y);
    y -= 6;
    var PW3 = Math.floor((CONTENT_W - 8) / 3);
    var PH3 = Math.floor(PW3 * 0.72);
    var col3 = 0;
    var rowY = y;
    for (var pi = 0; pi < jobPhotos.length; pi++) {
      var photo = jobPhotos[pi];
      if (col3 === 0 && rowY - PH3 < FOOTER_H + 30) {
        drawFooter(page);
        page = newPage();
        rowY = PAGE_H - HEADER_H - 8;
      }
      var px = MARGIN + col3 * (PW3 + 4);
      page.drawRectangle({ x: px, y: rowY - PH3, width: PW3, height: PH3, color: LGRAY });
      var pb = await fetchPhotoBytes(photo.storage_path);
      var pimg = await embedImg(pb);
      if (pimg) {
        var ps = pimg.scaleToFit(PW3 - 2, PH3 - 2);
        page.drawImage(pimg, { x: px + (PW3 - ps.width) / 2, y: rowY - PH3 + (PH3 - ps.height) / 2, width: ps.width, height: ps.height });
      }
      if (photo.caption) {
        page.drawText(String(photo.caption).substring(0, 36), { x: px, y: rowY - PH3 - 9, size: 7, font: regFont, color: GRAY });
      }
      col3++;
      if (col3 >= 3) { col3 = 0; rowY -= PH3 + 16; }
    }
    if (col3 > 0) { rowY -= PH3 + 16; }
    y = rowY - 8;
  }

  // TECH SIGNATURES
  var sigPhotos = photos.filter(function(p) {
    return p.section === 'signature' || p.section === 'sig' || (p.section && p.section.indexOf('tech-sig') === 0);
  });
  if (sigPhotos.length > 0 || techs.length > 0) {
    var nSigs = Math.max(sigPhotos.length, techs.length, 1);
    if (y < 100) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 8; }
    y = drawSectionBar(page, 'Technician Signatures', y);
    y -= 6;
    for (var si = 0; si < nSigs; si++) {
      if (y < 90) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 8; }
      var techN = techs[si] || '';
      page.drawText('Technician' + (techN ? ': ' + techN : ''), { x: MARGIN, y: y, size: 9, font: boldFont, color: BLACK });
      y -= 6;
      var SW = 200;
      var SH = 60;
      page.drawRectangle({ x: MARGIN, y: y - SH, width: SW, height: SH, color: LGRAY });
      if (sigPhotos[si]) {
        var sigB = await fetchPhotoBytes(sigPhotos[si].storage_path);
        var sigI = await embedImg(sigB);
        if (sigI) {
          var sigS = sigI.scaleToFit(SW - 4, SH - 4);
          page.drawImage(sigI, { x: MARGIN + (SW - sigS.width) / 2, y: y - SH + (SH - sigS.height) / 2, width: sigS.width, height: sigS.height });
        }
      }
      y -= SH + 14;
    }
  }

  // PARTS TABLE
  if (parts.length > 0) {
    if (y < 120) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 8; }
    y = drawSectionBar(page, 'Parts', y);
    y -= 4;
    var tCols = [
      { label: 'SKU', x: MARGIN + 2 },
      { label: 'Description', x: MARGIN + 62 },
      { label: 'Notes', x: MARGIN + 225 },
      { label: 'Unit $', x: MARGIN + 330 },
      { label: 'Qty', x: MARGIN + 392 },
      { label: 'Total', x: MARGIN + 428 }
    ];
    function drawPartsHeader(pg, yy) {
      pg.drawRectangle({ x: MARGIN, y: yy - 16, width: CONTENT_W, height: 18, color: BLACK });
      for (var ci = 0; ci < tCols.length; ci++) {
        pg.drawText(tCols[ci].label, { x: tCols[ci].x, y: yy - 12, size: 8, font: boldFont, color: WHITE });
      }
    }
    drawPartsHeader(page, y);
    y -= 20;
    var ROW_H = 22;
    for (var rpi = 0; rpi < parts.length; rpi++) {
      var part = parts[rpi];
      if (y - ROW_H < FOOTER_H + 30) {
        drawFooter(page);
        page = newPage();
        y = PAGE_H - HEADER_H - 8;
        drawPartsHeader(page, y);
        y -= 20;
      }
      if (rpi % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: CONTENT_W, height: ROW_H, color: LGRAY });
      page.drawText(String(part.sku || part.code || '').substring(0, 10), { x: tCols[0].x, y: y - 14, size: 8, font: boldFont, color: BLACK });
      page.drawText(String(part.description || part.name || '').substring(0, 26), { x: tCols[1].x, y: y - 14, size: 8, font: regFont, color: BLACK });
      page.drawText(String(part.notes || '').substring(0, 16), { x: tCols[2].x, y: y - 14, size: 7, font: regFont, color: DKGRAY });
      page.drawText(fmtMoney(part.price || part.unitPrice), { x: tCols[3].x, y: y - 14, size: 8, font: regFont, color: BLACK });
      var qty = parseInt(part.qty || part.quantity || 1);
      page.drawText(String(qty), { x: tCols[4].x, y: y - 14, size: 8, font: regFont, color: BLACK });
      page.drawText(fmtMoney(parseFloat(part.price || part.unitPrice || 0) * qty), { x: tCols[5].x, y: y - 14, size: 8, font: boldFont, color: BLACK });
      y -= ROW_H;
    }
    y -= 8;
  }

  // COST SUMMARY
  if (y < 110) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 8; }
  y = drawSectionBar(page, 'Cost Summary', y);
  y -= 4;
  var summRows = [
    ['Parts Total', fmtMoney(partsTotal)],
    ['Mileage / Travel (' + parseFloat(sub.miles || 0).toFixed(0) + ' mi)', fmtMoney(mileageTotal)],
    ['Labor', fmtMoney(laborTotal)],
    ['GRAND TOTAL', fmtMoney(grandTotal)]
  ];
  for (var ri = 0; ri < summRows.length; ri++) {
    var isGrand = ri === 3;
    var sRow = summRows[ri];
    page.drawRectangle({ x: PAGE_W - MARGIN - 210, y: y - 16, width: 210, height: 18, color: isGrand ? BLACK : LGRAY });
    page.drawText(sRow[0], { x: PAGE_W - MARGIN - 206, y: y - 12, size: 9, font: isGrand ? boldFont : regFont, color: isGrand ? WHITE : BLACK });
    var valW = boldFont.widthOfTextAtSize(sRow[1], 9);
    page.drawText(sRow[1], { x: PAGE_W - MARGIN - valW - 4, y: y - 12, size: 9, font: boldFont, color: isGrand ? WHITE : BLACK });
    y -= 20;
  }

  drawFooter(page);

  var pdfBytes = await pdfDoc.save();
  var pdfB64 = Buffer.from(pdfBytes).toString('base64');
  var custDisp = sub.customer_name || d.customer || 'Customer';
  var locDisp = sub.location_name || d.location || '';
  var subject = 'Work Order #' + woNum + ' - ' + custDisp + (locDisp ? ' - ' + locDisp : '') + ' - ' + jobTypeLabel + ' - ROS Service Work Order';
  var htmlBody = '<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">'
    + '<div style="background:#1a2332;padding:18px 24px;border-radius:6px 6px 0 0">'
    + '<img src="https://pm.reliable-oilfield-services.com/ros-logo.png" style="height:44px;width:44px;object-fit:contain;margin-right:12px;vertical-align:middle">'
    + '<span style="color:#fff;font-size:17px;font-weight:bold;vertical-align:middle">ROS Service Work Order</span>'
    + '</div>'
    + '<div style="background:#fff;border:1px solid #ddd;border-top:none;padding:20px">'
    + '<h2 style="color:#1a2332;margin:0 0 4px">Work Order #' + woNum + '</h2>'
    + '<p style="color:#666;margin:0 0 16px;font-size:13px">' + jobTypeLabel + ' | ' + fmtDate(sub.date) + '</p>'
    + '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">'
    + '<tr><td style="padding:6px;background:#f5f5f5;font-weight:bold;width:120px">Customer</td><td style="padding:6px">' + custDisp + '</td>'
    + '<td style="padding:6px;background:#f5f5f5;font-weight:bold;width:120px">Location</td><td style="padding:6px">' + locDisp + '</td></tr>'
    + '<tr><td style="padding:6px;background:#f5f5f5;font-weight:bold">Truck</td><td style="padding:6px">' + (sub.truck_number || '') + '</td>'
    + '<td style="padding:6px;background:#f5f5f5;font-weight:bold">Tech</td><td style="padding:6px">' + (techs[0] || '') + '</td></tr>'
    + '</table>'
    + '<p style="font-size:13px">Please find the ROS Service Work Order PDF attached.</p>'
    + '<hr style="border:none;border-top:1px solid #eee;margin:16px 0">'
    + '<p style="color:#999;font-size:11px">Reliable Oilfield Services | reliable-oilfield-services.com</p>'
    + '</div></div>';
  var emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: TO, subject: subject, html: htmlBody, attachments: [{ filename: 'Work-Order-' + woNum + '-report.pdf', content: pdfB64 }] })
  });
  var emailData = await emailResp.json();
  if (!emailResp.ok) return res.status(500).json({ error: 'Resend error', details: emailData });
  return res.status(200).json({ ok: true, emailId: emailData.id });
}
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

// ââ DAILY INSPECTION REPORT ââââââââââââââââââââââââââââââââââââââââââââââ
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
async function sendJhaReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts) {
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
  var pdfB64 = Buffer.from(pdfBytes).toString('base64');

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
async function sendJhaReport(res, sub, d, photos, PDFDocument, rgb, StandardFonts) {
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
  var pdfB64 = Buffer.from(pdfBytes).toString('base64');

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
    + (highRisk > 0 ? '<div style="background:#fef2f2;border:2px solid #dc2626;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-weight:bold;color:#991b1b">\u26a0\ufe0f ' + highRisk + ' HIGH/CRITICAL RISK STEP(S) IDENTIFIED â Supervisor approval required before starting work</div>' : '')
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
