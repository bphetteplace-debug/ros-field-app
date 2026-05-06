import { createClient } from '@supabase/supabase-js';

// Read env vars (Vite exposes anything VITE_*)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Detect whether we're in cloud mode or local mode
export const isCloudMode = () => {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
};

// Lazily create the client only if env vars are present
let _client = null;
export const supabase = (() => {
  if (!isCloudMode()) return null;
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return _client;
})();

// Helper: upload a photo to the submission-photos bucket
export async function uploadPhoto(submissionId, section, file) {
  if (!supabase) throw new Error('Cloud mode not configured');
  const filename = `${submissionId}/${section}/${Date.now()}-${file.name}`;
  const { data, error } = await supabase.storage
    .from('submission-photos')
    .upload(filename, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  return data.path;
}

// Helper: get a signed URL for a photo (since the bucket is private)
export async function getPhotoUrl(path) {
  if (!supabase) return null;
  const { data, error } = await supabase.storage
    .from('submission-photos')
    .createSignedUrl(path, 3600);  // 1 hour
  if (error) {
    console.error('Photo URL error:', error);
    return null;
  }
  return data.signedUrl;
}
