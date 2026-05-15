import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveDraft, loadDraft, clearDraft, listDrafts } from '../draftStore.js';

// fake-indexeddb is set up globally in src/test/setup.js
// Each test gets a clean DB because we clear all drafts in beforeEach.

async function clearAll() {
  const all = await listDrafts();
  for (const d of all) await clearDraft(d.formType);
  try { localStorage.clear() } catch (_) {}
}

beforeEach(clearAll);
afterEach(clearAll);

describe('saveDraft / loadDraft / clearDraft', () => {
  it('returns null when nothing has been saved', async () => {
    const result = await loadDraft('jha');
    expect(result).toBeNull();
  });

  it('persists a draft and reads it back', async () => {
    await saveDraft('jha', { taskStep: 'Test', risk: 'High' }, null);
    const result = await loadDraft('jha');
    expect(result).not.toBeNull();
    expect(result.formType).toBe('jha');
    expect(result.fields.taskStep).toBe('Test');
    expect(result.fields.risk).toBe('High');
    expect(typeof result.updatedAt).toBe('number');
  });

  it('upserts — second save with same formType overwrites the first', async () => {
    await saveDraft('inspection', { odometer: 1000 }, null);
    await saveDraft('inspection', { odometer: 2000, defects: 'bad' }, null);
    const result = await loadDraft('inspection');
    expect(result.fields.odometer).toBe(2000);
    expect(result.fields.defects).toBe('bad');
    const all = await listDrafts();
    expect(all.filter(d => d.formType === 'inspection')).toHaveLength(1);
  });

  it('keeps multiple formTypes independent', async () => {
    await saveDraft('jha', { jhaField: 1 }, null);
    await saveDraft('inspection', { inspField: 2 }, null);
    const jha = await loadDraft('jha');
    const insp = await loadDraft('inspection');
    expect(jha.fields.jhaField).toBe(1);
    expect(insp.fields.inspField).toBe(2);
  });

  // NOTE: fake-indexeddb (test env) doesn't fully round-trip Blobs the way
  // real browser IDB does — Blobs come back as plain objects. Real Chrome
  // / Android Chrome preserve Blob types via structured clone. So these
  // tests assert structural persistence (shape + count + sibling fields)
  // rather than Blob identity. Live verification of Blob round-trip
  // happens when a form is migrated to use the store.
  it('persists photo arrays with structural fidelity', async () => {
    const blob = new Blob(['hello'], { type: 'image/jpeg' });
    await saveDraft('jha', { foo: 'bar' }, [{ file: blob, caption: 'one' }]);
    const result = await loadDraft('jha');
    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].caption).toBe('one');
    expect(result.photos[0].file).toBeTruthy();
  });

  it('persists object-shaped photo payloads (e.g. { section: [...] })', async () => {
    const blob1 = new Blob(['a'], { type: 'image/png' });
    const blob2 = new Blob(['b'], { type: 'image/png' });
    await saveDraft('pm', {}, {
      work: [{ file: blob1, order: 0 }],
      sigs: [{ file: blob2, order: 0 }],
    });
    const result = await loadDraft('pm');
    expect(result.photos.work).toHaveLength(1);
    expect(result.photos.sigs).toHaveLength(1);
    expect(result.photos.work[0].order).toBe(0);
    expect(result.photos.work[0].file).toBeTruthy();
  });

  it('clearDraft removes the entry; loadDraft returns null after', async () => {
    await saveDraft('expense', { total: 50 }, null);
    expect(await loadDraft('expense')).not.toBeNull();
    await clearDraft('expense');
    expect(await loadDraft('expense')).toBeNull();
  });

  it('migrates legacy localStorage draft into IDB on first load', async () => {
    // Simulate a tech mid-shift across the deploy: their old draft is in
    // localStorage under the legacy key.
    localStorage.setItem('ros_jha_draft', JSON.stringify({ techName: 'Vlad', supervisor: 'Brian' }));
    const result = await loadDraft('jha');
    expect(result).not.toBeNull();
    expect(result.fields.techName).toBe('Vlad');
    expect(result.fields.supervisor).toBe('Brian');
    // And it should have been written to IDB so the next load doesn't
    // re-touch localStorage.
    const idbCheck = await listDrafts();
    expect(idbCheck.find(d => d.formType === 'jha')).toBeTruthy();
  });

  it('clearDraft also clears the legacy localStorage entry', async () => {
    localStorage.setItem('ros_jha_draft', JSON.stringify({ a: 1 }));
    await loadDraft('jha'); // triggers migration
    await clearDraft('jha');
    expect(localStorage.getItem('ros_jha_draft')).toBeNull();
  });

  it('handles a malformed legacy localStorage payload without crashing', async () => {
    localStorage.setItem('ros_jha_draft', '{ not valid json');
    const result = await loadDraft('jha');
    expect(result).toBeNull();
  });

  it('rejects saveDraft without a formType', async () => {
    await expect(saveDraft('', { x: 1 })).rejects.toThrow(/formType/);
    await expect(saveDraft(null, { x: 1 })).rejects.toThrow(/formType/);
  });

  it('listDrafts returns every draft currently stored', async () => {
    await saveDraft('jha', { a: 1 });
    await saveDraft('pm', { b: 2 });
    await saveDraft('expense', { c: 3 });
    const all = await listDrafts();
    expect(all.map(d => d.formType).sort()).toEqual(['expense', 'jha', 'pm']);
  });
});
