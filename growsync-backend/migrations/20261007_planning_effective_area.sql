-- Additive migration. No backfill or changes to existing surface snapshots.
BEGIN;
ALTER TABLE public.planning_lots ADD COLUMN effective_area_ha NUMERIC(12,4) NULL;
ALTER TABLE public.planning_lots ADD CONSTRAINT planning_lots_effective_area_valid CHECK (
  effective_area_ha IS NULL OR (
    effective_area_ha > 0 AND effective_area_ha <> 'NaN'::numeric
    AND area_ha IS NOT NULL AND effective_area_ha <= area_ha
  )
);
COMMENT ON COLUMN public.planning_lots.effective_area_ha IS 'Work area in hectares; NULL uses the original area_ha snapshot.';
COMMIT;
