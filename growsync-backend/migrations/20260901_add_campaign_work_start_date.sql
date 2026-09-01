ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS work_start_date DATE NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'campaigns'::regclass
      AND conname = 'campaigns_work_start_before_start_check'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_work_start_before_start_check
      CHECK (work_start_date IS NULL OR work_start_date <= start_date);
  END IF;
END $$;
