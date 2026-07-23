ALTER TABLE vehicle_fuel_records
  ADD COLUMN IF NOT EXISTS current_fuel NUMERIC(12, 2)
    CHECK (current_fuel IS NULL OR current_fuel >= 0);

ALTER TABLE vehicle_fuel_records
  ADD COLUMN IF NOT EXISTS fuel_after_load NUMERIC(12, 2)
    CHECK (fuel_after_load IS NULL OR fuel_after_load >= 0);
