-- ────────────────────────────────────────────────────────────────────────
-- monthly_expenses — office-side monthly expense ledger
-- ────────────────────────────────────────────────────────────────────────
-- Created 2026-05-16 to back the new 💸 Monthly Expenses admin tab.
-- This is SEPARATE from the existing expense_report submissions which
-- are tech-side per-job expense reports (fuel, meals, lodging). This
-- table holds office-level fixed/payroll/other expenses (rent, insurance,
-- 401k, vehicle leases, etc.) imported from Caryl's 2026 Expense Tracker.
--
-- HOW TO APPLY: paste this file into the Supabase SQL Editor and run.
-- Idempotent: every CREATE uses IF NOT EXISTS, policies dropped + recreated.
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS monthly_expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date            date,
  description     text NOT NULL,
  amount          numeric(12, 2) NOT NULL DEFAULT 0,
  category        text NOT NULL DEFAULT 'Other',         -- Fixed / Payroll / Other
  notes           text,
  vendor          text,
  month_year      text NOT NULL,                          -- '2026-01'
  imported_from   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS monthly_expenses_date_idx        ON monthly_expenses (date);
CREATE INDEX IF NOT EXISTS monthly_expenses_month_year_idx  ON monthly_expenses (month_year);
CREATE INDEX IF NOT EXISTS monthly_expenses_category_idx    ON monthly_expenses (category);

-- updated_at trigger
CREATE OR REPLACE FUNCTION monthly_expenses_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS monthly_expenses_touch_updated_at_trigger ON monthly_expenses;
CREATE TRIGGER monthly_expenses_touch_updated_at_trigger
  BEFORE UPDATE ON monthly_expenses
  FOR EACH ROW EXECUTE FUNCTION monthly_expenses_touch_updated_at();

-- RLS: admin-only. Office finance data, techs don't see it.
ALTER TABLE monthly_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_monthly_expenses" ON monthly_expenses;
CREATE POLICY "admin_all_monthly_expenses" ON monthly_expenses
  FOR ALL TO authenticated
  USING  (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
