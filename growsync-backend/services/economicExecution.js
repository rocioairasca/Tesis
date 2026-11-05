const {z}=require('zod');
const stock=require('./stock');
const money=require('../../shared/costEstimate.cjs');
const {getEffectivePermissions}=require('../constants/permissions');
const uuid=z.string().uuid();
const decimal=z.string().regex(/^\d{1,14}(\.\d{1,6})?$/);
const day=z.string().refine(v=>{try{stock.calendarDate(v);return true;}catch{return false;}},'Fecha inválida.');
const laborSchema=z.object({
 status:z.enum(['pending','confirmed','not_applicable']),
 currency:z.enum(['USD','ARS']).nullable().optional(),
 rate_original:decimal.nullable().optional(),
 payment_date:day.nullable().optional(),fx_rate:decimal.nullable().optional(),
 fx_date:day.nullable().optional(),fx_source:z.string().trim().max(500).nullable().optional(),
}).strict();
const targetSchema=z.object({lot_id:uuid,sub_lot_id:uuid.nullable().optional(),beneficiary_crop_id:uuid,crop_assignment_id:uuid.nullable().optional()}).strict();
const completionSchema=z.object({labor:laborSchema.optional(),targets:z.array(targetSchema).min(1).optional()}).strict();
const revisionSchema=z.object({supersedes_id:uuid,reason:z.string().trim().min(1).max(2000),labor:laborSchema.optional()}).strict();
function parse(schema,body){try{return schema.parse(body);}catch(e){e.status=400;throw e;}}
function allowed(user,keys) {
 const p=getEffectivePermissions(user);
 return user?.enabled!==false && keys.every(k=>p.includes(k)||p.includes('all'));
}
const readKeys=['planning.view','inventory.view'];
const editKeys=[...readKeys,'planning.edit','inventory.edit'];
function authorize(user,edit=false){
 if(!allowed(user,edit?editKeys:readKeys))throw stock.fail('No tenés permisos para consultar o modificar costos reales.',403);
 parse(uuid,user?.company_id);parse(uuid,user?.id);
}
function completionInput(user,body) {
 const data=parse(completionSchema,body||{});
 if(data.labor && !allowed(user,editKeys))throw stock.fail('La carga económica requiere edición de Planificaciones e Inventario.',403);
 return data;
}
function laborLine(data={status:'pending'},area) {
 if(data.status==='not_applicable') {
   if(Object.entries(data).some(([k,v])=>k!=='status'&&v!=null))throw stock.fail('Labor no aplicable no admite importes.',400);
   return null;
 }
 const rate=data.rate_original==null?null:money.input(data.rate_original);
 if(rate!=null&&!data.currency)throw stock.fail('La tarifa requiere moneda.',400);
 if(data.fx_rate!=null && (data.currency!=='ARS'||money.input(data.fx_rate)<=0n))throw stock.fail('La cotización debe ser positiva y corresponder a ARS.',400);
 const original=rate==null?null:rate*money.input(area);
 let usd=null;
 if(data.status==='confirmed'){
   if(rate==null||!data.currency)throw stock.fail('Indicá tarifa y moneda para confirmar la labor.',400);
   if(data.currency==='USD')usd=original;
   else {
     if(!data.payment_date||!data.fx_date||data.fx_date!==data.payment_date||!data.fx_source?.trim()||data.fx_rate==null||money.input(data.fx_rate)<=0n)
       throw stock.fail('ARS requiere fecha de pago, cotización mayorista de esa fecha y fuente para confirmar.',400);
     const fx=money.input(data.fx_rate);
     // Rational division rounded once at storage scale 12 (not per-ha cents).
     usd=(original*money.QUANTITY_SCALE+fx/2n)/fx;
   }
 }
 if(data.currency==='USD' && ['fx_rate','fx_date','fx_source'].some(k=>data[k]!=null))
   throw stock.fail('La labor en USD no utiliza FX.',400);
 return {kind:'labor',area_ha:area,price_basis:'per_ha',rate_original:rate==null?null:stock.amount(rate),
   currency:data.currency??null,amount_original:original==null?null:money.costText(original),
   payment_date:data.payment_date??null,fx_rate:data.fx_rate??null,fx_date:data.fx_date??null,
   fx_type:data.currency==='ARS'&&data.fx_rate!=null?'divisa_mayorista':null,fx_source:data.fx_source??null,
   amount_usd:usd==null?null:money.costText(usd),cost_status:data.status,provenance:'manual_labor'};
}
function weights(areas) {
 const a=areas.map(money.input),sum=a.reduce((n,v)=>n+v,0n);
 if(!a.length||a.some(v=>v<=0n))throw stock.fail('La superficie aplicada debe ser válida y positiva.',400);
 const scale=money.COST_SCALE;
 const values=a.map(v=>v*scale/sum);
 // Largest remainder, stable target order breaks ties. Exact sum = 1.
 const ranked=a.map((v,i)=>({i,remainder:v*scale%sum})).sort((a,b)=>a.remainder===b.remainder?a.i-b.i:a.remainder>b.remainder?-1:1);
 let left=scale-values.reduce((n,v)=>n+v,0n);
 for(let i=0;left>0n;i++,left--)values[ranked[i].i]++;
 return values.map(money.costText);
}
async function insert(client,table,data){
 const keys=Object.keys(data),values=Object.values(data);
 return (await client.query('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',values)).rows[0];
}
const latest=async(client,company,id)=>(await client.query('SELECT * FROM economic_snapshots WHERE company_id=$1 AND planning_id=$2 ORDER BY revision DESC LIMIT 1',[company,id])).rows[0]||null;
async function details(client,snapshot) {
 if(!snapshot)return null;
 const {created_txid,idempotency_key,request_hash,...publicSnapshot}=snapshot;
 const {rows:lines}=await client.query('SELECT * FROM economic_snapshot_lines WHERE company_id=$1 AND snapshot_id=$2 ORDER BY kind,stock_movement_id,id',[snapshot.company_id,snapshot.id]);
 const {rows:targets}=await client.query('SELECT * FROM economic_snapshot_targets WHERE company_id=$1 AND snapshot_id=$2 ORDER BY lot_id,sub_lot_id NULLS FIRST',[snapshot.company_id,snapshot.id]);
 const known=lines.reduce((sum,l)=>sum+(l.amount_usd==null?0n:money.cost(l.amount_usd)),0n);
 const products=lines.filter(l=>l.kind==='product').reduce((sum,l)=>sum+(l.amount_usd==null?0n:money.cost(l.amount_usd)),0n);
 const area=targets.reduce((sum,t)=>sum+money.input(t.applied_area_ha),0n);
 const complete=snapshot.economic_status==='complete';
 const perHa=complete&&area>0n?(known*money.QUANTITY_SCALE+area/2n)/area:null;
 return {snapshot:publicSnapshot,lines,targets,known_products_cost_usd:money.costText(products),
   known_total_usd:money.costText(known),total_cost_usd:complete?money.costText(known):null,
   cost_per_ha_usd:perHa==null?null:money.costText(perHa),area_ha:stock.amount(area),
   pending_product_lines:lines.filter(l=>l.kind==='product'&&l.cost_status==='pending').length,
   comparison:null,comparison_unavailable_reason:'No se conservó un preventivo antes de esta ejecución.'};
}
async function planningRow(client,company,id,lock=false) {
 const p=(await client.query('SELECT * FROM planning WHERE company_id=$1 AND id=$2'+(lock?' FOR UPDATE':''),[company,id])).rows[0];
 if(!p)throw stock.fail('Planificación no encontrada.',404);
 return p;
}
async function readablePlanning(client,user,id,lock=false){
 const p=await planningRow(client,user.company_id,id,lock);
 if(p.enabled===false&&!allowed(user,['planning.view_disabled']))throw stock.fail('No tenés permiso para ver planificaciones deshabilitadas.',403);
 return p;
}
async function targetsFor(client,p,data) {
 if(!p.campaign_id)throw stock.fail('Seleccioná la campaña de la planificación antes de ejecutar.',400);
 const {rows:selections}=await client.query(`SELECT pl.lot_id,pl.sub_lot_id,COALESCE(pl.effective_area_ha,pl.area_ha)::text AS area,
   l.name AS lot_name,sl.name AS sub_lot_name,l.company_id AS lot_company,sl.company_id AS sub_company,sl.lot_id AS sub_parent
   FROM planning_lots pl LEFT JOIN lots l ON l.id=pl.lot_id LEFT JOIN sub_lots sl ON sl.id=pl.sub_lot_id
   WHERE pl.planning_id=$1 ORDER BY pl.lot_id,pl.sub_lot_id NULLS FIRST`,[p.id]);
 const key=t=>t.lot_id+':'+(t.sub_lot_id||'');
 const selected=new Map((data.targets||[]).map(t=>[key(t),t]));
 if(selected.size!==(data.targets||[]).length || [...selected.keys()].some(k=>!selections.some(s=>key(s)===k)))
   throw stock.fail('Los destinos económicos no coinciden con los lotes de la planificación.',400);
 const result=[];
 for(const s of selections) {
   if(s.lot_company!==p.company_id || (s.sub_lot_id&&(s.sub_company!==p.company_id||s.sub_parent!==s.lot_id)))
     throw stock.fail('Lote o división no disponible en la empresa.',400);
   const explicit=selected.get(key(s));
   // Legacy/ambiguous contexts never silently inherit the agronomic crop.
   const crop=explicit?.beneficiary_crop_id || (p.field_context==='growing_crop'?p.crop_id:null);
   if(!crop)throw stock.fail('Seleccioná explícitamente el cultivo beneficiario de cada lote para esta campaña.',400);
   const cropRow=(await client.query('SELECT id,name FROM crops WHERE company_id=$1 AND id=$2',[p.company_id,crop])).rows[0];
   if(!cropRow)throw stock.fail('Cultivo beneficiario no disponible en la empresa.',400);
   let assignment=explicit?.crop_assignment_id||null;
   if(assignment) {
     const found=await client.query(`SELECT id FROM crop_assignments WHERE company_id=$1 AND id=$2 AND campaign_id=$3 AND crop_id=$4
       AND lot_id=$5 AND sub_lot_id IS NOT DISTINCT FROM $6::uuid`,[p.company_id,assignment,p.campaign_id,crop,s.lot_id,s.sub_lot_id]);
     if(!found.rows.length)throw stock.fail('El ciclo beneficiario no corresponde a la campaña y destino.',400);
   }
   let appliedArea;
   try{appliedArea=stock.amount(money.input(s.area));}catch{throw stock.fail('La superficie aplicada debe ser válida y positiva.',400);}
   result.push({lot_id:s.lot_id,sub_lot_id:s.sub_lot_id,beneficiary_crop_id:crop, crop_assignment_id:assignment,
     lot_name_snapshot:s.lot_name,sub_lot_name_snapshot:s.sub_lot_name,crop_name_snapshot:cropRow.name,
     applied_area_ha:appliedArea,allocation_method:'area_proportional',
     allocation_note:'Prorrateado por superficie; no representa consumo medido por lote.'});
 }
 const w=weights(result.map(t=>t.applied_area_ha));
 return result.map((t,i)=>({...t,allocation_weight:w[i]}));
}
async function valueProduct(client,line,company) {
 const v=(await client.query('SELECT * FROM stock_batch_valuations WHERE company_id=$1 AND batch_id=$2 ORDER BY revision DESC LIMIT 1',[company,line.batch_id])).rows[0];
 const confirmed=v?.status==='confirmed'&&v.currency==='USD'&&v.unit_cost_usd!=null;
 return {...line,batch_valuation_id:v?.id??null,unit_cost_original:v?.unit_cost_original??null,currency:v?.currency??null,
   unit_cost_usd:confirmed?v.unit_cost_usd:null,amount_usd:confirmed?money.costText(money.productCost(line.quantity,v.unit_cost_usd)):null,
   cost_status:confirmed?'confirmed':'pending',provenance:'actual_stock_movement'};
}
async function writeSnapshot(client,p,lines,targets,laborStatus,{actorId,key,hash,previous,reason,effectiveDate}) {
 const pending=lines.some(l=>l.cost_status==='pending'),known=lines.some(l=>l.cost_status==='confirmed');
 const s=await insert(client,'economic_snapshots',{company_id:p.company_id,planning_id:p.id,revision:previous?previous.revision+1:1,
   supersedes_id:previous?.id??null,campaign_id:previous?.campaign_id??p.campaign_id,effective_date:previous?.effective_date??effectiveDate,
   activity_type_snapshot:previous?.activity_type_snapshot??p.activity_type,recipe_id:previous?.recipe_id??p.recipe_id??null,
   recipe_name_snapshot:previous?.recipe_name_snapshot??p.recipe_name_snapshot??null,labor_status:laborStatus,
   economic_status:pending?(known?'partial':'pending'):'complete',created_by:actorId,reason:reason??null,idempotency_key:key,request_hash:hash});
 for(const line of lines)await insert(client,'economic_snapshot_lines',{...line,company_id:p.company_id,snapshot_id:s.id});
 for(const target of targets)await insert(client,'economic_snapshot_targets',{...target,company_id:p.company_id,snapshot_id:s.id});
 return s;
}
// Called within the SAME transaction as Usage, movements and completion, before COMMIT.
async function capture(client,{planningId,companyId,actorId,effectiveDate,economic={}}) {
 const p=await planningRow(client,companyId,planningId,true);
 if(p.inventory_impact_mode==='HISTORICAL_NO_STOCK')return null;
 const previous=await latest(client,companyId,p.id);
 if(previous)return previous; // Existing completion is the operation's idempotency boundary.
 const data=parse(completionSchema,economic),targets=await targetsFor(client,p,data);
 const area=stock.amount(targets.reduce((n,t)=>n+money.input(t.applied_area_ha),0n));
 const {rows}=await client.query(`SELECT m.id AS stock_movement_id,m.usage_id,m.product_id,m.batch_id,(-m.quantity)::text AS quantity,
   m.unit AS unit_snapshot,pr.name AS product_name_snapshot,pp.id AS planning_product_id,
   CASE WHEN to_jsonb(pp)->>'dose_amount' IS NULL THEN NULL ELSE jsonb_build_object('amount',to_jsonb(pp)->>'dose_amount','unit',to_jsonb(pp)->>'dose_unit') END AS documented_dose
   FROM stock_movements m JOIN usage_records u ON u.id=m.usage_id AND u.company_id=m.company_id
   JOIN planning_product_completions pc ON pc.usage_id=u.id AND pc.planning_id=$2
   JOIN planning_products pp ON pp.id=pc.planning_product_id AND pp.product_id=m.product_id
   JOIN products pr ON pr.id=m.product_id AND pr.company_id=m.company_id
   WHERE m.company_id=$1 AND u.source_planning_id=$2 AND m.movement_type='consumption' ORDER BY m.id`,[companyId,p.id]);
 // Positive completions must be represented completely, zero completions create no product lines.
 const {rows:missing}=await client.query(`SELECT pc.planning_product_id FROM planning_product_completions pc
   LEFT JOIN usage_records u ON u.id=pc.usage_id AND u.company_id=$1
   WHERE pc.planning_id=$2 AND pc.actual_amount>0 AND (u.id IS NULL OR pc.actual_amount IS DISTINCT FROM
     (SELECT -sum(m.quantity) FROM stock_movements m WHERE m.company_id=$1 AND m.usage_id=u.id AND m.movement_type='consumption'))`,[companyId,p.id]);
 if(missing.length)throw stock.fail('La evidencia de consumo real está incompleta.');
 const lines=[];
 for(const row of rows)lines.push(await valueProduct(client,{...row,kind:'product'},companyId));
 const labor=data.labor||{status:'pending'},line=laborLine(labor,area);
 if(line)lines.push(line);
 return writeSnapshot(client,p,lines,targets,labor.status,{actorId,effectiveDate,key:'planning-execution:'+p.id,hash:stock.fingerprint({planningId,effectiveDate,economic:data})});
}
async function current(pool,{user,planningId}) {
 authorize(user);parse(uuid,planningId);await readablePlanning(pool,user,planningId);
 return {current:await details(pool,await latest(pool,user.company_id,planningId))};
}
async function history(pool,{user,planningId,page=1}) {
 authorize(user);parse(uuid,planningId);page=parse(z.coerce.number().int().min(1),page);
 await readablePlanning(pool,user,planningId);
 const {rows}=await pool.query('SELECT * FROM economic_snapshots WHERE company_id=$1 AND planning_id=$2 ORDER BY revision DESC LIMIT 25 OFFSET $3',[user.company_id,planningId,(page-1)*25]);
 const data=[];for(const s of rows)data.push(await details(pool,s));
 return {data,page,pageSize:25};
}
async function revise(pool,{user,planningId,key,body}) {
 authorize(user,true);parse(uuid,planningId);
 if(typeof key!=='string'||!key.trim()||key.length>200)throw stock.fail('Idempotency-Key obligatorio.',400);
 const data=parse(revisionSchema,body),hash=stock.fingerprint({planningId,actor:user.id,data});
 return stock.transaction(pool,async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['economic:'+user.company_id+':'+key]);
   const p=await readablePlanning(client,user,planningId,true);
   const replay=(await client.query('SELECT * FROM economic_snapshots WHERE company_id=$1 AND idempotency_key=$2',[user.company_id,key])).rows[0];
   if(replay){
     if(replay.request_hash!==hash)throw stock.fail('La clave corresponde a otra revisión.');
     return {current:await details(client,replay),replayed:true};
   }
   const previous=await latest(client,user.company_id,p.id);
   if(!previous || previous.id!==data.supersedes_id)throw stock.fail('La revisión cambió. Actualizá el detalle antes de continuar.');
   const old=await details(client,previous);
   const strip=({id,snapshot_id,company_id,...value})=>value;
   const lines=[];
   for(const row of old.lines.filter(l=>l.kind==='product')) {
     const line=strip(row);
     lines.push(line.cost_status==='confirmed'?line:await valueProduct(client,line,user.company_id));
   }
   const laborStatus=data.labor?.status??previous.labor_status;
   const labor=data.labor?laborLine(data.labor,old.area_ha):old.lines.find(l=>l.kind==='labor');
   if(labor)lines.push(strip(labor));
   const s=await writeSnapshot(client,p,lines,old.targets.map(strip),laborStatus,{actorId:user.id,key,hash,previous,reason:data.reason});
   return {current:await details(client,s),replayed:false};
 });
}
module.exports={capture,current,history,revise,completionInput,completionSchema,laborSchema,laborLine,weights,allowed,editKeys,readKeys};
