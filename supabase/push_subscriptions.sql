-- ────────────────────────────────────────────────────────────────────────
-- push_subscriptions — Web Push subscription storage per user
-- ────────────────────────────────────────────────────────────────────────
-- Stores one row per (user, device/browser) combination. Each row is the
-- PushSubscription payload returned by pushManager.subscribe() — endpoint
-- URL + keys the lambda needs to encrypt a push to that browser.
--
-- HOW TO APPLY: paste this whole file into the Supabase SQL Editor and run.
-- Idempotent: CREATE IF NOT EXISTS + DROP-and-recreate policies.
--
-- Owner action checklist for OS-level web push to work end-to-end:
--   1. Run this SQL.
--   2. Set VITE_VAPID_PUBLIC_KEY in Vercel env (Production, Preview, Dev) —
--      embedded in client bundle. Same key in all environments.
--   3. Set VAPID_PRIVATE_KEY in Vercel env (Production only — secret).
--   4. Set VAPID_SUBJECT in Vercel env to "mailto:bphetteplace@…" so push
--      services can contact us if there's abuse.
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL,
  p256dh      text NOT NULL,
  auth_key    text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Same (user, endpoint) means same browser re-subscribing — upsert in place.
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

-- RLS: users manage their own subscriptions; admins can view all (for support).
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own push subs" ON push_subscriptions;
CREATE POLICY "users manage own push subs" ON push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "admin read all push subs" ON push_subscriptions;
CREATE POLICY "admin read all push subs" ON push_subscriptions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Updated-at trigger so we can audit when a sub was last refreshed.
CREATE OR REPLACE FUNCTION set_push_sub_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS push_subs_set_updated_at ON push_subscriptions;
CREATE TRIGGER push_subs_set_updated_at
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_push_sub_updated_at();
