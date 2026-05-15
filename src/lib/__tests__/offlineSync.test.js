import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  queueOfflineSubmission,
  getOfflineQueue,
  removeFromOfflineQueue,
} from '../submissions.js';
import { processOfflineQueue, __isProcessing } from '../offlineSync.js';

// We stub the network-touching parts of submissions.js so processOfflineQueue
// can run end-to-end against fake-indexeddb without hitting Supabase.
vi.mock('../submissions.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    saveSubmission: vi.fn(async (formData) => ({ id: 'mock-sub-' + Date.now(), pm_number: 10000 })),
    uploadPhotos: vi.fn(async () => ({ rows: [], uploaded: 0, failed: 0, total: 0 })),
  };
});

async function clearQueue() {
  const items = await getOfflineQueue();
  for (const item of items) await removeFromOfflineQueue(item.id);
}

beforeEach(async () => {
  await clearQueue();
  vi.clearAllMocks();
});

afterEach(async () => {
  await clearQueue();
});

describe('offline queue persistence', () => {
  it('starts empty', async () => {
    const q = await getOfflineQueue();
    expect(q).toEqual([]);
  });

  it('queueOfflineSubmission persists an item that getOfflineQueue returns', async () => {
    await queueOfflineSubmission({ formData: { customerName: 'Diamondback' } });
    const q = await getOfflineQueue();
    expect(q).toHaveLength(1);
    expect(q[0].formData.customerName).toBe('Diamondback');
  });

  it('stamps queuedAt on inserted rows', async () => {
    const before = Date.now();
    await queueOfflineSubmission({ formData: {} });
    const q = await getOfflineQueue();
    expect(typeof q[0].queuedAt).toBe('number');
    expect(q[0].queuedAt).toBeGreaterThanOrEqual(before);
  });

  it('assigns a monotonically increasing id (autoIncrement)', async () => {
    await queueOfflineSubmission({ formData: { n: 1 } });
    await queueOfflineSubmission({ formData: { n: 2 } });
    const q = await getOfflineQueue();
    expect(q).toHaveLength(2);
    expect(q[0].id).toBeLessThan(q[1].id);
  });

  it('removeFromOfflineQueue removes a single item by id', async () => {
    await queueOfflineSubmission({ formData: { n: 1 } });
    await queueOfflineSubmission({ formData: { n: 2 } });
    const before = await getOfflineQueue();
    await removeFromOfflineQueue(before[0].id);
    const after = await getOfflineQueue();
    expect(after).toHaveLength(1);
    expect(after[0].formData.n).toBe(2);
  });
});

describe('processOfflineQueue', () => {
  it('returns {success: 0, failed: 0} when queue is empty', async () => {
    const res = await processOfflineQueue('user-1');
    expect(res).toEqual({ success: 0, failed: 0 });
  });

  it('processes every queued item and removes it on success', async () => {
    await queueOfflineSubmission({ formData: { n: 1 } });
    await queueOfflineSubmission({ formData: { n: 2 } });
    const res = await processOfflineQueue('user-1');
    expect(res.success).toBe(2);
    expect(res.failed).toBe(0);
    const remaining = await getOfflineQueue();
    expect(remaining).toEqual([]);
  });

  it('clears the lock after a normal run (so the next call works)', async () => {
    await queueOfflineSubmission({ formData: { n: 1 } });
    await processOfflineQueue('user-1');
    expect(__isProcessing()).toBe(false);
    const second = await processOfflineQueue('user-1');
    expect(second).toEqual({ success: 0, failed: 0 });
  });

  it('returns {skipped: true} for the second of two concurrent calls', async () => {
    await queueOfflineSubmission({ formData: { n: 1 } });
    await queueOfflineSubmission({ formData: { n: 2 } });
    const [first, second] = await Promise.all([
      processOfflineQueue('user-1'),
      processOfflineQueue('user-1'),
    ]);
    // Exactly one of the calls did the work; the other returned skipped.
    const did = [first, second].find(r => !r.skipped);
    const skipped = [first, second].find(r => r.skipped);
    expect(did.success).toBe(2);
    expect(skipped).toEqual({ success: 0, failed: 0, skipped: true });
    expect(__isProcessing()).toBe(false);
  });
});
