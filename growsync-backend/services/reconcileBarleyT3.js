// One support case only. No operational completion, inventory or cycle writers.
const stock=require('./stock');
const {getEffectivePermissions}=require('../constants/permissions');
const {catalog,snapshot}=require('./reconcileSowing');
const {randomUUID}=require('node:crypto');
const CASE=Object.freeze({
  company:'2791ea15-7dad-48e2-945b-3791e2d44478',actor:'95362622-aef0-4294-8b64-5710a256e91c',
  planning:'c843269e-50a5-4ea5-b63d-4c5587e5b48d',campaign:'42894d7b-337a-4833-8995-f35a36b42104',
  fromLot:'12aad78a-66de-4b08-9b07-f841c072f703',toLot:'21bdf5bf-fef2-419d-814d-22a508134ac0',
  crop:'fb5158a3-7c70-4f56-bf31-8de684037e45',product:'7a17bc98-87ec-47b4-a6cf-971bf229a653',
  planningProduct:'44dc1aa7-28bd-41d7-92e5-c72f5e4c6c91',laterPlanning:'513d7676-dd7a-4987-9259-ad24371b24bb',
});
const OPERATION='reconcile-barley-t3';
const WARNING='Se conserva la superficie histórica registrada de 68.7130 ha. No se interpreta como superficie estructural de T3 y no se crea un ciclo productivo.';
const REASON='Corrección de vínculo histórico T4 a T3 y cultivo Cebada, sin evidencia suficiente de superficie sembrada real.';
const EVIDENCE='T4: Maíz 2026-01-05 a 2026-08-07; T3: Soja cerrada 2026-05-01 y fumigación de Cebada 2026-08-28. Estado operativo confirmado: T3 Cebada, T4 Rastrojo de Maíz.';
const conflict=message=>{throw stock.fail(message,409);};
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const rows=(state,table)=>(state[table]||[]).map(s=>JSON.parse(s));
async function authorize(client,input){
  if(input.companyId!==CASE.company||input.actorId!==CASE.actor)throw stock.fail('Empresa o actor no autorizados para este caso de soporte.',403);
  const actor=(await client.query('SELECT * FROM public.users WHERE id=$1 AND company_id=$2 AND enabled=true',[input.actorId,input.companyId])).rows[0];
  const permissions=actor?getEffectivePermissions(actor):[];
  if(!actor||actor.role!==3||(!permissions.includes('all')&&!['history.import','planning.edit'].every(p=>permissions.includes(p))))
    throw stock.fail('Se requiere Admin habilitado con history.import y planning.edit.',403);
}
async function reviewSchema(client){
  const schema=await catalog(client);
  if(!schema.tables.includes('productive_state_declarations'))conflict('Falta el esquema de declaraciones productivas.');
  // Review incoming keys, including composite keys. No unreviewed dependency is allowed.
  const incoming=(await client.query(`SELECT a.relname AS child,b.relname AS parent,
    ARRAY(SELECT attname FROM unnest(k.conkey) WITH ORDINALITY x(num,ord)
      JOIN pg_attribute z ON z.attrelid=k.conrelid AND z.attnum=x.num ORDER BY x.ord) AS child_columns,
    ARRAY(SELECT attname FROM unnest(k.confkey) WITH ORDINALITY x(num,ord)
      JOIN pg_attribute z ON z.attrelid=k.confrelid AND z.attnum=x.num ORDER BY x.ord) AS parent_columns,
    pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class a ON a.oid=k.conrelid JOIN pg_class b ON b.oid=k.confrelid
    JOIN pg_namespace n ON n.oid=b.relnamespace WHERE k.contype='f' AND n.nspname='public'
    AND b.relname IN ('planning','planning_products','planning_lots') ORDER BY a.relname,k.conname`)).rows;
  const known=new Set(['planning_lots:planning_id:planning:id','planning_products:planning_id:planning:id',
    'usage_records:source_planning_id:planning:id','usage_records:source_planning_product_id:planning_products:id',
    'planning_product_completions:planning_id:planning:id','planning_product_completions:planning_product_id:planning_products:id',
    'crop_assignments:source_planning_id:planning:id']);
  for(const fk of incoming)if(!known.has([fk.child,fk.child_columns.join(','),fk.parent,fk.parent_columns.join(',')].join(':')))
    conflict('FK entrante desconocida: '+fk.child+' -> '+fk.parent+'.');
  const triggers=JSON.parse(schema.definitions).triggers||[];
  return {...schema,incoming,relevant_triggers:triggers.filter(t=>['planning','planning_lots','historical_events','historical_imports'].includes(t.table))};
}
async function build(client,input,schema,state){
  const p=rows(state,'planning').find(r=>r.id===CASE.planning&&r.company_id===CASE.company);
  if(!p)conflict('Planning exacta inexistente o de otra empresa.');
  if(p.title!=='Siembra Cebada'||p.activity_type!=='siembra'||p.status!=='completado'||p.enabled!==true||p.crop_id!==null||
    p.campaign_id!==CASE.campaign||p.inventory_impact_mode!=='NORMAL'||p.registered_retroactively!==false||
    p.historical_import_id!==null||p.completed_at!==null||p.effective_date!==null)
    conflict('La Planning ya no coincide con el caso confirmado.');
  const dates=(await client.query(`SELECT (start_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text AS start_day,
    (end_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text AS end_day FROM public.planning WHERE id=$1`,[CASE.planning])).rows[0];
  if(dates.start_day!=='2026-06-04'||dates.end_day!=='2026-06-06')conflict('El período de siembra cambió.');
  const selections=rows(state,'planning_lots').filter(r=>r.planning_id===CASE.planning);
  const exact=(await client.query(`SELECT area_ha::text AS area,area_ha=68.7130::numeric AS area_ok,
    effective_area_ha IS NULL AS effective_ok FROM public.planning_lots WHERE planning_id=$1`,[CASE.planning])).rows;
  if(selections.length!==1||selections[0].lot_id!==CASE.fromLot||selections[0].sub_lot_id!==null||!exact[0]?.area_ok||!exact[0]?.effective_ok)
    conflict('La selección debe seguir siendo T4 completo, 68.7130 ha, sin área efectiva.');
  const products=rows(state,'planning_products').filter(r=>r.planning_id===CASE.planning);
  if(products.length!==1||products[0].id!==CASE.planningProduct||products[0].product_id!==CASE.product||products[0].amount!==2391||products[0].unit!=='kg')
    conflict('El producto planificado o los 2391 kg cambiaron.');
  const product=rows(state,'products').find(r=>r.id===CASE.product&&r.company_id===CASE.company);
  if(!product||product.name!=='Fertilizante siembra trigo'||product.unit!=='kg')conflict('El producto de catálogo confirmado cambió.');
  if(rows(state,'usage_records').some(r=>r.source_planning_id===CASE.planning||r.source_planning_product_id===CASE.planningProduct))conflict('Apareció un Usage vinculado.');
  if(rows(state,'planning_product_completions').some(r=>r.planning_id===CASE.planning||r.planning_product_id===CASE.planningProduct))conflict('Apareció una completion vinculada.');
  if(rows(state,'crop_assignments').some(r=>r.source_planning_id===CASE.planning))conflict('Apareció un ciclo vinculado.');
  if(rows(state,'historical_events').some(r=>r.entity_id===CASE.planning))conflict('La Planning ya tiene eventos históricos.');
  for(const [id,name] of [[CASE.fromLot,'T4'],[CASE.toLot,'T3']])if(!rows(state,'lots').some(r=>r.id===id&&r.name===name&&r.company_id===CASE.company&&r.enabled===true))
    conflict('T3/T4 no están disponibles en la misma empresa.');
  const crop=rows(state,'crops').find(r=>r.id===CASE.crop&&r.company_id===CASE.company&&r.name==='Cebada');
  const campaign=rows(state,'campaigns').find(r=>r.id===CASE.campaign&&r.company_id===CASE.company&&r.name==='Fina 2026 (Trigo, Cebada)');
  if(!crop||!campaign||campaign.start_date>'2026-06-04'||(campaign.end_date&&campaign.end_date<'2026-06-06'))conflict('Cultivo/campaña confirmados no disponibles.');
  const cycles=rows(state,'crop_assignments');
  const cropName=id=>rows(state,'crops').find(r=>r.id===id&&r.company_id===CASE.company)?.name;
  if(!cycles.some(r=>r.company_id===CASE.company&&r.lot_id===CASE.fromLot&&r.sub_lot_id===null&&cropName(r.crop_id)==='Maíz'&&r.start_date==='2026-01-05'&&r.end_date==='2026-08-07'))
    conflict('Falta el ciclo Maíz confirmado de T4.');
  if(!cycles.some(r=>r.company_id===CASE.company&&r.lot_id===CASE.toLot&&r.sub_lot_id===null&&cropName(r.crop_id)==='Soja'&&r.end_date==='2026-05-01'))
    conflict('Falta el cierre previo de Soja confirmado de T3.');
  const later=rows(state,'planning').find(r=>r.id===CASE.laterPlanning&&r.company_id===CASE.company&&r.enabled===true&&r.activity_type==='fumigacion'&&r.crop_id===CASE.crop);
  const laterLots=rows(state,'planning_lots').filter(r=>r.planning_id===CASE.laterPlanning);
  // This legacy evidence uses effective_date, or its original UTC calendar date.
  const laterDay=(await client.query(`SELECT COALESCE(effective_date,(start_at AT TIME ZONE 'UTC')::date)::text AS day
    FROM public.planning WHERE id=$1`,[CASE.laterPlanning])).rows[0]?.day;
  if(!later||laterDay!=='2026-08-28'||laterLots.length!==1||laterLots[0].lot_id!==CASE.toLot||laterLots[0].sub_lot_id!==null)
    conflict('La evidencia de fumigación de Cebada en T3 cambió.');
  // Unknown non-FK relations containing either graph identifier also fail closed.
  const known=new Set(['planning','planning_lots','planning_products','usage_records','planning_product_completions','crop_assignments','historical_events']);
  const contains=value=>value===CASE.planning||value===CASE.planningProduct||
    (value&&typeof value==='object'&&Object.values(value).some(contains));
  for(const table of schema.tables)if(!known.has(table)&&rows(state,table).some(contains))conflict('Relación no revisada con la Planning: '+table+'.');
  const expected=(await client.query(`SELECT ((to_jsonb(p)||jsonb_build_object('crop_id',$2::uuid))-'updated_at')::text AS planning
    FROM public.planning p WHERE id=$1`,[CASE.planning,CASE.crop])).rows[0].planning;
  const expectedLot=(await client.query(`SELECT (to_jsonb(l)||jsonb_build_object('lot_id',$2::uuid))::text AS value
    FROM public.planning_lots l WHERE planning_id=$1`,[CASE.planning,CASE.toLot])).rows[0].value;
  return {p,selections,products,expected,expectedLot,
    fingerprint:stock.fingerprint({operation:OPERATION,case:CASE,actor:input.actorId,schema,state}),
    before:{lot:{id:CASE.fromLot,name:'T4'},crop:null,area_ha:'68.7130'},
    after:{lot:{id:CASE.toLot,name:'T3'},crop:{id:CASE.crop,name:'Cebada'},area_ha:'68.7130'}};
}
async function run(pool,input,confirming){
  if(confirming&&(typeof input.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.fingerprint)||typeof input.key!=='string'||!input.key.trim()||input.key.length>200||input.confirmed!==true))
    throw stock.fail('Fingerprint, Idempotency-Key y confirmed=true son obligatorios.',400);
  return stock.transaction(pool,async client=>{
    if(!confirming)await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL search_path=public,pg_catalog');await client.query('SET LOCAL row_security=off');
    await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='30s'");
    await authorize(client,input);
    let schema=await reviewSchema(client);
    if(confirming){
      await client.query(`LOCK TABLE ${schema.tables.map(t=>'public.'+quote(t)).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
      await authorize(client,input);
      const locked=await reviewSchema(client);
      if(stock.fingerprint(schema)!==stock.fingerprint(locked))conflict('El esquema cambió concurrentemente.');
      schema=locked;
      await client.query('SELECT id FROM public.planning WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[CASE.planning,CASE.laterPlanning]]);
      await client.query('SELECT * FROM public.planning_lots WHERE planning_id=$1 FOR UPDATE',[CASE.planning]);
    }
    const request={operation:OPERATION,case:CASE,fingerprint:input.fingerprint,confirmed:true,actor_id:input.actorId};
    const hash=stock.fingerprint(request);
    if(confirming){
      const prior=(await client.query('SELECT * FROM public.historical_imports WHERE company_id=$1 AND idempotency_key=$2',[CASE.company,input.key])).rows[0];
      if(prior){
        if(prior.source!==OPERATION||prior.imported_by!==input.actorId||prior.request_hash!==hash||!prior.result)conflict('Idempotency-Key corresponde a otro contenido.');
        return {...prior.result,replayed:true};
      }
    }
    const before=await snapshot(client,schema.tables),plan=await build(client,input,schema,before);
    if(!confirming)return {persisted:false,can_confirm:true,planning_id:CASE.planning,fingerprint:plan.fingerprint,
      before:plan.before,after:plan.after,warning:WARNING,evidence:EVIDENCE,reason:REASON,
      schema_review:{incoming_fks:schema.incoming,relevant_triggers:schema.relevant_triggers}};
    if(plan.fingerprint!==input.fingerprint)conflict('Fingerprint vencido: ejecutá prepare nuevamente.');
    const expected=Object.fromEntries(Object.entries(before).map(([t,r])=>[t,[...r]]));
    const importId=randomUUID();
    const receipt=(await client.query(`INSERT INTO public.historical_imports(id,company_id,idempotency_key,request_hash,imported_by,source,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7::text::jsonb) RETURNING to_jsonb(historical_imports)::text AS value`,
      [importId,CASE.company,input.key,hash,input.actorId,OPERATION,JSON.stringify(request)])).rows[0].value;
    const updated=await client.query('UPDATE public.planning SET crop_id=$2 WHERE id=$1 AND company_id=$3 AND crop_id IS NULL RETURNING id',[CASE.planning,CASE.crop,CASE.company]);
    const moved=await client.query('UPDATE public.planning_lots SET lot_id=$2 WHERE planning_id=$1 AND lot_id=$3 AND sub_lot_id IS NULL RETURNING planning_id',[CASE.planning,CASE.toLot,CASE.fromLot]);
    if(updated.rows.length!==1||moved.rows.length!==1)conflict('No se actualizó exactamente una Planning y una selección.');
    const saved=(await client.query(`SELECT to_jsonb(p)::text AS value,(to_jsonb(p)-'updated_at')::text AS protected,
      (updated_at IS NOT DISTINCT FROM $2::timestamptz OR updated_at=transaction_timestamp()) AS timestamp_ok
      FROM public.planning p WHERE id=$1`,[CASE.planning,plan.p.updated_at])).rows[0];
    const savedLot=(await client.query('SELECT to_jsonb(l)::text AS value FROM public.planning_lots l WHERE planning_id=$1',[CASE.planning])).rows;
    if(!saved||saved.protected!==plan.expected||!saved.timestamp_ok||savedLot.length!==1||savedLot[0].value!==plan.expectedLot)
      conflict('Un trigger alteró campos no autorizados de Planning o selección.');
    const replace=(table,predicate,value)=>{const original=before[table].find(s=>predicate(JSON.parse(s)));expected[table].splice(expected[table].indexOf(original),1,value);};
    replace('planning',r=>r.id===CASE.planning,saved.value);replace('planning_lots',r=>r.planning_id===CASE.planning,savedLot[0].value);
    const original=before.planning.find(s=>JSON.parse(s).id===CASE.planning);
    const oldLot=before.planning_lots.find(s=>JSON.parse(s).planning_id===CASE.planning);
    const meta={operation:OPERATION,actor_id:input.actorId,company_id:CASE.company,planning_id:CASE.planning,
      historical_area_ha:'68.7130',area_interpretation:'historical_record_only',structural_area_used:false,
      crop_assignment_created:false,warning:WARNING,evidence:EVIDENCE,reason:REASON,
      fingerprint:plan.fingerprint,idempotency_key:input.key,import_id:importId};
    const beforeAudit=JSON.stringify({planning:JSON.parse(original),planning_lots:[JSON.parse(oldLot)],planning_products:plan.products});
    const afterAudit=JSON.stringify({planning:JSON.parse(saved.value),planning_lots:[JSON.parse(savedLot[0].value)],planning_products:plan.products,reconciliation:meta});
    const eventId=randomUUID();
    const event=(await client.query(`INSERT INTO public.historical_events(id,company_id,actor_id,entity_table,entity_id,before_data,after_data)
      VALUES($1,$2,$3,'planning',$4,$5::text::jsonb,$6::text::jsonb) RETURNING to_jsonb(historical_events)::text AS value`,
      [eventId,CASE.company,input.actorId,CASE.planning,beforeAudit,afterAudit])).rows[0].value;
    const eventOK=(await client.query(`SELECT id=$1 AND company_id=$2 AND actor_id=$3 AND entity_table='planning' AND entity_id=$4
      AND before_data=$5::text::jsonb AND after_data=$6::text::jsonb AND occurred_at=transaction_timestamp() AS ok
      FROM public.historical_events WHERE id=$1`,[eventId,CASE.company,input.actorId,CASE.planning,beforeAudit,afterAudit])).rows[0];
    if(!eventOK?.ok)conflict('Auditoría alterada por un trigger.');
    expected.historical_events.push(event);
    const result={operation:OPERATION,replayed:false,import_id:importId,planning_id:CASE.planning,
      fingerprint:plan.fingerprint,before:plan.before,after:plan.after,warning:WARNING,
      crop_assignments_created:0,usages_created:0,completions_created:0,stock_movements_created:0};
    const finalReceipt=(await client.query(`UPDATE public.historical_imports SET result=$2::text::jsonb WHERE id=$1
      RETURNING to_jsonb(historical_imports)::text AS value`,[importId,JSON.stringify(result)])).rows[0].value;
    const receiptOK=(await client.query(`SELECT (to_jsonb(h)-'result')=($2::text::jsonb-'result') AND result=$3::text::jsonb
      AND id=$1 AND company_id=$4 AND imported_by=$5 AND idempotency_key=$6 AND source=$7
      AND request_hash=$8 AND payload=$9::text::jsonb AND imported_at=transaction_timestamp() AS ok
      FROM public.historical_imports h WHERE id=$1`,[importId,receipt,JSON.stringify(result),CASE.company,input.actorId,input.key,OPERATION,hash,JSON.stringify(request)])).rows[0];
    if(!receiptOK?.ok)conflict('Constancia de idempotencia alterada.');
    expected.historical_imports.push(finalReceipt);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    const after=await snapshot(client,schema.tables);
    for(const table of schema.tables)if(JSON.stringify([...expected[table]].sort())!==JSON.stringify([...after[table]].sort()))conflict('Delta no autorizado en '+table+'.');
    if(stock.fingerprint(schema)!==stock.fingerprint(await reviewSchema(client)))conflict('El esquema cambió durante la reconciliación.');
    return result;
  }).catch(error=>{
    if(['55P03','40P01','57014','40001','23505','23514','23503','42703'].includes(error.code))throw stock.fail('Conflicto de esquema, integridad o concurrencia: reconciliación no guardada.',409);
    throw error;
  });
}
module.exports={CASE,WARNING,prepare:(pool,input)=>run(pool,input,false),confirm:(pool,input)=>run(pool,input,true)};
