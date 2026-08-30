ALTER TABLE harvest_records
  ADD COLUMN IF NOT EXISTS crop_id UUID NULL,
  ADD COLUMN IF NOT EXISTS sub_lot_id UUID NULL,
  ADD COLUMN IF NOT EXISTS campaign_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'harvest_records_crop_id_fkey'
  ) THEN
    ALTER TABLE harvest_records
      ADD CONSTRAINT harvest_records_crop_id_fkey
      FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'harvest_records_sub_lot_id_fkey'
  ) THEN
    ALTER TABLE harvest_records
      ADD CONSTRAINT harvest_records_sub_lot_id_fkey
      FOREIGN KEY (sub_lot_id) REFERENCES sub_lots(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'harvest_records_campaign_id_fkey'
  ) THEN
    ALTER TABLE harvest_records
      ADD CONSTRAINT harvest_records_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS harvest_crop_assignments (
  harvest_id UUID NOT NULL REFERENCES harvest_records(id) ON DELETE RESTRICT,
  crop_assignment_id UUID NOT NULL REFERENCES crop_assignments(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (harvest_id, crop_assignment_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS harvest_crop_assignments_assignment_unique
  ON harvest_crop_assignments(crop_assignment_id);

CREATE INDEX IF NOT EXISTS idx_harvest_records_crop_id
  ON harvest_records(crop_id)
  WHERE crop_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_harvest_records_campaign_id
  ON harvest_records(campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_harvest_records_sub_lot_id
  ON harvest_records(sub_lot_id)
  WHERE sub_lot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_harvest_crop_assignments_harvest
  ON harvest_crop_assignments(harvest_id);
