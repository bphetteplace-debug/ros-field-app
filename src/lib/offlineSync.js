// src/lib/offlineSync.js
// Handles offline submission queue: shows banner, processes queue when online
// Used by SubmissionsListPage to display pending offline submissions

import { getOfflineQueue, removeFromOfflineQueue, saveSubmission, uploadPhotos } from './submissions';

// Try to process all queued offline submissions
// Returns { success: number, failed: number }
export async function processOfflineQueue(userId) {
  const queue = await getOfflineQueue();
  if (queue.length === 0) return { success: 0, failed: 0 };

  let success = 0, failed = 0;
  for (const item of queue) {
    try {
      const submission = await saveSubmission(item.formData, userId);
      // Re-upload photos stored as base64 data URLs
      if (item.photoDataUrls && submission) {
        for (const [section, photos] of Object.entries(item.photoDataUrls)) {
          if (photos.length > 0) {
            await uploadPhotos(submission.id, photos.map((url, i) => ({ dataUrl: url, caption: '' })), section);
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
  return { success, failed };
}

export async function getQueueCount() {
  try {
    const queue = await getOfflineQueue();
    return queue.length;
  } catch { return 0; }
}
