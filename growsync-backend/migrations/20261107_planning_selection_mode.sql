-- Additive metadata only. Existing historical/surface snapshots remain unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.planning_lots ADD COLUMN selection_mode text;
ALTER TABLE public.planning_lots ADD CONSTRAINT planning_lots_selection_mode_valid CHECK (
 selection_mode IS NULL OR
 (selection_mode='sub_lot' AND sub_lot_id IS NOT NULL) OR
 (selection_mode='full_lot' AND sub_lot_id IS NULL AND (effective_area_ha IS NULL OR effective_area_ha=area_ha)) OR
 (selection_mode='manual_portion' AND sub_lot_id IS NULL AND effective_area_ha IS NOT NULL AND effective_area_ha>0 AND effective_area_ha<=area_ha)
);
COMMENT ON COLUMN public.planning_lots.selection_mode IS 'Explicit selection: full_lot, sub_lot or manual_portion. NULL retains legacy semantics. area_ha is structural snapshot; effective_area_ha is operational area. No geometry for manual portions.';
COMMIT;
