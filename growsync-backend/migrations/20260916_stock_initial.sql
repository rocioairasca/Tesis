-- Prerequisites: Inventory V1, 20260914_inventory_base_units, historical_no_stock.
-- Prepared migration only. No tenant data updates, no production execution.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE stock_initial_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES companies(id),
  effective_date date NOT NULL,
  actor_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK(length(request_hash)=64),
  payload jsonb NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id),
  FOREIGN KEY(company_id,actor_id) REFERENCES users(company_id,id)
);
ALTER TABLE stock_initial_openings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stock_initial_openings FROM PUBLIC;
ALTER TABLE stock_batches ADD COLUMN stock_initial_id uuid,
  ADD FOREIGN KEY(company_id,stock_initial_id) REFERENCES stock_initial_openings(company_id,id),
  DROP CONSTRAINT stock_batches_origin_check,
  ADD CONSTRAINT stock_batches_origin_check CHECK(origin IN ('legacy','purchase','adjustment','return','stock_initial')),
  ADD CONSTRAINT stock_batches_initial_link CHECK((origin='stock_initial')=(stock_initial_id IS NOT NULL));
ALTER TABLE stock_movements ADD COLUMN stock_initial_id uuid, ADD COLUMN effective_date date,
  ADD FOREIGN KEY(company_id,stock_initial_id) REFERENCES stock_initial_openings(company_id,id),
  DROP CONSTRAINT stock_movements_movement_type_check,
  ADD CONSTRAINT stock_movements_movement_type_check CHECK(movement_type IN ('opening','receipt','consumption','adjustment_in','adjustment_out','reversal','stock_initial')),
  DROP CONSTRAINT stock_movements_check,
  ADD CONSTRAINT stock_movements_check CHECK(
    (movement_type IN ('opening','receipt','adjustment_in','reversal','stock_initial') AND quantity>0)
    OR (movement_type IN ('consumption','adjustment_out') AND quantity<0)),
  ADD CONSTRAINT stock_movements_initial_link CHECK((movement_type='stock_initial')=(stock_initial_id IS NOT NULL)),
  ADD CONSTRAINT stock_movements_initial_date CHECK(movement_type<>'stock_initial' OR (effective_date IS NOT NULL AND usage_id IS NULL));
CREATE UNIQUE INDEX stock_initial_once_per_batch ON stock_movements(batch_id) WHERE movement_type='stock_initial';

CREATE FUNCTION guard_stock_initial_opening() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('stock-initial:'||NEW.company_id,0));
    IF NEW.effective_date IS DISTINCT FROM (SELECT inventory_control_start_date FROM companies WHERE id=NEW.company_id)
      OR EXISTS(SELECT 1 FROM stock_batches WHERE company_id=NEW.company_id)
      OR EXISTS(SELECT 1 FROM stock_movements WHERE company_id=NEW.company_id) THEN
      RAISE EXCEPTION 'Initial opening requires configured date and empty inventory' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND OLD.result IS NULL AND NEW.result IS NOT NULL
    AND (to_jsonb(NEW)-'result')=(to_jsonb(OLD)-'result') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Stock initial audit is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER stock_initial_opening_guard BEFORE INSERT OR UPDATE OR DELETE ON stock_initial_openings
  FOR EACH ROW EXECUTE FUNCTION guard_stock_initial_opening();
CREATE TRIGGER stock_initial_opening_no_truncate BEFORE TRUNCATE ON stock_initial_openings
  FOR EACH STATEMENT EXECUTE FUNCTION guard_stock_initial_opening();
CREATE FUNCTION guard_stock_initial_batch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE opening stock_initial_openings%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('stock-initial:'||NEW.company_id,0));
    IF NEW.origin='legacy' AND EXISTS(SELECT 1 FROM stock_initial_openings WHERE company_id=NEW.company_id) THEN
      RAISE EXCEPTION 'Legacy opening cannot follow STOCK_INITIAL; use an audited adjustment' USING ERRCODE='23514';
    END IF;
    IF NEW.origin='stock_initial' THEN
      SELECT * INTO opening FROM stock_initial_openings WHERE id=NEW.stock_initial_id AND company_id=NEW.company_id;
      IF NOT FOUND OR opening.result IS NOT NULL OR NEW.received_date IS DISTINCT FROM opening.effective_date
        OR NEW.created_by IS DISTINCT FROM opening.actor_id OR NEW.available_quantity<>NEW.initial_quantity
        OR NEW.unit_price IS NOT NULL OR NEW.currency IS NOT NULL OR NEW.supplier IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid STOCK_INITIAL batch' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.stock_initial_id IS NOT NULL THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Stock initial batch provenance is immutable' USING ERRCODE='23514'; END IF;
    IF (to_jsonb(NEW)-ARRAY['available_quantity','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['available_quantity','updated_at']) THEN
      RAISE EXCEPTION 'Stock initial batch provenance is immutable' USING ERRCODE='23514';
    END IF;
  ELSIF TG_OP='UPDATE' AND NEW.stock_initial_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot relabel a batch as STOCK_INITIAL' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_initial_batch_guard BEFORE INSERT OR UPDATE OR DELETE ON stock_batches
  FOR EACH ROW EXECUTE FUNCTION guard_stock_initial_batch();
CREATE FUNCTION guard_stock_initial_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Stock movements are immutable' USING ERRCODE='23514'; END IF;
  IF NEW.movement_type='stock_initial' AND NOT EXISTS(
    SELECT 1 FROM stock_initial_openings o JOIN stock_batches b ON b.stock_initial_id=o.id AND b.company_id=o.company_id
    WHERE o.id=NEW.stock_initial_id AND o.company_id=NEW.company_id AND o.result IS NULL
      AND b.id=NEW.batch_id AND b.product_id=NEW.product_id AND b.unit=NEW.unit AND b.initial_quantity=NEW.quantity
      AND NEW.effective_date=o.effective_date AND NEW.created_by=o.actor_id AND NEW.operation_id=o.id
      AND NEW.idempotency_key=o.idempotency_key AND NEW.request_hash=o.request_hash
  ) THEN RAISE EXCEPTION 'Invalid STOCK_INITIAL movement' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_initial_movement_guard BEFORE INSERT OR UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION guard_stock_initial_movement();
CREATE TRIGGER stock_initial_movement_no_truncate BEFORE TRUNCATE ON stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION guard_stock_initial_movement();

CREATE FUNCTION check_stock_initial_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE opening stock_initial_openings%ROWTYPE; expected integer;
BEGIN
  SELECT * INTO opening FROM stock_initial_openings WHERE id=NEW.id;
  expected:=jsonb_array_length(opening.payload->'entries');
  IF opening.result IS NULL OR expected IS NULL OR expected<1
    OR (SELECT count(*) FROM stock_batches WHERE stock_initial_id=opening.id)<>expected
    OR (SELECT count(*) FROM stock_movements WHERE stock_initial_id=opening.id)<>expected THEN
    RAISE EXCEPTION 'Incomplete STOCK_INITIAL transaction' USING ERRCODE='23514';
  END IF;
  IF EXISTS(
    (SELECT e->>'product_id', e->>'unit', (e->>'quantity')::numeric, (e->>'expiration_date')::date
      FROM jsonb_array_elements(opening.payload->'entries') e
     EXCEPT ALL
     SELECT product_id::text,unit,initial_quantity,expiration_date FROM stock_batches WHERE stock_initial_id=opening.id)
    UNION ALL
    (SELECT product_id::text,unit,initial_quantity,expiration_date FROM stock_batches WHERE stock_initial_id=opening.id
     EXCEPT ALL
     SELECT e->>'product_id', e->>'unit', (e->>'quantity')::numeric, (e->>'expiration_date')::date
      FROM jsonb_array_elements(opening.payload->'entries') e)
  ) THEN RAISE EXCEPTION 'STOCK_INITIAL manifest does not match batches' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER stock_initial_complete AFTER INSERT ON stock_initial_openings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_stock_initial_complete();
CREATE FUNCTION guard_opened_inventory_date() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.inventory_control_start_date IS DISTINCT FROM OLD.inventory_control_start_date
    AND EXISTS(SELECT 1 FROM stock_initial_openings WHERE company_id=OLD.id) THEN
    RAISE EXCEPTION 'Opened inventory date is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER opened_inventory_date_guard BEFORE UPDATE OF inventory_control_start_date ON companies
  FOR EACH ROW EXECUTE FUNCTION guard_opened_inventory_date();
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON stock_initial_openings FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON stock_initial_openings FROM authenticated; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT,INSERT,UPDATE ON stock_initial_openings TO service_role;
    REVOKE DELETE,TRUNCATE ON stock_initial_openings FROM service_role;
  END IF;
END $$;
COMMIT;
