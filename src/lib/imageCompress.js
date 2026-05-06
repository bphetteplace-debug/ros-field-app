import imageCompression from 'browser-image-compression';

/**
 * Compress an image file before upload.
 * Field photos from phones can be 3-5MB raw — this gets them to ~300-500KB
 * which keeps storage costs sane and uploads fast on poor cell signal.
 */
export async function compressImage(file) {
  const options = {
    maxSizeMB: 0.5,
    maxWidthOrHeight: 1600,
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: 0.8,
  };
  try {
    const compressed = await imageCompression(file, options);
    return compressed;
  } catch (err) {
    console.warn('Image compression failed, using original:', err);
    return file;
  }
}

/**
 * Convert a file to a base64 data URL.
 * Used in local mode where we don't upload to cloud storage.
 */
export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
