-- Deploy together with the partial-harvest backend; pause old writers first.
-- No end_date, historical quantity or unlinked harvest is reinterpreted.
BEGIN;
LOCK TABLE crop_assignments, harvest_records, harvest_crop_assignments IN SHARE ROW EXCLUSIVE MODE;

DO $$ BEGIN
  IF EXISTS (SELECT harvest_id FROM harvest_crop_assignments GROUP BY harvest_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Manual reconciliation required: legacy harvest has multiple assignments';
  END IF;
END $$;

ALTER TABLE harvest_crop_assignments ADD COLUMN harvested_area_ha NUMERIC(12,2);
UPDATE harvest_crop_assignments hca
SET harvested_area_ha = hr.harvested_area_ha
FROM harvest_records hr WHERE hr.id = hca.harvest_id;
ALTER TABLE harvest_crop_assignments
  ALTER COLUMN harvested_area_ha SET NOT NULL,
  ADD CONSTRAINT harvest_crop_assignments_area_positive CHECK (harvested_area_ha > 0 AND harvested_area_ha <> 'NaN'::numeric);
DROP INDEX harvest_crop_assignments_assignment_unique;
CREATE INDEX idx_harvest_crop_assignments_assignment ON harvest_crop_assignments(crop_assignment_id);

ALTER TABLE crop_assignments ADD COLUMN harvest_closure_source TEXT;
UPDATE crop_assignments SET harvest_closure_source = 'legacy' WHERE end_date IS NOT NULL;
ALTER TABLE crop_assignments ADD CONSTRAINT crop_assignments_harvest_closure_source_check
  CHECK ((end_date IS NULL AND harvest_closure_source IS NULL)
    OR (end_date IS NOT NULL AND harvest_closure_source IS NOT NULL
      AND harvest_closure_source IN ('automatic', 'manual', 'legacy')));

CREATE TABLE harvest_cycle_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  crop_assignment_id UUID NOT NULL UNIQUE REFERENCES crop_assignments(id) ON DELETE RESTRICT,
  finalized_date DATE NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('measurement_difference', 'unharvested_area', 'loss', 'weather', 'other')),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  total_area_ha NUMERIC(12,2) NOT NULL CHECK (total_area_ha > 0 AND total_area_ha <> 'NaN'::numeric),
  harvested_area_ha NUMERIC(12,2) NOT NULL CHECK (harvested_area_ha >= 0 AND harvested_area_ha <> 'NaN'::numeric),
  remaining_area_ha NUMERIC(12,2) NOT NULL CHECK (remaining_area_ha > 0 AND remaining_area_ha <> 'NaN'::numeric),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (total_area_ha = harvested_area_ha + remaining_area_ha),
  CHECK (reason <> 'other' OR (notes IS NOT NULL AND btrim(notes) <> ''))
);
CREATE INDEX idx_harvest_cycle_closures_company ON harvest_cycle_closures(company_id, finalized_date);

-- Existing four-decimal areas are preserved until the separate precision gate passes.
-- All NEW/changed operational assignment areas are explicitly rounded, never truncated.
CREATE FUNCTION normalize_new_harvest_cycle_area() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text || ':' || NEW.lot_id::text, 0));
  IF TG_OP = 'INSERT' THEN
    NEW.area_ha := round(NEW.area_ha, 2);
  ELSIF NEW.area_ha IS DISTINCT FROM OLD.area_ha THEN
    NEW.area_ha := round(NEW.area_ha, 2);
  END IF;
  IF NEW.end_date IS NOT NULL AND NEW.harvest_closure_source IS NULL THEN
    NEW.harvest_closure_source := 'legacy';
  END IF;
  -- Check AFTER taking the same lot lock used by harvest writes. This also covers
  -- a new cycle whose application-level conflict check ran before a reopening.
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM crop_assignments other
      LEFT JOIN sub_lots previous_surface ON previous_surface.id = other.sub_lot_id
      LEFT JOIN sub_lots new_surface ON new_surface.id = NEW.sub_lot_id
      WHERE other.company_id = NEW.company_id AND other.lot_id = NEW.lot_id
        AND EXISTS (SELECT 1 FROM harvest_crop_assignments hca WHERE hca.crop_assignment_id = other.id)
        AND daterange(other.start_date, COALESCE(other.end_date, 'infinity'::date), '[]')
          && daterange(NEW.start_date, COALESCE(NEW.end_date, 'infinity'::date), '[]')
        AND (other.sub_lot_id IS NULL OR NEW.sub_lot_id IS NULL OR other.sub_lot_id = NEW.sub_lot_id
          OR ST_Area(ST_CollectionExtract(ST_Intersection(
            ST_CollectionExtract(ST_MakeValid(previous_surface.geom), 3),
            ST_CollectionExtract(ST_MakeValid(new_surface.geom), 3)), 3)::geography) > 1)
    ) THEN
      RAISE EXCEPTION 'New cycle overlaps a cycle with linked harvests' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER normalize_new_harvest_cycle_area BEFORE INSERT OR UPDATE ON crop_assignments
  FOR EACH ROW EXECUTE FUNCTION normalize_new_harvest_cycle_area();

-- Preserve the identity and recorded area of cycles already used by harvests.
CREATE FUNCTION protect_harvest_cycle_structure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.end_date, NEW.harvest_closure_source) IS DISTINCT FROM (OLD.end_date, OLD.harvest_closure_source)
    AND current_setting('growsync.harvest_cycle_write', true) IS DISTINCT FROM 'on'
    AND (OLD.harvest_closure_source IN ('automatic', 'manual', 'legacy')
      OR EXISTS (SELECT 1 FROM harvest_crop_assignments WHERE crop_assignment_id=OLD.id)) THEN
    RAISE EXCEPTION 'Harvest-linked or historical closure requires an explicit harvest operation' USING ERRCODE = '23514';
  END IF;
  IF (NEW.company_id, NEW.campaign_id, NEW.lot_id, NEW.sub_lot_id, NEW.crop_id, NEW.start_date, NEW.area_ha)
      IS DISTINCT FROM
     (OLD.company_id, OLD.campaign_id, OLD.lot_id, OLD.sub_lot_id, OLD.crop_id, OLD.start_date, OLD.area_ha)
     AND EXISTS (SELECT 1 FROM harvest_crop_assignments WHERE crop_assignment_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot change structure of a cycle with linked harvests' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_harvest_cycle_structure BEFORE UPDATE ON crop_assignments
  FOR EACH ROW EXECUTE FUNCTION protect_harvest_cycle_structure();
COMMIT;
