-- Prerequisites: Inventory V1 and 20260916_stock_initial.sql.
-- Prepared only: do not apply without a coordinated backend deployment.
-- No expiration dates or existing data are rewritten.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

ALTER TABLE stock_batches
  ADD COLUMN expiration_year smallint,
  ADD COLUMN expiration_month smallint,
  ADD CONSTRAINT stock_batches_expiration_pair CHECK (
    (expiration_year IS NULL) = (expiration_month IS NULL)),
  ADD CONSTRAINT stock_batches_expiration_precision CHECK (
    expiration_date IS NULL OR (expiration_year IS NULL AND expiration_month IS NULL)),
  ADD CONSTRAINT stock_batches_expiration_year_range CHECK (expiration_year BETWEEN 2000 AND 2100),
  ADD CONSTRAINT stock_batches_expiration_month_range CHECK (expiration_month BETWEEN 1 AND 12);

COMMENT ON COLUMN stock_batches.expiration_date IS 'Exact expiration date only; NULL for monthly precision.';
COMMENT ON COLUMN stock_batches.expiration_year IS 'Monthly expiration year (2000..2100), paired with expiration_month; no synthetic date.';
COMMENT ON COLUMN stock_batches.expiration_month IS 'Monthly expiration month (1..12), inclusive through its last calendar day.';

CREATE INDEX stock_batches_effective_expiration_fefo ON stock_batches (
  company_id, product_id,
  (COALESCE(expiration_date,
    (make_date(expiration_year,expiration_month,1) + INTERVAL '1 month - 1 day')::date)) ASC NULLS LAST,
  received_date ASC NULLS LAST, id ASC
) WHERE enabled AND available_quantity>0;

-- Extend the existing deferred manifest check. Missing JSON keys in historical
-- manifests evaluate to NULL, matching the new nullable columns on old batches.
-- The existing provenance guard compares full rows, so it already protects both
-- new columns on confirmed STOCK_INITIAL batches.
CREATE OR REPLACE FUNCTION check_stock_initial_complete() RETURNS trigger LANGUAGE plpgsql AS $$
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
    (SELECT e->>'product_id', e->>'unit', (e->>'quantity')::numeric, (e->>'expiration_date')::date,
      (e->>'expiration_year')::smallint, (e->>'expiration_month')::smallint
      FROM jsonb_array_elements(opening.payload->'entries') e
     EXCEPT ALL
     SELECT product_id::text,unit,initial_quantity,expiration_date,expiration_year,expiration_month
       FROM stock_batches WHERE stock_initial_id=opening.id)
    UNION ALL
    (SELECT product_id::text,unit,initial_quantity,expiration_date,expiration_year,expiration_month
       FROM stock_batches WHERE stock_initial_id=opening.id
     EXCEPT ALL
     SELECT e->>'product_id', e->>'unit', (e->>'quantity')::numeric, (e->>'expiration_date')::date,
       (e->>'expiration_year')::smallint, (e->>'expiration_month')::smallint
      FROM jsonb_array_elements(opening.payload->'entries') e)
  ) THEN RAISE EXCEPTION 'STOCK_INITIAL manifest does not match batches' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
COMMIT;
