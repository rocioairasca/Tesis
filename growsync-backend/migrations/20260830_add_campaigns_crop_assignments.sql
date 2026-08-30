CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date)
);

CREATE OR REPLACE FUNCTION set_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS campaigns_set_updated_at ON campaigns;
CREATE TRIGGER campaigns_set_updated_at
BEFORE UPDATE ON campaigns
FOR EACH ROW
EXECUTE FUNCTION set_campaigns_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_company_name_ci_unique
  ON campaigns(company_id, lower(btrim(name)));

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_one_active_per_company
  ON campaigns(company_id)
  WHERE status = 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'campaigns_company_dates_no_overlap'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_company_dates_no_overlap
      EXCLUDE USING gist (
        company_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campaigns_company_status_dates
  ON campaigns(company_id, status, start_date DESC);

CREATE TABLE IF NOT EXISTS crop_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  sub_lot_id UUID NULL REFERENCES sub_lots(id) ON DELETE RESTRICT,
  crop_id UUID NOT NULL REFERENCES crops(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  area_ha NUMERIC(12, 4) NOT NULL CHECK (area_ha > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date <= end_date)
);

CREATE OR REPLACE FUNCTION set_crop_assignments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crop_assignments_set_updated_at ON crop_assignments;
CREATE TRIGGER crop_assignments_set_updated_at
BEFORE UPDATE ON crop_assignments
FOR EACH ROW
EXECUTE FUNCTION set_crop_assignments_updated_at();

CREATE INDEX IF NOT EXISTS idx_crop_assignments_company_campaign
  ON crop_assignments(company_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_crop_assignments_lot_sub_lot
  ON crop_assignments(lot_id, sub_lot_id);

CREATE INDEX IF NOT EXISTS idx_crop_assignments_crop
  ON crop_assignments(crop_id);

CREATE INDEX IF NOT EXISTS idx_crop_assignments_real_dates
  ON crop_assignments(company_id, lot_id, start_date, end_date);

ALTER TABLE planning
  ADD COLUMN IF NOT EXISTS campaign_id UUID NULL;

ALTER TABLE planning
  ALTER COLUMN title DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'planning_campaign_id_fkey'
  ) THEN
    ALTER TABLE planning
      ADD CONSTRAINT planning_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_planning_campaign_id
  ON planning(campaign_id)
  WHERE campaign_id IS NOT NULL;
