-- Additive only. Existing activities remain NORMAL; no tenant is reclassified.
BEGIN;
ALTER TABLE companies ADD COLUMN inventory_control_start_date date;
CREATE TABLE historical_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_hash text NOT NULL,
  imported_by uuid NOT NULL REFERENCES users(id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (length(btrim(source)) > 0),
  payload jsonb NOT NULL,
  result jsonb,
  UNIQUE(company_id,idempotency_key)
);
ALTER TABLE historical_imports ENABLE ROW LEVEL SECURITY;
CREATE TABLE historical_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  entity_table text NOT NULL,
  entity_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL
);
ALTER TABLE historical_events ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['planning','usage_records','harvest_records','crop_assignments'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN inventory_impact_mode text NOT NULL DEFAULT ''NORMAL'' CHECK (inventory_impact_mode IN (''NORMAL'',''HISTORICAL_NO_STOCK'')), ADD COLUMN historical_import_id uuid REFERENCES historical_imports(id)', t);
  END LOOP;
END $$;
CREATE FUNCTION protect_inventory_impact_mode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='crop_assignments' AND OLD.inventory_impact_mode='HISTORICAL_NO_STOCK'
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Historical productive cycles cannot be recalculated' USING ERRCODE='23514';
  END IF;
  IF NEW.inventory_impact_mode IS DISTINCT FROM OLD.inventory_impact_mode
     OR NEW.historical_import_id IS DISTINCT FROM OLD.historical_import_id THEN
    RAISE EXCEPTION 'Inventory impact mode and import provenance are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['planning','usage_records','harvest_records','crop_assignments'] LOOP
    EXECUTE format('CREATE TRIGGER protect_inventory_impact_mode BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION protect_inventory_impact_mode()',t);
  END LOOP;
END $$;
CREATE FUNCTION check_usage_inventory_impact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_planning_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM planning p WHERE p.id=NEW.source_planning_id AND p.company_id=NEW.company_id
      AND p.inventory_impact_mode=NEW.inventory_impact_mode
  ) THEN RAISE EXCEPTION 'Usage and Planning inventory modes must agree' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_usage_inventory_impact BEFORE INSERT OR UPDATE ON usage_records
  FOR EACH ROW EXECUTE FUNCTION check_usage_inventory_impact();
CREATE FUNCTION reject_historical_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM usage_records u WHERE u.id=NEW.usage_id
    AND u.inventory_impact_mode='HISTORICAL_NO_STOCK') THEN
    RAISE EXCEPTION 'Historical usage cannot have stock movements' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reject_historical_stock_movement BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION reject_historical_stock_movement();
CREATE FUNCTION protect_historical_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Historical audit is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER protect_historical_events BEFORE UPDATE OR DELETE ON historical_events
  FOR EACH ROW EXECUTE FUNCTION protect_historical_audit();
CREATE FUNCTION protect_historical_import_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Historical import is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.result IS NOT NULL OR (to_jsonb(NEW)-'result') IS DISTINCT FROM (to_jsonb(OLD)-'result') THEN
    RAISE EXCEPTION 'Historical import is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_historical_import_audit BEFORE UPDATE OR DELETE ON historical_imports
  FOR EACH ROW EXECUTE FUNCTION protect_historical_import_audit();
COMMIT;
