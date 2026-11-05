-- Historical execution evidence only. No backfill or changes to physical balances.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=public,pg_catalog;
CREATE TABLE economic_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 planning_id uuid NOT NULL REFERENCES planning(id) ON DELETE RESTRICT,
 manual_usage_id uuid CHECK (manual_usage_id IS NULL),
 phase text NOT NULL DEFAULT 'actual' CHECK (phase='actual'),
 revision integer NOT NULL CHECK (revision>0),
 supersedes_id uuid REFERENCES economic_snapshots(id),
 state text NOT NULL DEFAULT 'sealed' CHECK (state='sealed'),
 campaign_id uuid NOT NULL REFERENCES campaigns(id),
 effective_date date NOT NULL,
 activity_type_snapshot text NOT NULL,
 recipe_id uuid,
 recipe_name_snapshot text,
 labor_status text NOT NULL CHECK (labor_status IN ('pending','confirmed','not_applicable')),
 economic_status text NOT NULL CHECK (economic_status IN ('pending','partial','complete')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_txid bigint NOT NULL DEFAULT txid_current(),
 reason text CHECK (length(reason)<=2000),
 idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
 request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
 UNIQUE(company_id,id),
 UNIQUE(company_id,planning_id,revision),
 UNIQUE(company_id,idempotency_key),
 UNIQUE(supersedes_id),
 CHECK ((revision=1)=(supersedes_id IS NULL)),
 CHECK (revision=1 OR (reason IS NOT NULL AND length(btrim(reason))>0))
);
CREATE TABLE economic_snapshot_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 snapshot_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('product','labor')),
 planning_product_id uuid REFERENCES planning_products(id),
 usage_id uuid REFERENCES usage_records(id),
 stock_movement_id uuid REFERENCES stock_movements(id),
 product_id uuid REFERENCES products(id),
 batch_id uuid REFERENCES stock_batches(id),
 batch_valuation_id uuid REFERENCES stock_batch_valuations(id),
 product_name_snapshot text,
 unit_snapshot text,
 quantity numeric(20,6) CHECK (quantity>0 AND quantity<>'NaN'::numeric),
 documented_dose jsonb,
 unit_cost_original numeric(20,6) CHECK (unit_cost_original>=0 AND unit_cost_original<>'NaN'::numeric),
 currency text CHECK (currency IN ('USD','ARS')),
 unit_cost_usd numeric(20,6) CHECK (unit_cost_usd>=0 AND unit_cost_usd<>'NaN'::numeric),
 amount_usd numeric(40,12) CHECK (amount_usd>=0 AND amount_usd<>'NaN'::numeric),
 area_ha numeric(20,6) CHECK (area_ha>0 AND area_ha<>'NaN'::numeric),
 price_basis text CHECK (price_basis='per_ha'),
 rate_original numeric(20,6) CHECK (rate_original>=0 AND rate_original<>'NaN'::numeric),
 amount_original numeric(40,12) CHECK (amount_original>=0 AND amount_original<>'NaN'::numeric),
 payment_date date,
 fx_rate numeric(20,6) CHECK (fx_rate>0 AND fx_rate<>'NaN'::numeric),
 fx_date date,
 fx_type text CHECK (fx_type='divisa_mayorista'),
 fx_source text CHECK (length(fx_source)<=500),
 cost_status text NOT NULL CHECK (cost_status IN ('confirmed','pending')),
 provenance text NOT NULL,
 FOREIGN KEY(company_id,snapshot_id) REFERENCES economic_snapshots(company_id,id),
 UNIQUE(snapshot_id,stock_movement_id),
 CHECK ((cost_status='pending' AND amount_usd IS NULL) OR (cost_status='confirmed' AND amount_usd IS NOT NULL)),
 CHECK (kind<>'product' OR (stock_movement_id IS NOT NULL AND usage_id IS NOT NULL AND planning_product_id IS NOT NULL AND product_id IS NOT NULL AND batch_id IS NOT NULL AND quantity IS NOT NULL AND product_name_snapshot IS NOT NULL AND unit_snapshot IS NOT NULL)),
 CHECK (kind<>'labor' OR (stock_movement_id IS NULL AND usage_id IS NULL AND product_id IS NULL AND batch_id IS NULL AND batch_valuation_id IS NULL AND area_ha IS NOT NULL AND price_basis IS NOT NULL)),
 CHECK (kind<>'product' OR cost_status<>'confirmed' OR (batch_valuation_id IS NOT NULL AND currency='USD' AND unit_cost_usd IS NOT NULL AND amount_usd=quantity*unit_cost_usd)),
 CHECK (kind<>'labor' OR cost_status<>'confirmed' OR (rate_original IS NOT NULL AND currency IS NOT NULL AND amount_original IS NOT NULL AND amount_original=rate_original*area_ha)),
 CHECK (kind<>'labor' OR cost_status<>'confirmed' OR
   (currency='USD' AND amount_usd=amount_original AND fx_rate IS NULL AND fx_date IS NULL AND fx_type IS NULL AND fx_source IS NULL) OR
   (currency='ARS' AND payment_date IS NOT NULL AND fx_rate IS NOT NULL AND fx_date IS NOT NULL AND fx_date=payment_date AND fx_type IS NOT NULL AND fx_type='divisa_mayorista' AND fx_source IS NOT NULL AND length(btrim(fx_source))>0 AND amount_usd=round(amount_original/fx_rate,12)))
);
CREATE UNIQUE INDEX economic_one_labor ON economic_snapshot_lines(snapshot_id) WHERE kind='labor';
CREATE TABLE economic_snapshot_targets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 snapshot_id uuid NOT NULL,
 lot_id uuid NOT NULL REFERENCES lots(id),
 sub_lot_id uuid REFERENCES sub_lots(id),
 beneficiary_crop_id uuid NOT NULL REFERENCES crops(id),
 crop_assignment_id uuid REFERENCES crop_assignments(id),
 lot_name_snapshot text NOT NULL,
 sub_lot_name_snapshot text,
 crop_name_snapshot text NOT NULL,
 applied_area_ha numeric(20,6) NOT NULL CHECK (applied_area_ha>0 AND applied_area_ha<>'NaN'::numeric),
 allocation_method text NOT NULL CHECK (allocation_method='area_proportional'),
 allocation_weight numeric(20,12) NOT NULL CHECK (allocation_weight>=0 AND allocation_weight<=1),
 allocation_note text NOT NULL,
 FOREIGN KEY(company_id,snapshot_id) REFERENCES economic_snapshots(company_id,id)
);
CREATE UNIQUE INDEX economic_target_surface ON economic_snapshot_targets(snapshot_id,lot_id,COALESCE(sub_lot_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX economic_lines_usage ON economic_snapshot_lines(company_id,usage_id);
CREATE INDEX economic_lines_movement ON economic_snapshot_lines(stock_movement_id);

CREATE FUNCTION guard_economic_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE prev economic_snapshots%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Economic history is immutable' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM planning WHERE id=NEW.planning_id AND company_id=NEW.company_id AND campaign_id=NEW.campaign_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Planning/campaign tenant mismatch' USING ERRCODE='23503'; END IF;
 IF NEW.recipe_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM planning p WHERE p.id=NEW.planning_id AND p.company_id=NEW.company_id AND to_jsonb(p)->>'recipe_id'=NEW.recipe_id::text AND to_jsonb(p)->>'recipe_name_snapshot'=NEW.recipe_name_snapshot) THEN
   RAISE EXCEPTION 'Recipe evidence mismatch' USING ERRCODE='23503';
 END IF;
 PERFORM 1 FROM campaigns WHERE id=NEW.campaign_id AND company_id=NEW.company_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Campaign tenant mismatch' USING ERRCODE='23503'; END IF;
 PERFORM 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id AND enabled=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'Actor tenant mismatch' USING ERRCODE='23503'; END IF;
 SELECT * INTO prev FROM economic_snapshots WHERE company_id=NEW.company_id AND planning_id=NEW.planning_id ORDER BY revision DESC LIMIT 1;
 IF FOUND AND (NEW.supersedes_id IS DISTINCT FROM prev.id OR NEW.revision<>prev.revision+1) THEN
   RAISE EXCEPTION 'Stale economic revision' USING ERRCODE='23514';
 END IF;
 IF prev.id IS NULL AND (NEW.revision<>1 OR NEW.supersedes_id IS NOT NULL) THEN RAISE EXCEPTION 'Invalid first revision'; END IF;
 IF prev.id IS NOT NULL AND (NEW.campaign_id<>prev.campaign_id OR NEW.effective_date<>prev.effective_date OR NEW.activity_type_snapshot<>prev.activity_type_snapshot OR NEW.recipe_id IS DISTINCT FROM prev.recipe_id OR NEW.recipe_name_snapshot IS DISTINCT FROM prev.recipe_name_snapshot) THEN
   RAISE EXCEPTION 'Economic revision cannot change operational facts' USING ERRCODE='23514';
 END IF;
 NEW.created_txid=txid_current();
 RETURN NEW;
END $$;
CREATE TRIGGER economic_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON economic_snapshots FOR EACH ROW EXECUTE FUNCTION guard_economic_snapshot();
CREATE TRIGGER economic_snapshot_no_truncate BEFORE TRUNCATE ON economic_snapshots FOR EACH STATEMENT EXECUTE FUNCTION guard_economic_snapshot();

CREATE FUNCTION guard_economic_child() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE s economic_snapshots%ROWTYPE; m stock_movements%ROWTYPE; v stock_batch_valuations%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Economic history is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM economic_snapshots WHERE company_id=NEW.company_id AND id=NEW.snapshot_id;
 IF NOT FOUND OR s.created_txid<>txid_current() THEN RAISE EXCEPTION 'Snapshot is sealed' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='economic_snapshot_targets' THEN
   IF s.revision=1 AND NOT EXISTS(SELECT 1 FROM planning_lots pl WHERE pl.planning_id=s.planning_id AND pl.lot_id=NEW.lot_id AND pl.sub_lot_id IS NOT DISTINCT FROM NEW.sub_lot_id AND COALESCE(pl.effective_area_ha,pl.area_ha)=NEW.applied_area_ha) THEN
     RAISE EXCEPTION 'Target area must match operational evidence' USING ERRCODE='23514';
   END IF;
   PERFORM 1 FROM lots WHERE id=NEW.lot_id AND company_id=NEW.company_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Lot tenant mismatch' USING ERRCODE='23503'; END IF;
   IF NEW.sub_lot_id IS NOT NULL THEN
     PERFORM 1 FROM sub_lots WHERE id=NEW.sub_lot_id AND lot_id=NEW.lot_id AND company_id=NEW.company_id;
     IF NOT FOUND THEN RAISE EXCEPTION 'Sublot tenant mismatch' USING ERRCODE='23503'; END IF;
   END IF;
   PERFORM 1 FROM crops WHERE id=NEW.beneficiary_crop_id AND company_id=NEW.company_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Crop tenant mismatch' USING ERRCODE='23503'; END IF;
   IF NEW.crop_assignment_id IS NOT NULL THEN
     PERFORM 1 FROM crop_assignments WHERE id=NEW.crop_assignment_id AND company_id=NEW.company_id AND campaign_id=s.campaign_id AND crop_id=NEW.beneficiary_crop_id AND lot_id=NEW.lot_id AND sub_lot_id IS NOT DISTINCT FROM NEW.sub_lot_id;
     IF NOT FOUND THEN RAISE EXCEPTION 'Assignment context mismatch' USING ERRCODE='23503'; END IF;
   END IF;
 ELSIF NEW.kind='product' THEN
   SELECT * INTO m FROM stock_movements WHERE id=NEW.stock_movement_id AND company_id=NEW.company_id;
   IF NOT FOUND OR m.movement_type<>'consumption' OR m.product_id<>NEW.product_id OR m.batch_id<>NEW.batch_id OR m.usage_id IS DISTINCT FROM NEW.usage_id OR -m.quantity<>NEW.quantity OR m.unit<>NEW.unit_snapshot THEN RAISE EXCEPTION 'Movement facts mismatch' USING ERRCODE='23514'; END IF;
   PERFORM 1 FROM usage_records u JOIN planning_products pp ON pp.id=NEW.planning_product_id
     JOIN products p ON p.id=NEW.product_id AND p.company_id=NEW.company_id
     JOIN stock_batches b ON b.id=NEW.batch_id AND b.company_id=NEW.company_id AND b.product_id=NEW.product_id
     WHERE u.id=NEW.usage_id AND u.company_id=NEW.company_id AND u.source_planning_id=s.planning_id AND u.source_planning_product_id=NEW.planning_product_id AND pp.planning_id=s.planning_id AND pp.product_id=NEW.product_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Usage/product tenant mismatch' USING ERRCODE='23503'; END IF;
   IF NEW.batch_valuation_id IS NOT NULL THEN
     SELECT * INTO v FROM stock_batch_valuations WHERE id=NEW.batch_valuation_id AND company_id=NEW.company_id AND batch_id=NEW.batch_id;
     IF NOT FOUND THEN RAISE EXCEPTION 'Valuation tenant mismatch' USING ERRCODE='23503'; END IF;
     IF NEW.cost_status='confirmed' AND (v.status<>'confirmed' OR v.unit_cost_usd IS DISTINCT FROM NEW.unit_cost_usd OR v.currency IS DISTINCT FROM NEW.currency OR v.unit_cost_original IS DISTINCT FROM NEW.unit_cost_original) THEN RAISE EXCEPTION 'Valuation evidence mismatch' USING ERRCODE='23514'; END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER economic_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON economic_snapshot_lines FOR EACH ROW EXECUTE FUNCTION guard_economic_child();
CREATE TRIGGER economic_targets_guard BEFORE INSERT OR UPDATE OR DELETE ON economic_snapshot_targets FOR EACH ROW EXECUTE FUNCTION guard_economic_child();
CREATE TRIGGER economic_lines_no_truncate BEFORE TRUNCATE ON economic_snapshot_lines FOR EACH STATEMENT EXECUTE FUNCTION guard_economic_child();
CREATE TRIGGER economic_targets_no_truncate BEFORE TRUNCATE ON economic_snapshot_targets FOR EACH STATEMENT EXECUTE FUNCTION guard_economic_child();

CREATE FUNCTION validate_economic_seal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE labor_count integer; pending_count integer; known_count integer; expected text;
BEGIN
 IF (SELECT COALESCE(sum(allocation_weight),0) FROM economic_snapshot_targets WHERE snapshot_id=NEW.id)<>1 THEN
   RAISE EXCEPTION 'Economic target weights must sum to one' USING ERRCODE='23514';
 END IF;
 SELECT count(*) FILTER(WHERE kind='labor'),count(*) FILTER(WHERE cost_status='pending'),count(*) FILTER(WHERE cost_status='confirmed') INTO labor_count,pending_count,known_count FROM economic_snapshot_lines WHERE snapshot_id=NEW.id;
 IF (NEW.labor_status='not_applicable' AND labor_count<>0) OR (NEW.labor_status<>'not_applicable' AND labor_count<>1) THEN RAISE EXCEPTION 'Invalid labor evidence' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM economic_snapshot_lines WHERE snapshot_id=NEW.id AND kind='labor' AND cost_status<>NEW.labor_status) THEN RAISE EXCEPTION 'Labor status mismatch' USING ERRCODE='23514'; END IF;
 expected=CASE WHEN pending_count=0 THEN 'complete' WHEN known_count>0 THEN 'partial' ELSE 'pending' END;
 IF NEW.economic_status<>expected THEN RAISE EXCEPTION 'Economic status mismatch' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM economic_snapshot_lines WHERE snapshot_id=NEW.id AND kind='labor' AND area_ha<>(SELECT sum(applied_area_ha) FROM economic_snapshot_targets WHERE snapshot_id=NEW.id)) THEN RAISE EXCEPTION 'Labor area mismatch' USING ERRCODE='23514'; END IF;
 IF EXISTS(
   SELECT m.id FROM stock_movements m JOIN usage_records u ON u.id=m.usage_id AND u.company_id=m.company_id
   JOIN planning_product_completions pc ON pc.usage_id=u.id AND pc.planning_id=NEW.planning_id
   WHERE m.company_id=NEW.company_id AND u.source_planning_id=NEW.planning_id AND m.movement_type='consumption'
   EXCEPT SELECT stock_movement_id FROM economic_snapshot_lines WHERE snapshot_id=NEW.id AND kind='product'
 ) THEN RAISE EXCEPTION 'Economic snapshot lacks actual movements' USING ERRCODE='23514'; END IF;
 IF NEW.revision=1 AND EXISTS(
   SELECT pl.lot_id,pl.sub_lot_id FROM planning_lots pl WHERE pl.planning_id=NEW.planning_id
   EXCEPT SELECT t.lot_id,t.sub_lot_id FROM economic_snapshot_targets t WHERE t.snapshot_id=NEW.id
 ) THEN RAISE EXCEPTION 'Economic snapshot lacks operational targets' USING ERRCODE='23514'; END IF;
 IF NEW.supersedes_id IS NOT NULL THEN
   IF EXISTS(
     (SELECT to_jsonb(l)-ARRAY['id','snapshot_id','batch_valuation_id','unit_cost_original','currency','unit_cost_usd','amount_usd','cost_status','provenance'] FROM economic_snapshot_lines l WHERE snapshot_id=NEW.supersedes_id AND kind='product'
      EXCEPT SELECT to_jsonb(l)-ARRAY['id','snapshot_id','batch_valuation_id','unit_cost_original','currency','unit_cost_usd','amount_usd','cost_status','provenance'] FROM economic_snapshot_lines l WHERE snapshot_id=NEW.id AND kind='product')
     UNION ALL
     (SELECT to_jsonb(l)-ARRAY['id','snapshot_id','batch_valuation_id','unit_cost_original','currency','unit_cost_usd','amount_usd','cost_status','provenance'] FROM economic_snapshot_lines l WHERE snapshot_id=NEW.id AND kind='product'
      EXCEPT SELECT to_jsonb(l)-ARRAY['id','snapshot_id','batch_valuation_id','unit_cost_original','currency','unit_cost_usd','amount_usd','cost_status','provenance'] FROM economic_snapshot_lines l WHERE snapshot_id=NEW.supersedes_id AND kind='product')
   ) THEN RAISE EXCEPTION 'Economic revision cannot change product facts' USING ERRCODE='23514'; END IF;
   IF EXISTS(
     (SELECT to_jsonb(t)-'id'-'snapshot_id' FROM economic_snapshot_targets t WHERE snapshot_id=NEW.supersedes_id
      EXCEPT SELECT to_jsonb(t)-'id'-'snapshot_id' FROM economic_snapshot_targets t WHERE snapshot_id=NEW.id)
     UNION ALL
     (SELECT to_jsonb(t)-'id'-'snapshot_id' FROM economic_snapshot_targets t WHERE snapshot_id=NEW.id
      EXCEPT SELECT to_jsonb(t)-'id'-'snapshot_id' FROM economic_snapshot_targets t WHERE snapshot_id=NEW.supersedes_id)
   ) THEN RAISE EXCEPTION 'Economic revision cannot change targets' USING ERRCODE='23514'; END IF;
   IF EXISTS(
     SELECT to_jsonb(l)-'id'-'snapshot_id' FROM economic_snapshot_lines l WHERE snapshot_id=NEW.supersedes_id AND kind='product' AND cost_status='confirmed'
     EXCEPT SELECT to_jsonb(l)-'id'-'snapshot_id' FROM economic_snapshot_lines l WHERE snapshot_id=NEW.id AND kind='product'
   ) THEN RAISE EXCEPTION 'Confirmed product evidence must be preserved' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER economic_seal AFTER INSERT ON economic_snapshots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_economic_seal();

-- There is currently no integral Planning reversal. Reject partial physical reversal.
CREATE FUNCTION guard_economic_reversal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.movement_type='reversal' AND EXISTS(SELECT 1 FROM economic_snapshot_lines WHERE stock_movement_id=NEW.reversed_movement_id) THEN
   RAISE EXCEPTION 'El consumo tiene evidencia económica: requiere reversión integral de Planning.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER economic_reversal_guard BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION guard_economic_reversal();
ALTER TABLE economic_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE economic_snapshot_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE economic_snapshot_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON economic_snapshots,economic_snapshot_lines,economic_snapshot_targets FROM PUBLIC,anon,authenticated;
COMMIT;
