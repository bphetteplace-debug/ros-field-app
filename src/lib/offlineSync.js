// src/lib/offlineSync.js
// Handles offline submission queue: shows banner, processes queue when online
// Used by SubmissionsListPage to display pending offline submissions

import { getOfflineQueue, removeFromOfflineQueue, saveSubmission, uploadPhotos } from './submissions';

// Module-scoped lock so two concurrent calls (e.g. tab reopen while a sync
// is already in flight) can't double-submit the same queued item.
let isProcessing = false;

// Try to process all queued offline submissions
// Returns { success: number, failed: number, skipped?: boolean }
export async function processOfflineQueue(userId) {
  if (isProcessing) return { success: 0, failed: 0, skipped: true };
  isProcessing = true;
  try {
    const queue = await getOfflineQueue();
    if (queue.length === 0) return { success: 0, failed: 0 };

    let success = 0, failed = 0;
    for (const item of queue) {
      try {
        // Discard legacy queue entries that lack formData — they pre-date
        // the structural fix and can't actually be replayed (the saveSubmission
        // call below would throw on undefined). Leaving them in the queue
        // means the "1 pending" banner never clears.
        if (!item.formData) {
          console.warn('[OfflineSync] queue item has no formData; discarding', item.id);
          await removeFromOfflineQueue(item.id);
          failed++;
          continue;
        }
        // Prefer the queued userId (set when the original tech enqueued the
        // payload). Falls back to the current online user only if the queue
        // predates the userId-persistence fix. Without this, two techs
        // sharing a tablet would flip ownership when one syncs the other's
        // queued items, breaking RLS edit access for the original author.
        const submitterId = item.userId || userId;
        // template was missing from older queue entries; saveSubmission has
        // a default but pass it through when present.
        const submission = await saveSubmission(item.formData, submitterId, item.template);
        // Re-upload photos stored as { dataUrl, caption } objects keyed by section
        if (item.photoDataUrls && submission) {
          for (const [section, photos] of Object.entries(item.photoDataUrls)) {
            if (photos && photos.length > 0) {
              await uploadPhotos(
                submission.id,
                photos.map(p => ({ dataUrl: p.dataUrl, caption: p.caption || '' })),
                section
              );
            }
          }
        }
        await removeFromOfflineQueue(item.id);
        success++;
      } catch (e) {
        console.warn('[OfflineSync] Failed to sync item', item.id, e.message);
        failed++;
      }
    }
    return { success: success, failed: failed };
  } finally {
    isProcessing = false;
  }
}

// Test-only: lets unit tests verify the lock without monkey-patching.
export function __isProcessing() { return isProcessing; }

export async function getQueueCount() {
  try {
    const queue = await getOfflineQueue();
    return queue.length;
  } catch { return 0; }
}
