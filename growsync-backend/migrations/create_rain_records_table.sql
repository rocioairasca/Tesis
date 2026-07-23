CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS rain_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  rain_mm NUMERIC(10, 2) NOT NULL CHECK (rain_mm >= 0),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('api', 'manual', 'edited_api')),
  notes TEXT,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS rain_records_company_date_enabled_unique
  ON rain_records (company_id, date)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS rain_records_company_date_idx
  ON rain_records (company_id, date DESC);

CREATE OR REPLACE FUNCTION set_rain_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rain_records_set_updated_at ON rain_records;
CREATE TRIGGER rain_records_set_updated_at
BEFORE UPDATE ON rain_records
FOR EACH ROW
EXECUTE FUNCTION set_rain_records_updated_at();
