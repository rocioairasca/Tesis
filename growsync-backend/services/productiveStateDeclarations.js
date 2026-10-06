const stock=require('./stock');
const {getEffectivePermissions}=require('../constants/permissions');
const {catalog,snapshot}=require('./reconcileSowing');
const {getStates}=require('./productiveState');
const {randomUUID}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=message=>{throw stock.fail(message,409);};
function normalize(entries){
  const fields=['lot_id','sub_lot_id','layout_id','kind','crop_id','observed_on','source','evidence','reason','supersedes_id'];
  if(!Array.isArray(entries)||!entries.length||entries.length>20)throw stock.fail('Ingresá entre 1 y 20 estados observados.',400);
  const result=entries.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!fields.includes(k)))throw stock.fail('Declaración inválida.',400);
    const d=Object.fromEntries(fields.map(k=>[k,row[k]??null]));
    for(const f of ['lot_id','sub_lot_id','layout_id','crop_id','supersedes_id']){
      if((f==='lot_id'||d[f]!==null)&&!UUID.test(d[f]||''))throw stock.fail('Referencia inválida.',400);
      if(d[f])d[f]=d[f].toLowerCase();
    }
    stock.calendarDate(d.observed_on);
    if(!['growing_crop','stubble','fallow','unknown'].includes(d.kind)||(['growing_crop','stubble'].includes(d.kind)!==Boolean(d.crop_id)))
      throw stock.fail('Cultivo incompatible con el estado observado.',400);
    for(const f of ['source','evidence','reason'])if(typeof d[f]!=='string'||!d[f].trim()||d[f].length>(f==='source'?200:4000))throw stock.fail('Fuente, evidencia y motivo son obligatorios.',400);
    return d;
  }).sort((a,b)=>(a.lot_id+':'+(a.sub_lot_id||'')).localeCompare(b.lot_id+':'+(b.sub_lot_id||'')));
  if(new Set(result.map(d=>d.lot_id+':'+(d.sub_lot_id||''))).size!==result.length)throw stock.fail('Una declaración por unidad en cada confirmación.',400);
  return result;
}
async function authorize(client,{companyId,actorId}){
  const a=(await client.query('SELECT * FROM public.users WHERE id=$1 AND company_id=$2 AND enabled=true',[actorId,companyId])).rows[0];
  const permissions=a?getEffectivePermissions(a):[];
  if(!a||a.role!==3||(!permissions.includes('all')&&!['planning.edit','history.import'].every(p=>permissions.includes(p))))throw stock.fail('Se requiere Admin con planning.edit e history.import.',403);
}
async function preview(client,input,entries,schema,state){
  const items=[];
  for(const d of entries){
    const result=await getStates(client,{companyId:input.companyId,lotId:d.lot_id,date:d.observed_on,includeLegacy:false});
    const unit=result.data.flatMap(l=>l.units).find(u=>u.sub_lot_id===d.sub_lot_id&&u.layout_id===d.layout_id);
    if(!unit||unit.lot_enabled!==true)fail('La unidad no pertenece al lote/empresa/layout activo o no está habilitada explícitamente.');
    const crop=d.crop_id?(await client.query('SELECT id,name FROM public.crops WHERE id=$1 AND company_id=$2',[d.crop_id,input.companyId])).rows[0]:null;
    if(d.crop_id&&!crop)fail('Cultivo no disponible en esta empresa.');
    if(d.supersedes_id){
      const prior=(await client.query('SELECT *,coverage::text AS coverage_key FROM public.productive_state_declarations WHERE id=$1 AND company_id=$2',[d.supersedes_id,input.companyId])).rows[0];
      if(!prior||prior.lot_id!==d.lot_id||prior.sub_lot_id!==d.sub_lot_id||prior.layout_id!==d.layout_id||
        prior.coverage_key!==unit.coverage_key||prior.observed_on>d.observed_on)
        fail('La declaración anterior no corresponde a la misma cobertura/empresa o fecha.');
      if((await client.query('SELECT 1 FROM public.productive_state_declarations WHERE supersedes_id=$1',[d.supersedes_id])).rows.length)fail('La declaración anterior ya fue sustituida.');
    }
    const proposed={...d,id:'preview:'+d.lot_id+':'+(d.sub_lot_id||'whole'),company_id:input.companyId,actor_id:input.actorId,coverage:unit.coverage,coverage_key:unit.coverage_key};
    // Use exactly the same resolver to preview the effect; no second precedence implementation.
    const next=await getStates(client,{companyId:input.companyId,lotId:d.lot_id,date:d.observed_on,includeLegacy:false,
      additionalDeclarations:[{...proposed,crop_name:crop?.name||null}]});
    const after=next.data.flatMap(l=>l.units).find(u=>u.sub_lot_id===d.sub_lot_id);
    items.push({declaration:d,coverage:unit.coverage,coverage_key:unit.coverage_key,unit_name:unit.name,crop,before:unit.state,after:after.state,
      warning:after.state.conflict?'Estado confirmado con historial pendiente de revisar':null});
  }
  return {persisted:false,can_confirm:true,items,fingerprint:stock.fingerprint({operation:'productive-declarations-v1',company:input.companyId,actor:input.actorId,entries,schema,state})};
}
async function run(pool,input,confirming){
  const entries=normalize(input.declarations);
  if(confirming&&(input.confirmed!==true||typeof input.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.fingerprint)||typeof input.key!=='string'||!input.key.trim()||input.key.length>200))throw stock.fail('Confirmación, fingerprint e Idempotency-Key obligatorios.',400);
  return stock.transaction(pool,async client=>{
    if(!confirming)await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL search_path=public,pg_catalog");await client.query("SET LOCAL row_security=off");
    await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='30s'");
    await authorize(client,input);
    let schema=await catalog(client);
    if(!schema.tables.includes('productive_state_declarations'))throw stock.fail('Falta desplegar el esquema de declaraciones.',503);
    const protections=(await client.query(`SELECT tgname FROM pg_trigger WHERE tgrelid='public.productive_state_declarations'::regclass AND tgenabled IN ('O','A')`)).rows.map(r=>r.tgname);
    if(['productive_declaration_validate','productive_declaration_append_only','productive_declaration_no_truncate'].some(name=>!protections.includes(name)))fail('Faltan protecciones habilitadas de declaraciones.');
    if(confirming){
      await client.query('LOCK TABLE '+schema.tables.map(t=>'public."'+t.replaceAll('"','""')+'"').join(',')+' IN SHARE ROW EXCLUSIVE MODE');
      await authorize(client,input);
      const locked=await catalog(client);if(stock.fingerprint(locked)!==stock.fingerprint(schema))fail('Cambió el esquema.');schema=locked;
      for(const lot of [...new Set(entries.map(d=>d.lot_id))].sort())await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[input.companyId+':'+lot]);
    }
    const payload={operation:'productive-state-declarations',declarations:entries,fingerprint:input.fingerprint,confirmed:true};
    const hash=stock.fingerprint(payload);
    if(confirming){
      const old=(await client.query('SELECT * FROM public.historical_imports WHERE company_id=$1 AND idempotency_key=$2',[input.companyId,input.key])).rows[0];
      if(old){if(old.source!==payload.operation||old.request_hash!==hash||!old.result)fail('Idempotency-Key corresponde a otro contenido.');return {...old.result,replayed:true};}
    }
    const before=await snapshot(client,schema.tables),plan=await preview(client,input,entries,schema,before);
    if(!confirming)return plan;
    if(plan.fingerprint!==input.fingerprint)fail('Fingerprint vencido. Ejecutá prepare nuevamente.');
    const expected=Object.fromEntries(Object.entries(before).map(([t,rows])=>[t,[...rows]]));
    const receiptId=randomUUID();
    const receipt=(await client.query(`INSERT INTO public.historical_imports(id,company_id,idempotency_key,request_hash,imported_by,source,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7::text::jsonb) RETURNING to_jsonb(historical_imports)::text value`,
      [receiptId,input.companyId,input.key,hash,input.actorId,payload.operation,JSON.stringify(payload)])).rows[0].value;
    const result={operation:payload.operation,replayed:false,import_id:receiptId,fingerprint:plan.fingerprint,declaration_ids:[]};
    for(const item of plan.items){
      const id=randomUUID(),d={...item.declaration,id,company_id:input.companyId,actor_id:input.actorId,coverage:null};
      const fields=Object.keys(d),values=fields.map(k=>d[k]);
      const saved=(await client.query(`INSERT INTO public.productive_state_declarations (${fields.join(',')}) VALUES (${fields.map((k,i)=>'$'+(i+1)+(k==='coverage'?'::text::jsonb':'')).join(',')}) RETURNING to_jsonb(productive_state_declarations)::text value`,values)).rows[0].value;
      const match=(await client.query(`SELECT (to_jsonb(x)-ARRAY['recorded_at','coverage'])=($2::text::jsonb-'coverage') AND recorded_at=transaction_timestamp() AND coverage=$3::text::jsonb AS ok
        FROM public.productive_state_declarations x WHERE id=$1`,[id,JSON.stringify(d),item.coverage_key])).rows[0];
      if(!match?.ok)fail('La declaración persistida no coincide con el delta autorizado.');
      expected.productive_state_declarations.push(saved);result.declaration_ids.push(id);
      const eventPayload={operation:payload.operation,previous_state:item.before,
        observed_on:d.observed_on,fingerprint:plan.fingerprint,idempotency_import_id:receiptId};
      const event=(await client.query(`INSERT INTO public.historical_events(company_id,actor_id,entity_table,entity_id,before_data,after_data)
        VALUES($1,$2,'productive_state_declarations',$3,$4::text::jsonb,$5::text::jsonb || jsonb_build_object('declaration',$6::text::jsonb)) RETURNING to_jsonb(historical_events)::text value`,
        [input.companyId,input.actorId,id,JSON.stringify({state:item.before}),JSON.stringify(eventPayload),saved])).rows[0].value;
      const ev=(await client.query(`SELECT company_id=$1 AND actor_id=$2 AND entity_table='productive_state_declarations' AND entity_id=$3
        AND before_data=$4::text::jsonb AND after_data=($5::text::jsonb || jsonb_build_object('declaration',$7::text::jsonb)) AND occurred_at=transaction_timestamp() AS ok
        FROM public.historical_events WHERE id=$6`,[input.companyId,input.actorId,id,JSON.stringify({state:item.before}),JSON.stringify(eventPayload),JSON.parse(event).id,saved])).rows[0];
      if(!ev?.ok)fail('La auditoría fue modificada inesperadamente.');expected.historical_events.push(event);
    }
    const finalReceipt=(await client.query(`UPDATE public.historical_imports SET result=$2::text::jsonb WHERE id=$1 RETURNING to_jsonb(historical_imports)::text value`,[receiptId,JSON.stringify(result)])).rows[0].value;
    const receiptOK=(await client.query(`SELECT (to_jsonb(h)-'result')=($2::text::jsonb-'result') AND result=$3::text::jsonb
      AND company_id=$4 AND imported_by=$5 AND idempotency_key=$6 AND request_hash=$7 AND source=$8 AND payload=$9::text::jsonb
      AND imported_at=transaction_timestamp() AS ok FROM public.historical_imports h WHERE id=$1`,
      [receiptId,receipt,JSON.stringify(result),input.companyId,input.actorId,input.key,hash,payload.operation,JSON.stringify(payload)])).rows[0];
    if(!receiptOK?.ok)fail('La constancia de idempotencia fue modificada.');expected.historical_imports.push(finalReceipt);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    const after=await snapshot(client,schema.tables);
    for(const t of schema.tables)if(JSON.stringify([...expected[t]].sort())!==JSON.stringify([...after[t]].sort()))fail('Delta inesperado en '+t+'. Se revirtió toda la operación.');
    if(stock.fingerprint(await catalog(client))!==stock.fingerprint(schema))fail('Cambió el esquema durante la operación.');
    return result;
  }).catch(e=>{if(['23514','23503','23505','55P03','40P01','57014','40001'].includes(e.code))throw stock.fail('Conflicto de integridad, cobertura o concurrencia. Revisá prepare.',409);throw e;});
}
module.exports={prepare:(pool,x)=>run(pool,x,false),confirm:(pool,x)=>run(pool,x,true),normalize};
