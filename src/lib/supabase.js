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

// Deleted dead-code: uploadPhoto + getPhotoUrl. Both used a signed-URL
// pattern that doesn't apply here — the `submission-photos` bucket is
// public, so callers go through getPhotoUrl in src/lib/submissions.js
// which returns the cheaper public URL directly.
