ALTER TABLE planning
  ADD COLUMN IF NOT EXISTS effective_date DATE NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS registered_retroactively BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_planning_effective_date
  ON planning(company_id, effective_date)
  WHERE effective_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planning_registered_retroactively
  ON planning(company_id, registered_retroactively)
  WHERE registered_retroactively IS TRUE;
