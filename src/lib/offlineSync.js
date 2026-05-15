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
        const submission = await saveSubmission(item.formData, userId);
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
