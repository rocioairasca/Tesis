CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS vehicle_fuel_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  fuel_type TEXT NOT NULL DEFAULT 'diesel'
    CHECK (fuel_type IN ('diesel', 'nafta', 'gnc', 'otro')),
  liters NUMERIC(12, 2) NOT NULL CHECK (liters > 0),
  current_fuel NUMERIC(12, 2) CHECK (current_fuel IS NULL OR current_fuel >= 0),
  fuel_after_load NUMERIC(12, 2) CHECK (fuel_after_load IS NULL OR fuel_after_load >= 0),
  unit_price NUMERIC(12, 2) CHECK (unit_price IS NULL OR unit_price >= 0),
  total_cost NUMERIC(12, 2) GENERATED ALWAYS AS (
    CASE
      WHEN unit_price IS NULL THEN NULL
      ELSE liters * unit_price
    END
  ) STORED,
  odometer NUMERIC(12, 2) CHECK (odometer IS NULL OR odometer >= 0),
  supplier TEXT,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_fuel_records_company_vehicle
  ON vehicle_fuel_records(company_id, vehicle_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_fuel_records_loaded_at
  ON vehicle_fuel_records(vehicle_id, loaded_at DESC);
