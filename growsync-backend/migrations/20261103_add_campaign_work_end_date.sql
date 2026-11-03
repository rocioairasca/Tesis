-- Preserve campaign identity, existing work starts and open ends.
BEGIN;
ALTER TABLE campaigns ADD COLUMN work_end_date DATE NULL;
UPDATE campaigns SET work_end_date = end_date;
-- Existing constraints enforce work_start_date <= start_date <= end_date.
ALTER TABLE campaigns ADD CONSTRAINT campaigns_work_end_after_end_check
  CHECK (work_end_date IS NULL OR (end_date IS NOT NULL AND end_date <= work_end_date));
COMMIT;
