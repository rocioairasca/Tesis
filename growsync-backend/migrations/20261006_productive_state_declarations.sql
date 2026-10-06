-- Schema only. No company data, declarations or agronomic mutations.
BEGIN;
CREATE TABLE public.productive_state_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  lot_id uuid NOT NULL REFERENCES public.lots(id) ON DELETE RESTRICT,
  sub_lot_id uuid REFERENCES public.sub_lots(id) ON DELETE RESTRICT,
  layout_id uuid REFERENCES public.lot_layouts(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('growing_crop','stubble','fallow','unknown')),
  crop_id uuid REFERENCES public.crops(id) ON DELETE RESTRICT,
  observed_on date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (length(btrim(source)) BETWEEN 1 AND 200),
  evidence text NOT NULL CHECK (length(btrim(evidence)) BETWEEN 1 AND 4000),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 4000),
  supersedes_id uuid REFERENCES public.productive_state_declarations(id) ON DELETE RESTRICT,
  coverage jsonb NOT NULL,
  CHECK ((kind IN ('growing_crop','stubble') AND crop_id IS NOT NULL)
    OR (kind IN ('fallow','unknown') AND crop_id IS NULL)),
  CHECK (supersedes_id IS NULL OR supersedes_id<>id),
  CHECK (sub_lot_id IS NULL OR layout_id IS NOT NULL)
);
CREATE INDEX productive_declarations_unit_date ON public.productive_state_declarations
 (company_id,lot_id,sub_lot_id,observed_on DESC);
CREATE UNIQUE INDEX productive_declarations_one_successor ON public.productive_state_declarations(supersedes_id)
 WHERE supersedes_id IS NOT NULL;
ALTER TABLE public.productive_state_declarations ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.validate_productive_declaration() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE l public.lots; sl public.sub_lots; ll public.lot_layouts; prior public.productive_state_declarations;
  active_layout uuid; expected jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text||':'||NEW.lot_id::text,0));
  SELECT * INTO l FROM public.lots WHERE id=NEW.lot_id AND company_id=NEW.company_id AND enabled=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot/company unavailable' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.users WHERE id=NEW.actor_id AND company_id=NEW.company_id AND enabled=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Actor/company unavailable' USING ERRCODE='23514'; END IF;
  IF NEW.crop_id IS NOT NULL THEN
    PERFORM 1 FROM public.crops WHERE id=NEW.crop_id AND company_id=NEW.company_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Crop/company unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT id INTO active_layout FROM public.lot_layouts WHERE lot_id=l.id AND company_id=NEW.company_id AND status='active' FOR SHARE;
  IF NEW.layout_id IS DISTINCT FROM active_layout THEN RAISE EXCEPTION 'Current active layout required' USING ERRCODE='23514'; END IF;
  IF NEW.sub_lot_id IS NOT NULL THEN
    SELECT * INTO sl FROM public.sub_lots WHERE id=NEW.sub_lot_id AND lot_id=l.id AND company_id=NEW.company_id
      AND layout_id=NEW.layout_id AND enabled=true FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sublot/lot/layout/company mismatch' USING ERRCODE='23514'; END IF;
    expected=jsonb_build_object('lot_id',l.id,'sub_lot_id',sl.id,'layout_id',sl.layout_id,'geom',to_jsonb(sl)->'geom','area_ha',sl.area_ha);
  ELSE
    IF EXISTS (SELECT 1 FROM public.sub_lots WHERE layout_id=active_layout AND lot_id=l.id AND company_id=NEW.company_id AND enabled=true) THEN
      RAISE EXCEPTION 'Declare each active sublot separately' USING ERRCODE='23514';
    END IF;
    expected=jsonb_build_object('lot_id',l.id,'sub_lot_id',NULL,'layout_id',active_layout,'geom',to_jsonb(l)->'geom','area_ha',l.area_ha);
  END IF;
  IF NEW.coverage IS NOT NULL AND NEW.coverage<>expected THEN RAISE EXCEPTION 'Coverage changed' USING ERRCODE='23514'; END IF;
  NEW.coverage=expected;
  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT * INTO prior FROM public.productive_state_declarations WHERE id=NEW.supersedes_id FOR SHARE;
    IF NOT FOUND OR (prior.company_id,prior.lot_id,prior.sub_lot_id,prior.layout_id) IS DISTINCT FROM
      (NEW.company_id,NEW.lot_id,NEW.sub_lot_id,NEW.layout_id) OR prior.coverage<>expected OR NEW.observed_on<prior.observed_on THEN
      RAISE EXCEPTION 'Invalid supersession coverage/company/date' USING ERRCODE='23514';
    END IF;
    -- An existing immutable predecessor plus FK and self-check cannot form a future cycle.
    IF EXISTS (WITH RECURSIVE chain AS (SELECT id,supersedes_id FROM public.productive_state_declarations WHERE id=NEW.supersedes_id
      UNION SELECT p.id,p.supersedes_id FROM public.productive_state_declarations p JOIN chain c ON p.id=c.supersedes_id)
      SELECT 1 FROM chain WHERE id=NEW.id) THEN RAISE EXCEPTION 'Supersession cycle' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER productive_declaration_validate BEFORE INSERT ON public.productive_state_declarations
 FOR EACH ROW EXECUTE FUNCTION public.validate_productive_declaration();
CREATE FUNCTION public.protect_productive_declaration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Productive declarations are append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER productive_declaration_append_only BEFORE UPDATE OR DELETE ON public.productive_state_declarations
 FOR EACH ROW EXECUTE FUNCTION public.protect_productive_declaration();
CREATE TRIGGER productive_declaration_no_truncate BEFORE TRUNCATE ON public.productive_state_declarations
 FOR EACH STATEMENT EXECUTE FUNCTION public.protect_productive_declaration();
REVOKE UPDATE,DELETE,TRUNCATE ON public.productive_state_declarations FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
