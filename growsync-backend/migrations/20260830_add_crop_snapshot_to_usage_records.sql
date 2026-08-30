ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS crop_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usage_records_crop_id_fkey'
  ) THEN
    ALTER TABLE usage_records
      ADD CONSTRAINT usage_records_crop_id_fkey
      FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_usage_records_crop_id
  ON usage_records(crop_id)
  WHERE crop_id IS NOT NULL;
