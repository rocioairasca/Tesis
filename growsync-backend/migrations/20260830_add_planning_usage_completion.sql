CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE planning_products
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

UPDATE planning_products
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE planning_products
  ALTER COLUMN id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS planning_products_id_unique
  ON planning_products(id);

ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS source_planning_id UUID NULL,
  ADD COLUMN IF NOT EXISTS source_planning_product_id UUID NULL;

ALTER TABLE usage_lots
  ADD COLUMN IF NOT EXISTS sub_lot_id UUID NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usage_records_source_planning_id_fkey'
  ) THEN
    ALTER TABLE usage_records
      ADD CONSTRAINT usage_records_source_planning_id_fkey
      FOREIGN KEY (source_planning_id) REFERENCES planning(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usage_records_source_planning_product_id_fkey'
  ) THEN
    ALTER TABLE usage_records
      ADD CONSTRAINT usage_records_source_planning_product_id_fkey
      FOREIGN KEY (source_planning_product_id) REFERENCES planning_products(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usage_lots_sub_lot_id_fkey'
  ) THEN
    ALTER TABLE usage_lots
      ADD CONSTRAINT usage_lots_sub_lot_id_fkey
      FOREIGN KEY (sub_lot_id) REFERENCES sub_lots(id) ON DELETE RESTRICT;
  END IF;

  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'usage_lots'
      AND c.contype IN ('p', 'u')
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname::text)
        FROM unnest(c.conkey) AS key(attnum)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum
      ) = ARRAY['lot_id', 'usage_id']
  LOOP
    EXECUTE format('ALTER TABLE usage_lots DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

DO $$
DECLARE
  index_schema TEXT;
  index_name TEXT;
BEGIN
  FOR index_schema, index_name IN
    SELECT ns.nspname, i.relname
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace ns ON ns.oid = i.relnamespace
    WHERE t.relname = 'usage_lots'
      AND ix.indisunique
      AND ix.indpred IS NULL
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname::text)
        FROM unnest(ix.indkey) AS key(attnum)
        JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = key.attnum
      ) = ARRAY['lot_id', 'usage_id']
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I.%I', index_schema, index_name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS usage_lots_unique_full_lot
  ON usage_lots(usage_id, lot_id)
  WHERE sub_lot_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS usage_lots_unique_sub_lot
  ON usage_lots(usage_id, sub_lot_id)
  WHERE sub_lot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS planning_product_completions (
  planning_product_id UUID PRIMARY KEY REFERENCES planning_products(id) ON DELETE RESTRICT,
  planning_id UUID NOT NULL REFERENCES planning(id) ON DELETE RESTRICT,
  usage_id UUID NULL REFERENCES usage_records(id) ON DELETE RESTRICT,
  actual_amount NUMERIC(12, 4) NOT NULL CHECK (actual_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS usage_records_source_planning_product_unique
  ON usage_records(source_planning_product_id)
  WHERE source_planning_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_records_source_planning
  ON usage_records(source_planning_id)
  WHERE source_planning_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_lots_sub_lot_id
  ON usage_lots(sub_lot_id)
  WHERE sub_lot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planning_product_completions_planning
  ON planning_product_completions(planning_id);
