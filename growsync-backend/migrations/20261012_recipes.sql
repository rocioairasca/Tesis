-- Phase 1: reusable dose templates only. No changes to Usage, Planning or stock.
BEGIN;
CREATE TABLE public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  activity_type text NOT NULL CHECK (activity_type IN ('fumigacion','fertilizacion','siembra')),
  field_context text CHECK (field_context IN ('growing_crop','stubble','fallow','pre_sowing','other')),
  crop_id uuid REFERENCES public.crops(id),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX recipes_enabled_name_unique ON public.recipes(company_id,lower(btrim(name))) WHERE enabled=true;
CREATE INDEX recipes_company_enabled_idx ON public.recipes(company_id,enabled);
CREATE INDEX recipes_company_crop_idx ON public.recipes(company_id,crop_id);
CREATE INDEX recipes_company_activity_idx ON public.recipes(company_id,activity_type);
CREATE TABLE public.recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  dose_amount numeric(20,6) NOT NULL CHECK (dose_amount>0 AND dose_amount<>'NaN'::numeric),
  dose_unit text NOT NULL CHECK (dose_unit IN ('L','mL','kg','g','unit','bag')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recipe_id,product_id)
);
CREATE INDEX recipe_items_product_idx ON public.recipe_items(product_id);
CREATE FUNCTION public.recipes_check_tenant() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'Recipe tenancy and creator are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.crop_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crops WHERE id=NEW.crop_id AND company_id=NEW.company_id) THEN
    RAISE EXCEPTION 'Recipe crop must belong to the same company' USING ERRCODE='23514';
  END IF;
  IF NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id) THEN
    RAISE EXCEPTION 'Recipe creator must belong to the same company' USING ERRCODE='23514';
  END IF;
  NEW.name=btrim(NEW.name); NEW.updated_at=now(); RETURN NEW;
END $$;
CREATE TRIGGER recipes_check_tenant BEFORE INSERT OR UPDATE ON public.recipes FOR EACH ROW EXECUTE FUNCTION public.recipes_check_tenant();
CREATE FUNCTION public.recipe_items_check_tenant() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE valid_product boolean; product_enabled boolean;
BEGIN
  SELECT true,p.enabled INTO valid_product,product_enabled FROM recipes r JOIN products p ON p.company_id=r.company_id
    WHERE r.id=NEW.recipe_id AND p.id=NEW.product_id;
  IF valid_product IS NOT TRUE THEN
    RAISE EXCEPTION 'Recipe product must belong to the same company' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.recipe_id IS DISTINCT FROM OLD.recipe_id THEN
    IF product_enabled IS NOT TRUE THEN RAISE EXCEPTION 'New recipe products must be enabled' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.updated_at=now(); RETURN NEW;
END $$;
CREATE TRIGGER recipe_items_check_tenant BEFORE INSERT OR UPDATE ON public.recipe_items FOR EACH ROW EXECUTE FUNCTION public.recipe_items_check_tenant();
CREATE FUNCTION public.recipes_require_items() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE recipe_uuid uuid;
BEGIN
  IF TG_TABLE_NAME='recipes' THEN recipe_uuid=NEW.id;
  ELSIF TG_OP='DELETE' THEN recipe_uuid=OLD.recipe_id;
  ELSE recipe_uuid=OLD.recipe_id; END IF;
  IF EXISTS(SELECT 1 FROM recipes WHERE id=recipe_uuid) AND NOT EXISTS(SELECT 1 FROM recipe_items WHERE recipe_id=recipe_uuid) THEN
    RAISE EXCEPTION 'A recipe must contain at least one product' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER recipes_require_items AFTER INSERT OR UPDATE ON public.recipes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.recipes_require_items();
CREATE CONSTRAINT TRIGGER recipe_items_require_items AFTER DELETE OR UPDATE ON public.recipe_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.recipes_require_items();
-- API uses the existing privileged SQL connection. No direct browser grants/policies.
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_items ENABLE ROW LEVEL SECURITY;
COMMIT;
