// Narrow support operation. No Supabase client, completion or inventory writers.
const stock = require('./stock');
const { getEffectivePermissions } = require('../constants/permissions');
const { validateReferences } = require('./historicalImport');
const { randomUUID } = require('node:crypto');
const COMPANY = '2791ea15-7dad-48e2-945b-3791e2d44478';
const CROP = '2f9aabe7-d74d-400c-92c7-8b2b4f8fed8f';
const CAMPAIGN = '42894d7b-337a-4833-8995-f35a36b42104';
const CASES = Object.freeze({
  'bc06146e-086e-4a10-8dec-fcaa3d5d71f1': { lot: '81e0ba67-b201-4bb6-ac01-09b26f6635aa', date: '2026-05-23' },
  'c6a6bea6-345b-44f2-baa8-9d10cd81e255': { lot: 'b3e6227c-65cc-45ff-9174-19f432cf5a3a', date: '2026-05-26' },
  'ab0c87f3-8edf-40b3-b1e4-4eca931734ec': { lot: 'a21d67cd-667d-4c17-bbc6-db7f4b20b617', date: '2026-05-29' },
  'b71d0fad-659e-493b-8127-104b93844983': { lot: 'a7df5a3f-9b62-4347-b576-be736896470d', date: '2026-06-01' },
});
const EXCLUDED = {
  '74842b24-19cd-4f88-bf4b-3f43dedd7837': 'T2 excluido: Soja abierta whole-lot superpuesta con T2-A.',
  'c843269e-50a5-4ea5-b63d-4c5587e5b48d': 'T3/Cebada excluido: la siembra continúa vinculada históricamente a T4.',
};
const EVIDENCE = 'primer día del período confirmado como inicio real de siembra';
const REQUIRED = ['companies','users','planning','planning_lots','planning_products','planning_product_completions',
  'usage_records','usage_lots','crop_assignments','harvest_records','harvest_crop_assignments','harvest_cycle_closures',
  'lots','lot_layouts','sub_lots','crops','campaigns','products','stock_batches','stock_movements','notifications',
  'historical_events','historical_imports'];
const quote = s => '"' + s.replaceAll('"', '""') + '"';
const conflict = message => { throw stock.fail(message, 409); };
function idsFrom(value) {
  if (!Array.isArray(value) || !value.length || value.length > 4 || value.some(x => typeof x !== 'string'))
    throw stock.fail('Seleccioná entre 1 y 4 siembras autorizadas.', 400);
  const ids = value.map(x => x.toLowerCase()).sort();
  for (const id of ids) if (EXCLUDED[id]) conflict(EXCLUDED[id]);
  if (new Set(ids).size !== ids.length || ids.some(id => !CASES[id]))
    conflict('Solo están autorizadas las cuatro siembras de Trigo indicadas para soporte.');
  return ids;
}
async function authorize(client, input) {
  const { rows } = await client.query('SELECT * FROM public.users WHERE id=$1 AND company_id=$2 AND enabled=true', [input.actorId,input.companyId]);
  const actor = rows[0], permissions = actor ? getEffectivePermissions(actor) : [];
  if (!actor || actor.role !== 3 || (!permissions.includes('all') && !['planning.edit','history.import'].every(p => permissions.includes(p))))
    throw stock.fail('Se requiere Admin con planning.edit e history.import.',403);
  if (input.companyId !== COMPANY) throw stock.fail('La reconciliación no está autorizada para esta empresa.',403);
}
async function catalog(client) {
  // Conservative support guard: all ordinary public tables, including unknown relations.
  // No global rows are returned to the caller. DDL/partitions/non-public inbound FKs fail closed.
  const tables = (await client.query(`SELECT c.relname,c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`)).rows;
  if (tables.some(t => t.relkind !== 'r') || REQUIRED.some(t => !tables.some(x => x.relname === t)))
    conflict('Esquema incompleto o particionado: requiere revisión antes de reconciliar.');
  const external = (await client.query(`SELECT 1 FROM pg_constraint k
    JOIN pg_class a ON a.oid=k.conrelid JOIN pg_namespace an ON an.oid=a.relnamespace
    JOIN pg_class b ON b.oid=k.confrelid JOIN pg_namespace bn ON bn.oid=b.relnamespace
    WHERE k.contype='f' AND bn.nspname='public' AND an.nspname<>'public' LIMIT 1`)).rows;
  if (external.length) conflict('Hay referencias externas al esquema público: requieren revisión.');
  const protections = [['planning','protect_inventory_impact_mode'],['crop_assignments','protect_inventory_impact_mode'],
    ['historical_events','protect_historical_events'],['historical_imports','protect_historical_import_audit']];
  const installed = (await client.query(`SELECT c.relname,t.tgname,t.tgenabled FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal`)).rows;
  if (protections.some(([table,name])=>!installed.some(t=>t.relname===table && t.tgname===name && ['O','A'].includes(t.tgenabled))))
    conflict('Faltan protecciones históricas habilitadas en la base.');
  const definitions = (await client.query(`SELECT jsonb_build_object(
    'columns',(SELECT jsonb_agg(to_jsonb(x) ORDER BY table_name,ordinal_position)
      FROM information_schema.columns x WHERE table_schema='public'),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,'def',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname)
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
    'triggers',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,
      'def',pg_get_triggerdef(t.oid),'function',pg_get_functiondef(t.tgfoid)) ORDER BY c.relname,t.tgname)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal),
    'indexes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY tablename,indexname) FROM pg_indexes x WHERE schemaname='public')
    )::text AS value`)).rows[0].value;
  return { tables: tables.map(t => t.relname), definitions };
}
async function snapshot(client, tables) {
  const result = {};
  // PostgreSQL JSONB text preserves numeric/timestamp precision; do not reserialize row data in JS.
  for (const table of tables) result[table] = (await client.query(
    `SELECT to_jsonb(x)::text AS value FROM public.${quote(table)} x ORDER BY to_jsonb(x)::text`)).rows.map(r => r.value);
  return result;
}
const rowsOf = (state, table) => state[table].map(s => JSON.parse(s));
async function build(client, input, ids, schema, state) {
  const campaign = rowsOf(state,'campaigns').find(r => r.id === CAMPAIGN && r.company_id === COMPANY);
  const crop = rowsOf(state,'crops').find(r => r.id === CROP && r.company_id === COMPANY);
  if (!campaign || !crop || crop.enabled !== true) conflict('Cultivo o campaña esperados no disponibles en la empresa.');
  const items = [];
  for (const id of ids) {
    const spec = CASES[id], p = rowsOf(state,'planning').find(r => r.id === id && r.company_id === COMPANY);
    if (!p) throw stock.fail('Planning inexistente o de otra empresa.',404);
    if (p.activity_type !== 'siembra' || p.status !== 'completado' || p.enabled !== true || p.crop_id !== null ||
        p.campaign_id !== CAMPAIGN || p.inventory_impact_mode !== 'HISTORICAL_NO_STOCK' || !p.historical_import_id)
      conflict('La Planning no coincide con las precondiciones de la reconciliación.');
    if (!rowsOf(state,'historical_imports').some(r => r.id === p.historical_import_id && r.company_id === COMPANY))
      conflict('Procedencia histórica inexistente o de otra empresa.');
    if (rowsOf(state,'crop_assignments').some(r => r.source_planning_id === id)) conflict('La Planning ya tiene un crop_assignment vinculado.');
    const selections = rowsOf(state,'planning_lots').filter(r => r.planning_id === id);
    if (selections.length !== 1 || selections[0].lot_id !== spec.lot || selections[0].sub_lot_id !== null)
      conflict('La selección histórica no coincide exactamente con el lote completo autorizado.');
    const lot = rowsOf(state,'lots').find(r => r.id === spec.lot && r.company_id === COMPANY && r.enabled === true);
    if (!lot || lot.area_ha == null || !Number.isFinite(Number(lot.area_ha)) || Number(lot.area_ha) <= 0)
      conflict('Falta un área estructural actual válida en lots.area_ha.');
    const dates = (await client.query(`SELECT
      (start_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text AS start_day,
      (end_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text AS end_day,
      effective_date::text FROM public.planning WHERE id=$1 AND company_id=$2`,[id,COMPANY])).rows[0];
    if (dates.start_day !== spec.date || dates.end_day < spec.date || (dates.effective_date && dates.effective_date !== spec.date) ||
        campaign.start_date > spec.date || (campaign.end_date && campaign.end_date < spec.date))
      conflict('El período, la fecha efectiva o la campaña contradicen la fecha de inicio confirmada.');
    // Whole-lot + infinite window: every sublot of the same lot intersects. No PostGIS approximation needed.
    const cycles = rowsOf(state,'crop_assignments').filter(r => r.lot_id === spec.lot);
    if (cycles.some(r => r.company_id !== COMPANY || r.end_date === null || r.end_date >= spec.date))
      conflict('Existe un ciclo superpuesto con la nueva ventana del lote completo.');
    const harvests = rowsOf(state,'harvest_records').filter(r => r.lot_id === spec.lot);
    if (harvests.some(r => r.company_id !== COMPANY || r.harvest_date >= spec.date))
      conflict('Hay cosechas inesperadas en la ventana de la nueva siembra.');
    const closures = rowsOf(state,'harvest_cycle_closures').filter(r => cycles.some(c => c.id === r.crop_assignment_id));
    if (closures.some(r => r.company_id !== COMPANY || r.finalized_date >= spec.date)) conflict('Hay cierres inesperados en la nueva ventana.');
    const products = rowsOf(state,'planning_products').filter(r => r.planning_id === id);
    const completions = rowsOf(state,'planning_product_completions').filter(r => r.planning_id === id || products.some(p => p.id === r.planning_product_id));
    const usages = rowsOf(state,'usage_records').filter(r => r.source_planning_id === id || products.some(p => p.id === r.source_planning_product_id) || completions.some(c => c.usage_id === r.id));
    if (usages.some(u => u.company_id !== COMPANY || u.source_planning_id !== id || u.inventory_impact_mode !== 'HISTORICAL_NO_STOCK') || completions.some(c => c.planning_id !== id))
      conflict('El grafo de productos, completions o usos tiene referencias incompatibles.');
    const usageLots = rowsOf(state,'usage_lots').filter(r => usages.some(u => u.id === r.usage_id));
    for (const [table,graph] of [['planning',[p]],['planning_lots',selections],['planning_products',products],['planning_product_completions',completions],['usage_records',usages],['usage_lots',usageLots]])
      for (const row of graph) await validateReferences(client,table,row,COMPANY);
    if (usageLots.some(r => r.lot_id !== spec.lot || r.sub_lot_id !== null)) conflict('Los usos no corresponden exclusivamente al lote completo.');
    // Verify installed precision; only the documented rounding trigger is anticipated.
    const area = (await client.query(`SELECT l.area_ha::text AS source,
      round(l.area_ha, CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid='public.crop_assignments'::regclass AND t.tgname='normalize_new_harvest_cycle_area' AND t.tgenabled IN ('O','A'))
        THEN LEAST(c.numeric_scale,2) ELSE c.numeric_scale END)::text AS persisted
      FROM public.lots l CROSS JOIN information_schema.columns c
      WHERE l.id=$1 AND l.company_id=$2 AND c.table_schema='public' AND c.table_name='crop_assignments'
        AND c.column_name='area_ha' AND c.data_type='numeric' AND c.numeric_scale BETWEEN 0 AND 4`,[spec.lot,COMPANY])).rows[0];
    if (!area || Number(area.persisted) <= 0) conflict('Precisión instalada incompatible o área estructural redondeada inválida.');
    const expected = (await client.query(`SELECT ((to_jsonb(p) || jsonb_build_object('crop_id',$3::uuid))-'updated_at')::text AS value
      FROM public.planning p WHERE id=$1 AND company_id=$2`,[id,COMPANY,CROP])).rows[0].value;
    items.push({ planning_id:id, lot_id:spec.lot, crop_id:CROP, campaign_id:CAMPAIGN, start_date:spec.date,
      end_date:null, sub_lot_id:null, structural_area_source:area.source, structural_area_persisted:area.persisted,
      historical_import_id:p.historical_import_id, evidence:EVIDENCE,
      graph:{planning:p,planning_lots:selections,planning_products:products,completions,usages,usage_lots:usageLots}, expected });
  }
  return { items, fingerprint:stock.fingerprint({operation:'reconcile-sowing-v1',company:COMPANY,actor:input.actorId,ids,cases:CASES,schema,state}) };
}
function publicPreview(plan) {
  return {persisted:false,can_confirm:true,fingerprint:plan.fingerprint,
    items:plan.items.map(({expected,...item})=>item)};
}
async function run(pool,input,confirming) {
  const ids = idsFrom(input.planningIds);
  if (confirming && (typeof input.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.fingerprint) ||
      typeof input.key !== 'string' || !input.key.trim() || input.key.length > 200 || input.confirmed !== true))
    throw stock.fail('Fingerprint, Idempotency-Key y confirmed=true son obligatorios.',400);
  return stock.transaction(pool,async client=>{
    if (!confirming) await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL search_path=public,pg_catalog");
    await client.query("SET LOCAL row_security=off");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await authorize(client,input);
    let schema = await catalog(client);
    if (confirming) {
      await client.query(`LOCK TABLE ${schema.tables.map(t=>'public.'+quote(t)).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
      await authorize(client,input);
      const lockedSchema = await catalog(client);
      if (stock.fingerprint(lockedSchema) !== stock.fingerprint(schema)) conflict('El esquema cambió durante la preparación.');
      schema = lockedSchema;
      for (const id of ids) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[COMPANY+':'+CASES[id].lot]);
    }
    const request = {operation:'reconcile-sowing',planning_ids:ids,fingerprint:input.fingerprint,confirmed:true};
    const requestHash = stock.fingerprint(request);
    if (confirming) {
      const prior = (await client.query('SELECT * FROM public.historical_imports WHERE company_id=$1 AND idempotency_key=$2',[COMPANY,input.key])).rows[0];
      if (prior) {
        if (prior.source !== 'reconcile-sowing' || prior.request_hash !== requestHash || !prior.result) conflict('Idempotency-Key ya corresponde a otro contenido.');
        return {...prior.result,replayed:true};
      }
    }
    const before = await snapshot(client,schema.tables);
    const plan = await build(client,input,ids,schema,before);
    if (!confirming) return publicPreview(plan);
    if (input.fingerprint !== plan.fingerprint) conflict('Fingerprint vencido: cambió una precondición. Ejecutá prepare nuevamente.');
    const expected = Object.fromEntries(Object.entries(before).map(([t,rows])=>[t,[...rows]]));
    const receiptId = randomUUID();
    const receipt = (await client.query(`INSERT INTO public.historical_imports(id,company_id,idempotency_key,request_hash,imported_by,source,payload)
      VALUES($1,$2,$3,$4,$5,'reconcile-sowing',$6::text::jsonb) RETURNING to_jsonb(historical_imports)::text AS value`,
      [receiptId,COMPANY,input.key,requestHash,input.actorId,JSON.stringify(request)])).rows[0].value;
    const result = {operation:'reconcile-sowing',replayed:false,import_id:receiptId,fingerprint:plan.fingerprint,
      stock_unchanged:true,stock_movements_created:0,items:[]};
    for (const item of plan.items) {
      const assignmentId = randomUUID();
      // Preserve operational dates and quantities, including effective_date. The confirmed date belongs to the new cycle only.
      await client.query('UPDATE public.planning SET crop_id=$3 WHERE company_id=$1 AND id=$2 AND crop_id IS NULL',[COMPANY,item.planning_id,CROP]);
      const savedPlanning = (await client.query(`SELECT to_jsonb(p)::text AS value,(to_jsonb(p)-'updated_at')::text AS protected,
        (updated_at IS NOT DISTINCT FROM $3::timestamptz OR updated_at=transaction_timestamp()) AS timestamp_ok
        FROM public.planning p WHERE id=$1 AND company_id=$2`,[item.planning_id,COMPANY,item.graph.planning.updated_at])).rows[0];
      if (!savedPlanning || savedPlanning.protected !== item.expected || !savedPlanning.timestamp_ok) conflict('Un trigger modificó campos de Planning no autorizados.');
      const originalPlanning = before.planning.find(s=>JSON.parse(s).id===item.planning_id);
      expected.planning.splice(expected.planning.indexOf(originalPlanning),1,savedPlanning.value);
      const saved = (await client.query(`INSERT INTO public.crop_assignments(id,company_id,lot_id,sub_lot_id,crop_id,campaign_id,
        start_date,end_date,source_planning_id,inventory_impact_mode,historical_import_id,area_ha)
        VALUES($1,$2,$3,NULL,$4,$5,$6::date,NULL,$7,'HISTORICAL_NO_STOCK',$8,$9::numeric)
        RETURNING to_jsonb(crop_assignments)::text AS value`,
        [assignmentId,COMPANY,item.lot_id,CROP,CAMPAIGN,item.start_date,item.planning_id,item.historical_import_id,item.structural_area_source])).rows[0].value;
      // Compare scalar values in PostgreSQL; no floating-point area comparison.
      const ok = (await client.query(`SELECT area_ha::text AS area_persisted, (id=$1 AND company_id=$2 AND lot_id=$3 AND sub_lot_id IS NULL AND crop_id=$4
        AND campaign_id=$5 AND start_date=$6::date AND end_date IS NULL AND source_planning_id=$7
        AND inventory_impact_mode='HISTORICAL_NO_STOCK' AND historical_import_id=$8 AND area_ha=$9::numeric
        AND harvest_closure_source IS NULL AND created_at=transaction_timestamp() AND updated_at=transaction_timestamp()) AS ok
        FROM public.crop_assignments WHERE id=$1`,[assignmentId,COMPANY,item.lot_id,CROP,CAMPAIGN,item.start_date,item.planning_id,item.historical_import_id,item.structural_area_persisted])).rows[0];
      const assignment = JSON.parse(saved);
      const assignmentKeys = ['id','company_id','lot_id','sub_lot_id','crop_id','campaign_id','start_date','end_date','source_planning_id',
        'inventory_impact_mode','historical_import_id','area_ha','harvest_closure_source','created_at','updated_at'];
      if (!ok?.ok || Object.keys(assignment).some(k=>!assignmentKeys.includes(k))) conflict('El assignment persistido no coincide con el delta autorizado o tiene columnas no revisadas.');
      expected.crop_assignments.push(saved);
      const info = {planning_id:item.planning_id,assignment_id:assignmentId,start_date:item.start_date,
        structural_area_source:item.structural_area_source,structural_area_persisted:ok.area_persisted};
      const auditMeta = {...info,operation:'reconcile-sowing',actor_id:input.actorId,company_id:COMPANY,
        evidence:EVIDENCE,fingerprint:plan.fingerprint,idempotency_import_id:receiptId};
      const event = (await client.query(`INSERT INTO public.historical_events(company_id,actor_id,entity_table,entity_id,before_data,after_data)
        VALUES($1,$2,'planning',$3,$4::text::jsonb,jsonb_build_object('planning',$5::text::jsonb,'assignment',$6::text::jsonb,'reconciliation',$7::text::jsonb))
        RETURNING to_jsonb(historical_events)::text AS value`,[COMPANY,input.actorId,item.planning_id,
        originalPlanning,savedPlanning.value,saved,JSON.stringify(auditMeta)])).rows[0].value;
      // A BEFORE audit trigger must not rewrite the requested evidence.
      const auditOK = (await client.query(`SELECT company_id=$1 AND actor_id=$2 AND entity_table='planning' AND entity_id=$3
        AND before_data=$4::text::jsonb AND after_data=jsonb_build_object('planning',$5::text::jsonb,'assignment',$6::text::jsonb,'reconciliation',$7::text::jsonb)
        AND occurred_at=transaction_timestamp() AS ok FROM public.historical_events WHERE id=$8`,[COMPANY,input.actorId,item.planning_id,
        originalPlanning,savedPlanning.value,saved,JSON.stringify(auditMeta),JSON.parse(event).id])).rows[0];
      if (!auditOK?.ok) conflict('El evento de auditoría fue modificado inesperadamente.');
      expected.historical_events.push(event);
      result.items.push(info);
    }
    const finalReceipt = (await client.query(`UPDATE public.historical_imports SET result=$2::text::jsonb WHERE id=$1
      RETURNING to_jsonb(historical_imports)::text AS value`,[receiptId,JSON.stringify(result)])).rows[0].value;
    const receiptOK = (await client.query(`SELECT (to_jsonb(h)-'result')=($2::text::jsonb-'result') AND result=$3::text::jsonb AS ok
      FROM public.historical_imports h WHERE id=$1`,[receiptId,receipt,JSON.stringify(result)])).rows[0];
    const receiptData = JSON.parse(finalReceipt);
    if (!receiptOK?.ok || receiptData.company_id!==COMPANY || receiptData.id!==receiptId || receiptData.imported_by!==input.actorId ||
        receiptData.source!=='reconcile-sowing' || receiptData.request_hash!==requestHash || receiptData.idempotency_key!==input.key ||
        stock.fingerprint(receiptData.payload)!==stock.fingerprint(request)) conflict('La constancia de idempotencia fue modificada inesperadamente.');
    expected.historical_imports.push(finalReceipt);
    const after = await snapshot(client,schema.tables);
    for (const t of schema.tables) if (JSON.stringify([...expected[t]].sort()) !== JSON.stringify([...after[t]].sort()))
      conflict('No se guardó la reconciliación: se detectó un delta no autorizado en '+t+'.');
    if (stock.fingerprint(await catalog(client)) !== stock.fingerprint(schema)) conflict('El esquema cambió durante la reconciliación.');
    // Deferred constraint triggers must run before the last protected comparison.
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    const finalState = await snapshot(client,schema.tables);
    if (stock.fingerprint(finalState)!==stock.fingerprint(after)) conflict('Un trigger diferido modificó datos protegidos.');
    return result;
  }).catch(error=>{
    if (['55P03','40P01','57014','40001','23505','23514','23503'].includes(error.code))
      throw stock.fail('No se guardó la reconciliación: conflicto de integridad o concurrencia. Revisá prepare.',409);
    throw error;
  });
}
module.exports = {prepare:(pool,input)=>run(pool,input,false),confirm:(pool,input)=>run(pool,input,true),CASES,COMPANY,CROP,CAMPAIGN};



