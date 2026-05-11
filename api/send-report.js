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
  const fmt = (n) => '$' + parseFloat(n || 0).toFixed(2);
  const BLACK = rgb(0,0,0);
  const WHITE = rgb(1,1,1);
  const GRAY = rgb(0.5,0.5,0.5);
  const LGRAY = rgb(0.94,0.94,0.94);
  const MGRAY = rgb(0.75,0.75,0.75);
  const DKGRAY = rgb(0.25,0.25,0.25);
  const pdfDoc = await PDFDocument.create();
  const regFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let logoImg = null;
  try {
    const logoResp = await fetch('https://pm.reliable-oilfield-services.com/ros-logo.png');
    if (logoResp.ok) {
      const logoBytes = await logoResp.arrayBuffer();
      logoImg = await pdfDoc.embedPng(new Uint8Array(logoBytes));
    }
  } catch (e) { }

  async function fetchPhotoBytes(storagePath) {
    if (!storagePath) return null;
    try {
      const url = SUPA_URL + '/storage/v1/object/authenticated/photos/' + storagePath;
      const r = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } });
      if (!r.ok) return null;
      return new Uint8Array(await r.arrayBuffer());
    } catch { return null; }
  }

  async function embedPhoto(bytes) {
    if (!bytes) return null;
    try { return await pdfDoc.embedJpg(bytes); } catch {}
    try { return await pdfDoc.embedPng(bytes); } catch {}
    return null;
  }

  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN = 36;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const HEADER_H = 95;
  const FOOTER_H = 22;
  let pageNum = 0;

  function drawHeader(pg) {
    pageNum++;
    if (logoImg) {
      const logoDims = logoImg.scale(0.22);
      pg.drawImage(logoImg, { x: MARGIN, y: PAGE_H - MARGIN - logoDims.height, width: logoDims.width, height: logoDims.height });
    } else {
      pg.drawCircle({ x: MARGIN + 28, y: PAGE_H - MARGIN - 28, size: 28, borderColor: BLACK, borderWidth: 2, color: WHITE });
      pg.drawText('ROS', { x: MARGIN + 16, y: PAGE_H - MARGIN - 34, size: 10, font: boldFont, color: BLACK });
    }
    const titleW = boldFont.widthOfTextAtSize('ROS Service Work Order', 18);
    pg.drawText('ROS Service Work Order', { x: PAGE_W / 2 - titleW / 2, y: PAGE_H - MARGIN - 22, size: 18, font: boldFont, color: BLACK });
    const subW = regFont.widthOfTextAtSize('Reliable Oilfield Services', 11);
    pg.drawText('Reliable Oilfield Services', { x: PAGE_W / 2 - subW / 2, y: PAGE_H - MARGIN - 38, size: 11, font: regFont, color: DKGRAY });
    pg.drawText('No.', { x: PAGE_W - MARGIN - 72, y: PAGE_H - MARGIN - 16, size: 9, font: boldFont, color: BLACK });
    const dateStr = sub.date ? sub.date.substring(0,7).replace('-','/') : new Date().toLocaleDateString('en-US',{month:'numeric',year:'numeric'}).replace('/','/');
    pg.drawText(dateStr + ' ' + woNum, { x: PAGE_W - MARGIN - 72, y: PAGE_H - MARGIN - 28, size: 9, font: regFont, color: BLACK });
    pg.drawRectangle({ x: MARGIN, y: PAGE_H - HEADER_H + 2, width: CONTENT_W, height: 1, color: MGRAY });
  }

  function drawFooter(pg) {
    pg.drawText(String(sub.id || '').substring(0,50), { x: MARGIN, y: 14, size: 7, font: regFont, color: GRAY });
    pg.drawText(String(pageNum), { x: PAGE_W - MARGIN - 8, y: 14, size: 8, font: boldFont, color: GRAY });
  }

  function drawSection(pg, title, yPos) {
    pg.drawRectangle({ x: MARGIN, y: yPos - 4, width: CONTENT_W, height: 22, color: BLACK });
    const tw = boldFont.widthOfTextAtSize(title, 11);
    pg.drawText(title, { x: PAGE_W / 2 - tw / 2, y: yPos + 2, size: 11, font: boldFont, color: WHITE });
    return yPos - 30;
  }

  function drawField2(pg, label, value, x, yPos) {
    pg.drawText(label + ':', { x, y: yPos + 14, size: 8, font: boldFont, color: DKGRAY });
    const val = String(value || 'N/A').substring(0, 30);
    pg.drawText(val, { x, y: yPos, size: 10, font: regFont, color: BLACK });
  }

  function newPage() {
    const pg = pdfDoc.addPage([PAGE_W, PAGE_H]);
    drawHeader(pg);
    return pg;
  }

  let page = newPage();
  let y = PAGE_H - HEADER_H - 14;

  // CUSTOMER INFORMATION
  y = drawSection(page, 'Customer Information', y);
  y -= 8;
  const col1 = MARGIN, col2 = MARGIN + CONTENT_W/3, col3 = MARGIN + CONTENT_W*2/3;
  drawField2(page, 'Customer Name', d.customer, col1, y);
  drawField2(page, 'ROS Truck Number', d.truck, col2, y);
  drawField2(page, 'Start Time', d.startTime || '', col3, y);
  y -= 32;
  drawField2(page, 'Location Name', d.location, col1, y);
  drawField2(page, 'Customer Contact', d.contact, col2, y);
  drawField2(page, 'Arrival Observations', '', col3, y);
  y -= 32;
  drawField2(page, 'GL Code', d.glCode || 'N/A', col1, y);
  drawField2(page, 'Type of work', jobTypeLabel, col2, y);
  y -= 32;
  drawField2(page, 'Equipment Asset Tag', d.assetTag || 'None', col1, y);
  drawField2(page, 'Work Area', d.workArea || 'None', col2, y);
  drawField2(page, 'Website', 'Reliable-oilfield-services.com', col3, y);
  y -= 32;
  drawField2(page, 'Customer Work Order', d.customerWO || 'N/A', col1, y);
  drawField2(page, 'Date', sub.date || '', col2, y);
  y -= 32;

  // Site sign + GPS side by side
  const sitePhoto = photos.find(p => p.section === 'site-sign' || p.section === 'arrival-photo');
  const gpsPhoto = photos.find(p => p.section === 'gps' || p.section === 'map');
  const HALF_W = CONTENT_W / 2 - 4;
  const HALF_H = 110;
  page.drawText('Site Sign:', { x: col1, y: y + 12, size: 8, font: boldFont, color: DKGRAY });
  page.drawText('GPS:', { x: col2, y: y + 12, size: 8, font: boldFont, color: DKGRAY });
  page.drawRectangle({ x: col1, y: y - HALF_H, width: HALF_W, height: HALF_H, color: LGRAY });
  page.drawRectangle({ x: col2, y: y - HALF_H, width: HALF_W, height: HALF_H, color: LGRAY });
  if (sitePhoto) {
    const b = await fetchPhotoBytes(sitePhoto.storage_path);
    const img = await embedPhoto(b);
    if (img) { const s = img.scaleToFit(HALF_W, HALF_H); page.drawImage(img, { x: col1+(HALF_W-s.width)/2, y: y-HALF_H+(HALF_H-s.height)/2, width: s.width, height: s.height }); }
  }
  if (gpsPhoto) {
    const b = await fetchPhotoBytes(gpsPhoto.storage_path);
    const img = await embedPhoto(b);
    if (img) { const s = img.scaleToFit(HALF_W, HALF_H); page.drawImage(img, { x: col2+(HALF_W-s.width)/2, y: y-HALF_H+(HALF_H-s.height)/2, width: s.width, height: s.height }); }
  }
  y -= HALF_H + 14;

  // DESCRIPTION OF WORK
  if (y < 120) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 14; }
  y = drawSection(page, 'Description of Work', y);
  y -= 6;
  page.drawText('Summary:', { x: MARGIN, y, size: 9, font: boldFont, color: BLACK });
  y -= 14;
  const desc = String(d.workDescription || d.description || d.notes || '');
  const words = desc.split(/\s+/);
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (regFont.widthOfTextAtSize(test, 10) > CONTENT_W - 8) {
      if (y < FOOTER_H + 20) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 14; }
      page.drawText(line, { x: MARGIN, y, size: 10, font: regFont, color: BLACK });
      y -= 14; line = word;
    } else { line = test; }
  }
  if (line) { page.drawText(line, { x: MARGIN, y, size: 10, font: regFont, color: BLACK }); y -= 14; }
  y -= 10;

  // COMPLETED WORK PHOTOS
  const generalPhotos = photos.filter(p => !p.section || p.section === 'work' || p.section === 'general');
  const equipPhotos = photos.filter(p => p.section && p.section !== 'work' && p.section !== 'general' && !p.section.startsWith('arrival') && !p.section.startsWith('departure') && p.section !== 'site-sign' && p.section !== 'gps' && p.section !== 'map' && !p.section.startsWith('part-') && p.section !== 'signature' && !p.section.startsWith('tech-sig'));
  const allJobPhotos = [...generalPhotos, ...equipPhotos];

  if (allJobPhotos.length > 0) {
    if (y < 120) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 14; }
    y = drawSection(page, 'Completed Work', y);
    y -= 8;
    const PW = (CONTENT_W - 8) / 3;
    const PH = PW * 0.75;
    let col = 0; let rowY = y;
    for (const photo of allJobPhotos) {
      if (col === 0 && rowY - PH < FOOTER_H + 30) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 14; rowY = y; }
      const px = MARGIN + col * (PW + 4);
      page.drawRectangle({ x: px, y: rowY-PH, width: PW, height: PH, color: LGRAY });
      const b = await fetchPhotoBytes(photo.storage_path);
      const img = await embedPhoto(b);
      if (img) { const s = img.scaleToFit(PW, PH); page.drawImage(img, { x: px+(PW-s.width)/2, y: rowY-PH+(PH-s.height)/2, width: s.width, height: s.height }); }
      if (photo.caption) page.drawText(String(photo.caption).substring(0,38), { x: px, y: rowY-PH-10, size: 7, font: regFont, color: GRAY });
      col++;
      if (col >= 3) { col = 0; rowY -= PH + 18; }
    }
    y = rowY - (col > 0 ? PH + 18 : 0);
    y -= 10;
  }

  // TECH SIGNATURES
  const sigPhotos = photos.filter(p => p.section === 'signature' || p.section === 'sig' || (p.section && p.section.startsWith('tech-sig')));
  if (sigPhotos.length > 0 || techs.length > 0) {
    if (y < 120) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 14; }
    const nSigs = Math.max(sigPhotos.length, techs.length, 1);
    for (let i = 0; i < nSigs; i++) {
      if (y < 90) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 14; }
      const techName = techs[i] || '';
      page.drawText('Tech Signature' + (techName ? ' - ' + techName : ''), { x: MARGIN, y, size: 9, font: boldFont, color: BLACK });
      y -= 6;
      const SW = 180; const SH = 64;
      page.drawRectangle({ x: MARGIN, y: y-SH, width: SW, height: SH, color: LGRAY });
      if (sigPhotos[i]) {
        const b = await fetchPhotoBytes(sigPhotos[i].storage_path);
        const img = await embedPhoto(b);
        if (img) { const s = img.scaleToFit(SW, SH); page.drawImage(img, { x: MARGIN+(SW-s.width)/2, y: y-SH+(SH-s.height)/2, width: s.width, height: s.height }); }
      }
      y -= SH + 14;
    }
  }

  // PARTS TABLE
  if (parts.length > 0) {
    if (y < 100) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 14; }
    y = drawSection(page, 'Parts', y);
    y -= 4;
    const ROW_H = 72;
    const IMG_W = 62;
    const CX = { sku: MARGIN, skuW: 55, desc: MARGIN+55, descW: 130, img: MARGIN+190, imgW: IMG_W, notes: MARGIN+258, notesW: 88, price: MARGIN+350, priceW: 56, qty: MARGIN+410, qtyW: 38, total: MARGIN+452, totalW: 84 };
    // Header
    page.drawRectangle({ x: MARGIN, y: y-16, width: CONTENT_W, height: 18, color: BLACK });
    const hdr = [['SKU', CX.sku+2],['Description',CX.desc],['Photo',CX.img+10],['Notes',CX.notes],['Unit $',CX.price],['Qty',CX.qty+5],['Total',CX.total]];
    for (const [h,hx] of hdr) page.drawText(h, { x:hx, y:y-12, size:8, font:boldFont, color:WHITE });
    y -= 20;

    for (const part of parts) {
      if (y - ROW_H < FOOTER_H + 30) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 14; }
      const rb = y - ROW_H;
      page.drawRectangle({ x: MARGIN, y: rb, width: CONTENT_W, height: ROW_H, color: WHITE });
      page.drawRectangle({ x: MARGIN, y: rb, width: CONTENT_W, height: 1, color: LGRAY });
      page.drawText(String(part.sku||part.code||''), { x: CX.sku+2, y: y-14, size:8, font:boldFont, color:BLACK });
      // Wrap description
      const dw = String(part.description||part.name||'').split(' ');
      let dl=''; let dy=y-14;
      for (const w of dw) {
        const t = dl ? dl+' '+w : w;
        if (regFont.widthOfTextAtSize(t,8) > CX.descW-4) {
          page.drawText(dl, { x:CX.desc, y:dy, size:8, font:regFont, color:BLACK });
          dy -= 11; dl = w; if (dy < rb+4) break;
        } else dl = t;
      }
      if (dl && dy >= rb+4) page.drawText(dl, { x:CX.desc, y:dy, size:8, font:regFont, color:BLACK });
      page.drawText(fmt(part.price||part.unitPrice), { x:CX.price, y:y-14, size:8, font:regFont, color:BLACK });
      const qty = parseInt(part.qty||part.quantity||1);
      page.drawText(String(qty), { x:CX.qty+5, y:y-14, size:8, font:regFont, color:BLACK });
      const ptotal = parseFloat(part.price||part.unitPrice||0)*qty;
      page.drawText(fmt(ptotal), { x:CX.total, y:y-14, size:8, font:boldFont, color:BLACK });
      // Part photo
      const pp = photos.find(p => p.section === 'part-'+(part.sku||part.code));
      if (pp) {
        const b = await fetchPhotoBytes(pp.storage_path);
        const img = await embedPhoto(b);
        if (img) { const s = img.scaleToFit(IMG_W, ROW_H-8); page.drawImage(img, { x:CX.img+(IMG_W-s.width)/2, y:rb+4+(ROW_H-8-s.height)/2, width:s.width, height:s.height }); }
      }
      y -= ROW_H;
    }

    // Cost summary
    y -= 8;
    if (y < 90) { drawFooter(page); page = newPage(); y = PAGE_H - HEADER_H - 14; }
    const tots = [['Parts Total',fmt(partsTotal)],['Mileage/Travel',fmt(mileageTotal)],['Labor',fmt(laborTotal)],['GRAND TOTAL',fmt(grandTotal)]];
    for (const [lbl,val] of tots) {
      const bold = lbl === 'GRAND TOTAL';
      page.drawRectangle({ x: PAGE_W-MARGIN-180, y:y-4, width:180, height:18, color: bold ? BLACK : LGRAY });
      page.drawText(lbl, { x:PAGE_W-MARGIN-175, y:y, size:9, font: bold ? boldFont : regFont, color: bold ? WHITE : BLACK });
      page.drawText(val, { x:PAGE_W-MARGIN-58, y:y, size:9, font:boldFont, color: bold ? WHITE : BLACK });
      y -= 20;
    }
  }

  drawFooter(page);

  // Build PDF + send email
  const pdfBytes = await pdfDoc.save();
  const pdfB64 = Buffer.from(pdfBytes).toString('base64');
  const customer = d.customer || sub.customer || 'Customer';
  const location = d.location || sub.location || '';
  const tech = techs[0] || sub.technician || '';
  const subject = 'Work Order #' + woNum + ' - ' + customer + (location ? ' - ' + location : '') + ' - ' + jobTypeLabel + ' - ROS Service Work Order';
  const htmlBody = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#1a2332">Work Order #' + woNum + '</h2><p><strong>Customer:</strong> ' + customer + '</p><p><strong>Location:</strong> ' + location + '</p><p><strong>Technician:</strong> ' + tech + '</p><p><strong>Type:</strong> ' + jobTypeLabel + '</p><p><strong>Date:</strong> ' + (sub.date||'') + '</p><p>Please find the attached Work Order PDF.</p><hr/><p style="color:#888;font-size:12px">Reliable Oilfield Services | Reliable-oilfield-services.com</p></div>';
  const emailResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: TO, subject, html: htmlBody, attachments: [{ filename: 'Work-Order-' + woNum + '-report.pdf', content: pdfB64 }] }),
  });
  const emailData = await emailResp.json();
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
