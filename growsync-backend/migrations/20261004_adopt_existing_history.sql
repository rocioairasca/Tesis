-- Explicit legacy adoption only. Apply manually after review; never reclassifies rows on install.
BEGIN;
CREATE SCHEMA IF NOT EXISTS history_internal;
REVOKE ALL ON SCHEMA history_internal FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE history_internal.adoption_permits (
  transaction_id bigint NOT NULL, backend_pid integer NOT NULL,
  entity_table text NOT NULL, entity_id uuid NOT NULL, import_id uuid NOT NULL,
  PRIMARY KEY(transaction_id,backend_pid,entity_table,entity_id)
);
REVOKE ALL ON history_internal.adoption_permits FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.protect_inventory_impact_mode() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.inventory_impact_mode='NORMAL' AND OLD.historical_import_id IS NULL
    AND NEW.inventory_impact_mode='HISTORICAL_NO_STOCK' AND NEW.historical_import_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM history_internal.adoption_permits a
      WHERE a.transaction_id=txid_current() AND a.backend_pid=pg_backend_pid()
        AND a.entity_table=TG_TABLE_NAME AND a.entity_id=OLD.id AND a.import_id=NEW.historical_import_id) THEN
    -- Preserve technical timestamps too, including the existing cycle touch trigger.
    IF TG_TABLE_NAME IN ('planning','crop_assignments','harvest_records') THEN NEW.updated_at=OLD.updated_at; END IF;
    -- Generated date_range is computed after BEFORE triggers; confirm compares the stored value.
    IF (to_jsonb(NEW)-ARRAY['inventory_impact_mode','historical_import_id','date_range']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['inventory_impact_mode','historical_import_id','date_range']) THEN
      RAISE EXCEPTION 'Adoption cannot change productive data' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='crop_assignments' AND OLD.inventory_impact_mode='HISTORICAL_NO_STOCK' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Historical productive cycles cannot be recalculated' USING ERRCODE='23514';
  END IF;
  IF NEW.inventory_impact_mode IS DISTINCT FROM OLD.inventory_impact_mode OR NEW.historical_import_id IS DISTINCT FROM OLD.historical_import_id THEN
    RAISE EXCEPTION 'Inventory impact mode and import provenance are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION history_internal.authorize_adoption(c uuid, a uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE u public.users; permissions jsonb;
BEGIN
  SELECT * INTO u FROM public.users WHERE id=a AND company_id=c AND enabled=true;
  permissions=COALESCE(u.custom_permissions,CASE WHEN u.role=3 THEN '["all"]'::jsonb ELSE '[]'::jsonb END);
  IF u.id IS NULL OR u.role IS DISTINCT FROM 3 OR NOT
    (permissions ? 'all' OR (permissions ? 'history.import' AND permissions ? 'planning.edit')) THEN
    RAISE EXCEPTION 'Se requiere Admin con permisos de planificación e históricos.' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION public.prepare_history_adoption(c uuid,a uuid,ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE cutoff date; pid uuid; p public.planning; d date; graph jsonb; blocks jsonb;
  items jsonb='[]'; t text; r jsonb; mapping jsonb; field text; target text; ref jsonb;
  pp public.planning_products; u public.usage_records; pc public.planning_product_completions;
  valid boolean=true; relation_bad boolean; usage_ids uuid[]; pp_ids uuid[]; cycle_ids uuid[];
BEGIN
  PERFORM history_internal.authorize_adoption(c,a);
  IF ids IS NULL OR cardinality(ids)<1 OR cardinality(ids)>50 OR array_position(ids,NULL) IS NOT NULL
    OR cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) THEN
    RAISE EXCEPTION 'Seleccioná entre 1 y 50 planificaciones distintas.' USING ERRCODE='22023';
  END IF;
  SELECT inventory_control_start_date INTO cutoff FROM public.companies WHERE id=c;
  FOREACH pid IN ARRAY ids LOOP
    blocks='[]'; relation_bad=false;
    SELECT * INTO p FROM public.planning WHERE id=pid AND company_id=c;
    IF NOT FOUND THEN
      items=items||jsonb_build_array(jsonb_build_object('planning_id',pid,'blockers',jsonb_build_array('Registro inexistente o de otra empresa.'),'graph',NULL));
      valid=false; CONTINUE;
    END IF;
    d=COALESCE(p.effective_date,(p.end_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
    IF cutoff IS NULL THEN blocks=blocks||jsonb_build_array('Configurá primero el inicio del control de inventario.'); END IF;
    IF d IS NULL OR d>=cutoff THEN blocks=blocks||jsonb_build_array('La fecha debe ser anterior al inicio del inventario.'); END IF;
    IF p.status<>'completado' THEN blocks=blocks||jsonb_build_array('La planificación debe estar completada.'); END IF;
    IF p.inventory_impact_mode<>'NORMAL' OR p.historical_import_id IS NOT NULL THEN blocks=blocks||jsonb_build_array('El registro ya es histórico o pertenece a una importación.'); END IF;
    IF p.activity_type NOT IN ('siembra','fumigacion','fertilizacion') THEN blocks=blocks||jsonb_build_array('Este tipo de actividad requiere revisión histórica específica.'); END IF;
    SELECT COALESCE(array_agg(id),'{}') INTO pp_ids FROM public.planning_products WHERE planning_id=pid;
    SELECT COALESCE(array_agg(id),'{}') INTO usage_ids FROM public.usage_records
      WHERE source_planning_id=pid OR source_planning_product_id=ANY(pp_ids)
        OR id IN (SELECT usage_id FROM public.planning_product_completions WHERE planning_id=pid OR planning_product_id=ANY(pp_ids));
    SELECT COALESCE(array_agg(id),'{}') INTO cycle_ids FROM public.crop_assignments WHERE source_planning_id=pid;
    graph=jsonb_build_object('planning',jsonb_build_array(to_jsonb(p)),
      'planning_lots',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY lot_id,sub_lot_id),'[]') FROM public.planning_lots x WHERE planning_id=pid),
      'planning_products',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.planning_products x WHERE planning_id=pid),
      'usage_records',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.usage_records x WHERE id=ANY(usage_ids)),
      'usage_lots',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY usage_id,lot_id,sub_lot_id),'[]') FROM public.usage_lots x WHERE usage_id=ANY(usage_ids)),
      'planning_product_completions',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY planning_product_id),'[]') FROM public.planning_product_completions x WHERE planning_id=pid OR planning_product_id=ANY(pp_ids) OR usage_id=ANY(usage_ids)),
      'crop_assignments',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.crop_assignments x WHERE id=ANY(cycle_ids)));
    -- Validate every tenant-bearing reference, not just the root Planning.
    FOR t,mapping IN SELECT * FROM jsonb_each('{
      "planning":{"responsible_user":"users","created_by":"users","vehicle_id":"vehicles","crop_id":"crops","campaign_id":"campaigns"},
      "planning_lots":{"lot_id":"lots","sub_lot_id":"sub_lots"},
      "planning_products":{"product_id":"products"},
      "usage_records":{"product_id":"products","user_id":"users","created_by":"users","crop_id":"crops"},
      "usage_lots":{"lot_id":"lots","sub_lot_id":"sub_lots"},
      "crop_assignments":{"lot_id":"lots","sub_lot_id":"sub_lots","crop_id":"crops","campaign_id":"campaigns"}
    }'::jsonb) LOOP
      FOR r IN SELECT value FROM jsonb_array_elements(graph->t) LOOP
        IF r ? 'company_id' AND (r->>'company_id') IS DISTINCT FROM c::text THEN relation_bad=true; END IF;
        FOR field,target IN SELECT * FROM jsonb_each_text(mapping) LOOP
          IF r->>field IS NOT NULL THEN
            EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id=$1 AND company_id=$2',target) INTO ref USING (r->>field)::uuid,c;
            IF ref IS NULL THEN relation_bad=true;
            ELSIF field='sub_lot_id' AND ref->>'lot_id' IS DISTINCT FROM r->>'lot_id' THEN relation_bad=true;
            ELSIF field='product_id' AND (r->>'unit' IS NULL OR
              COALESCE('{"litros":"L","litro":"L","lt":"L","l":"L","kilos":"kg","kilo":"kg","bolsas":"bag","bolsa":"bag","unidades":"unit","unidad":"unit"}'::jsonb->>trim(r->>'unit'),trim(r->>'unit')) IS DISTINCT FROM
              COALESCE('{"litros":"L","litro":"L","lt":"L","l":"L","kilos":"kg","kilo":"kg","bolsas":"bag","bolsa":"bag","unidades":"unit","unidad":"unit"}'::jsonb->>trim(ref->>'unit'),trim(ref->>'unit'))) THEN relation_bad=true;
            END IF;
          ELSIF field='product_id' THEN relation_bad=true;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
    IF EXISTS(SELECT 1 FROM public.planning_products WHERE planning_id=pid AND (amount IS NULL OR amount<0 OR amount='NaN'::numeric))
      OR EXISTS(SELECT 1 FROM public.planning_lots WHERE planning_id=pid AND (area_ha<0 OR area_ha='NaN'::numeric)) THEN relation_bad=true; END IF;
    FOR u IN SELECT * FROM public.usage_records WHERE id=ANY(usage_ids) LOOP
      IF u.source_planning_id IS DISTINCT FROM pid OR u.inventory_impact_mode<>'NORMAL' OR u.historical_import_id IS NOT NULL
        OR u.date>=cutoff OR u.amount_used IS NULL OR u.amount_used<=0 OR u.amount_used='NaN'::numeric THEN relation_bad=true; END IF;
      IF u.source_planning_product_id IS NOT NULL THEN
        SELECT * INTO pp FROM public.planning_products WHERE id=u.source_planning_product_id;
        IF pp.planning_id IS DISTINCT FROM pid OR pp.product_id IS DISTINCT FROM u.product_id THEN relation_bad=true; END IF;
      END IF;
      IF EXISTS(SELECT 1 FROM public.usage_lots ul WHERE ul.usage_id=u.id AND NOT EXISTS
        (SELECT 1 FROM public.planning_lots pl WHERE pl.planning_id=pid AND pl.lot_id=ul.lot_id AND pl.sub_lot_id IS NOT DISTINCT FROM ul.sub_lot_id)) THEN relation_bad=true; END IF;
    END LOOP;
    FOR pc IN SELECT * FROM public.planning_product_completions WHERE planning_id=pid OR planning_product_id=ANY(pp_ids) OR usage_id=ANY(usage_ids) LOOP
      SELECT * INTO pp FROM public.planning_products WHERE id=pc.planning_product_id;
      IF pc.planning_id IS DISTINCT FROM pid OR pp.planning_id IS DISTINCT FROM pid OR pc.actual_amount<0 OR pc.actual_amount='NaN'::numeric THEN relation_bad=true; END IF;
      IF pc.usage_id IS NOT NULL THEN
        SELECT * INTO u FROM public.usage_records WHERE id=pc.usage_id;
        IF u.source_planning_id IS DISTINCT FROM pid OR u.source_planning_product_id IS DISTINCT FROM pp.id
          OR u.product_id IS DISTINCT FROM pp.product_id OR u.amount_used IS DISTINCT FROM pc.actual_amount THEN relation_bad=true; END IF;
      END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM public.crop_assignments ca WHERE id=ANY(cycle_ids) AND
      (inventory_impact_mode<>'NORMAL' OR historical_import_id IS NOT NULL OR start_date>=cutoff
       OR p.activity_type<>'siembra' OR ca.crop_id IS DISTINCT FROM p.crop_id OR ca.campaign_id IS DISTINCT FROM p.campaign_id
       OR NOT EXISTS(SELECT 1 FROM public.planning_lots pl WHERE pl.planning_id=pid AND pl.lot_id=ca.lot_id AND pl.sub_lot_id IS NOT DISTINCT FROM ca.sub_lot_id))) THEN relation_bad=true; END IF;
    IF EXISTS(SELECT 1 FROM public.harvest_crop_assignments WHERE crop_assignment_id=ANY(cycle_ids))
      OR EXISTS(SELECT 1 FROM public.harvest_cycle_closures WHERE crop_assignment_id=ANY(cycle_ids)) THEN
      blocks=blocks||jsonb_build_array('Tiene cosechas o cierres de ciclo vinculados; requiere revisión histórica integral.');
    END IF;
    IF EXISTS(SELECT 1 FROM public.stock_movements WHERE usage_id=ANY(usage_ids)
      OR operation_id=pid OR idempotency_key IN (SELECT 'planning-product:'||x::text FROM unnest(pp_ids) x)) THEN
      blocks=blocks||jsonb_build_array('Tiene movimientos de inventario vinculados. No se puede adoptar.');
    END IF;
    IF relation_bad THEN
      blocks=blocks||jsonb_build_array('Relaciones, empresa, productos, cantidades o fechas inconsistentes; requiere revisión.');
      graph=NULL; -- Do not expose linked foreign-tenant data, even in a blocked preview.
    ELSE
      graph=graph||jsonb_build_object(
        'sub_lots',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code) ORDER BY id),'[]') FROM public.sub_lots WHERE id IN (SELECT sub_lot_id FROM public.planning_lots WHERE planning_id=pid)),
        'lots',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY id),'[]') FROM public.lots WHERE id IN (SELECT lot_id FROM public.planning_lots WHERE planning_id=pid)),
        'products',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'unit',unit) ORDER BY id),'[]') FROM public.products WHERE id IN (SELECT product_id FROM public.planning_products WHERE planning_id=pid)));
    END IF;
    IF jsonb_array_length(blocks)>0 THEN valid=false; END IF;
    items=items||jsonb_build_array(jsonb_build_object('planning_id',pid,'planning',to_jsonb(p),'effective_date',d,'graph',graph,'blockers',blocks));
  END LOOP;
  RETURN jsonb_build_object('persisted',false,'can_confirm',valid,'inventory_control_start_date',cutoff,'items',items);
END $$;

CREATE FUNCTION history_internal.inventory_snapshot(c uuid) RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object(
    'products',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.products p WHERE company_id=c),
    'notifications',(SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY id),'[]') FROM public.notifications n WHERE company_id=c),
    'batches',(SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY id),'[]') FROM public.stock_batches b WHERE company_id=c),
    'movements',(SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM public.stock_movements m WHERE company_id=c),
    'balances',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY product_id),'[]') FROM (
      SELECT product_id,sum(initial_quantity) AS total_quantity,sum(available_quantity) AS on_hand,
        sum(available_quantity) FILTER(WHERE enabled AND (COALESCE(expiration_date,
          (make_date(expiration_year,expiration_month,1)+interval '1 month - 1 day')::date) IS NULL OR
          COALESCE(expiration_date,(make_date(expiration_year,expiration_month,1)+interval '1 month - 1 day')::date)>=(now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)) AS usable
      FROM public.stock_batches WHERE company_id=c AND enabled GROUP BY product_id) t));
$$;

CREATE FUNCTION public.confirm_history_adoption(c uuid,a uuid,ids uuid[],idem text,confirmed boolean) RETURNS jsonb
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
          RAISE EXCEPTION 'La base modificaría datos del antecedente. Operación cancelada.' USING ERRCODE='P0001';
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
          RAISE EXCEPTION 'Un efecto secundario modificaría el antecedente. Operación cancelada.' USING ERRCODE='P0001';
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
        RAISE EXCEPTION 'Una relación cambiaría durante la adopción. Operación cancelada.' USING ERRCODE='P0001';
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
    RAISE EXCEPTION 'El inventario cambió. Adopción cancelada.' USING ERRCODE='P0001';
  END IF;
  adoption_result=jsonb_build_object('persisted',true,'import_id',import_id,'planning_ids',payload->'planning_ids',
    'inventory_impact_mode','HISTORICAL_NO_STOCK','stock_unchanged',true,'stock_movements_created',0);
  UPDATE public.historical_imports SET result=adoption_result WHERE id=import_id;
  RETURN adoption_result;
END $$;
REVOKE ALL ON FUNCTION history_internal.authorize_adoption(uuid,uuid), history_internal.inventory_snapshot(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.prepare_history_adoption(uuid,uuid,uuid[]), public.confirm_history_adoption(uuid,uuid,uuid[],text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_history_adoption(uuid,uuid,uuid[]), public.confirm_history_adoption(uuid,uuid,uuid[],text,boolean) TO service_role;
COMMIT;