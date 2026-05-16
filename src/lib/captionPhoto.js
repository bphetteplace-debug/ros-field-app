// Client helper that POSTs an image File/Blob to /api/caption-photo and
// returns the AI-generated caption. Compresses the image first (same
// browser-image-compression we use everywhere) so we stay well under
// the Vercel serverless body limit and the AI call is faster.

import { compressImage } from './imageCompress';

function getAuthToken() {
  try {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) return null;
    return JSON.parse(localStorage.getItem(key))?.access_token || null;
  } catch (_) { return null; }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Captions a photo via the lambda. Returns the caption string, or null
// on any failure (lambda error, no auth, network, etc). Caller decides
// whether to surface the failure to the user.
//
// context: 'service_work' (default) or 'expense_item'
export async function captionPhoto(file, context = 'service_work') {
  if (!file) return null;
  const token = getAuthToken();
  if (!token) return null;

  let compressed;
  try {
    compressed = await compressImage(file);
  } catch (_) {
    compressed = file;
  }

  let base64;
  try {
    base64 = await fileToBase64(compressed);
  } catch (_) {
    return null;
  }

  try {
    const res = await fetch('/api/caption-photo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ image: base64, context }),
    });
    if (!res.ok) {
      console.warn('caption-photo HTTP', res.status);
      return null;
    }
    const body = await res.json();
    const caption = (body && typeof body.caption === 'string') ? body.caption.trim() : '';
    return caption || null;
  } catch (e) {
    console.warn('captionPhoto request failed:', e);
    return null;
  }
}
