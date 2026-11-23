-- FIN-01C: explicit, auditable declaration that the costs of ONE lot/sublot + campaign + crop were reviewed and are complete.
-- Append-only (never a mutable boolean on the result). A declaration is valid only while its evidence fingerprint matches
-- the current economic evidence; adding or revising a cost invalidates it by inserting a new `open` revision.
-- Not executed anywhere: apply through the normal migration review. Requires companies, users, campaigns, lots, sub_lots, crops.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=public,pg_catalog;

CREATE TABLE economic_completeness_declarations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
 lot_id uuid NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
 sub_lot_id uuid REFERENCES sub_lots(id) ON DELETE RESTRICT,
 crop_id uuid NOT NULL REFERENCES crops(id) ON DELETE RESTRICT,
 state text NOT NULL CHECK (state IN ('open','complete')),
 revision integer NOT NULL CHECK (revision>0),
 supersedes_id uuid REFERENCES economic_completeness_declarations(id) ON DELETE RESTRICT,
 reason text CHECK (length(reason)<=2000),
 observation text CHECK (length(observation)<=2000),
 auto_invalidated boolean NOT NULL DEFAULT false,           -- true when a new/revised cost reopened it
 evidence_fingerprint text CHECK (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
 known_total_usd numeric(40,12) CHECK (known_total_usd>=0),
 planning_snapshots integer CHECK (planning_snapshots>=0),
 cost_entries integer CHECK (cost_entries>=0),
 declared_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 declared_at timestamptz NOT NULL DEFAULT now(),
 created_txid bigint NOT NULL DEFAULT txid_current(),
 idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
 request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
 UNIQUE(company_id,idempotency_key,id),
 UNIQUE(supersedes_id),
 CHECK ((revision=1)=(supersedes_id IS NULL)),
 CHECK (state<>'complete' OR (evidence_fingerprint IS NOT NULL AND known_total_usd IS NOT NULL AND planning_snapshots IS NOT NULL AND cost_entries IS NOT NULL)),
 CHECK (state<>'open' OR revision=1 OR (reason IS NOT NULL AND length(btrim(reason))>0))      -- every reopening has a reason
);
CREATE UNIQUE INDEX economic_completeness_key_revision ON economic_completeness_declarations(
  company_id,campaign_id,lot_id,COALESCE(sub_lot_id,'00000000-0000-0000-0000-000000000000'::uuid),crop_id,revision);
-- One logical write = one idempotency key, but a multi-key declaration inserts several rows: key + target is unique.
CREATE UNIQUE INDEX economic_completeness_idempotency ON economic_completeness_declarations(
  company_id,idempotency_key,campaign_id,lot_id,COALESCE(sub_lot_id,'00000000-0000-0000-0000-000000000000'::uuid),crop_id);
-- Aggregator access path: current declarations of a campaign.
CREATE INDEX economic_completeness_campaign ON economic_completeness_declarations(company_id,campaign_id);

CREATE FUNCTION guard_economic_completeness() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE prev economic_completeness_declarations%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Completeness history is immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('completeness:'||NEW.company_id::text||':'||NEW.campaign_id::text||':'||NEW.lot_id::text||':'||COALESCE(NEW.sub_lot_id::text,'')||':'||NEW.crop_id::text,0));
 PERFORM 1 FROM campaigns WHERE id=NEW.campaign_id AND company_id=NEW.company_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Campaign tenant mismatch' USING ERRCODE='23503'; END IF;
 PERFORM 1 FROM lots WHERE id=NEW.lot_id AND company_id=NEW.company_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lot tenant mismatch' USING ERRCODE='23503'; END IF;
 IF NEW.sub_lot_id IS NOT NULL THEN
   PERFORM 1 FROM sub_lots WHERE id=NEW.sub_lot_id AND lot_id=NEW.lot_id AND company_id=NEW.company_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Sublot tenant mismatch' USING ERRCODE='23503'; END IF;
 END IF;
 PERFORM 1 FROM crops WHERE id=NEW.crop_id AND company_id=NEW.company_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Crop tenant mismatch' USING ERRCODE='23503'; END IF;
 PERFORM 1 FROM users WHERE id=NEW.declared_by AND company_id=NEW.company_id AND enabled=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'Actor tenant mismatch' USING ERRCODE='23503'; END IF;
 SELECT * INTO prev FROM economic_completeness_declarations
   WHERE company_id=NEW.company_id AND campaign_id=NEW.campaign_id AND lot_id=NEW.lot_id AND sub_lot_id IS NOT DISTINCT FROM NEW.sub_lot_id AND crop_id=NEW.crop_id
   ORDER BY revision DESC LIMIT 1;
 IF FOUND THEN
   IF NEW.supersedes_id IS DISTINCT FROM prev.id OR NEW.revision<>prev.revision+1 THEN RAISE EXCEPTION 'Stale completeness revision' USING ERRCODE='23514'; END IF;
 ELSIF NEW.revision<>1 OR NEW.supersedes_id IS NOT NULL THEN
   RAISE EXCEPTION 'Invalid first revision' USING ERRCODE='23514';
 END IF;
 NEW.created_txid=txid_current();
 RETURN NEW;
END $$;
CREATE TRIGGER economic_completeness_guard BEFORE INSERT OR UPDATE OR DELETE ON economic_completeness_declarations FOR EACH ROW EXECUTE FUNCTION guard_economic_completeness();
CREATE TRIGGER economic_completeness_no_truncate BEFORE TRUNCATE ON economic_completeness_declarations FOR EACH STATEMENT EXECUTE FUNCTION guard_economic_completeness();

ALTER TABLE economic_completeness_declarations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON economic_completeness_declarations FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE economic_completeness_declarations IS 'Append-only completeness declarations per lot/sublot + campaign + crop. Current = highest revision; valid only while evidence_fingerprint matches current evidence.';
COMMIT;
