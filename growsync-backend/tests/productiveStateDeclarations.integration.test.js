const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{randomUUID}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const service=require('../services/productiveStateDeclarations'),{getStates,resolveUnit}=require('../services/productiveState');
let db,pool;
before(async()=>{db=new PGlite();await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');pool={async connect(){return {query:(s,a)=>db.query(s,a),release(){}}}};});
after(()=>db.close());
async function put(table,row){const keys=Object.keys(row);await db.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k,i)=>'$'+(i+1)+(typeof row[k]==='object'&&row[k]!==null?'::text::jsonb':'')).join(',')})`,keys.map(k=>typeof row[k]==='object'&&row[k]!==null?JSON.stringify(row[k]):row[k]));}
async function all(){const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;const out={};for(const {tablename:t} of tables)out[t]=(await db.query(`SELECT to_jsonb(x)::text value FROM "${t}" x ORDER BY to_jsonb(x)::text`)).rows.map(r=>r.value);return out;}
async function fixture(){
 await db.exec('DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS history_internal CASCADE; CREATE SCHEMA public;');
 for(const file of ['./historySchema.fixture.sql','../migrations/20260916_historical_no_stock.sql','../migrations/20261004_adopt_existing_history.sql','../migrations/20261006_productive_state_declarations.sql'])await db.exec(fs.readFileSync(require.resolve(file),'utf8'));
 const companyId=randomUUID(),actorId=randomUUID(),lot=randomUUID(),layout=randomUUID(),a=randomUUID(),b=randomUUID(),wheat=randomUUID(),soy=randomUUID(),campaign=randomUUID(),importId=randomUUID(),cycle=randomUUID();
 await put('companies',{id:companyId,name:'Synthetic T2'});await put('users',{id:actorId,company_id:companyId,email:'admin@example.test',role:3});
 await put('crops',{id:wheat,company_id:companyId,name:'Trigo'});await put('crops',{id:soy,company_id:companyId,name:'Soja'});
 await put('campaigns',{id:campaign,company_id:companyId,name:'Fixture',start_date:'2025-01-01'});
 await put('lots',{id:lot,company_id:companyId,name:'T2',area:70.97,area_ha:70.9676});
 await put('lot_layouts',{id:layout,company_id:companyId,lot_id:lot,version:1,status:'active',parent_geom_snapshot:'opaque identity fixture',parent_area_ha_snapshot:70.9676});
 for(const [id,name,area] of [[a,'T2-A',41.0802],[b,'T2-B',29.8872]])await put('sub_lots',{id,company_id:companyId,lot_id:lot,layout_id:layout,code:name,name,geom:'opaque identity fixture',area_ha:area});
 await put('historical_imports',{id:importId,company_id:companyId,idempotency_key:'fixture',request_hash:'fixture',imported_by:actorId,source:'fixture',payload:{}});
 const planning='74842b24-19cd-4f88-bf4b-3f43dedd7837';
 await put('planning',{id:planning,company_id:companyId,responsible_user:actorId,activity_type:'siembra',status:'completado',start_at:'2026-05-25T00:00:00-03:00',end_at:'2026-05-26T00:00:00-03:00',inventory_impact_mode:'HISTORICAL_NO_STOCK',historical_import_id:importId,campaign_id:campaign});
 await put('planning_lots',{planning_id:planning,lot_id:lot,area_ha:41.1});
 await put('crop_assignments',{id:cycle,company_id:companyId,lot_id:lot,crop_id:soy,campaign_id:campaign,start_date:'2025-12-05',area_ha:70.97,inventory_impact_mode:'HISTORICAL_NO_STOCK',historical_import_id:importId});
 for(const [name,amount] of [['Semilla Trigo',4521],['Fertilizante siembra trigo',2184.05]]){
  const product=randomUUID(),pp=randomUUID(),usage=randomUUID();await put('products',{id:product,company_id:companyId,name,unit:'kg',total_quantity:5000,available_quantity:5000});
  await put('planning_products',{id:pp,planning_id:planning,product_id:product,amount,unit:'kg'});
  await put('usage_records',{id:usage,company_id:companyId,product_id:product,amount_used:amount,unit:'kg',date:'2026-05-25',source_planning_id:planning,source_planning_product_id:pp,inventory_impact_mode:'HISTORICAL_NO_STOCK',historical_import_id:importId});
  await put('usage_lots',{usage_id:usage,lot_id:lot});await put('planning_product_completions',{planning_id:planning,planning_product_id:pp,usage_id:usage,actual_amount:amount});
  await put('stock_batches',{id:randomUUID(),company_id:companyId,product_id:product,initial_quantity:100,available_quantity:100,unit:'kg',origin:'legacy',created_by:actorId});
 }
 const declarations=[{lot_id:lot,sub_lot_id:a,layout_id:layout,kind:'growing_crop',crop_id:wheat,observed_on:'2026-10-06',source:'operational_confirmation',evidence:'Estado vigente confirmado',reason:'Inicio histórico sin reconciliar'},
 {lot_id:lot,sub_lot_id:b,layout_id:layout,kind:'stubble',crop_id:soy,observed_on:'2026-10-06',source:'operational_confirmation',evidence:'Rastrojo confirmado',reason:'Cierre histórico no documentado'}];
 const input={companyId,actorId,declarations};
 const read=date=>getStates(db,{companyId,lotId:lot,date,includeLegacy:false});
 return {companyId,actorId,lot,layout,a,b,wheat,soy,campaign,cycle,planning,input,read,
  prepare:()=>service.prepare(pool,input),confirm:(p,extra={})=>service.confirm(pool,{...input,fingerprint:p.fingerprint,key:'fixture-confirm',confirmed:true,...extra})};
}
const conflict=p=>assert.rejects(p,e=>e.status===409);
test('migración limpia no inserta declaraciones; prepare readonly estable y preview T2 comprensible',async()=>{
 const x=await fixture(),before=await all(),p=await x.prepare();assert.equal(p.persisted,false);assert.equal(p.items.length,2);assert.equal((await x.prepare()).fingerprint,p.fingerprint);assert.deepEqual(await all(),before);
 for(const i of p.items){assert.equal(i.after.source,'declaration');assert.equal(i.after.conflict,true);assert.match(i.warning,/historial pendiente/);}
});
test('T2 confirmado: A Trigo/B rastrojo Soja, historia/stock/usos exactos, idempotencia',async()=>{
 const x=await fixture(),before=await all(),p=await x.prepare(),r=await x.confirm(p),after=await all();
 for(const table of Object.keys(before).filter(t=>!['productive_state_declarations','historical_events','historical_imports'].includes(t)))assert.deepEqual(after[table],before[table],table);
 const states=(await x.read('2026-10-06')).data[0].units;const a=states.find(u=>u.sub_lot_id===x.a).state,b=states.find(u=>u.sub_lot_id===x.b).state;
 assert.equal(a.kind,'growing_crop');assert.equal(a.crop.name,'Trigo');assert.equal(b.kind,'stubble');assert.equal(b.crop.name,'Soja');
 for(const s of [a,b]){assert.equal(s.source,'declaration');assert.equal(s.effective_date,null);assert.equal(s.observed_on,'2026-10-06');assert.equal(s.conflict,true);assert.ok(s.conflicts.some(c=>c.assignment_id===x.cycle));}
 assert.deepEqual(await x.confirm(p),{...r,replayed:true});assert.deepEqual(await all(),after);
 await conflict(x.confirm(p,{declarations:[x.input.declarations[0]]}));
 await assert.rejects(require('../services/reconcileSowing').prepare(pool,{companyId:x.companyId,actorId:x.actorId,planningIds:[x.planning]}),e=>e.status===409);
});
test('fingerprint obligatorio y stale; key y confirmed obligatorios',async()=>{
 const x=await fixture(),p=await x.prepare();for(const patch of [{fingerprint:undefined},{key:undefined},{confirmed:false}])await assert.rejects(x.confirm(p,patch),e=>e.status===400);
 await db.query('UPDATE lots SET area_ha=area_ha+1 WHERE id=$1',[x.lot]);const before=await all();await conflict(x.confirm(p));assert.deepEqual(await all(),before);
});
test('append-only DB: UPDATE DELETE TRUNCATE y auto supersesión rechazados',async()=>{
 const x=await fixture(),r=await x.confirm(await x.prepare());
 for(const sql of ['UPDATE productive_state_declarations SET reason=reason','DELETE FROM productive_state_declarations','TRUNCATE productive_state_declarations'])await assert.rejects(db.exec(sql),/append.only/i);
 const priorB=(await db.query('SELECT id FROM productive_state_declarations WHERE sub_lot_id=$1',[x.b])).rows[0].id;
 await assert.rejects(put('productive_state_declarations',{id:randomUUID(),company_id:x.companyId,actor_id:x.actorId,...x.input.declarations[0],supersedes_id:priorB,coverage:null}));
 const self=randomUUID();await assert.rejects(put('productive_state_declarations',{id:self,company_id:x.companyId,actor_id:x.actorId,...x.input.declarations[0],supersedes_id:self,coverage:null}));
});
for(const [kind,crop] of [['growing_crop',null],['stubble',null],['fallow','yes'],['unknown','yes']])test('kind/crop inválido '+kind,async()=>{
 const x=await fixture(),d={...x.input.declarations[0],kind,crop_id:crop?x.wheat:null};await assert.rejects(service.prepare(pool,{...x.input,declarations:[d]}),e=>e.status===400);
 await assert.rejects(put('productive_state_declarations',{id:randomUUID(),company_id:x.companyId,actor_id:x.actorId,...d,coverage:null}));
});
test('tenant isolation y permisos efectivos',async()=>{
 const x=await fixture(),company=randomUUID(),actor=randomUUID();await put('companies',{id:company,name:'Other'});await put('users',{id:actor,company_id:company,email:'other@example.test',role:3});
 await conflict(service.prepare(pool,{...x.input,companyId:company,actorId:actor}));
 for(const patch of ["role=2","role=3,custom_permissions='[\"history.import\"]'::jsonb"]){await db.query('UPDATE users SET '+patch+' WHERE id=$1',[x.actorId]);await assert.rejects(x.prepare(),e=>e.status===403);}
});
test('sublote/lote/layout coherentes; layout activo requerido',async()=>{
 const x=await fixture();await conflict(service.prepare(pool,{...x.input,declarations:[{...x.input.declarations[0],layout_id:randomUUID()}]}));
 await assert.rejects(put('productive_state_declarations',{id:randomUUID(),company_id:x.companyId,actor_id:x.actorId,...x.input.declarations[0],sub_lot_id:x.b,lot_id:randomUUID(),coverage:null}));
 await db.query("UPDATE lot_layouts SET status='locked' WHERE id=$1",[x.layout]);await conflict(x.prepare());
});
test('supersedes mismo tenant/cobertura, conserva fila anterior y no bifurca',async()=>{
 const x=await fixture(),r=await x.confirm(await x.prepare()),prior=(await db.query('SELECT * FROM productive_state_declarations WHERE sub_lot_id=$1',[x.a])).rows[0];
 const input={...x.input,declarations:[{...x.input.declarations[0],kind:'fallow',crop_id:null,supersedes_id:prior.id,observed_on:'2026-10-07'}]};
 const p=await service.prepare(pool,input);await service.confirm(pool,{...input,fingerprint:p.fingerprint,key:'correction',confirmed:true});
 assert.deepEqual((await db.query('SELECT * FROM productive_state_declarations WHERE id=$1',[prior.id])).rows[0],prior);
 assert.equal((await x.read('2026-10-06')).data[0].units.find(u=>u.sub_lot_id===x.a).state.kind,'growing_crop');
 assert.equal((await x.read('2026-10-07')).data[0].units.find(u=>u.sub_lot_id===x.a).state.kind,'fallow');
 await conflict(service.prepare(pool,input));
});
test('declaración futura no aplica y cambio de layout no transfiere estado',async()=>{
 const x=await fixture();await x.confirm(await x.prepare());assert.equal((await x.read('2026-10-05')).data[0].units[0].state.source,'derived');
 await db.query("UPDATE lot_layouts SET status='locked' WHERE id=$1",[x.layout]);
 const states=(await x.read('2026-10-06')).data[0].units;assert.equal(states.length,1);assert.equal(states[0].state.source,'derived');assert.equal(states[0].state.crop.name,'Soja');
 assert.ok(states[0].state.conflicts.some(c=>c.type==='declaration_coverage_changed'));
});
test('hecho real posterior vence declaración; importación tardía anterior no',async()=>{
 const x=await fixture();await x.confirm(await x.prepare());
 const insertCycle=(date,created)=>put('crop_assignments',{id:randomUUID(),company_id:x.companyId,lot_id:x.lot,sub_lot_id:x.a,crop_id:x.wheat,campaign_id:x.campaign,start_date:date,area_ha:41.08,created_at:created});
 await insertCycle('2026-09-01','2026-11-01');assert.equal((await x.read('2026-10-11')).data[0].units.find(u=>u.sub_lot_id===x.a).state.source,'declaration');
 await insertCycle('2026-10-10','2026-10-10');const s=(await x.read('2026-10-11')).data[0].units.find(u=>u.sub_lot_id===x.a).state;
 assert.equal(s.source,'derived');assert.equal(s.effective_date,'2026-10-10');
});
for(const [table,body] of [['productive_state_declarations','UPDATE products SET available_quantity=available_quantity+1;'],['historical_events',"UPDATE planning SET title='unexpected';"]])test('rollback total efecto de trigger '+table,async()=>{
 const x=await fixture();await db.exec(`CREATE FUNCTION attack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} RETURN NEW; END $$; CREATE TRIGGER attack AFTER INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION attack();`);
 const p=await x.prepare(),before=await all();await conflict(x.confirm(p));assert.deepEqual(await all(),before);
});
const unit={lot_id:'lot',sub_lot_id:'a',layout_id:'v1',coverage:{id:'a'}};
const cycle={id:'soja',lot_id:'lot',sub_lot_id:null,crop_id:'soy',crop_name:'Soja',start_date:'2025-12-05',end_date:null,area_ha:70.97,harvests:[],closures:[]};
const declaration={id:'decl',lot_id:'lot',sub_lot_id:'a',layout_id:'v1',coverage:unit.coverage,kind:'growing_crop',crop_id:'wheat',crop_name:'Trigo',observed_on:'2026-10-06'};
test('empates incompatibles de declaraciones y hechos se exponen',()=>{
 const other={...declaration,id:'other',kind:'stubble',crop_id:'soy',crop_name:'Soja'};
 const s=resolveUnit(unit,'2026-10-06',[cycle],[declaration,other]);assert.equal(s.kind,'unknown');assert.equal(s.quality,'ambiguous');assert.ok(s.conflicts.some(c=>c.type==='incompatible_declarations'));
 const same={...cycle,id:'same',start_date:'2026-10-06'};assert.ok(resolveUnit(unit,'2026-10-06',[same],[declaration]).conflicts.some(c=>c.type==='same_day_fact_conflict'));
});
test('ausencia no es barbecho; legacy/pérdida no prueban rastrojo; parcial conserva cultivo',()=>{
 assert.equal(resolveUnit(unit,'2026-10-06').kind,'unknown');
 for(const source of ['legacy','manual'])assert.equal(resolveUnit(unit,'2026-10-06',[{...cycle,end_date:'2026-09-01',harvest_closure_source:source}]).kind,'unknown');
 const partial={...cycle,harvests:[{id:'h',enabled:true,harvest_date:'2026-10-07',harvested_area_ha:10}]};
 assert.equal(resolveUnit(unit,'2026-10-08',[partial],[declaration]).kind,'growing_crop');
 assert.equal(resolveUnit(unit,'2026-10-08',[partial],[declaration]).source,'derived');
});
test('cierre automático completo respaldado deriva rastrojo desde después del día activo inclusivo',()=>{
 const complete={...cycle,end_date:'2026-10-07',harvest_closure_source:'automatic',harvests:[{id:'h',enabled:true,harvest_date:'2026-10-07',harvested_area_ha:70.97}]};
 assert.equal(resolveUnit(unit,'2026-10-07',[complete]).kind,'growing_crop');
 const s=resolveUnit(unit,'2026-10-08',[complete],[declaration]);assert.equal(s.kind,'stubble');assert.equal(s.source,'derived');assert.equal(s.effective_date,'2026-10-07');
});

test('supersedes de otra empresa rechazado en API y trigger',async()=>{
 const x=await fixture();await x.confirm(await x.prepare());const prior=(await db.query('SELECT * FROM productive_state_declarations LIMIT 1')).rows[0];
 const other=randomUUID(),actor=randomUUID(),lot=randomUUID();await put('companies',{id:other,name:'Other'});await put('users',{id:actor,company_id:other,email:'other@fixture.test',role:3});await put('lots',{id:lot,company_id:other,name:'Whole',area:1,area_ha:1});
 const declaration={lot_id:lot,sub_lot_id:null,layout_id:null,kind:'fallow',crop_id:null,observed_on:'2026-10-07',source:'fixture',evidence:'known',reason:'test',supersedes_id:prior.id};
 await conflict(service.prepare(pool,{companyId:other,actorId:actor,declarations:[declaration]}));
 await assert.rejects(put('productive_state_declarations',{id:randomUUID(),company_id:other,actor_id:actor,...declaration,coverage:null}));
});
test('whole-lot sin layout admite declaración; subdividir después no la transfiere',async()=>{
 const x=await fixture(),lot=randomUUID();await put('lots',{id:lot,company_id:x.companyId,name:'Whole',area:1,area_ha:1});
 const input={...x.input,declarations:[{...x.input.declarations[0],lot_id:lot,sub_lot_id:null,layout_id:null,kind:'unknown',crop_id:null}]};
 const p=await service.prepare(pool,input);await service.confirm(pool,{...input,fingerprint:p.fingerprint,key:'whole',confirmed:true});
 assert.equal((await getStates(db,{companyId:x.companyId,lotId:lot,date:'2026-10-06',includeLegacy:false})).data[0].units[0].state.source,'declaration');
 await assert.rejects(put('productive_state_declarations',{id:randomUUID(),company_id:x.companyId,actor_id:x.actorId,...x.input.declarations[0],sub_lot_id:null,coverage:null}),/each active sublot/);
});
test('prepare DB impide escrituras de helpers y fecha inexistente rechazada',async()=>{
 const x=await fixture(),before=await all();let attempted=false;
 const badPool={async connect(){return {release(){},async query(sql,args){if(sql.startsWith('SELECT c.relname,c.relkind')&&!attempted){attempted=true;await db.query("UPDATE lots SET name='unexpected'");}return db.query(sql,args);}}}};
 await assert.rejects(service.prepare(badPool,x.input),/read.only/i);assert.deepEqual(await all(),before);
 await assert.rejects(getStates(db,{companyId:x.companyId,date:'2026-02-30',includeLegacy:false}),e=>e.status===400);
});
test('cierre manual posterior con pérdida es hecho unknown, no rastrojo',()=>{
 const manual={...cycle,end_date:'2026-10-07',harvest_closure_source:'manual',closures:[{id:'loss',reason:'loss',finalized_date:'2026-10-07'}]};
 const s=resolveUnit(unit,'2026-10-08',[manual],[declaration]);assert.equal(s.kind,'unknown');assert.equal(s.source,'derived');assert.equal(s.effective_date,'2026-10-07');
});
test('HTTP administrativos usan sesión y payload estricto sin inicializar Supabase',async t=>{
 const x=await fixture(),express=require('express'),app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:x.actorId,company_id:x.companyId,role:3};next();});
 app.use('/api/history/productive-state-declarations',require('../routes/productiveStateDeclarations')(pool));app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const url='http://127.0.0.1:'+server.address().port+'/api/history/productive-state-declarations/';
 const post=(op,body,key)=>fetch(url+op,{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});
 assert.equal((await post('prepare',{declarations:x.input.declarations,company_id:x.companyId})).status,400);
 const p=await post('prepare',{declarations:x.input.declarations});assert.equal(p.status,200);assert.equal(p.headers.get('cache-control'),'no-store');const preview=await p.json();
 const body={declarations:x.input.declarations,fingerprint:preview.fingerprint,confirmed:true};assert.equal((await post('confirm',body)).status,400);
 assert.equal((await post('confirm',body,'http')).status,201);assert.equal((await post('confirm',body,'http')).status,200);
});

test('empate de hechos incompatible devuelve unknown y evidencia de ambos',()=>{
 const wheat={...cycle,id:'wheat',crop_id:'wheat',crop_name:'Trigo',start_date:'2026-10-10'};
 const soy={...cycle,start_date:'2026-10-10'};
 const state=resolveUnit(unit,'2026-10-11',[wheat,soy]);assert.equal(state.kind,'unknown');assert.equal(state.quality,'ambiguous');assert.ok(state.conflicts.some(c=>c.type==='incompatible_facts'));
});
test('cambio de geometría dentro del mismo layout no conserva declaración aplicable',async()=>{
 const x=await fixture();await x.confirm(await x.prepare());await db.query("UPDATE sub_lots SET geom='changed geometry' WHERE id=$1",[x.a]);
 const state=(await x.read('2026-10-06')).data[0].units.find(u=>u.sub_lot_id===x.a).state;assert.equal(state.source,'derived');assert.ok(state.conflicts.some(c=>c.type==='declaration_coverage_changed'));
});

test('nueva siembra posterior seguida por cierre no respaldado termina unknown, no cultivo activo perpetuo',()=>{
 const later={...cycle,id:'new',start_date:'2026-10-10',end_date:'2026-10-20',harvest_closure_source:'legacy'};
 const state=resolveUnit(unit,'2026-10-21',[later],[declaration]);assert.equal(state.kind,'unknown');assert.equal(state.source,'derived');
});

test('compatibilidad de área y enabled nullable en lectura, con creación administrativa estricta',async()=>{
 const x=await fixture(),lot=randomUUID();await put('lots',{id:lot,company_id:x.companyId,name:'Legacy enabled',enabled:null,area:10,area_ha:null});
 const result=await getStates(db,{companyId:x.companyId,lotId:lot,date:'2026-10-06',includeLegacy:false});assert.equal(Number(result.data[0].units[0].area_ha),10);
 const declaration={...x.input.declarations[0],lot_id:lot,sub_lot_id:null,layout_id:null,kind:'unknown',crop_id:null};await conflict(service.prepare(pool,{...x.input,declarations:[declaration]}));
});

test('cobertura usa texto JSONB exacto y no números redondeados de JavaScript',()=>{
 const sameParsed={coords:[1]};
 const u={...unit,coverage:sameParsed,coverage_key:'{"coords": [1.0000000000000001]}'};
 const d={...declaration,coverage:sameParsed,coverage_key:'{"coords": [1.0000000000000002]}'};
 const state=resolveUnit(u,'2026-10-06',[cycle],[d]);assert.equal(state.source,'derived');assert.ok(state.conflicts.some(c=>c.type==='declaration_coverage_changed'));
});

for(const kind of ['growing_crop','stubble'])test(kind+' admite crop deshabilitado de la empresa en DB y prepare/confirm',async()=>{
 const x=await fixture(),crop=kind==='growing_crop'?x.wheat:x.soy;
 await db.query('UPDATE crops SET enabled=false WHERE id=$1',[crop]);
 const declaration={...x.input.declarations[0],kind,crop_id:crop};
 // Direct DB insertion proves that the migration trigger accepts the inactive catalog entry.
 await put('productive_state_declarations',{id:randomUUID(),company_id:x.companyId,actor_id:x.actorId,...declaration,coverage:null});
 const input={...x.input,declarations:[{...declaration,sub_lot_id:x.b}]};
 const before=await all(),preview=await service.prepare(pool,input);assert.deepEqual(await all(),before);
 assert.equal(preview.items[0].crop.id,crop);
 const result=await service.confirm(pool,{...input,fingerprint:preview.fingerprint,key:'disabled-'+kind,confirmed:true});
 const saved=(await db.query('SELECT * FROM productive_state_declarations WHERE id=$1',[result.declaration_ids[0]])).rows[0];
 assert.equal(saved.kind,kind);assert.equal(saved.crop_id,crop);
 assert.equal((await db.query('SELECT enabled FROM crops WHERE id=$1',[crop])).rows[0].enabled,false);
 const after=await all();for(const table of Object.keys(before).filter(t=>!['productive_state_declarations','historical_events','historical_imports'].includes(t)))assert.deepEqual(after[table],before[table],table);
});
for(const foreign of [false,true])test(foreign?'crop de otra empresa sigue rechazado':'crop inexistente sigue rechazado',async()=>{
 const x=await fixture(),crop=randomUUID();
 if(foreign){const company=randomUUID();await put('companies',{id:company,name:'Other crop owner'});await put('crops',{id:crop,company_id:company,name:'Other crop',enabled:false});}
 for(const kind of ['growing_crop','stubble']){
  const declaration={...x.input.declarations[0],kind,crop_id:crop};
  await conflict(service.prepare(pool,{...x.input,declarations:[declaration]}));
  await assert.rejects(put('productive_state_declarations',{id:randomUUID(),company_id:x.companyId,actor_id:x.actorId,...declaration,coverage:null}),e=>e.code==='23514');
 }
});
