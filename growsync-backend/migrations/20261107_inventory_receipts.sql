-- Additive grouping of new receipts only; existing batches remain ungrouped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE public.inventory_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  received_date date NOT NULL,
  supplier text CHECK (length(supplier) <= 500),
  document_type text CHECK (length(document_type) <= 100),
  reference text CHECK (length(reference) <= 500),
  notes text CHECK (length(notes) <= 2000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE(company_id,id),
  UNIQUE(company_id,idempotency_key),
  FOREIGN KEY(company_id,created_by) REFERENCES public.users(company_id,id) ON DELETE RESTRICT
);
ALTER TABLE public.stock_batches ADD COLUMN inventory_receipt_id uuid;
ALTER TABLE public.stock_batches ADD CONSTRAINT stock_batches_inventory_receipt_fk
  FOREIGN KEY(company_id,inventory_receipt_id) REFERENCES public.inventory_receipts(company_id,id) ON DELETE RESTRICT NOT VALID;
-- NULL on every pre-existing batch; no backfill or balance changes.
ALTER TABLE public.stock_batches VALIDATE CONSTRAINT stock_batches_inventory_receipt_fk;
CREATE UNIQUE INDEX stock_batches_receipt_product_key
  ON public.stock_batches(company_id,inventory_receipt_id,product_id) WHERE inventory_receipt_id IS NOT NULL;
ALTER TABLE public.inventory_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_receipts FROM PUBLIC, anon, authenticated;
COMMENT ON COLUMN public.stock_batches.inventory_receipt_id IS 'Shared receipt header; NULL for prior and individual receipts.';
COMMIT;
