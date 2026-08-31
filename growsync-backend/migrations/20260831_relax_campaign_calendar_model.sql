-- Permite campañas abiertas y simultáneas.
-- No modifica campañas ni campaign_id existentes.

ALTER TABLE campaigns
  ALTER COLUMN end_date DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'campaigns'::regclass
      AND conname = 'campaigns_company_dates_no_overlap'
  ) THEN
    ALTER TABLE campaigns
      DROP CONSTRAINT campaigns_company_dates_no_overlap;
  END IF;
END $$;

DROP INDEX IF EXISTS campaigns_one_active_per_company;
