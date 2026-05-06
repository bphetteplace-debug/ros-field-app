-- ROS Field App — Supabase database schema
-- Run this entire file in the Supabase SQL Editor.
-- Idempotent: safe to re-run.
--
-- Tables:
--   profiles       — extends auth.users with role, full name, truck number
--   customers      — Diamondback, High Peak, etc.
--   locations      — wells / pads (Cerberus 11-23, etc.)
--   parts_catalog  — 247-SKU price book
--   submissions    — a filled-out PM
--   submission_techs — many-to-many link to crew members
--   photos         — uploaded photos linked to submissions

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('tech', 'admin')) DEFAULT 'tech',
  truck_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all profiles"
  ON profiles FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- Auto-create a profile row when a new auth user is created.
-- You can fill in full_name and role manually after creation.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), 'tech');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  default_contact TEXT,
  default_email TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view customers"
  ON customers FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage customers"
  ON customers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- LOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  work_area TEXT,
  gl_code TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_customer ON locations(customer_id);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view locations"
  ON locations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage locations"
  ON locations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- PARTS CATALOG
-- ============================================================
CREATE TABLE IF NOT EXISTS parts_catalog (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  category TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parts_category ON parts_catalog(category);

ALTER TABLE parts_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view parts"
  ON parts_catalog FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage parts"
  ON parts_catalog FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- SUBMISSIONS
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS pm_number_seq START 9000;

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pm_number INTEGER NOT NULL DEFAULT nextval('pm_number_seq') UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'sent_to_customer')) DEFAULT 'draft',
  template TEXT NOT NULL DEFAULT 'flare_combustor',  -- 'flare_combustor' | 'bms' | 'thief_hatch' | 'psv'

  -- Customer / location
  customer_id UUID REFERENCES customers(id),
  location_id UUID REFERENCES locations(id),
  customer_name TEXT,            -- denormalized for snapshotting
  location_name TEXT,
  contact TEXT,
  work_order TEXT,
  gl_code TEXT,
  asset_tag TEXT,
  work_area TEXT,
  work_type TEXT,
  truck_number TEXT,

  -- Timing
  date DATE NOT NULL,
  start_time TEXT,
  departure_time TEXT,

  -- Work
  summary TEXT,

  -- Costs
  miles NUMERIC(8,2) DEFAULT 0,
  cost_per_mile NUMERIC(6,2) DEFAULT 1.50,
  labor_hours NUMERIC(6,2) DEFAULT 0,
  labor_rate NUMERIC(6,2) DEFAULT 115.00,

  -- Form-specific data (equipment inspection, parts used, etc.)
  data JSONB DEFAULT '{}'::jsonb,

  -- Audit
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_submissions_creator ON submissions(created_by);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_date ON submissions(date DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_customer ON submissions(customer_id);

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

-- Techs see only their own submissions
CREATE POLICY "Techs view own submissions"
  ON submissions FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Techs create their own submissions
CREATE POLICY "Techs insert own submissions"
  ON submissions FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Techs update their own drafts; admins can update anything
CREATE POLICY "Techs update own submissions"
  ON submissions FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can delete submissions"
  ON submissions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS submissions_updated_at ON submissions;
CREATE TRIGGER submissions_updated_at
  BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SUBMISSION TECHS (many-to-many)
-- ============================================================
CREATE TABLE IF NOT EXISTS submission_techs (
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (submission_id, user_id)
);

ALTER TABLE submission_techs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View submission techs if submission visible"
  ON submission_techs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = submission_id
        AND (s.created_by = auth.uid()
             OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
    )
  );

CREATE POLICY "Manage submission techs if submission editable"
  ON submission_techs FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = submission_id AND s.created_by = auth.uid()
    )
  );

-- ============================================================
-- PHOTOS
-- ============================================================
CREATE TABLE IF NOT EXISTS photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  section TEXT NOT NULL,         -- 'site_sign' | 'completed_work' | 'equipment_<idx>' | 'parts_<code>'
  storage_path TEXT NOT NULL,    -- path in submission-photos bucket
  caption TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photos_submission ON photos(submission_id);

ALTER TABLE photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View photos if submission visible"
  ON photos FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = submission_id
        AND (s.created_by = auth.uid()
             OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
    )
  );

CREATE POLICY "Manage photos if submission editable"
  ON photos FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = submission_id AND s.created_by = auth.uid()
    )
  );
