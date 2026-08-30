ALTER TABLE planning_lots
  ADD COLUMN IF NOT EXISTS sub_lot_id UUID NULL,
  ADD COLUMN IF NOT EXISTS area_ha NUMERIC(12, 4);

DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.relname = 'planning_lots'
      AND n.nspname = current_schema()
      AND c.contype IN ('p', 'u')
      AND (
        SELECT array_agg(a.attname ORDER BY k.ordinality)
        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      ) = ARRAY['planning_id', 'lot_id']
  LOOP
    EXECUTE format('ALTER TABLE planning_lots DROP CONSTRAINT %I', constraint_record.conname);
  END LOOP;
END $$;

DO $$
DECLARE
  index_record RECORD;
BEGIN
  FOR index_record IN
    SELECT i.relname
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_constraint c ON c.conindid = ix.indexrelid
    WHERE t.relname = 'planning_lots'
      AND n.nspname = current_schema()
      AND ix.indisunique IS TRUE
      AND c.oid IS NULL
      AND (
        SELECT array_agg(a.attname ORDER BY k.ordinality)
        FROM unnest(string_to_array(ix.indkey::TEXT, ' ')::INT[]) WITH ORDINALITY AS k(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
      ) = ARRAY['planning_id', 'lot_id']
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I.%I', current_schema(), index_record.relname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'planning_lots_sub_lot_id_fkey'
  ) THEN
    ALTER TABLE planning_lots
      ADD CONSTRAINT planning_lots_sub_lot_id_fkey
      FOREIGN KEY (sub_lot_id) REFERENCES sub_lots(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'planning_lots_area_ha_positive'
  ) THEN
    ALTER TABLE planning_lots
      ADD CONSTRAINT planning_lots_area_ha_positive
      CHECK (area_ha IS NULL OR area_ha > 0);
  END IF;
END $$;

UPDATE planning_lots pl
SET area_ha = COALESCE(l.area_ha, NULLIF(l.area, 0)::NUMERIC)
FROM lots l
WHERE pl.lot_id = l.id
  AND pl.area_ha IS NULL;

CREATE INDEX IF NOT EXISTS idx_planning_lots_lot_sub_lot
  ON planning_lots(lot_id, sub_lot_id);

CREATE INDEX IF NOT EXISTS idx_planning_lots_sub_lot_id
  ON planning_lots(sub_lot_id)
  WHERE sub_lot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planning_lots_planning_id
  ON planning_lots(planning_id);

CREATE UNIQUE INDEX IF NOT EXISTS planning_lots_unique_full_lot
  ON planning_lots(planning_id, lot_id)
  WHERE sub_lot_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS planning_lots_unique_sub_lot
  ON planning_lots(planning_id, sub_lot_id)
  WHERE sub_lot_id IS NOT NULL;
