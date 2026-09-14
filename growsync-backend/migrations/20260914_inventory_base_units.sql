-- Controlled unit expansion. Run in a transaction after the read-only diagnostic.
-- No quantities or historical rows are updated. Existing spellings stay valid for
-- immutable composite foreign keys. New product spellings are canonicalized.
-- Catalog source: shared/inventoryUnits.json. SQL is a reviewed deployment snapshot.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.inventory_normalize_unit(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE btrim(value)
    WHEN 'litros' THEN 'L' WHEN 'litro' THEN 'L' WHEN 'lt' THEN 'L' WHEN 'l' THEN 'L'
    WHEN 'kilos' THEN 'kg' WHEN 'kilo' THEN 'kg'
    WHEN 'bolsas' THEN 'bag' WHEN 'bolsa' THEN 'bag'
    WHEN 'unidades' THEN 'unit' WHEN 'unidad' THEN 'unit'
    ELSE btrim(value) END
$$;

DO $$
DECLARE table_name text; constraint_name text; definition text; other_checks int;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['stock_batches','stock_movements'] LOOP
    IF to_regclass('public.'||table_name) IS NULL THEN CONTINUE; END IF;
    constraint_name := table_name||'_unit_check';
    SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
      WHERE conrelid=to_regclass('public.'||table_name) AND conname=constraint_name;
    -- Refuse unexpected schemas instead of dropping an arbitrary constraint.
    IF definition IS NULL OR definition NOT IN (
      'CHECK ((unit = ANY (ARRAY[''kg''::text, ''litros''::text])))',
      'CHECK ((unit = ANY (ARRAY[''L''::text, ''mL''::text, ''kg''::text, ''g''::text, ''unit''::text, ''bag''::text, ''litros''::text, ''bolsas''::text])))'
    ) THEN
      RAISE EXCEPTION 'Unexpected unit constraint on %. Diagnose installed schema first.',table_name;
    END IF;
    SELECT count(*) INTO other_checks FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
      WHERE c.conrelid=to_regclass('public.'||table_name) AND c.contype='c'
        AND a.attname='unit' AND c.conname<>constraint_name;
    IF other_checks>0 THEN RAISE EXCEPTION 'Additional unit checks on % require review',table_name; END IF;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I, ADD CONSTRAINT %I CHECK (unit IN (''L'',''mL'',''kg'',''g'',''unit'',''bag'',''litros'',''bolsas''))',table_name,constraint_name,constraint_name);
  END LOOP;
  IF to_regclass('public.planning_product_completions') IS NOT NULL THEN
    -- Widen only the installed 12,4 type. An unbounded numeric is already safe.
    IF EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
      AND c.table_name='planning_product_completions' AND c.column_name='actual_amount'
      AND numeric_precision=12 AND numeric_scale=4) THEN
      ALTER TABLE public.planning_product_completions ALTER COLUMN actual_amount TYPE numeric(20,6);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
      AND c.table_name='planning_product_completions' AND c.column_name='actual_amount'
      AND (data_type<>'numeric' OR numeric_scale<6 OR numeric_precision-numeric_scale<14)) THEN
      RAISE EXCEPTION 'Unexpected completion precision. Review before migration.';
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.inventory_guard_product_unit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE reference record; has_history boolean;
BEGIN
  IF TG_OP='UPDATE' AND NEW.unit IS NOT DISTINCT FROM OLD.unit THEN RETURN NEW; END IF;
  NEW.unit:=public.inventory_normalize_unit(NEW.unit);
  IF NEW.unit IS NULL OR NEW.unit NOT IN ('L','mL','kg','g','unit','bag') THEN
    RAISE EXCEPTION 'Seleccioná una unidad base válida.' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN RETURN NEW; END IF;
  IF NEW.unit=public.inventory_normalize_unit(OLD.unit) THEN
    NEW.unit:=OLD.unit; RETURN NEW; -- label normalization is not a historical rewrite
  END IF;
  has_history:=COALESCE(OLD.total_quantity,0)<>0 OR COALESCE(OLD.available_quantity,0)<>0;
  FOR reference IN
    SELECT DISTINCT n.nspname,rel.relname,a.attname FROM pg_constraint fk
    JOIN pg_class rel ON rel.oid=fk.conrelid JOIN pg_namespace n ON n.oid=rel.relnamespace
    CROSS JOIN LATERAL unnest(fk.conkey,fk.confkey) AS keys(local_key,foreign_key)
    JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=keys.local_key
    JOIN pg_attribute target ON target.attrelid=fk.confrelid AND target.attnum=keys.foreign_key
    WHERE fk.contype='f' AND fk.confrelid='public.products'::regclass AND target.attname='id'
  LOOP
    EXIT WHEN has_history;
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I=$1)',reference.nspname,reference.relname,reference.attname)
      INTO has_history USING OLD.id;
  END LOOP;
  IF has_history THEN
    RAISE EXCEPTION 'La unidad base no puede modificarse porque el producto ya posee movimientos o registros asociados.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inventory_product_unit_guard ON public.products;
CREATE TRIGGER inventory_product_unit_guard BEFORE INSERT OR UPDATE OF unit ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.inventory_guard_product_unit();

-- Serialize operational inserts with product-unit edits, including legacy writers.
-- This does not modify pre-existing rows or the immutable movements trigger.
CREATE OR REPLACE FUNCTION public.inventory_inherit_product_unit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE base_unit text;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT unit INTO base_unit FROM public.products WHERE id=NEW.product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no disponible.' USING ERRCODE='23503'; END IF;
  IF base_unit IS NULL OR public.inventory_normalize_unit(base_unit) NOT IN ('L','mL','kg','g','unit','bag') OR
    (NEW.unit IS NOT NULL AND public.inventory_normalize_unit(NEW.unit) IS DISTINCT FROM public.inventory_normalize_unit(base_unit)) THEN
    RAISE EXCEPTION 'La unidad debe coincidir con la unidad base del producto.' USING ERRCODE='23514';
  END IF;
  NEW.unit:=base_unit;
  RETURN NEW;
END $$;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['usage_records','planning_products','stock_batches'] LOOP
    IF to_regclass('public.'||table_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS inventory_inherit_unit ON public.%I',table_name);
    EXECUTE format('CREATE TRIGGER inventory_inherit_unit BEFORE INSERT OR UPDATE OF unit,product_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.inventory_inherit_product_unit()',table_name);
  END LOOP;
END $$;
