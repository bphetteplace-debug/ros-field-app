import { describe, it, expect } from 'vitest';
import { normalizePdfLayout, PDF_SECTION_DEFS, DEFAULT_PDF_LAYOUT } from '../../components/WorkOrderPDFTemplate.jsx';

const ALL_IDS = PDF_SECTION_DEFS.map(s => s.id);

describe('normalizePdfLayout', () => {
  it('returns full default layout when saved is null', () => {
    const out = normalizePdfLayout(null);
    expect(out).toHaveLength(PDF_SECTION_DEFS.length);
    expect(out.map(s => s.id)).toEqual(ALL_IDS);
    expect(out.every(s => s.enabled === true)).toBe(true);
  });

  it('returns full default layout when saved is undefined', () => {
    const out = normalizePdfLayout(undefined);
    expect(out.map(s => s.id)).toEqual(ALL_IDS);
  });

  it('returns full default layout for non-array input', () => {
    const out = normalizePdfLayout({ not: 'an array' });
    expect(out.map(s => s.id)).toEqual(ALL_IDS);
  });

  it('preserves the saved ordering', () => {
    const saved = [
      { id: 'cost_summary', enabled: true },
      { id: 'customer_info', enabled: true },
    ];
    const out = normalizePdfLayout(saved);
    expect(out[0].id).toBe('cost_summary');
    expect(out[1].id).toBe('customer_info');
  });

  it('drops unknown section IDs (e.g. removed since save)', () => {
    const saved = [
      { id: 'customer_info', enabled: true },
      { id: 'legacy_signoff_v1', enabled: true },
      { id: 'parts', enabled: false },
    ];
    const out = normalizePdfLayout(saved);
    expect(out.find(s => s.id === 'legacy_signoff_v1')).toBeUndefined();
  });

  it('appends sections that are in the catalog but missing from saved (forward-compatible)', () => {
    const saved = [{ id: 'customer_info', enabled: true }];
    const out = normalizePdfLayout(saved);
    expect(out).toHaveLength(PDF_SECTION_DEFS.length);
    expect(out[0].id).toBe('customer_info');
    const appendedIds = out.slice(1).map(s => s.id);
    expect(appendedIds).toEqual(ALL_IDS.filter(id => id !== 'customer_info'));
  });

  it('appended sections default to enabled=true', () => {
    const saved = [{ id: 'customer_info', enabled: false }];
    const out = normalizePdfLayout(saved);
    const appended = out.slice(1);
    expect(appended.every(s => s.enabled === true)).toBe(true);
  });

  it('preserves enabled=false from saved', () => {
    const saved = [
      { id: 'parts', enabled: false },
      { id: 'cost_summary', enabled: false },
    ];
    const out = normalizePdfLayout(saved);
    expect(out.find(s => s.id === 'parts').enabled).toBe(false);
    expect(out.find(s => s.id === 'cost_summary').enabled).toBe(false);
  });

  it('treats enabled=undefined as enabled=true', () => {
    const saved = [{ id: 'parts' }];
    const out = normalizePdfLayout(saved);
    expect(out.find(s => s.id === 'parts').enabled).toBe(true);
  });

  it('deduplicates if saved contains the same id twice', () => {
    const saved = [
      { id: 'customer_info', enabled: true },
      { id: 'customer_info', enabled: false },
    ];
    const out = normalizePdfLayout(saved);
    expect(out.filter(s => s.id === 'customer_info')).toHaveLength(1);
    expect(out.find(s => s.id === 'customer_info').enabled).toBe(true);
  });

  it('uses catalog labels (ignores any label stored in saved row)', () => {
    const saved = [{ id: 'parts', enabled: true, label: 'Stale Old Label' }];
    const out = normalizePdfLayout(saved);
    const partsDef = PDF_SECTION_DEFS.find(s => s.id === 'parts');
    expect(out.find(s => s.id === 'parts').label).toBe(partsDef.label);
  });

  it('DEFAULT_PDF_LAYOUT round-trips through normalizePdfLayout unchanged', () => {
    const out = normalizePdfLayout(DEFAULT_PDF_LAYOUT);
    expect(out.map(s => s.id)).toEqual(DEFAULT_PDF_LAYOUT.map(s => s.id));
    expect(out.every(s => s.enabled === true)).toBe(true);
  });
});
