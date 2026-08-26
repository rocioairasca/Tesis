ALTER TABLE companies
ADD COLUMN IF NOT EXISTS plan TEXT CHECK (plan IN ('basic', 'professional')),
ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'inactive'
  CHECK (subscription_status IN ('inactive', 'active', 'past_due', 'cancelled')),
ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS subscription_source TEXT NOT NULL DEFAULT 'unknown'
  CHECK (subscription_source IN ('unknown', 'mercadopago', 'manual'));

CREATE INDEX IF NOT EXISTS companies_subscription_status_idx
  ON companies (subscription_status);
