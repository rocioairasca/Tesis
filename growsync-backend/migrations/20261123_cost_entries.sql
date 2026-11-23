-- FIN-01C: additional costs that do NOT come from Planning (seed, contractors, fuel, rent, freight, drying, other).
-- Additive and append-only. Requires companies, users, campaigns, lots, sub_lots and crops. No backfill.
-- Not executed anywhere: apply through the normal migration review. Planning snapshots are never copied here.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=public,pg_catalog;

CREATE TABLE cost_entries (
 id uuid PRIMARY KEY,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
 root_id uuid NOT NULL,                                   -- id of revision 1: groups every revision of one expense
 revision integer NOT NULL CHECK (revision>0),
 supersedes_id uuid REFERENCES cost_entries(id) ON DELETE RESTRICT,
 state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','void')),   -- void = explicit economic reversal
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
 category text NOT NULL CHECK (category IN ('seed','contractor','labor','fuel_machinery','rent','freight','drying','other')),
 description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
 expense_date date NOT NULL,
 currency text NOT NULL CHECK (currency IN ('USD','ARS')),
 amount_original numeric(20,6) NOT NULL CHECK (amount_original>=0 AND amount_original<>'NaN'::numeric),
 amount_usd numeric(40,12) CHECK (amount_usd>=0 AND amount_usd<>'NaN'::numeric),     -- NULL = pending, never zero
 cost_status text NOT NULL CHECK (cost_status IN ('confirmed','pending')),
 payment_date date,
 fx_rate numeric(20,6) CHECK (fx_rate>0 AND fx_rate<>'NaN'::numeric),
 fx_date date,
 fx_type text CHECK (fx_type='divisa_mayorista'),
 fx_source text CHECK (length(fx_source)<=500),
 supplier_name text CHECK (length(supplier_name)<=500),
 reference text CHECK (length(reference)<=500),
 notes text CHECK (length(notes)<=2000),
 reason text CHECK (length(reason)<=2000),
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 created_txid bigint NOT NULL DEFAULT txid_current(),
 idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
 request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
 UNIQUE(company_id,id),
 UNIQUE(company_id,root_id,revision),
 UNIQUE(company_id,idempotency_key),
 UNIQUE(supersedes_id),
 CHECK ((revision=1)=(supersedes_id IS NULL)),
 CHECK ((revision=1)=(root_id=id)),
 CHECK (revision=1 OR (reason IS NOT NULL AND length(btrim(reason))>0)),
 CHECK (state='active' OR (reason IS NOT NULL AND length(btrim(reason))>0)),
 CONSTRAINT cost_entry_confirmation CHECK (
   (cost_status='pending' AND amount_usd IS NULL)
   OR (cost_status='confirmed' AND amount_usd IS NOT NULL AND (
        (currency='USD' AND amount_usd=amount_original AND fx_rate IS NULL AND fx_date IS NULL AND fx_type IS NULL AND fx_source IS NULL)
     OR (currency='ARS' AND payment_date IS NOT NULL AND fx_rate IS NOT NULL AND fx_date IS NOT NULL AND fx_date=payment_date
         AND fx_type IS NOT NULL AND fx_source IS NOT NULL AND length(btrim(fx_source))>0
         -- one single rounding at storage scale 12: |usd - original/fx| <= 0.5e-12
         AND abs(amount_usd*fx_rate-amount_original)<=fx_rate*0.0000000000005))))
);
CREATE INDEX cost_entries_company_campaign ON cost_entries(company_id,campaign_id);

CREATE TABLE cost_entry_targets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 cost_entry_id uuid NOT NULL,
 lot_id uuid NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
 sub_lot_id uuid REFERENCES sub_lots(id) ON DELETE RESTRICT,
 beneficiary_crop_id uuid NOT NULL REFERENCES crops(id) ON DELETE RESTRICT,
 lot_name_snapshot text NOT NULL,
 sub_lot_name_snapshot text,
 crop_name_snapshot text NOT NULL,
 reference_area_ha numeric(20,6) NOT NULL CHECK (reference_area_ha>0 AND reference_area_ha<>'NaN'::numeric),  -- area when assigned
 allocation_method text NOT NULL CHECK (allocation_method IN ('area_proportional','manual_percent')),
 allocation_weight numeric(20,12) NOT NULL CHECK (allocation_weight>=0 AND allocation_weight<=1),
 FOREIGN KEY(company_id,cost_entry_id) REFERENCES cost_entries(company_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX cost_entry_target_surface ON cost_entry_targets(cost_entry_id,lot_id,COALESCE(sub_lot_id,'00000000-0000-0000-0000-000000000000'::uuid),beneficiary_crop_id);
-- Aggregator access paths: by lot/crop for "Resultados por lote" and by entry for the detail.
CREATE INDEX cost_entry_targets_lot_crop ON cost_entry_targets(company_id,lot_id,beneficiary_crop_id);

CREATE FUNCTION guard_cost_entry() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE prev cost_entries%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Cost history is immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cost_entry:'||NEW.company_id::text||':'||NEW.root_id::text,0));
 PERFORM 1 FROM campaigns WHERE id=NEW.campaign_id AND company_id=NEW.company_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Campaign tenant mismatch' USING ERRCODE='23503'; END IF;
 PERFORM 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id AND enabled=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'Actor tenant mismatch' USING ERRCODE='23503'; END IF;
 SELECT * INTO prev FROM cost_entries WHERE company_id=NEW.company_id AND root_id=NEW.root_id ORDER BY revision DESC LIMIT 1;
 IF FOUND THEN
   IF NEW.supersedes_id IS DISTINCT FROM prev.id OR NEW.revision<>prev.revision+1 THEN RAISE EXCEPTION 'Stale cost revision' USING ERRCODE='23514'; END IF;
   IF prev.state='void' THEN RAISE EXCEPTION 'A voided cost cannot be revised' USING ERRCODE='23514'; END IF;
 ELSIF NEW.revision<>1 OR NEW.supersedes_id IS NOT NULL OR NEW.root_id<>NEW.id THEN
   RAISE EXCEPTION 'Invalid first revision' USING ERRCODE='23514';
 END IF;
 NEW.created_txid=txid_current();
 RETURN NEW;
END $$;
CREATE TRIGGER cost_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON cost_entries FOR EACH ROW EXECUTE FUNCTION guard_cost_entry();
CREATE TRIGGER cost_entry_no_truncate BEFORE TRUNCATE ON cost_entries FOR EACH STATEMENT EXECUTE FUNCTION guard_cost_entry();

CREATE FUNCTION guard_cost_entry_target() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e cost_entries%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Cost history is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO e FROM cost_entries WHERE company_id=NEW.company_id AND id=NEW.cost_entry_id;
 IF NOT FOUND OR e.created_txid<>txid_current() THEN RAISE EXCEPTION 'Cost entry is sealed' USING ERRCODE='23514'; END IF;
 IF e.state<>'active' THEN RAISE EXCEPTION 'A voided cost has no targets' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM lots WHERE id=NEW.lot_id AND company_id=NEW.company_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lot tenant mismatch' USING ERRCODE='23503'; END IF;
 IF NEW.sub_lot_id IS NOT NULL THEN
   PERFORM 1 FROM sub_lots WHERE id=NEW.sub_lot_id AND lot_id=NEW.lot_id AND company_id=NEW.company_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Sublot tenant mismatch' USING ERRCODE='23503'; END IF;
 END IF;
 PERFORM 1 FROM crops WHERE id=NEW.beneficiary_crop_id AND company_id=NEW.company_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Crop tenant mismatch' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cost_entry_target_guard BEFORE INSERT OR UPDATE OR DELETE ON cost_entry_targets FOR EACH ROW EXECUTE FUNCTION guard_cost_entry_target();
CREATE TRIGGER cost_entry_target_no_truncate BEFORE TRUNCATE ON cost_entry_targets FOR EACH STATEMENT EXECUTE FUNCTION guard_cost_entry_target();

-- Checked at COMMIT: an active cost has explicit targets whose weights sum EXACTLY to one with a single method.
CREATE FUNCTION validate_cost_entry_seal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE n integer; total numeric; methods integer;
BEGIN
 SELECT count(*),COALESCE(sum(allocation_weight),0),count(DISTINCT allocation_method) INTO n,total,methods FROM cost_entry_targets WHERE cost_entry_id=NEW.id;
 IF NEW.state='void' THEN
   IF n<>0 THEN RAISE EXCEPTION 'A voided cost has no targets' USING ERRCODE='23514'; END IF;
 ELSE
   IF n=0 THEN RAISE EXCEPTION 'A cost needs at least one target' USING ERRCODE='23514'; END IF;
   IF total<>1 THEN RAISE EXCEPTION 'Cost target weights must sum to one' USING ERRCODE='23514'; END IF;
   IF methods<>1 THEN RAISE EXCEPTION 'A cost uses a single allocation method' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER cost_entry_seal AFTER INSERT ON cost_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_cost_entry_seal();

ALTER TABLE cost_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_entry_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cost_entries,cost_entry_targets FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE cost_entries IS 'Additional costs outside Planning. Append-only revisions (root_id/revision/supersedes_id); current = no successor; state=void is the explicit reversal.';
COMMIT;
