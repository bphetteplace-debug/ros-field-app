import { describe, it, expect } from 'vitest';
import { buildPDFData, fmtMoney, fmtTime } from '../pdfData.js';

const getUrl = (path) => 'https://cdn.example.com/' + path;

function pmSubmission(overrides = {}) {
  return {
    id: 'uuid-1',
    pm_number: 10042,
    work_order: '10042',
    template: 'pm_flare_combustor',
    customer_name: 'Diamondback',
    location_name: 'Pad 17',
    truck_number: '0003',
    date: '2026-05-15',
    start_time: '08:30:00',
    departure_time: '14:45:00',
    work_type: 'Quarterly PM',
    work_area: 'Tank battery',
    contact: 'John Doe',
    gl_code: 'GL-100',
    asset_tag: 'AT-9912',
    summary: 'Performed full PM inspection.',
    miles: 42.5,
    cost_per_mile: 1.5,
    labor_hours: 3.5,
    labor_rate: 115,
    photos: [
      { storage_path: 'uuid-1/work-0.jpg', caption: 'Before', section: 'work' },
    ],
    data: {
      jobType: 'PM',
      warrantyWork: false,
      techs: ['Matthew Reid', 'Pedro Perez'],
      billableTechs: 2,
      parts: [
        { sku: 'P-1', description: 'Gasket', qty: 2, price: 12.5 },
      ],
      arrestors: [{ tag: 'A-1', condition: 'good' }],
      flares: [],
      heaters: [],
      partsTotal: 25.0,
      lastServiceDate: '2026-02-15',
      permitsRequired: ['Hot Work'],
      customerWorkOrder: 'CWO-555',
    },
    ...overrides,
  };
}

function serviceCallSubmission() {
  return {
    id: 'uuid-2',
    pm_number: 10050,
    work_order: '10050',
    template: 'service_call',
    customer_name: 'High Peak Energy',
    location_name: 'Site B',
    truck_number: '0002',
    date: '2026-05-15',
    miles: 30,
    cost_per_mile: 1.5,
    labor_hours: 2,
    labor_rate: 115,
    summary: 'Replaced igniter.',
    data: {
      jobType: 'Service Call',
      techs: ['Vladimir Rivero'],
      billableTechs: 1,
      scEquipment: [{ tag: 'IG-7', notes: 'replaced' }],
      reportedIssue: 'Flare not lighting',
      rootCause: 'Failed igniter',
      partsTotal: 100,
      grandTotal: 375,
    },
    photos: [],
  };
}

function expenseSubmission() {
  return {
    id: 'uuid-3',
    pm_number: 10060,
    work_order: '10060',
    template: 'expense_report',
    customer_name: 'ExTex',
    truck_number: '0004',
    date: '2026-05-15',
    summary: '',
    data: {
      jobType: 'Expense Report',
      techs: ['Pedro Perez'],
      expenseItems: [{ category: 'Fuel', amount: 50 }],
      expenseTotal: 50,
    },
    photos: [],
  };
}

function inspectionSubmission() {
  return {
    id: 'uuid-4',
    pm_number: 10070,
    work_order: '10070',
    template: 'daily_inspection',
    customer_name: '',
    truck_number: '0005',
    date: '2026-05-15',
    data: {
      jobType: 'Daily Inspection',
      techs: ['Matthew Reid'],
      inspectionType: 'pre-trip',
      odometer: 92341,
      checkItems: [{ id: 'lights_head', status: 'pass' }],
      failCount: 0,
      allPass: true,
    },
    photos: [],
  };
}

describe('buildPDFData', () => {
  it('builds top-level shape for a PM submission', async () => {
    const out = await buildPDFData(pmSubmission(), getUrl);
    expect(out.wo_number).toBe('10042');
    expect(out.customer).toBe('Diamondback');
    expect(out.location).toBe('Pad 17');
    expect(out.job_type).toBe('PM');
    expect(out.truck_number).toBe('0003');
    expect(out.technicians).toEqual(['Matthew Reid', 'Pedro Perez']);
    expect(out.tech_count).toBe(2);
  });

  it('formats start_time and departure_time as HH:MM', async () => {
    const out = await buildPDFData(pmSubmission(), getUrl);
    expect(out.start_time).toBe('08:30');
    expect(out.departure_time).toBe('14:45');
  });

  it('falls back to techs.length when billableTechs is missing', async () => {
    const sub = pmSubmission();
    delete sub.data.billableTechs;
    const out = await buildPDFData(sub, getUrl);
    expect(out.tech_count).toBe(2);
  });

  it('computes mileage_total from miles * cost_per_mile', async () => {
    const out = await buildPDFData(pmSubmission(), getUrl);
    expect(out.cost_mileage).toBe(fmtMoney(42.5 * 1.5));
  });

  it('uses grandTotal from data when present (Service Call)', async () => {
    const out = await buildPDFData(serviceCallSubmission(), getUrl);
    expect(out.cost_total).toBe(fmtMoney(375));
  });

  it('derives grandTotal when JSONB does not supply it (PM)', async () => {
    const out = await buildPDFData(pmSubmission(), getUrl);
    // mileage = 42.5 * 1.5 = 63.75, labor = 3.5 * 115 * 2 = 805, parts = 25
    const expected = 25 + 63.75 + 805;
    expect(out.cost_total).toBe(fmtMoney(expected));
  });

  it('surfaces reported_issue and root_cause for Service Call', async () => {
    const out = await buildPDFData(serviceCallSubmission(), getUrl);
    expect(out.reported_issue).toBe('Flare not lighting');
    expect(out.root_cause).toBe('Failed igniter');
    expect(out.job_type).toBe('Service Call');
  });

  it('passes through arrestors / flares / heaters for PM', async () => {
    const out = await buildPDFData(pmSubmission(), getUrl);
    expect(out.arrestors).toHaveLength(1);
    expect(out.flares).toEqual([]);
    expect(out.heaters).toEqual([]);
  });

  it('resolves photo URLs through getUrl', async () => {
    const out = await buildPDFData(pmSubmission(), getUrl);
    expect(out.photos[0].url).toBe('https://cdn.example.com/uuid-1/work-0.jpg');
    expect(out.photos[0].caption).toBe('Before');
    expect(out.photos[0].section).toBe('work');
  });

  it('expense_report submission still builds a valid shape', async () => {
    const out = await buildPDFData(expenseSubmission(), getUrl);
    expect(out.wo_number).toBe('10060');
    expect(out.customer).toBe('ExTex');
    expect(Array.isArray(out.parts)).toBe(true);
    expect(Array.isArray(out.photos)).toBe(true);
    expect(out.arrestors).toEqual([]);
  });

  it('daily_inspection submission still builds a valid shape', async () => {
    const out = await buildPDFData(inspectionSubmission(), getUrl);
    expect(out.wo_number).toBe('10070');
    expect(out.truck_number).toBe('0005');
    expect(out.technicians).toEqual(['Matthew Reid']);
    expect(out.parts).toEqual([]);
  });

  it('wo_number falls back to pm_number then id when work_order is empty', async () => {
    const sub = pmSubmission({ work_order: '' });
    const out = await buildPDFData(sub, getUrl);
    expect(out.wo_number).toBe('10042');

    const sub2 = pmSubmission({ work_order: '', pm_number: null });
    const out2 = await buildPDFData(sub2, getUrl);
    expect(out2.wo_number).toBe('uuid-1');
  });

  it('parts rows include formatted unit_price and line_total', async () => {
    const out = await buildPDFData(pmSubmission(), getUrl);
    expect(out.parts).toHaveLength(1);
    expect(out.parts[0].sku).toBe('P-1');
    expect(out.parts[0].qty).toBe(2);
    expect(out.parts[0].unit_price).toBe(fmtMoney(12.5));
    expect(out.parts[0].line_total).toBe(fmtMoney(25));
  });
});

describe('fmtTime', () => {
  it('truncates seconds from a HH:MM:SS time string', () => {
    expect(fmtTime('08:30:00')).toBe('08:30');
  });

  it('returns empty string for falsy input', () => {
    expect(fmtTime('')).toBe('');
    expect(fmtTime(null)).toBe('');
  });
});
