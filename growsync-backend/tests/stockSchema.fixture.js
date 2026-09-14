// Schema fixture for isolated tests ONLY. No production connection or installer.
// The same additive DDL is delivered in the task summary for manual review.
module.exports = `
ALTER TABLE products
  ADD COLUMN active_ingredient text,
  ADD COLUMN formulation text,
  ADD COLUMN manufacturer text,
  ADD COLUMN minimum_stock numeric(20,6) CHECK (minimum_stock >= 0 AND minimum_stock <> 'NaN'::numeric),
  ADD COLUMN notes text,
  ADD COLUMN updated_at timestamptz;
ALTER TABLE products ALTER COLUMN updated_at SET DEFAULT now();
CREATE UNIQUE INDEX inventory_product_unit_key ON products(company_id,id,unit);
CREATE UNIQUE INDEX inventory_usage_product_key ON usage_records(company_id,product_id,id);
CREATE UNIQUE INDEX inventory_user_company_key ON users(company_id,id);

CREATE TABLE stock_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  initial_quantity numeric(20,6) NOT NULL CHECK (initial_quantity > 0 AND initial_quantity <> 'NaN'::numeric),
  available_quantity numeric(20,6) NOT NULL CHECK (available_quantity >= 0 AND available_quantity <= initial_quantity AND available_quantity <> 'NaN'::numeric),
  unit text NOT NULL CHECK (unit IN ('kg','litros')),
  received_date date,
  expiration_date date,
  unit_price numeric(20,6) CHECK (unit_price >= 0 AND unit_price <> 'NaN'::numeric),
  currency text CHECK (currency IN ('ARS','USD')),
  exchange_rate numeric(20,6) CHECK (exchange_rate > 0 AND exchange_rate <> 'NaN'::numeric),
  total_original numeric(20,6) CHECK (total_original >= 0 AND total_original <> 'NaN'::numeric),
  total_ars numeric(20,6) CHECK (total_ars >= 0 AND total_ars <> 'NaN'::numeric),
  supplier text,
  reference text,
  notes text,
  origin text NOT NULL CHECK (origin IN ('legacy','purchase','adjustment','return')),
  CONSTRAINT stock_batches_received_date_required CHECK (origin NOT IN ('purchase','return') OR received_date IS NOT NULL),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  enabled boolean NOT NULL DEFAULT true,
  FOREIGN KEY (company_id,product_id,unit) REFERENCES products(company_id,id,unit) ON DELETE RESTRICT,
  FOREIGN KEY (company_id,created_by) REFERENCES users(company_id,id) ON DELETE RESTRICT,
  UNIQUE (company_id,product_id,id,unit),
  CHECK (currency IS NOT NULL OR (unit_price IS NULL AND total_original IS NULL AND total_ars IS NULL)),
  CHECK (currency IS DISTINCT FROM 'USD' OR exchange_rate IS NOT NULL)
);
CREATE INDEX stock_batches_fefo ON stock_batches(company_id,product_id,expiration_date ASC NULLS LAST,received_date ASC NULLS LAST,id ASC)
  WHERE enabled AND available_quantity > 0;

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('opening','receipt','consumption','adjustment_in','adjustment_out','reversal')),
  quantity numeric(20,6) NOT NULL CHECK (quantity <> 0 AND quantity <> 'NaN'::numeric),
  unit text NOT NULL CHECK (unit IN ('kg','litros')),
  usage_id uuid,
  operation_id uuid NOT NULL,
  reversed_movement_id uuid,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (length(request_hash)=64),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  UNIQUE (company_id,product_id,id,unit),
  FOREIGN KEY (company_id,product_id,batch_id,unit) REFERENCES stock_batches(company_id,product_id,id,unit) ON DELETE RESTRICT,
  FOREIGN KEY (company_id,product_id,usage_id) REFERENCES usage_records(company_id,product_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id,created_by) REFERENCES users(company_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id,product_id,reversed_movement_id,unit) REFERENCES stock_movements(company_id,product_id,id,unit) ON DELETE RESTRICT,
  CHECK ((movement_type IN ('opening','receipt','adjustment_in','reversal') AND quantity>0)
    OR (movement_type IN ('consumption','adjustment_out') AND quantity<0)),
  CHECK ((movement_type='reversal') = (reversed_movement_id IS NOT NULL)),
  CHECK (movement_type<>'consumption' OR usage_id IS NOT NULL)
);
CREATE UNIQUE INDEX stock_movements_once_per_batch ON stock_movements(company_id,idempotency_key,batch_id,movement_type);
CREATE UNIQUE INDEX stock_movements_reversal_once ON stock_movements(reversed_movement_id) WHERE reversed_movement_id IS NOT NULL;
CREATE INDEX stock_movements_product ON stock_movements(company_id,product_id,created_at,id);
CREATE INDEX stock_movements_operation ON stock_movements(company_id,operation_id);
CREATE INDEX stock_movements_usage ON stock_movements(company_id,usage_id) WHERE usage_id IS NOT NULL;

CREATE FUNCTION inventory_stamp_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
CREATE TRIGGER inventory_product_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION inventory_stamp_updated_at();
CREATE TRIGGER inventory_batch_updated BEFORE UPDATE ON stock_batches FOR EACH ROW EXECUTE FUNCTION inventory_stamp_updated_at();
CREATE FUNCTION inventory_guard_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original stock_movements%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Stock movements are immutable'; END IF;
  IF NEW.movement_type='reversal' THEN
    SELECT * INTO original FROM stock_movements WHERE id=NEW.reversed_movement_id;
    IF NOT FOUND OR original.movement_type<>'consumption'
      OR NEW.quantity<>-original.quantity OR NEW.batch_id<>original.batch_id
      OR NEW.usage_id IS DISTINCT FROM original.usage_id
      OR NEW.company_id<>original.company_id OR NEW.product_id<>original.product_id
    THEN RAISE EXCEPTION 'Invalid stock reversal'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_movement_guard BEFORE INSERT OR UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION inventory_guard_movement();
CREATE TRIGGER inventory_movement_no_truncate BEFORE TRUNCATE ON stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION inventory_guard_movement();
ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stock_batches,stock_movements FROM PUBLIC;
REVOKE ALL ON stock_batches,stock_movements FROM anon,authenticated;
REVOKE UPDATE,DELETE,TRUNCATE ON stock_movements FROM service_role;
GRANT SELECT,INSERT ON stock_movements TO service_role;
GRANT SELECT,INSERT,UPDATE ON stock_batches TO service_role;
`;
