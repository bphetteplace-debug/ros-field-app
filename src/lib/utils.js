export const fmt = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const nowTime = () => {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h.toString().padStart(2, '0')}:${m} ${ap}`;
};

// Parse a time string into total minutes since midnight.
// Accepts either 12-hour ("08:30 AM", "4:15 PM", "12:00 pm") or 24-hour ("13:45", "08:30").
// Returns null on anything unrecognizable.
export const parseTime = (str) => {
  if (!str) return null;
  const s = String(str).trim().toUpperCase();
  // 12-hour with AM/PM. Space between minute and AM/PM is optional so
  // both "08:30 AM" and "08:30AM" parse — techs typing on a phone often
  // skip the space.
  let m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = m[3];
    if (h === 12) h = 0;
    if (ap === 'PM') h += 12;
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  // 24-hour HH:MM
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  return null;
};

// Given a start and end time string, return the elapsed time in decimal hours,
// rounded to the nearest quarter (so 1h7m -> 1.0, 1h8m -> 1.25, 2h22m -> 2.5).
// Handles overnight crossings (departure before start = next-day departure).
// Returns null if either time is invalid.
export const decimalHoursBetween = (start, end) => {
  const s = parseTime(start);
  const e = parseTime(end);
  if (s === null || e === null) return null;
  let diffMin = e - s;
  if (diffMin < 0) diffMin += 24 * 60;            // crossed midnight
  const hours = diffMin / 60;
  return Math.round(hours * 4) / 4;               // snap to nearest 0.25
};

export const uuid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2, 11);
