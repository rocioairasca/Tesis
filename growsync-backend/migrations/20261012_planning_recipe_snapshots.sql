-- Phase 2 only: no backfill, executions, Usage or stock effects.
BEGIN;
ALTER TABLE public.planning ADD COLUMN recipe_id uuid NULL REFERENCES public.recipes(id) ON DELETE RESTRICT;
ALTER TABLE public.planning ADD COLUMN recipe_name_snapshot text NULL;
ALTER TABLE public.planning ADD CONSTRAINT planning_recipe_snapshot_pair CHECK (
  (recipe_id IS NULL AND recipe_name_snapshot IS NULL) OR
  (recipe_id IS NOT NULL AND recipe_name_snapshot IS NOT NULL AND length(btrim(recipe_name_snapshot))>0)
);
ALTER TABLE public.planning_products ADD COLUMN dose_amount numeric(20,6) NULL;
ALTER TABLE public.planning_products ADD COLUMN dose_unit text NULL;
ALTER TABLE public.planning_products ADD CONSTRAINT planning_product_dose_pair CHECK (
  (dose_amount IS NULL AND dose_unit IS NULL) OR
  (dose_amount IS NOT NULL AND dose_unit IS NOT NULL AND dose_amount>0 AND dose_amount<>'NaN'::numeric AND dose_unit IN ('L','mL','kg','g','unit','bag'))
);
CREATE INDEX planning_recipe_idx ON public.planning(company_id,recipe_id) WHERE recipe_id IS NOT NULL;
CREATE FUNCTION public.planning_recipe_tenant_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
  IF NEW.recipe_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM recipes WHERE id=NEW.recipe_id AND company_id=NEW.company_id) THEN
    RAISE EXCEPTION 'Planning recipe must belong to the same company' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER planning_recipe_tenant_guard BEFORE INSERT OR UPDATE OF recipe_id,company_id ON public.planning
  FOR EACH ROW EXECUTE FUNCTION public.planning_recipe_tenant_guard();
COMMENT ON COLUMN public.planning.recipe_id IS 'Recipe origin only; historical name and doses are stored snapshots, never recalculated on read.';
COMMENT ON COLUMN public.planning_products.dose_amount IS 'Stored dose per hectare. amount is the planned total in unit.';
COMMIT;
