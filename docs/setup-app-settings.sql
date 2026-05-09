-- docs/setup-app-settings.sql
-- Run this once in Supabase SQL Editor to enable dynamic settings
-- Project: idddbbvotykfairirmwn

-- 1. Create app_settings table
CREATE TABLE IF NOT EXISTS public.app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- 3. Allow all authenticated users to READ settings
CREATE POLICY "All users can read settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

-- 4. Allow only admins (service role) to INSERT/UPDATE settings
-- The frontend uses the anon key for reads, service role for writes via API
CREATE POLICY "Service role can write settings"
  ON public.app_settings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. Also allow authenticated users to upsert settings (for SettingsPage)
--    This lets Brian update from the app without a backend API
CREATE POLICY "Authenticated users can upsert settings"
  ON public.app_settings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update settings"
  ON public.app_settings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 6. Seed with current hardcoded defaults
INSERT INTO public.app_settings (key, value) VALUES
  ('customers', '["Diamondback","High Peak Energy","ExTex","A8 Oilfield Services","Pristine Alliance","KOS"]'::jsonb),
  ('trucks',    '["0001","0002","0003","0004","0005","0006","0007"]'::jsonb),
  ('techs',     '["Matthew Reid","Vladimir Rivero","Pedro Perez"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 7. Also make submission-photos bucket public (run if photos not showing in PDF)
-- In Supabase Dashboard: Storage -> submission-photos -> Make Public
-- Or via SQL:
UPDATE storage.buckets SET public = true WHERE id = 'submission-photos';

SELECT 'Setup complete. app_settings table created and seeded.' AS result;
