// Real controller + PostgreSQL semantics in disposable PGlite. No .env/network/production.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),{randomUUID:uuid}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const notifications=require('../services/planningNotifications'),schema=require('../validations/planning.schema'),recipes=require('../services/recipes');
let db,client,controller,events=[],inTransaction=false,failCommit=false,failNotification=false;
const migration=fs.readFileSync(require.resolve('../migrations/20261018_planning_assignment.sql'),'utf8');
before(async()=>{
  db=new PGlite();await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const f of ['./historySchema.fixture.sql','../migrations/20260916_historical_no_stock.sql','../migrations/20261007_planning_effective_area.sql',
    '../migrations/20261008_planning_field_context.sql','../migrations/20261012_recipes.sql','../migrations/20261012_planning_recipe_snapshots.sql','../migrations/20261018_planning_assignment.sql'])
    await db.exec(fs.readFileSync(require.resolve(f),'utf8'));
  await db.exec('CREATE FUNCTION ST_AsGeoJSON(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;');
  client={async query(sql,args){
    if(sql==='COMMIT' && failCommit){failCommit=false;throw Error('Synthetic failed commit');}
    if(sql==='BEGIN')inTransaction=true;
    const result=sql.includes('ST_MakeValid')?{rows:[]}:await db.query(sql,args);
    if(['COMMIT','ROLLBACK'].includes(sql))inTransaction=false;
    return result;
  },release(){}};
  const filename=require.resolve('../controllers/planning'),actual=createRequire(filename),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,require:name=>{
    if(name==='../db/supabaseClient')return {pool:{...client,connect:async()=>client}};
    if(name==='./notifications')return {createNotification:async(...args)=>{
      assert.equal(inTransaction,false,'notifications must follow COMMIT');
      if(failNotification)throw Error('Synthetic notification outage');
      events.push(args);return {id:uuid()};
    }};
    return actual(name);
  }},{filename});controller=module.exports;
});
after(()=>db?.close());
async function put(table,row){const keys=Object.keys(row);await db.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]));}
async function fixture(){
  events=[];failNotification=false;
  const company=uuid(),actor=uuid(),responsible=uuid(),third=uuid(),lot=uuid(),lot2=uuid(),crop=uuid(),campaign=uuid(),product=uuid();
  await put('companies',{id:company,name:'Synthetic assignment company'});
  for(const [id,name] of [[actor,'Juan Pérez'],[responsible,'Agustina Airasca'],[third,'María Gómez']])await put('users',{id,company_id:company,full_name:name,email:id+'@example.test',role:3});
  for(const id of [lot,lot2])await put('lots',{id,company_id:company,name:'Lote sintético',area:100,area_ha:100});
  await put('crops',{id:crop,company_id:company,name:'Maíz'});
  await put('campaigns',{id:campaign,company_id:company,name:'2026',start_date:'2026-01-01',end_date:'2026-12-31'});
  await put('products',{id:product,company_id:company,name:'Producto sintético',unit:'L',total_quantity:0,available_quantity:0});
  const body={title:'Fumigación lote T4',activity_type:'fumigacion',field_context:'stubble',crop_id:crop,campaign_id:campaign,
    start_at:'2026-10-21T00:00:00.000Z',end_at:'2026-10-21T00:00:00.000Z',responsible_user:responsible,status:'pendiente',lot_selections:[{lot_id:lot,effective_area_ha:10}]};
  const call=async(method,body={},id,actorId=actor,query={})=>{
    let data,code=200;await controller[method]({body,params:{id},query,user:{id:actorId,company_id:company,role:3}},
      {status(value){code=value;return this;},json(value){data=value;return this;}},error=>{throw error;});return {code,data};
  };
  return {company,actor,responsible,third,lot,lot2,crop,campaign,product,body,call,create:async(patch={})=>(await call('create',{...body,...patch})).data.id,
    row:async id=>(await db.query('SELECT * FROM planning WHERE id=$1',[id])).rows[0]};
}
test('assignment after commit: actor, work, calendar date, destination, company and metadata',async()=>{
  const x=await fixture(),id=await x.create();assert.equal(events.length,1);const e=events[0];
  assert.equal(e[0],x.responsible);assert.equal(e[1],'planning_assigned');assert.equal(e[3],'Nueva tarea asignada');
  assert.equal(e[4],'Juan Pérez te asignó “Fumigación lote T4” para el 21/10/2026.');
  assert.deepEqual(e[5],{planning_id:id,action:'assigned',actor_user_id:x.actor,activity_type:'fumigacion',start_at:new Date(x.body.start_at),end_at:new Date(x.body.end_at)});
  assert.equal(e[6],x.company);const row=await x.row(id);assert.equal(row.created_by,x.actor);assert.equal(row.assigned_by,x.actor);assert.ok(row.assigned_at instanceof Date);
  const detail=(await x.call('getOne',{},id)).data;assert.equal(detail.assigned_by_name,'Juan Pérez');assert.equal(detail.responsible_name,'Agustina Airasca');
});
test('friendly fallbacks and periods keep calendar day in Argentina',async()=>{
  const x=await fixture();await db.query("UPDATE users SET full_name=' ',email='juan@example.test' WHERE id=$1",[x.actor]);
  await x.create({title:' ',end_at:'2026-10-22T00:00:00Z'});assert.match(events[0][4],/juan@example.test te asignó “Fumigación sobre rastrojo de Maíz” del 21\/10\/2026 al 22\/10\/2026/);
  assert.equal(notifications.displayName({}),'Usuario');assert.equal(notifications.planningDisplayName({}),'Trabajo planificado');
});
for(const invalid of ['foreign','disabled','missing'])test('responsible '+invalid+' is rejected on create/update/register-completed',async()=>{
  const x=await fixture(),id=await x.create();let target=uuid();
  if(invalid==='foreign')target=(await fixture()).responsible;
  if(invalid==='disabled'){target=x.third;await db.query('UPDATE users SET enabled=false WHERE id=$1',[target]);}
  events=[];
  for(const method of ['create','update','registerCompleted']){
    const body=method==='update'?{responsible_user:target}:{...x.body,responsible_user:target,effective_date:'2026-10-21'};
    await assert.rejects(x.call(method,body,id),e=>e.status===400 && /responsable/.test(e.message));
  }
  assert.equal(events.length,0);assert.equal((await x.row(id)).responsible_user,x.responsible);
});
test('self assignment, self update and self cancellation are silent',async()=>{
  const x=await fixture(),id=await x.create({responsible_user:x.actor});await x.call('update',{title:'Otro título'},id);await x.call('remove',{},id);assert.equal(events.length,0);
});
for(const key of ['created_by','assigned_by','assigned_at','actor_user_id'])test('public authorship field '+key+' rejected in schemas and controllers',async()=>{
  const x=await fixture(),value=key==='assigned_at'?'2026-01-01T00:00:00Z':x.third,id=await x.create();events=[];
  for(const [method,contract] of [['create',schema.createSchema],['update',schema.updateSchema],['registerCompleted',schema.registerCompletedSchema]]){
    const body={...x.body,effective_date:'2026-10-21',[key]:value};
    assert.equal(contract.safeParse({body,params:{id}}).success,false);
    await assert.rejects(x.call(method,body,id),e=>e.status===400);
  }
  for(const contract of [schema.completeWorkSchema,schema.completeSowingSchema])assert.equal(contract.safeParse({params:{id},body:{effective_date:'2026-10-21',[key]:value}}).success,false);
  assert.equal(events.length,0);
});
test('reassign once: new assigned, former unassigned, server metadata changes; replay silent',async()=>{
  const x=await fixture(),id=await x.create(),old=await x.row(id);events=[];
  await x.call('update',{responsible_user:x.third},id,x.responsible);
  assert.equal(events.length,1);assert.equal(events[0][0],x.third); // old responsible is actor
  const row=await x.row(id);assert.equal(row.assigned_by,x.responsible);assert.ok(row.assigned_at>=old.assigned_at);
  events=[];await x.call('update',{responsible_user:x.responsible},id);
  assert.deepEqual(events.map(e=>[e[0],e[1]]),[[x.responsible,'planning_assigned'],[x.third,'planning_unassigned']]);
  const assigned=await x.row(id);events=[];await x.call('update',{responsible_user:x.responsible.toUpperCase(),description:'Texto'},id);
  assert.equal(events.length,0);assert.equal((await x.row(id)).assigned_at.getTime(),assigned.assigned_at.getTime());
});
test('dates compare instants, no-op status/responsible and description produce no notifications',async()=>{
  const x=await fixture(),id=await x.create();events=[];
  await x.call('update',{start_at:'2026-10-21T00:00:00Z',end_at:'2026-10-21T00:00:00.000Z',status:'pendiente',responsible_user:x.responsible,description:'Corrección'},id);
  assert.equal(events.length,0);
  const change={start_at:'2026-10-23T00:00:00Z',end_at:'2026-10-23T00:00:00Z'};
  await x.call('update',change,id);assert.equal(events.length,1);assert.deepEqual(events[0][5].changed_fields,['dates']);assert.match(events[0][4],/23\/10\/2026/);
  events=[];await x.call('update',change,id);assert.equal(events.length,0);
});
test('lots compare identity and effective areas independently of order',async()=>{
  const x=await fixture(),lots=[{lot_id:x.lot,effective_area_ha:10},{lot_id:x.lot2,effective_area_ha:20}],id=await x.create({lot_selections:lots});events=[];
  await x.call('update',{lot_selections:[...lots].reverse()},id);assert.equal(events.length,0);
  await x.call('update',{lot_selections:[{...lots[0],effective_area_ha:11},lots[1]]},id);assert.equal(events.length,1);assert.deepEqual(events[0][5].changed_fields,['lots']);
  events=[];await x.call('update',{lot_selections:[lots[0]]},id);assert.equal(events.length,1);
});
test('products normalize persisted amounts; aggregate multiple changes and ignore regenerated IDs',async()=>{
  const x=await fixture(),products=[{product_id:x.product,amount:'2',unit:'L'}],id=await x.create({products});events=[];
  await x.call('update',{products:[{...products[0],amount:'2.000000'}]},id);assert.equal(events.length,0);
  const patch={products:[{...products[0],amount:'3'}],title:'Nuevo trabajo',start_at:'2026-10-22T00:00:00Z',end_at:'2026-10-22T00:00:00Z',lot_selections:[{lot_id:x.lot2,effective_area_ha:10}]};
  await x.call('update',patch,id);assert.equal(events.length,1);assert.deepEqual(events[0][5].changed_fields,['dates','work','lots','products']);
  events=[];await x.call('update',patch,id);assert.equal(events.length,0);
});
test('recipe change is one notification; same snapshot and reordered products are silent',async()=>{
  const x=await fixture(),id=await x.create();
  const recipe=await recipes.create({...client,connect:async()=>client},{companyId:x.company,actorId:x.actor,body:{name:'Receta sintética',activity_type:'fumigacion',field_context:'stubble',crop_id:x.crop,items:[{product_id:x.product,dose_amount:'250',dose_unit:'mL'}]}});
  events=[];await x.call('update',{recipe_id:recipe.id},id);assert.equal(events.length,1);assert.deepEqual(events[0][5].changed_fields,['products']);
  events=[];await x.call('update',{recipe_id:recipe.id},id);assert.equal(events.length,0);
  const before={products:[{product_id:'a',amount:1},{product_id:'b',amount:2}]},after={products:[{product_id:'b',amount:'2.000000',id:'new'},{product_id:'a',amount:'1'}]};
  assert.deepEqual(notifications.detectMeaningfulChanges(before,after),[]);
});
test('status only notifies on an actual transition and never duplicates update',async()=>{
  const x=await fixture(),id=await x.create();events=[];await x.call('update',{status:'en_progreso',title:'En marcha'},id);assert.equal(events.length,1);assert.deepEqual(events[0][5].changed_fields,['work','status']);
  events=[];await x.call('update',{status:'en_progreso'},id);assert.equal(events.length,0);
});
test('cancellation notifies once after commit; repeated cancellation is rejected without another notice',async()=>{
  const x=await fixture(),id=await x.create();events=[];await x.call('remove',{},id);assert.equal(events.length,1);assert.equal(events[0][1],'planning_cancelled');
  const repeated=await x.call('remove',{},id);assert.equal(repeated.code,409);assert.equal(events.length,1);
});
test('failed COMMIT rolls back all assignment metadata and never dispatches',async()=>{
  const x=await fixture();failCommit=true;await assert.rejects(x.create(),/Synthetic failed commit/);assert.equal(events.length,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM planning WHERE company_id=$1',[x.company])).rows[0].n,0);
});
test('notification outage after COMMIT leaves successful response and persisted planning',async()=>{
  const x=await fixture();failNotification=true;try{const id=await x.create();assert.ok(await x.row(id));assert.equal(inTransaction,false);}finally{failNotification=false;}
});
test('retrospective registerCompleted records authenticated author without assignment notification',async()=>{
  const x=await fixture(),result=await x.call('registerCompleted',{...x.body,activity_type:'riego',effective_date:'2026-10-21'});
  assert.equal(result.code,201);assert.equal(events.length,0);assert.equal((await x.row(result.data.id)).created_by,x.actor);
});
for(const method of ['completeWork','completeSowing','update'])test(method+' completion notifies assigner, not responsible actor, and retry is silent',async()=>{
  const x=await fixture(),id=await x.create(method==='completeSowing'?{activity_type:'siembra',field_context:null,lot_selections:[{lot_id:x.lot}]}:method==='update'?{activity_type:'riego'}:{});events=[];
  const body=method==='update'?{status:'completado'}:{effective_date:'2026-10-21'};
  await x.call(method,body,id,x.responsible);assert.equal(events.length,1);assert.equal(events[0][0],x.actor);assert.equal(events[0][1],'planning_completed');assert.match(events[0][4],/Agustina Airasca completó/);
  events=[];
  if(method==='completeWork')await assert.rejects(x.call(method,body,id,x.responsible),e=>e.status===409);
  else await x.call(method,body,id,x.responsible);
  assert.equal(events.length,0);
});
test('completion fallback to creator for old metadata, all-self completion silent',async()=>{
  const x=await fixture(),id=await x.create();await db.query('UPDATE planning SET assigned_by=NULL,assigned_at=NULL WHERE id=$1',[id]);events=[];
  await x.call('completeWork',{effective_date:'2026-10-21'},id,x.responsible);assert.equal(events[0][0],x.actor);
  const y=await fixture(),self=await y.create({responsible_user:y.actor});await y.call('completeWork',{effective_date:'2026-10-21'},self);assert.equal(events.length,0);
});
test('foreign actor, planning and corrupt recipients cannot cross tenants',async()=>{
  const x=await fixture(),id=await x.create(),other=await fixture();events=[];
  assert.equal((await other.call('getOne',{},id)).code,404);assert.equal((await other.call('update',{title:'No'},id)).code,404);assert.equal((await other.call('remove',{},id)).code,404);
  await assert.rejects(x.call('update',{responsible_user:x.third},id,other.actor),e=>e.status===400);
  await db.query('UPDATE planning SET responsible_user=$1,assigned_by=$2 WHERE id=$3',[other.responsible,other.actor,id]);
  await x.call('update',{title:'Updated'},id);assert.equal(events.length,0);
  await x.call('completeWork',{effective_date:'2026-10-21'},id,x.responsible);assert.equal(events.length,0);
});
test('disabled former recipient is not notified; disabled metadata does not widen GET permission',async()=>{
  const x=await fixture(),id=await x.create();await db.query('UPDATE users SET enabled=false WHERE id=$1',[x.responsible]);events=[];
  await x.call('update',{responsible_user:x.third},id);assert.equal(events.length,1);assert.equal(events[0][0],x.third);
  await x.call('remove',{},id);let code=200;
  await controller.getOne({params:{id},user:{id:x.third,company_id:x.company,role:0,custom_permissions:['planning.view']}},{status(n){code=n;return this;},json(){}},e=>{throw e;});assert.equal(code,403);
});
test('assignment migration is repeatable, preserves existing rows and has a real FK',async()=>{
  const x=await fixture(),id=await x.create();const old=await x.row(id);await db.exec(migration);await db.exec(migration);assert.deepEqual(await x.row(id),old);
  await assert.rejects(db.query('UPDATE planning SET assigned_by=$1 WHERE id=$2',[uuid(),id]),e=>e.code==='23503');
  await db.query('UPDATE planning SET assigned_by=NULL,assigned_at=NULL WHERE id=$1',[id]);await db.exec(migration);
  const detail=(await x.call('getOne',{},id)).data;assert.equal(detail.assigned_by_name,null);assert.equal(detail.assigned_at,null);
});

test('public historical correction validates reassignment without notices or productive writes',async()=>{
  const x=await fixture(),id=uuid();
  await put('planning',{id,company_id:x.company,title:'Antecedente',activity_type:'fumigacion',start_at:'2020-01-01',end_at:'2020-01-01',responsible_user:x.responsible,created_by:x.actor,status:'completado',inventory_impact_mode:'HISTORICAL_NO_STOCK'});
  await put('crop_assignments',{id:uuid(),company_id:x.company,campaign_id:x.campaign,lot_id:x.lot,crop_id:x.crop,start_date:'2020-01-01',area_ha:10,source_planning_id:id,inventory_impact_mode:'HISTORICAL_NO_STOCK'});
  const mutate=require('../services/historicalMutation').mutate,pool={...client,connect:async()=>client};
  const input={companyId:x.company,actorId:x.actor,table:'planning',id};
  await db.query('UPDATE users SET enabled=false WHERE id=$1',[x.third]);
  await assert.rejects(mutate(pool,{...input,body:{responsible_user:x.third}}),e=>e.status===400);
  await assert.rejects(mutate(pool,{...input,body:{created_by:x.third}}),e=>e.status===400);
  await db.query('UPDATE users SET enabled=true WHERE id=$1',[x.third]);
  const stockBefore=(await db.query('SELECT * FROM stock_movements WHERE company_id=$1',[x.company])).rows;
  await mutate(pool,{...input,body:{responsible_user:x.third}});
  const current=await x.row(id);assert.equal(current.assigned_by,x.actor);assert.ok(current.assigned_at);assert.equal(current.created_by,x.actor);assert.equal(current.status,'completado');
  assert.equal(events.length,0);assert.deepEqual((await db.query('SELECT * FROM stock_movements WHERE company_id=$1',[x.company])).rows,stockBefore);
  await mutate(pool,{...input,body:{description:'Nota'}});assert.equal((await x.row(id)).assigned_at.getTime(),current.assigned_at.getTime());
});

test('HTTP public routes preserve view/edit/create/complete permissions and reject impersonation',async t=>{
  const x=await fixture(),id=await x.create(),express=require('express'),app=express();let permissions=['planning.create','planning.edit','planning.view'];
  const filename=require.resolve('../routes/planning'),actual=createRequire(filename),module={exports:{}};
  const pass=(req,res,next)=>next();
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,require:name=>name==='../controllers/planning'?controller:name==='../middleware/historicalOperations'?{rejectModeInput:pass,historical:()=>pass,blockHistorical:()=>pass}:actual(name)},{filename});
  app.use(express.json());app.use((req,res,next)=>{req.user={id:x.actor,company_id:x.company,role:0,custom_permissions:permissions};next();});app.use('/api/planning',module.exports);
  app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const url='http://127.0.0.1:'+server.address().port+'/api/planning';
  const send=(path,method,body)=>fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  for(const field of ['created_by','assigned_by','assigned_at','actor_user_id']){
    const body={...x.body,[field]:x.third};assert.equal((await send('','POST',body)).status,400);assert.equal((await send('/'+id,'PATCH',body)).status,400);
    assert.equal((await send('/register-completed','POST',{...body,effective_date:'2026-10-21'})).status,400);
  }
  permissions=['planning.create'];assert.equal((await fetch(url+'/'+id)).status,403);
  assert.equal((await send('/'+id,'PATCH',{title:'Denied'})).status,403);
  assert.equal((await send('/'+id+'/complete-work','POST',{effective_date:'2026-10-21'})).status,403);
  permissions=['planning.view'];assert.equal((await fetch(url+'/'+id)).status,200);assert.equal((await send('','POST',x.body)).status,403);
  for(const mine of ['true','1']){
    const response=await fetch(url+'?mine='+mine+'&user_id='+x.responsible);
    assert.equal(response.status,200);assert.equal((await response.json()).total,0);
  }
  const conflict=await fetch(url+'?mine=true&responsible='+x.responsible);
  assert.equal(conflict.status,400);assert.match((await conflict.json()).message,/No se puede combinar/);
  for(const mine of ['false','0'])assert.equal((await (await fetch(url+'?mine='+mine)).json()).total,1);
  assert.equal((await fetch(url+'?mine=invalid')).status,400);
  permissions=[];assert.equal((await fetch(url+'?mine=true')).status,403);permissions=['planning.view'];
  await x.call('remove',{},id);assert.equal((await fetch(url+'/'+id)).status,403);
  permissions=['planning.view','planning.view_disabled'];assert.equal((await fetch(url+'/'+id)).status,200);
});

test('completeWork already_applied retry does not send another completion notice',async()=>{
  const x=await fixture(),id=await x.create({products:[{product_id:x.product,amount:1,unit:'L'}]});events=[];
  const pp=(await db.query('SELECT id FROM planning_products WHERE planning_id=$1',[id])).rows[0].id;
  const body={effective_date:'2026-10-21',actual_products:[{planning_product_id:pp,actual_amount:0,unit:'L'}]};
  await x.call('completeWork',body,id,x.responsible);assert.equal(events.length,1);events=[];
  const retry=await x.call('completeWork',body,id,x.responsible);assert.equal(retry.data.already_applied,true);assert.equal(events.length,0);
});

test('mine uses authenticated identity and company; ignores injected user_id and rejects missing identity',async()=>{
  const x=await fixture(),y=await fixture(),mine=await x.create(),other=await x.create({responsible_user:x.third,lot_selections:[{lot_id:x.lot2,effective_area_ha:10}]}),foreign=await y.create();
  // Even inconsistent legacy data that names the authenticated user cannot escape company scope.
  await db.query('UPDATE planning SET responsible_user=$1 WHERE id=$2',[x.responsible,foreign]);
  const result=await x.call('list',{},null,x.responsible,{mine:true,user_id:x.third,company_id:y.company});
  assert.equal(result.code,200);assert.deepEqual(result.data.data.map(r=>r.id),[mine]);assert.equal(result.data.total,1);
  assert.ok(!result.data.data.some(r=>[other,foreign].includes(r.id)));assert.equal(result.data.data[0].company_id,x.company);
  assert.equal((await x.call('list',{},null,null,{mine:true})).code,401);
});
test('mine rejects responsible conflict and parses explicit true/false flags safely',async()=>{
  const x=await fixture();
  for(const mine of [true,'true','1']){
    const response=await x.call('list',{},null,x.responsible,{mine,responsible:x.third});
    assert.equal(response.code,400);assert.match(response.data.message,/No se puede combinar 'Mis tareas'/);
    assert.equal(schema.listQuery.parse({query:{mine}}).query.mine,true);
  }
  for(const mine of [false,'false','0'])assert.equal(schema.listQuery.parse({query:{mine}}).query.mine,false);
  assert.equal(schema.listQuery.safeParse({query:{mine:'someone'}}).success,false);
});
test('mine excludes completed, cancelled and disabled even with include flags; normal history remains available',async()=>{
  const x=await fixture(),open=await x.create();
  let day=22; for(const status of ['completado','cancelado']){const date='2026-10-'+day++;const id=await x.create({start_at:date+'T00:00:00Z',end_at:date+'T00:00:00Z'});await db.query('UPDATE planning SET status=$1 WHERE id=$2',[status,id]);}
  const disabled=await x.create({start_at:'2026-10-24T00:00:00Z',end_at:'2026-10-24T00:00:00Z'});await db.query('UPDATE planning SET enabled=false WHERE id=$1',[disabled]);
  const result=await x.call('list',{},null,x.responsible,{mine:true,includeDisabled:true,includeCanceled:true});
  assert.deepEqual(result.data.data.map(r=>r.id),[open]);
  assert.equal((await x.call('list',{},null,x.responsible,{responsible:x.responsible,status:'completado'})).data.total,1);
});
test('mine preserves effective delay, bounded horizon, ascending priority and stable pagination/count',async()=>{
  const x=await fixture(),ids=[];
  for(const date of ['2026-10-21','2026-10-22','2026-10-23','2026-10-24'])ids.push(await x.create({start_at:date+'T00:00:00Z',end_at:date+'T00:00:00Z'}));
  // Synthetic dates relative to DB time keep this test independent of the runner date.
  await db.query("UPDATE planning SET start_at=now()-interval '300 days',end_at=now()-interval '299 days' WHERE id=$1",[ids[0]]);
  for(let i=1;i<4;i++)await db.query("UPDATE planning SET start_at=now()+($1||' days')::interval,end_at=now()+($1||' days')::interval WHERE id=$2",[String(i*3),ids[i]]);
  const until=(await db.query("SELECT to_char(now()+interval '7 days','YYYY-MM-DD') AS horizon_date")).rows[0].horizon_date+'T23:59:59.999Z';
  const query={mine:true,to:until,pageSize:1};
  const all=[];
  for(let page=1;page<=3;page++){
    const {data}=await x.call('list',{},null,x.responsible,{...query,page});assert.equal(data.total,3);assert.equal(data.page,page);assert.equal(data.pageSize,1);all.push(data.data[0]);
  }
  assert.deepEqual(all.map(r=>r.id),ids.slice(0,3));assert.equal(all[0].status_effective,'en_demora');assert.equal(all[1].status_effective,'pendiente');
  assert.equal((await x.call('list',{},null,x.responsible,{...query,status:'en_demora'})).data.total,1);
});
test('mine intersects campaign, crop, lot, type, search and dates without widening tenancy',async()=>{
  const x=await fixture(),y=await fixture(),id=await x.create();await x.create({title:'Otra tarea',activity_type:'riego',lot_selections:[{lot_id:x.lot2,effective_area_ha:10}]});
  const query={mine:true,campaignId:x.campaign,cropId:x.crop,lotId:x.lot,type:'fumigacion',search:'T4',from:x.body.start_at,to:'2026-10-22T00:00:00Z'};
  assert.deepEqual((await x.call('list',{},null,x.responsible,query)).data.data.map(r=>r.id),[id]);
  assert.equal((await x.call('list',{},null,x.responsible,{...query,search:'No existe'})).data.total,0);
  await assert.rejects(x.call('list',{},null,x.responsible,{...query,lotId:y.lot}),e=>e.status===400 || e.status===404);
});
