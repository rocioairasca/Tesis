-- Preserve the original timestamp only for the privately authorized adoption.
-- No existing records are updated. Apply manually after review.
BEGIN;
CREATE OR REPLACE FUNCTION public.planning_set_updated_at() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.inventory_impact_mode='NORMAL' AND OLD.historical_import_id IS NULL
    AND NEW.inventory_impact_mode='HISTORICAL_NO_STOCK' AND NEW.historical_import_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM history_internal.adoption_permits a
      WHERE a.transaction_id=txid_current() AND a.backend_pid=pg_backend_pid()
        AND a.entity_table=TG_TABLE_NAME AND a.entity_id=OLD.id AND a.import_id=NEW.historical_import_id) THEN
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.planning_set_updated_at() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;