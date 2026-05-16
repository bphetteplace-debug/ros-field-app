-- ────────────────────────────────────────────────────────────────────────
-- active_dispatch — schema for customer-facing live job tracking
-- ────────────────────────────────────────────────────────────────────────
-- Created 2026-05-16 as foundation for the email-only Uber-style ETA
-- tracker. Schema only — no app code uses these tables yet. Wire-up
-- happens in a future commit.
--
-- HOW TO APPLY: paste this whole file into the Supabase SQL Editor
-- (project idddbbvotykfairirmwn → SQL Editor → New query) and run.
-- It's idempotent: every CREATE uses IF NOT EXISTS, and policies are
-- dropped + recreated, so re-running is safe.
-- ────────────────────────────────────────────────────────────────────────

-- 1. Table: one row per in-progress dispatch.
CREATE TABLE IF NOT EXISTS active_dispatch (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_token     text UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  submission_id   uuid REFERENCES submissions(id) ON DELETE SET NULL,
  tech_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tech_name       text,
  customer_name   text NOT NULL,
  customer_email  text,

  -- Destination = customer site (set at dispatch time, never changes)
  destination_lat   numeric(10, 6),
  destination_lng   numeric(10, 6),
  destination_label text,                                 -- e.g. "Acme Heater #3, Pump Pad B"

  -- Live tech location (updated periodically while en route)
  tech_lat          numeric(10, 6),
  tech_lng          numeric(10, 6),
  tech_updated_at   timestamptz,

  -- ETA in seconds from tech location to destination, may be NULL until
  -- Mapbox Directions API fills it in.
  eta_seconds       integer,

  status     text NOT NULL DEFAULT 'en_route'
             CHECK (status IN ('en_route', 'arrived', 'completed', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,                                  -- set when status flips to completed/cancelled
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS active_dispatch_share_token_idx ON active_dispatch (share_token);
CREATE INDEX IF NOT EXISTS active_dispatch_tech_id_idx     ON active_dispatch (tech_id);
CREATE INDEX IF NOT EXISTS active_dispatch_status_idx      ON active_dispatch (status) WHERE ended_at IS NULL;

-- 2. RLS — locked down by default. Only specific patterns allowed below.
ALTER TABLE active_dispatch ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_active_dispatch" ON active_dispatch;
CREATE POLICY "admin_all_active_dispatch" ON active_dispatch
  FOR ALL TO authenticated
  USING  (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "tech_read_own_active_dispatch" ON active_dispatch;
CREATE POLICY "tech_read_own_active_dispatch" ON active_dispatch
  FOR SELECT TO authenticated
  USING (tech_id = auth.uid());

DROP POLICY IF EXISTS "tech_update_own_location" ON active_dispatch;
CREATE POLICY "tech_update_own_location" ON active_dispatch
  FOR UPDATE TO authenticated
  USING (tech_id = auth.uid())
  WITH CHECK (tech_id = auth.uid());

-- 3. Public RPC — the customer-facing page calls this via the anon key.
-- RLS doesn't apply inside SECURITY DEFINER functions, so the random
-- share_token IS the entire access control. Returns NULL if the token
-- is unknown, the dispatch has ended, or it's older than 24 hours.
CREATE OR REPLACE FUNCTION get_active_dispatch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d active_dispatch;
BEGIN
  SELECT * INTO d
  FROM active_dispatch
  WHERE share_token = p_token
    AND ended_at IS NULL
    AND started_at > now() - interval '24 hours';

  IF d.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'tech_name',         d.tech_name,
    'customer_name',     d.customer_name,
    'destination_lat',   d.destination_lat,
    'destination_lng',   d.destination_lng,
    'destination_label', d.destination_label,
    'tech_lat',          d.tech_lat,
    'tech_lng',          d.tech_lng,
    'tech_updated_at',   d.tech_updated_at,
    'eta_seconds',       d.eta_seconds,
    'status',            d.status,
    'started_at',        d.started_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_active_dispatch(text) TO anon;
GRANT EXECUTE ON FUNCTION get_active_dispatch(text) TO authenticated;

-- 4. Trigger to auto-set ended_at when status flips to completed/cancelled.
CREATE OR REPLACE FUNCTION set_dispatch_ended_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.status IN ('completed', 'cancelled', 'arrived')) AND OLD.ended_at IS NULL THEN
    NEW.ended_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS active_dispatch_set_ended_at ON active_dispatch;
CREATE TRIGGER active_dispatch_set_ended_at
  BEFORE UPDATE ON active_dispatch
  FOR EACH ROW
  EXECUTE FUNCTION set_dispatch_ended_at();

-- 5. Enable Realtime on the table so the customer page can subscribe
-- to live updates without polling.
ALTER PUBLICATION supabase_realtime ADD TABLE active_dispatch;
