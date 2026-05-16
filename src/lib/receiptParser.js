// Pure functions that parse the OCR'd text of a receipt into structured
// fields (vendor / amount / category / date). Called from the receipt
// scanner on ExpenseReportPage after Tesseract has produced raw text.
//
// All functions return null when they can't make a confident guess — the
// caller fills only empty form fields, never overwrites whatever the
// tech has typed.

// Keyword → category mapping. Order matters: first matching category
// wins, so list the most specific keywords first within each bucket.
const CATEGORY_KEYWORDS = {
  Fuel: [
    'diesel', 'unleaded', 'gasoline', 'fuel', 'gallons', 'gal @',
    'shell', 'exxon', 'chevron', 'mobil', 'valero', 'phillips',
    'conoco', 'sunoco', "love's", 'pilot', 'flying j', 'circle k',
    'pump', 'unl-', 'reg ', ' prem ', 'fuel total',
  ],
  Meals: [
    'restaurant', 'cafe', 'café', 'grill', 'diner', 'pizza', 'burger',
    'mcdonald', 'subway', 'taco', 'wendy', 'chick-fil-a', 'starbucks',
    'food', 'meal', 'sonic', 'whataburger', 'dunkin', 'panera',
  ],
  Lodging: [
    'hotel', 'motel', 'inn', 'lodging', 'suites',
    'hampton', 'marriott', 'holiday inn', 'best western', 'la quinta',
    'comfort inn', 'sleep inn', 'super 8', 'days inn',
  ],
  'Tools / Supplies': [
    'home depot', 'lowes', 'lowe\'s', 'tractor supply', 'ace hardware',
    'hardware', 'fasteners', 'tools', 'autozone', 'oreilly',
    'napa', 'harbor freight',
  ],
  Repairs: [
    'repair', 'mechanic', 'tire', 'oil change', 'auto service',
    'jiffy lube', 'firestone', 'midas',
  ],
  'Parking / Tolls': [
    'parking', 'toll', 'parking garage', 'meter ', 'tollway', 'turnpike',
  ],
};

export function detectCategory(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const k of keywords) {
      if (lower.includes(k)) return cat;
    }
  }
  return null;
}

// Find a dollar amount. Prefer one labeled "total" / "amount due" /
// "balance" — falls back to the largest reasonable dollar amount in the
// text if no labelled total is found.
export function extractAmount(text) {
  if (!text || typeof text !== 'string') return null;
  // Labelled-total patterns. Allow a few non-digit chars between the
  // label and the number (like a colon or "$").
  const labelPatterns = [
    /grand\s*total[^\d]{0,12}\$?\s*(\d{1,6}\.\d{2})/i,
    /total\s*due[^\d]{0,12}\$?\s*(\d{1,6}\.\d{2})/i,
    /amount\s*due[^\d]{0,12}\$?\s*(\d{1,6}\.\d{2})/i,
    /balance\s*due[^\d]{0,12}\$?\s*(\d{1,6}\.\d{2})/i,
    /\btotal\b[^\d]{0,8}\$?\s*(\d{1,6}\.\d{2})/i,
  ];
  for (const p of labelPatterns) {
    const m = text.match(p);
    if (m) {
      const v = parseFloat(m[1]);
      if (Number.isFinite(v) && v > 0 && v < 100000) return v;
    }
  }
  // Fallback: any dollar amount with 2 decimals. Pick the largest, since
  // receipts usually have line items + a total and the total is the
  // largest. \b at the start prevents matching the tail of an over-long
  // number like "999999.99" as "99999.99". Cap at 100k to throw out OCR
  // garbage that slipped through.
  const re = /(?:^|[^\d.])(\d{1,5}\.\d{2})\b/g;
  const amounts = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = parseFloat(m[1]);
    if (Number.isFinite(v) && v > 0 && v < 100000) amounts.push(v);
  }
  if (amounts.length === 0) return null;
  amounts.sort((a, b) => b - a);
  return amounts[0];
}

// Vendor names live at the top of receipts. Strip common headers
// ("WELCOME TO", "RECEIPT", "STORE #..."), then take the first short
// fragment of letters before an address-y chunk kicks in.
const HEADER_NOISE_RE = /\b(welcome\s+to|welcome|thank\s+you|customer\s+copy|merchant\s+copy|receipt|invoice|order\s*#?\d*|store\s*#?\d+|reg\s*#?\d+|tran\s*#?\d+)\b/gi;

export function extractVendor(text) {
  if (!text || typeof text !== 'string') return null;
  // Receipts are single-line after our normalization, but we can split on
  // common boundaries: a street number ("123 Main"), state abbreviation +
  // zip ("TX 79401"), or "P.O. Box".
  const firstSegment =
    text.split(/\b\d{1,5}\s+[NSEW]?\s*[A-Z][a-z]/)[0] ||
    text.split(/\b[A-Z]{2}\s+\d{5}\b/)[0] ||
    text;
  // Remove header noise.
  let cleaned = firstSegment.replace(HEADER_NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  // Take the first 5 words max — vendor names are usually short.
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length === 0) return null;
  const joined = words.join(' ');
  // Sanity: reject if too short or all numeric.
  if (joined.length < 2 || /^[\d\s.,-]+$/.test(joined)) return null;
  return joined;
}

// Pull a date from the text in MM/DD/YYYY or YYYY-MM-DD form. Returns
// the date as an ISO YYYY-MM-DD string when parseable, otherwise null.
export function extractDate(text) {
  if (!text || typeof text !== 'string') return null;
  const slashed = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (slashed) {
    const m = parseInt(slashed[1], 10);
    const d = parseInt(slashed[2], 10);
    let y = parseInt(slashed[3], 10);
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y < 2100) {
      return (
        y.toString().padStart(4, '0') +
        '-' +
        m.toString().padStart(2, '0') +
        '-' +
        d.toString().padStart(2, '0')
      );
    }
  }
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  return null;
}

export function parseReceiptText(text) {
  if (!text || typeof text !== 'string') return {};
  return {
    vendor: extractVendor(text),
    amount: extractAmount(text),
    category: detectCategory(text),
    date: extractDate(text),
  };
}
