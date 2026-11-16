-- Run once, before deploying the registration change. No historical backfill.
BEGIN;
CREATE TABLE public.company_registration_payments (
  provider text NOT NULL,
  reference uuid NOT NULL,
  preference_id text,
  registration_token_hash text NOT NULL,
  plan text NOT NULL,
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL,
  provider_payment_id text,
  company_id uuid,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_registration_payments_token_hash_check CHECK (registration_token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT company_registration_payments_provider_reference_pk PRIMARY KEY (provider, reference),
  CONSTRAINT company_registration_payments_provider_payment_key UNIQUE (provider, provider_payment_id),
  CONSTRAINT company_registration_payments_company_key UNIQUE (company_id),
  CONSTRAINT company_registration_payments_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT company_registration_payments_provider_check CHECK (provider IN ('mercadopago', 'simulated')),
  CONSTRAINT company_registration_payments_plan_check CHECK (plan IN ('basic', 'professional')),
  CONSTRAINT company_registration_payments_amount_check CHECK (amount > 0),
  CONSTRAINT company_registration_payments_currency_check CHECK (currency = 'ARS'),
  CONSTRAINT company_registration_payments_preference_check CHECK (provider <> 'mercadopago' OR preference_id IS NOT NULL),
  CONSTRAINT company_registration_payments_consumption_check CHECK (
    (company_id IS NULL AND consumed_at IS NULL) OR
    (company_id IS NOT NULL AND consumed_at IS NOT NULL AND provider_payment_id IS NOT NULL)
  )
);
-- No client policies: default-deny RLS plus explicit privilege revocation.
ALTER TABLE public.company_registration_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_registration_payments FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.company_registration_payments FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.company_registration_payments FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    -- Supabase installations may inherit broader default grants, including DELETE/TRUNCATE.
    REVOKE ALL ON public.company_registration_payments FROM service_role;
    GRANT SELECT, INSERT, UPDATE ON public.company_registration_payments TO service_role;
  END IF;
END $$;
COMMIT;
