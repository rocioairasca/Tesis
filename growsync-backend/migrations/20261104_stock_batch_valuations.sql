-- Additive economic history only. Requires Inventory V1 and its tenant indexes.
-- No backfill and no writes to physical inventory. Apply through normal migration review.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE UNIQUE INDEX stock_batches_company_id_key ON public.stock_batches(company_id,id);

CREATE TABLE public.stock_batch_valuations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  supersedes_id uuid,
  status text NOT NULL CHECK (status IN ('pending','confirmed')),
  currency text CHECK (currency IN ('USD','ARS')),
  unit_cost_original numeric(20,6) CHECK (unit_cost_original >= 0 AND unit_cost_original <> 'NaN'::numeric),
  invoice_total_original numeric(20,6) CHECK (invoice_total_original >= 0 AND invoice_total_original <> 'NaN'::numeric),
  invoice_date date,
  supplier_name text CHECK (length(supplier_name) <= 500),
  invoice_reference text CHECK (length(invoice_reference) <= 500),
  payment_date date,
  fx_rate numeric(20,6),
  fx_date date,
  fx_type text,
  fx_source text,
  unit_cost_usd numeric(20,6),
  provenance text NOT NULL CHECK (provenance IN ('manual','legacy_review')),
  reason text CHECK (length(reason) <= 2000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE(company_id,batch_id,id),
  UNIQUE(company_id,batch_id,revision),
  UNIQUE(company_id,idempotency_key),
  UNIQUE(supersedes_id),
  FOREIGN KEY(company_id,batch_id) REFERENCES public.stock_batches(company_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id,created_by) REFERENCES public.users(company_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id,batch_id,supersedes_id)
    REFERENCES public.stock_batch_valuations(company_id,batch_id,id) ON DELETE RESTRICT,
  CHECK ((revision = 1) = (supersedes_id IS NULL)),
  CHECK (revision = 1 OR (reason IS NOT NULL AND length(btrim(reason)) > 0)),
  CHECK (currency IS NOT NULL OR (unit_cost_original IS NULL AND invoice_total_original IS NULL)),
  CONSTRAINT stock_valuation_confirmation CHECK (
    (status = 'pending' AND unit_cost_usd IS NULL) OR
    (status = 'confirmed' AND currency IS NOT NULL AND currency = 'USD'
      AND unit_cost_original IS NOT NULL AND unit_cost_usd IS NOT NULL
      AND unit_cost_usd = unit_cost_original)
  ),
  -- ARS is pending-only in this phase. Do not accept an unverified conversion.
  CONSTRAINT stock_valuation_fx_deferred CHECK (
    fx_rate IS NULL AND fx_date IS NULL AND fx_type IS NULL AND fx_source IS NULL
  )
);

CREATE FUNCTION public.guard_stock_batch_valuation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE previous public.stock_batch_valuations%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Valuation history is immutable' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.stock_batches
    WHERE id=NEW.batch_id AND company_id=NEW.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found in company' USING ERRCODE='23503'; END IF;
  SELECT * INTO previous FROM public.stock_batch_valuations
    WHERE company_id=NEW.company_id AND batch_id=NEW.batch_id ORDER BY revision DESC LIMIT 1;
  IF FOUND THEN
    IF NEW.supersedes_id IS DISTINCT FROM previous.id OR NEW.revision <> previous.revision + 1 THEN
      RAISE EXCEPTION 'Valuation revision is stale' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.supersedes_id IS NOT NULL OR NEW.revision <> 1 THEN
    RAISE EXCEPTION 'First valuation must be revision 1' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_batch_valuation_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.stock_batch_valuations FOR EACH ROW EXECUTE FUNCTION public.guard_stock_batch_valuation();
CREATE TRIGGER stock_batch_valuation_no_truncate BEFORE TRUNCATE
  ON public.stock_batch_valuations FOR EACH STATEMENT EXECUTE FUNCTION public.guard_stock_batch_valuation();
ALTER TABLE public.stock_batch_valuations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_batch_valuations FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.stock_batch_valuations IS
  'Authoritative economic revisions; existing stock_batches monetary columns remain original evidence. Current = highest revision. No physical inventory writes.';
COMMENT ON COLUMN public.stock_batch_valuations.fx_rate IS 'Reserved: ARS per USD. ARS confirmation is not enabled in this phase.';
COMMIT;
