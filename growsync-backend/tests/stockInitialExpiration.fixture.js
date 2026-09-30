// Target-schema definition for an empty, disposable test database only.
// The incremental migration is not run by these tests. A static assertion checks
// that its deferred checker matches this tested definition.
module.exports=`CREATE OR REPLACE FUNCTION check_stock_initial_complete() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;`;
