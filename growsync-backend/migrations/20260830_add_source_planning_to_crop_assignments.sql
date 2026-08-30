ALTER TABLE crop_assignments
  ADD COLUMN IF NOT EXISTS source_planning_id UUID NULL;

DROP INDEX IF EXISTS crop_assignments_source_planning_surface_unique;

ALTER TABLE crop_assignments
  DROP CONSTRAINT IF EXISTS crop_assignments_source_planning_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'crop_assignments_source_planning_id_fkey'
  ) THEN
    ALTER TABLE crop_assignments
      ADD CONSTRAINT crop_assignments_source_planning_id_fkey
      FOREIGN KEY (source_planning_id) REFERENCES planning(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS crop_assignments_source_planning_whole_lot_unique
  ON crop_assignments (source_planning_id, lot_id)
  WHERE source_planning_id IS NOT NULL
    AND sub_lot_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS crop_assignments_source_planning_sub_lot_unique
  ON crop_assignments (source_planning_id, sub_lot_id)
  WHERE source_planning_id IS NOT NULL
    AND sub_lot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crop_assignments_source_planning
  ON crop_assignments(source_planning_id)
  WHERE source_planning_id IS NOT NULL;
