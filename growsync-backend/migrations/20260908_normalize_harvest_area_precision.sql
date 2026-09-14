-- SEPARATE, GUARDED STEP. Known production excesses require reconciliation first.
-- Never automatically lower harvest amounts or reopen existing cycles.
BEGIN;
LOCK TABLE crop_assignments, harvest_records, harvest_crop_assignments IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (
    SELECT ca.id FROM crop_assignments ca
    JOIN harvest_crop_assignments hca ON hca.crop_assignment_id = ca.id
    JOIN harvest_records hr ON hr.id = hca.harvest_id AND hr.enabled
    GROUP BY ca.id HAVING sum(hca.harvested_area_ha) > round(ca.area_ha, 2)
  ) THEN
    RAISE EXCEPTION 'STOP: harvested area exceeds normalized cycle area. Reconcile explicitly before changing precision.';
  END IF;
  IF EXISTS (SELECT 1 FROM crop_assignments WHERE round(area_ha, 2) <= 0 OR area_ha = 'NaN'::numeric) THEN
    RAISE EXCEPTION 'STOP: invalid area after rounding';
  END IF;
END $$;
-- The only planned quantity change is ROUND(area_ha, 2). Geometry stays intact.
ALTER TABLE crop_assignments ALTER COLUMN area_ha TYPE NUMERIC(12,2) USING round(area_ha, 2);
COMMIT;
