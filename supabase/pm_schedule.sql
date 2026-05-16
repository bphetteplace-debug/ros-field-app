-- ────────────────────────────────────────────────────────────────────────
-- pm_schedule_entries — per-customer monthly PM schedule
-- ────────────────────────────────────────────────────────────────────────
-- Created 2026-05-16 to back the new 📅 PM Schedule admin tab. Seeded
-- from Diamondback's 2026 full-year PM workbook (204 entries Jan-May
-- with real foreman + GPS + asset detail; June-Dec template rows).
-- Designed multi-customer from the start so High Peak / ExTex / KOS /
-- A8 / Pristine can drop in without schema changes.
--
-- HOW TO APPLY: paste this whole file into the Supabase SQL Editor
-- (project idddbbvotykfairirmwn → SQL Editor → New query) and run.
-- Idempotent: every CREATE uses IF NOT EXISTS, and policies are
-- dropped + recreated, so re-running is safe.
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pm_schedule_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Customer scoping (extensible beyond Diamondback)
  customer        text NOT NULL,

  -- The physical site + work
  location_name   text NOT NULL,
  service_type    text,                          -- BMS, Flame Arrestor / Combustor, etc.
  area            text,                          -- Bryant Ranch, Spanish Trail, SRRR
  well_type       text,                          -- Horizontal, Vertical
  latitude        numeric(10, 6),
  longitude       numeric(10, 6),
  assets          text,                          -- "2 Arrestors  |  1 60'"

  -- Customer-side reference
  ticket_number   text,
  shut_in_date    date,                          -- when the well goes offline for the PM
  foreman         text,                          -- DBK foreman responsible (their side)

  -- Status — kept as text, not enum, so admin can add new states
  status          text NOT NULL DEFAULT 'Needs Scheduling',
  notes           text,
  date_completed  date,

  -- Optional link back to the actual ROS submission once a tech completes it
  submission_id   uuid REFERENCES submissions(id) ON DELETE SET NULL,

  -- Convenience for month-bucket filtering ('2026-01', '2026-02', ...)
  month_year      text,

  imported_from   text,                          -- e.g. 'diamondback_2026_v4'
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS pm_schedule_customer_idx        ON pm_schedule_entries (customer);
CREATE INDEX IF NOT EXISTS pm_schedule_shut_in_date_idx    ON pm_schedule_entries (shut_in_date);
CREATE INDEX IF NOT EXISTS pm_schedule_status_idx          ON pm_schedule_entries (status);
CREATE INDEX IF NOT EXISTS pm_schedule_month_year_idx      ON pm_schedule_entries (month_year);
CREATE INDEX IF NOT EXISTS pm_schedule_foreman_idx         ON pm_schedule_entries (foreman);

-- updated_at auto-refresh
CREATE OR REPLACE FUNCTION pm_schedule_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pm_schedule_touch_updated_at_trigger ON pm_schedule_entries;
CREATE TRIGGER pm_schedule_touch_updated_at_trigger
  BEFORE UPDATE ON pm_schedule_entries
  FOR EACH ROW EXECUTE FUNCTION pm_schedule_touch_updated_at();

-- RLS: admin can do anything, techs can read but not write.
ALTER TABLE pm_schedule_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_pm_schedule" ON pm_schedule_entries;
CREATE POLICY "admin_all_pm_schedule" ON pm_schedule_entries
  FOR ALL TO authenticated
  USING  (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "tech_read_pm_schedule" ON pm_schedule_entries;
CREATE POLICY "tech_read_pm_schedule" ON pm_schedule_entries
  FOR SELECT TO authenticated
  USING (true);                                  -- any logged-in tech can see the schedule
