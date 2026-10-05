-- Additive only. Existing records keep NULL; no inferred context or backfill.
BEGIN;
ALTER TABLE public.planning ADD COLUMN field_context TEXT NULL;
ALTER TABLE public.planning ADD CONSTRAINT planning_field_context_valid CHECK (
  field_context IS NULL OR field_context IN ('growing_crop','stubble','fallow','pre_sowing','other')
);
COMMENT ON COLUMN public.planning.field_context IS 'Descriptive field situation: crop_id identifies the growing crop, stubble source, intended crop, or optional related crop. NULL preserves legacy semantics. Never creates or changes productive cycles; sowing retains its existing crop meaning.';
COMMIT;
