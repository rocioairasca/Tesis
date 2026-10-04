-- Diagnostics only: no data changes and no relaxation of adoption comparisons.
-- Apply manually after review. Requires 20261004_adopt_existing_history.sql.
BEGIN;
CREATE OR REPLACE FUNCTION history_internal.adoption_diff(before_value jsonb,after_value jsonb,ignored text[] DEFAULT ARRAY[]::text[])
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE result jsonb='[]'; k text; b jsonb; a jsonb; child jsonb; i integer;
BEGIN
  IF before_value IS NOT DISTINCT FROM after_value THEN RETURN result; END IF;
  IF jsonb_typeof(before_value)='object' AND jsonb_typeof(after_value)='object' THEN
    FOR k IN SELECT jsonb_object_keys(before_value) UNION SELECT jsonb_object_keys(after_value) LOOP
      IF k=ANY(ignored) THEN CONTINUE; END IF;
      b=before_value->k; a=after_value->k;
      IF b IS DISTINCT FROM a THEN
        result=result||jsonb_build_array(jsonb_build_object('id',COALESCE(before_value->'id',after_value->'id'),
          'field',k,'before',b,'after',a,'before_present',before_value ? k,'after_present',after_value ? k));
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(before_value)='array' AND jsonb_typeof(after_value)='array' THEN
    FOR i IN 0..greatest(jsonb_array_length(before_value),jsonb_array_length(after_value))-1 LOOP
      FOR child IN SELECT value FROM jsonb_array_elements(history_internal.adoption_diff(before_value->i,after_value->i,ignored)) LOOP
        result=result||jsonb_build_array(child||jsonb_build_object('row_index',i));
      END LOOP;
    END LOOP;
  ELSE
    result=jsonb_build_array(jsonb_build_object('field',NULL,'before',before_value,'after',after_value));
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION history_internal.adoption_diff(jsonb,jsonb,text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.confirm_history_adoption(c uuid,a uuid,ids uuid[],idem text,confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE preview jsonb; before_stock jsonb; item jsonb; r jsonb; saved jsonb; t text;
  import_id uuid; old_import public.historical_imports; payload jsonb; adoption_result jsonb; digest text;
BEGIN
  PERFORM history_internal.authorize_adoption(c,a);
  IF confirmed IS DISTINCT FROM true OR idem IS NULL OR length(trim(idem)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Confirmación explícita y clave de idempotencia obligatorias.' USING ERRCODE='22023';
  END IF;
  -- Bounded administrative transaction: prevents graph/stock changes and phantom links
  -- while validating and comparing. No network/email calls take place under these locks.
  LOCK TABLE public.companies, public.users, public.planning, public.planning_lots,
    public.planning_products, public.usage_records, public.usage_lots, public.planning_product_completions,
    public.crop_assignments, public.harvest_records, public.harvest_crop_assignments, public.harvest_cycle_closures,
    public.products, public.lots, public.sub_lots, public.crops, public.campaigns, public.vehicles,
    public.stock_batches, public.stock_movements, public.historical_imports, public.notifications IN SHARE ROW EXCLUSIVE MODE;
  PERFORM history_internal.authorize_adoption(c,a);
  payload=jsonb_build_object('planning_ids',(SELECT jsonb_agg(x ORDER BY x) FROM unnest(ids) x),'confirmed_no_stock',true);
  digest=md5(payload::text);
  SELECT * INTO old_import FROM public.historical_imports WHERE company_id=c AND idempotency_key=idem;
  IF FOUND THEN
    IF old_import.source<>'adopt-existing' OR old_import.request_hash<>digest OR old_import.result IS NULL THEN
      RAISE EXCEPTION 'La clave ya corresponde a otra operación.' USING ERRCODE='P0001';
    END IF;
    RETURN old_import.result||jsonb_build_object('replayed',true);
  END IF;
  preview=public.prepare_history_adoption(c,a,ids);
  IF NOT (preview->>'can_confirm')::boolean THEN
    RETURN preview||jsonb_build_object('conflict',true);
  END IF;
  before_stock=history_internal.inventory_snapshot(c);
  INSERT INTO public.historical_imports(company_id,idempotency_key,request_hash,imported_by,source,payload)
    VALUES(c,idem,digest,a,'adopt-existing',payload) RETURNING id INTO import_id;
  FOR item IN SELECT value FROM jsonb_array_elements(preview->'items') LOOP
    FOREACH t IN ARRAY ARRAY['planning','usage_records','crop_assignments'] LOOP
      FOR r IN SELECT value FROM jsonb_array_elements(item->'graph'->t) LOOP
        INSERT INTO history_internal.adoption_permits VALUES(txid_current(),pg_backend_pid(),t,(r->>'id')::uuid,import_id);
        EXECUTE format('UPDATE public.%I SET inventory_impact_mode=''HISTORICAL_NO_STOCK'', historical_import_id=$1 WHERE id=$2 AND company_id=$3 RETURNING to_jsonb(%I.*)',t,t)
          INTO saved USING import_id,(r->>'id')::uuid,c;
        DELETE FROM history_internal.adoption_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND entity_table=t AND entity_id=(r->>'id')::uuid;
        IF saved IS NULL OR (saved-ARRAY['inventory_impact_mode','historical_import_id']) IS DISTINCT FROM (r-ARRAY['inventory_impact_mode','historical_import_id']) THEN
          RAISE EXCEPTION 'La base modificaría datos del antecedente. Operación cancelada.' USING ERRCODE='P0001',
      DETAIL=jsonb_build_object('kind','historical_adoption_diff','stage','update','table',t,
        'differences',history_internal.adoption_diff(r,saved,ARRAY['inventory_impact_mode','historical_import_id']))::text;
        END IF;
      END LOOP;
    END LOOP;
    -- Re-read after all triggers have fired, including AFTER triggers touching a parent.
    FOREACH t IN ARRAY ARRAY['planning','usage_records','crop_assignments'] LOOP
      FOR r IN SELECT value FROM jsonb_array_elements(item->'graph'->t) LOOP
        EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id=$1 AND company_id=$2',t)
          INTO saved USING (r->>'id')::uuid,c;
        IF saved IS NULL OR saved->>'inventory_impact_mode'<>'HISTORICAL_NO_STOCK'
          OR saved->>'historical_import_id' IS DISTINCT FROM import_id::text
          OR (saved-ARRAY['inventory_impact_mode','historical_import_id']) IS DISTINCT FROM (r-ARRAY['inventory_impact_mode','historical_import_id']) THEN
          RAISE EXCEPTION 'Un efecto secundario modificaría el antecedente. Operación cancelada.' USING ERRCODE='P0001',
      DETAIL=jsonb_build_object('kind','historical_adoption_diff','stage','after_triggers','table',t,
        'differences',history_internal.adoption_diff(r,saved,ARRAY['inventory_impact_mode','historical_import_id']))::text;
        END IF;
      END LOOP;
    END LOOP;
    -- Preserve junction rows exactly; refuse side effects from any installed triggers.
    FOREACH t IN ARRAY ARRAY['planning_lots','planning_products','planning_product_completions','usage_lots'] LOOP
      IF t='usage_lots' THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY usage_id,lot_id,sub_lot_id),'[]') INTO saved
          FROM public.usage_lots x WHERE usage_id IN (SELECT (v->>'id')::uuid FROM jsonb_array_elements(item->'graph'->'usage_records') v);
      ELSE
        EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY %s),''[]'') FROM public.%I x WHERE planning_id=$1',
          CASE t WHEN 'planning_lots' THEN 'lot_id,sub_lot_id' WHEN 'planning_products' THEN 'id' ELSE 'planning_product_id' END,t)
          INTO saved USING (item->>'planning_id')::uuid;
      END IF;
      IF saved IS DISTINCT FROM item->'graph'->t THEN
        RAISE EXCEPTION 'Una relación cambiaría durante la adopción. Operación cancelada.' USING ERRCODE='P0001',
      DETAIL=jsonb_build_object('kind','historical_adoption_diff','stage','relations','table',t,
        'differences',history_internal.adoption_diff(item->'graph'->t,saved,ARRAY[]::text[]))::text;
      END IF;
    END LOOP;
    INSERT INTO public.historical_events(company_id,actor_id,entity_table,entity_id,before_data,after_data)
      VALUES(c,a,'planning',(item->>'planning_id')::uuid,item->'graph',jsonb_build_object(
        'operation','adopt-existing','planning_id',item->>'planning_id','previous_mode','NORMAL','inventory_impact_mode','HISTORICAL_NO_STOCK',
        'converted_relations',jsonb_build_object('planning',jsonb_build_array(item->>'planning_id'),
          'usage_records',(SELECT COALESCE(jsonb_agg(x->'id'),'[]') FROM jsonb_array_elements(item->'graph'->'usage_records') x),
          'crop_assignments',(SELECT COALESCE(jsonb_agg(x->'id'),'[]') FROM jsonb_array_elements(item->'graph'->'crop_assignments') x)),
        'historical_import_id',import_id,'inventory_control_start_date',preview->'inventory_control_start_date','confirmed_no_stock',true));
  END LOOP;
  IF before_stock IS DISTINCT FROM history_internal.inventory_snapshot(c) THEN
    RAISE EXCEPTION 'El inventario cambió. Adopción cancelada.' USING ERRCODE='P0001',
      DETAIL=jsonb_build_object('kind','historical_adoption_diff','stage','inventory','table','inventory_snapshot',
        'differences',history_internal.adoption_diff(before_stock,history_internal.inventory_snapshot(c),ARRAY[]::text[]))::text;
  END IF;
  adoption_result=jsonb_build_object('persisted',true,'import_id',import_id,'planning_ids',payload->'planning_ids',
    'inventory_impact_mode','HISTORICAL_NO_STOCK','stock_unchanged',true,'stock_movements_created',0);
  UPDATE public.historical_imports SET result=adoption_result WHERE id=import_id;
  RETURN adoption_result;
END $$;
COMMIT;
