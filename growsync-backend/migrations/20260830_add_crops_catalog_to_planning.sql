CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS crops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_crops_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crops_set_updated_at ON crops;
CREATE TRIGGER crops_set_updated_at
BEFORE UPDATE ON crops
FOR EACH ROW
EXECUTE FUNCTION set_crops_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS crops_company_name_ci_unique
  ON crops(company_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_crops_company_enabled_name
  ON crops(company_id, enabled, name);

INSERT INTO crops (company_id, name)
SELECT c.id, crop_name
FROM companies c
CROSS JOIN (
  VALUES ('Soja'), ('Maíz'), ('Trigo'), ('Girasol'), ('Sorgo')
) AS seed(crop_name)
ON CONFLICT (company_id, (lower(btrim(name)))) DO NOTHING;

ALTER TABLE planning
  ADD COLUMN IF NOT EXISTS crop_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'planning_crop_id_fkey'
  ) THEN
    ALTER TABLE planning
      ADD CONSTRAINT planning_crop_id_fkey
      FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_planning_crop_id
  ON planning(crop_id)
  WHERE crop_id IS NOT NULL;
