// Real relational/controller tests in disposable PGlite, never .env or Supabase.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),{randomUUID:uuid}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const recipes=require('../services/recipes'),recipePlanning=require('../services/planningRecipes'),schema=require('../validations/planning.schema');
let db,pool,controller;
before(async()=>{
  db=new PGlite();await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const f of ['./historySchema.fixture.sql','../migrations/20261018_planning_assignment.sql','../migrations/20260914_inventory_base_units.sql','../migrations/20260916_historical_no_stock.sql','../migrations/20261007_planning_effective_area.sql',
    '../migrations/20261008_planning_field_context.sql','../migrations/20261012_recipes.sql','../migrations/20261012_planning_recipe_snapshots.sql'])
    await db.exec(fs.readFileSync(require.resolve(f),'utf8'));
  await db.exec('CREATE FUNCTION ST_AsGeoJSON(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;');
  const client={async query(s,a){if(s.includes('ST_MakeValid'))return {rows:[]};return db.query(s,a);},release(){}};
  pool={...client,connect:async()=>client};
  const filename=require.resolve('../controllers/planning'),actual=createRequire(filename),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,require:name=>
    name==='../db/supabaseClient'?{pool}:name==='./notifications'?{createNotification:async()=>{}}:actual(name)},{filename});controller=module.exports;
});
after(()=>db?.close());
async function put(table,row){const keys=Object.keys(row);await db.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]));}
async function all(){const out={},tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;for(const {tablename:t} of tables)out[t]=(await db.query(`SELECT to_jsonb(x)::text value FROM "${t}" x ORDER BY to_jsonb(x)::text`)).rows.map(r=>r.value);return out;}
async function fixture(){
  const companyId=uuid(),actorId=uuid(),lot=uuid(),lot2=uuid(),crop=uuid(),campaign=uuid(),liquid=uuid(),mass=uuid();
  await put('companies',{id:companyId,name:'Synthetic recipe planning'});
  await put('users',{id:actorId,company_id:companyId,email:actorId+'@example.test',role:3});
  await put('crops',{id:crop,company_id:companyId,name:'Maíz'});
  await put('campaigns',{id:campaign,company_id:companyId,name:'2026',start_date:'2026-01-01',end_date:'2026-12-31'});
  for(const [id,area] of [[lot,100],[lot2,20]])await put('lots',{id,company_id:companyId,name:'Synthetic',area,area_ha:area});
  for(const [id,unit] of [[liquid,'L'],[mass,'kg']])await put('products',{id,company_id:companyId,name:id,unit,total_quantity:100,available_quantity:100});
  await put('stock_batches',{id:uuid(),company_id:companyId,product_id:mass,initial_quantity:100,available_quantity:100,unit:'kg',origin:'purchase',received_date:'2026-01-01',created_by:actorId});
  const recipeBody={name:'Barbecho Maíz',activity_type:'fumigacion',field_context:'stubble',crop_id:crop,
    items:[{product_id:liquid,dose_amount:'300',dose_unit:'mL'},{product_id:mass,dose_amount:'15',dose_unit:'g'}]};
  const recipe=await recipes.create(pool,{companyId,actorId,body:recipeBody});
  const body={activity_type:'fumigacion',field_context:'stubble',crop_id:crop,campaign_id:campaign,
    start_at:'2026-10-01T03:00:00Z',end_at:'2026-10-01T03:00:00Z',responsible_user:actorId,status:'pendiente',
    lot_selections:[{lot_id:lot,effective_area_ha:'10'}],recipe_id:recipe.id};
  const call=async(method,body={},id)=>{let data,code=200;await controller[method]({body,params:{id},user:{id:actorId,company_id:companyId,role:3}},
    {status(value){code=value;return this;},json(value){data=value;return this;}},error=>{throw error;});return {code,data};};
  return {companyId,actorId,lot,lot2,crop,campaign,liquid,mass,recipe,recipeBody,body,call,create:(patch={})=>call('create',{...body,...patch}),view:id=>call('getOne',{},id)};
}
test('create resolves effective area and normalized doses without Usage, completions, stock or unrelated writes',async()=>{
  const x=await fixture(),before=await all(),result=await x.create(),id=result.data.id,view=(await x.view(id)).data,after=await all();
  assert.equal(result.code,201);assert.equal(view.recipe_id,x.recipe.id);assert.equal(view.recipe_name_snapshot,'Barbecho Maíz');assert.equal(Number(view.planned_area_ha),10);
  const liquid=view.products.find(p=>p.product_id===x.liquid),mass=view.products.find(p=>p.product_id===x.mass);
  assert.equal(liquid.amount,'3.000000');assert.equal(liquid.unit,'L');assert.equal(liquid.dose_amount,'300.000000');assert.equal(liquid.dose_unit,'mL');
  assert.equal(mass.amount,'0.150000');assert.equal(mass.unit,'kg');assert.equal(mass.dose_unit,'g');
  for(const table of Object.keys(before).filter(t=>!['planning','planning_lots','planning_products'].includes(t)))assert.deepEqual(after[table],before[table],table);
});
for(const [name,patch] of [['activity',()=>({activity_type:'fertilizacion'})],['context',()=>({field_context:'growing_crop'})],['crop',x=>({crop_id:null,field_context:'fallow'})]])
  test('reject incompatible '+name+' atomically',async()=>{
    const x=await fixture(),before=await all();await assert.rejects(x.create(patch(x)),e=>e.status===400);assert.deepEqual(await all(),before);
  });
test('disabled and foreign recipes are rejected; general recipe is compatible',async()=>{
  const x=await fixture(),other=await fixture(),before=await all();await assert.rejects(x.create({recipe_id:other.recipe.id}),e=>e.status===400);assert.deepEqual(await all(),before);
  await recipes.disable(pool,{companyId:x.companyId,id:x.recipe.id});await assert.rejects(x.create(),e=>e.status===400);
  const general=await recipes.create(pool,{companyId:x.companyId,actorId:x.actorId,body:{...x.recipeBody,name:'General',field_context:null,crop_id:null}});
  assert.equal((await x.create({recipe_id:general.id,field_context:'fallow',crop_id:null})).code,201);
});
test('multiple lots and sublots use each effective snapshot',async()=>{
  const x=await fixture(),layout=uuid(),sub=uuid();
  await put('lot_layouts',{id:layout,company_id:x.companyId,lot_id:x.lot2,version:1,status:'active',parent_geom_snapshot:'{}',parent_area_ha_snapshot:20});
  await put('sub_lots',{id:sub,company_id:x.companyId,lot_id:x.lot2,layout_id:layout,name:'A',code:'A',area_ha:12,geom:'{}'});
  const id=(await x.create({lot_selections:[{lot_id:x.lot,effective_area_ha:'7.5'},{lot_id:x.lot2,sub_lot_id:sub,effective_area_ha:'2.5'}]})).data.id;
  const view=(await x.view(id)).data;assert.equal(Number(view.planned_area_ha),10);assert.equal(view.products.find(p=>p.product_id===x.liquid).amount,'3.000000');
  assert.equal(view.lots.find(l=>l.sub_lot_id===sub).effective_area_ha,2.5);
});
test('editing recipe name/doses/items and disabling source never changes saved planning; resizing uses saved doses',async()=>{
  const x=await fixture(),id=(await x.create()).data.id,before=(await x.view(id)).data;
  await recipes.update(pool,{companyId:x.companyId,actorId:x.actorId,id:x.recipe.id,body:{...x.recipeBody,name:'Changed source',items:[{product_id:x.liquid,dose_amount:'9',dose_unit:'L'}]}});
  await recipes.disable(pool,{companyId:x.companyId,id:x.recipe.id});assert.deepEqual((await x.view(id)).data,before);
  await x.call('update',{lot_selections:[{lot_id:x.lot,effective_area_ha:'15'}]},id);
  const view=(await x.view(id)).data;assert.equal(view.recipe_name_snapshot,'Barbecho Maíz');assert.equal(view.products.length,2);
  assert.equal(view.products.find(p=>p.product_id===x.liquid).amount,'4.500000');assert.equal(view.products.find(p=>p.product_id===x.mass).amount,'0.225000');
  assert.equal(view.products.find(p=>p.product_id===x.liquid).dose_amount,'300.000000');
});
test('changing source creates a new snapshot; removal keeps amounts as manual and clears doses',async()=>{
  const x=await fixture(),id=(await x.create()).data.id;
  const next=await recipes.create(pool,{companyId:x.companyId,actorId:x.actorId,body:{...x.recipeBody,name:'New source',items:[{product_id:x.mass,dose_amount:'2.5',dose_unit:'kg'}]}});
  await x.call('update',{recipe_id:next.id},id);let view=(await x.view(id)).data;
  assert.equal(view.recipe_name_snapshot,'New source');assert.equal(view.products.length,1);assert.equal(view.products[0].amount,'25.000000');
  await x.call('update',{recipe_id:null},id);view=(await x.view(id)).data;
  assert.equal(view.recipe_id,null);assert.equal(view.recipe_name_snapshot,null);assert.equal(view.products[0].amount,25);assert.equal(view.products[0].dose_amount,null);assert.equal(view.products[0].dose_unit,null);
  await x.call('update',{lot_selections:[{lot_id:x.lot,effective_area_ha:20}]},id);assert.equal((await x.view(id)).data.products[0].amount,25);
});
test('incompatible agronomic edits, recipe/manual ambiguity and injected snapshots are rejected',async()=>{
  const x=await fixture(),id=(await x.create()).data.id;
  for(const body of [{activity_type:'fertilizacion'},{field_context:'growing_crop'},{crop_id:null,field_context:'fallow'},
    {products:[{product_id:x.liquid,amount:99,unit:'L'}]},{recipe_id:x.recipe.id,products:[]},{recipe_name_snapshot:'Injected'},
    {products:[{product_id:x.liquid,amount:1,unit:'L',dose_amount:3,dose_unit:'L'}]}]){
    const before=await all();await assert.rejects(x.call('update',body,id),e=>e.status===400);assert.deepEqual(await all(),before);
  }
  await assert.rejects(x.create({products:[]}),e=>e.status===400);
});
test('manual planning and old historical snapshots remain compatible and unmodified',async()=>{
  const x=await fixture(),manual={...x.body,products:[{product_id:x.mass,amount:7,unit:'kg'}]};delete manual.recipe_id;
  const id=(await x.call('create',manual)).data.id,view=(await x.view(id)).data;assert.equal(view.recipe_id,null);assert.equal(view.products[0].amount,7);assert.equal(view.products[0].dose_amount,null);
  const importId=uuid();await put('historical_imports',{id:importId,company_id:x.companyId,idempotency_key:uuid(),request_hash:'fixture',imported_by:x.actorId,source:'fixture',payload:'{}'});
  const historical=uuid();await put('planning',{id:historical,company_id:x.companyId,title:'Historical',activity_type:'siembra',start_at:'2025-01-01T03:00:00Z',end_at:'2025-01-02T03:00:00Z',status:'completado',responsible_user:x.actorId,inventory_impact_mode:'HISTORICAL_NO_STOCK',historical_import_id:importId});
  const before=(await db.query('SELECT to_jsonb(p)::text value FROM planning p WHERE id=$1',[historical])).rows[0].value;
  await assert.rejects(x.call('update',{recipe_id:x.recipe.id},historical),e=>e.status===409);
  assert.equal((await db.query('SELECT to_jsonb(p)::text value FROM planning p WHERE id=$1',[historical])).rows[0].value,before);
});
test('completed recipe plans reject productive edits; metadata still editable',async()=>{
  const x=await fixture(),id=(await x.create()).data.id;await db.query("UPDATE planning SET status='completado' WHERE id=$1",[id]);
  for(const body of [{recipe_id:null},{products:[]},{lot_selections:[{lot_id:x.lot,effective_area_ha:15}]}])await assert.rejects(x.call('update',body,id),e=>e.status===409);
  assert.equal((await x.call('update',{description:'Metadata only'},id)).code,200);
});
test('register-completed with a recipe requires explicit real quantities and rolls back if missing',async()=>{
  const x=await fixture(),before=await all();await assert.rejects(x.call('registerCompleted',{...x.body,effective_date:'2026-10-01'}),e=>e.status===400);
  assert.deepEqual(await all(),before);assert.equal(schema.registerCompletedSchema.safeParse({body:{...x.body,effective_date:'2026-10-01'}}).success,false);
});
test('schema accepts nullable origin, rejects recipe plus even empty manual products and untrusted dose/name',async()=>{
  const x=await fixture();assert.equal(schema.createSchema.safeParse({body:x.body}).success,true);
  for(const body of [{...x.body,products:[]},{...x.body,recipe_name_snapshot:'fake'},{...x.body,recipe_id:null,products:[{product_id:x.liquid,amount:1,unit:'L',dose_amount:1,dose_unit:'L'}]}])
    assert.equal(schema.createSchema.safeParse({body}).success,false);
  assert.equal(schema.updateSchema.safeParse({params:{id:uuid()},body:{recipe_id:null}}).success,true);
});
test('options are compatible, tenant-scoped, exclude disabled and expose availability without Usage permissions',async()=>{
  const x=await fixture(),other=await fixture();
  const opts=await recipePlanning.options(pool,x.companyId,{activity_type:'fumigacion',field_context:'stubble',crop_id:x.crop});
  assert.equal(opts.length,1);assert.equal(opts[0].id,x.recipe.id);assert.equal(opts[0].crop_name,'Maíz');assert.ok(opts[0].items.every(i=>i.available_quantity!=null));
  assert.equal((await recipePlanning.options(pool,x.companyId,{activity_type:'fertilizacion',field_context:'stubble',crop_id:x.crop})).length,0);
  assert.ok(!opts.some(r=>r.id===other.recipe.id));await recipes.disable(pool,{companyId:x.companyId,id:x.recipe.id});assert.equal((await recipePlanning.options(pool,x.companyId,x.body)).length,0);
});
test('migration adds only nullable snapshots without backfill; DB enforces dose pairs and tenant',async()=>{
  const isolated=new PGlite();try{
    await isolated.exec(`CREATE TABLE recipes(id uuid PRIMARY KEY,company_id uuid); CREATE TABLE planning(id uuid PRIMARY KEY,company_id uuid,title text);
      CREATE TABLE planning_products(id uuid PRIMARY KEY,amount numeric,unit text);
      INSERT INTO planning VALUES(gen_random_uuid(),gen_random_uuid(),'Existing'); INSERT INTO planning_products VALUES(gen_random_uuid(),7,'kg');`);
    const before=(await isolated.query('SELECT to_jsonb(p) value FROM planning p')).rows[0].value;
    await isolated.exec(fs.readFileSync(require.resolve('../migrations/20261012_planning_recipe_snapshots.sql'),'utf8'));
    const {recipe_id,recipe_name_snapshot,...after}=(await isolated.query('SELECT to_jsonb(p) value FROM planning p')).rows[0].value;
    assert.deepEqual(after,before);assert.equal(recipe_id,null);assert.equal(recipe_name_snapshot,null);
    for(const sql of ["UPDATE planning_products SET dose_amount=1","UPDATE planning_products SET dose_unit='L'","UPDATE planning_products SET dose_amount=0,dose_unit='L'","UPDATE planning_products SET dose_amount=1,dose_unit='L/ha'"])
      await assert.rejects(isolated.exec(sql),e=>e.code==='23514');
  }finally{await isolated.close();}
  const x=await fixture(),other=await fixture(),id=(await x.create()).data.id;
  await assert.rejects(db.query("UPDATE planning SET recipe_id=$2,recipe_name_snapshot='foreign' WHERE id=$1",[id,other.recipe.id]),e=>e.code==='23514');
});

test('changing lot identity recalculates snapshot doses on the new effective area',async()=>{
  const x=await fixture(),id=(await x.create()).data.id;
  await x.call('update',{lot_selections:[{lot_id:x.lot2,effective_area_ha:'5'}]},id);
  const view=(await x.view(id)).data;assert.equal(view.lots.length,1);assert.equal(view.lots[0].lot_id,x.lot2);
  assert.equal(view.products.find(p=>p.product_id===x.liquid).amount,'1.500000');assert.equal(view.recipe_name_snapshot,'Barbecho Maíz');
});
test('HTTP recipe options accepts Planning custom permissions without usage.view and denies unrelated permissions',async t=>{
  const x=await fixture(),express=require('express'),app=express();let permissions=['planning.create'];
  const filename=require.resolve('../routes/planning'),actual=createRequire(filename),module={exports:{}};
  const pass=(req,res,next)=>next();
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,require:name=>
    name==='../controllers/planning'?controller:name==='../middleware/historicalOperations'?{rejectModeInput:pass,historical:()=>pass,blockHistorical:()=>pass}:actual(name)},{filename});
  app.use(express.json());app.use((req,res,next)=>{req.user={id:x.actorId,company_id:x.companyId,role:0,custom_permissions:permissions};next();});
  app.use('/api/planning',module.exports);app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const url='http://127.0.0.1:'+server.address().port+'/api/planning/recipe-options?activity_type=fumigacion&field_context=stubble&crop_id='+x.crop;
  let result=await fetch(url);assert.equal(result.status,200);assert.equal((await result.json())[0].id,x.recipe.id);
  permissions=['planning.create','recipes.view'];assert.equal((await fetch(url)).status,200);
  permissions=['planning.edit'];assert.equal((await fetch(url)).status,200);
  permissions=['recipes.view'];assert.equal((await fetch(url)).status,403);
  permissions=['usage.view'];assert.equal((await fetch(url)).status,403);
  permissions=[];assert.equal((await fetch(url)).status,403);
  const performed={...x.body,effective_date:'2026-10-01',actual_products:[{product_id:x.liquid,actual_amount:0,unit:'L'},{product_id:x.mass,actual_amount:0,unit:'kg'}]};
  const post=()=>fetch('http://127.0.0.1:'+server.address().port+'/api/planning/register-completed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(performed)});
  permissions=['planning.create'];assert.equal((await post()).status,403);
  permissions=['planning.edit'];assert.equal((await post()).status,403);
  permissions=['planning.create','planning.edit'];assert.equal((await post()).status,201);
});
test('persisted six-decimal quantities use half-up rounding and exact decimal area sums',async()=>{
  const x=await fixture(),tiny=await recipes.create(pool,{companyId:x.companyId,actorId:x.actorId,body:{...x.recipeBody,name:'Tiny',items:[{product_id:x.liquid,dose_amount:'0.000001',dose_unit:'L'}]}});
  const id=(await x.create({recipe_id:tiny.id,lot_selections:[{lot_id:x.lot,effective_area_ha:'1.5'}]})).data.id;
  assert.equal((await x.view(id)).data.products[0].amount,'0.000002');
  const next=await recipes.create(pool,{companyId:x.companyId,actorId:x.actorId,body:{...x.recipeBody,name:'Exact decimal sum',items:[{product_id:x.liquid,dose_amount:'2.5',dose_unit:'L'}]}});
  await x.call('update',{recipe_id:next.id,lot_selections:[{lot_id:x.lot,effective_area_ha:'0.1'},{lot_id:x.lot2,effective_area_ha:'0.2'}]},id);
  const view=(await x.view(id)).data;assert.equal(view.products[0].amount,'0.750000');assert.equal(Number(view.planned_area_ha),0.3);
});
async function executionFixture({dose='2.5',doseUnit='L',stockAmount='100',sowing=false}={}){
  const x=await fixture();
  await put('stock_batches',{id:uuid(),company_id:x.companyId,product_id:x.liquid,initial_quantity:stockAmount,available_quantity:stockAmount,unit:'L',origin:'purchase',received_date:'2026-01-01',created_by:x.actorId});
  await recipes.update(pool,{companyId:x.companyId,actorId:x.actorId,id:x.recipe.id,body:{...x.recipeBody,activity_type:sowing?'siembra':'fumigacion',field_context:sowing?null:'stubble',items:[{product_id:x.liquid,dose_amount:dose,dose_unit:doseUnit}]}});
  if(sowing)await db.query('UPDATE lots SET area=10,area_ha=10 WHERE id=$1',[x.lot]);
  x.body={...x.body,activity_type:sowing?'siembra':'fumigacion',field_context:sowing?null:'stubble'};
  x.register=(actual,patch={})=>x.call('registerCompleted',{...x.body,effective_date:'2026-10-01',actual_products:actual,...patch});
  x.actual=(amount,unit='L')=>[{product_id:x.liquid,actual_amount:amount,unit}];return x;
}
async function assertExecution(x,id,planned,real){
  const view=(await x.view(id)).data;assert.equal(view.status,'completado');assert.equal(view.recipe_name_snapshot,'Barbecho Maíz');assert.equal(view.products[0].amount,planned);
  const pp=view.products[0];const completions=(await db.query('SELECT * FROM planning_product_completions WHERE planning_id=$1',[id])).rows;
  assert.equal(completions.length,1);assert.equal(Number(completions[0].actual_amount),Number(real));
  const usages=(await db.query('SELECT * FROM usage_records WHERE source_planning_id=$1',[id])).rows;
  assert.equal(usages.length,Number(real)>0?1:0);
  if(usages.length){assert.equal(Number(usages[0].amount_used),Number(real));assert.equal(usages[0].unit,'L');assert.equal(usages[0].source_planning_product_id,pp.id);assert.equal(usages[0].date.toISOString?.().slice(0,10)||String(usages[0].date).slice(0,10),'2026-10-01');assert.equal((await db.query('SELECT * FROM usage_lots WHERE usage_id=$1',[usages[0].id])).rows[0].lot_id,x.lot);}
  const movements=(await db.query('SELECT * FROM stock_movements WHERE company_id=$1 AND product_id=$2',[x.companyId,x.liquid])).rows;
  assert.equal(movements.length,Number(real)>0?1:0);
}
test('register recipe preserves 25 planned while consuming 24 real and linking Usage',async()=>{
  const x=await executionFixture(),result=await x.register(x.actual('24'));assert.equal(result.code,201);await assertExecution(x,result.data.id,'25.000000','24');
  assert.equal(Number((await db.query('SELECT available_quantity FROM stock_batches WHERE company_id=$1 AND product_id=$2',[x.companyId,x.liquid])).rows[0].available_quantity),76);
});
for(const unit of ['mL','L'])test('recipe register converts real '+unit+' to base L',async()=>{
  const x=await executionFixture({dose:'300',doseUnit:'mL'}),result=await x.register(x.actual(unit==='mL'?'2400':'2.4',unit));await assertExecution(x,result.data.id,'3.000000','2.4');
});
test('real below planned can execute when stock only covers real',async()=>{const x=await executionFixture({stockAmount:'22'}),r=await x.register(x.actual('20'));await assertExecution(x,r.data.id,'25.000000','20');});
test('insufficient real stock rolls back planning, links, Usage, completions and movements',async()=>{
  const x=await executionFixture({stockAmount:'22'}),before=await all();await assert.rejects(x.register(x.actual('24')),e=>e.status===409);assert.deepEqual(await all(),before);
});
for(const [name,actual] of [['foreign',x=>[{product_id:x.mass,actual_amount:1,unit:'kg'}]],['duplicate',x=>[...x.actual(1),...x.actual(2)]],['missing',()=>[]],['negative',x=>x.actual('-1')],['NaN',x=>x.actual('NaN')],['precision',x=>x.actual('1.0000001')],['unit',x=>x.actual(1,'kg')]])test('recipe register rejects '+name+' real payload atomically',async()=>{
  const x=await executionFixture(),before=await all();await assert.rejects(x.register(actual(x)),e=>e.status===400);assert.deepEqual(await all(),before);
});
test('zero real persists completion without Usage or stock movement',async()=>{const x=await executionFixture(),r=await x.register(x.actual('0'));await assertExecution(x,r.data.id,'25.000000','0');});
test('disabled or foreign source rejects performed registration atomically',async()=>{
  const x=await executionFixture(),other=await executionFixture();let before=await all();await assert.rejects(x.register(x.actual(1),{recipe_id:other.recipe.id}),e=>e.status===400);assert.deepEqual(await all(),before);
  await recipes.disable(pool,{companyId:x.companyId,id:x.recipe.id});before=await all();await assert.rejects(x.register(x.actual(1)),e=>e.status===400);assert.deepEqual(await all(),before);
});
test('manual register contract remains unchanged',async()=>{
  const x=await executionFixture(),r=await x.call('registerCompleted',{...x.body,recipe_id:null,effective_date:'2026-10-01',products:[{product_id:x.liquid,amount:'7',unit:'L'}]});
  const v=(await x.view(r.data.id)).data;assert.equal(v.recipe_id,null);assert.equal(v.status,'completado');assert.equal(v.products[0].amount,7);assert.equal(Number(v.products[0].actual_amount),7);
});
test('future recipe execution uses saved snapshot after source edit and disable',async()=>{
  const x=await executionFixture(),r=await x.call('create',x.body);let before=(await x.view(r.data.id)).data;assert.equal(before.status,'pendiente');assert.equal(Number(before.products[0].amount),25);
  assert.equal((await db.query('SELECT * FROM usage_records WHERE source_planning_id=$1',[r.data.id])).rows.length,0);
  await recipes.update(pool,{companyId:x.companyId,actorId:x.actorId,id:x.recipe.id,body:{...x.recipeBody,name:'Changed',items:[{product_id:x.mass,dose_amount:99,dose_unit:'kg'}]}});
  await recipes.disable(pool,{companyId:x.companyId,id:x.recipe.id});await x.call('completeWork',{effective_date:'2026-10-01',actual_products:[{planning_product_id:before.products[0].id,actual_amount:'24',unit:'L'}]},r.data.id);await assertExecution(x,r.data.id,'25.000000','24');
});
test('sowing recipe executes real stock and assignment in one transaction',async()=>{
  const x=await executionFixture({sowing:true}),r=await x.register(x.actual('24'));await assertExecution(x,r.data.id,'25.000000','24');
  const ca=(await db.query('SELECT * FROM crop_assignments WHERE source_planning_id=$1',[r.data.id])).rows;assert.equal(ca.length,1);assert.equal(ca[0].crop_id,x.crop);assert.equal(ca[0].lot_id,x.lot);
});
test('sowing insufficient stock also rolls back crop assignment',async()=>{const x=await executionFixture({sowing:true,stockAmount:'22'}),before=await all();await assert.rejects(x.register(x.actual('24')),e=>e.status===409);assert.deepEqual(await all(),before);});
test('register schema differentiates product_id from legacy planning_product_id and accepts zero',async()=>{
 const x=await executionFixture();const body={...x.body,effective_date:'2026-10-01',actual_products:x.actual('0')};assert.equal(schema.registerCompletedSchema.safeParse({body}).success,true);
 for(const actual_products of [[{planning_product_id:uuid(),actual_amount:1,unit:'L'}],x.actual('-1'),x.actual('NaN'),x.actual('0.0000001'),[...x.actual(1),...x.actual(1)]])assert.equal(schema.registerCompletedSchema.safeParse({body:{...body,actual_products}}).success,false);
 assert.equal(schema.completeWorkSchema.safeParse({params:{id:uuid()},body:{effective_date:'2026-10-01',actual_products:x.actual(1)}}).success,false);
});

test('rollback restores an earlier product consumption when a later product fails',async()=>{
 const x=await executionFixture();await db.query('UPDATE stock_batches SET available_quantity=0 WHERE company_id=$1 AND product_id=$2',[x.companyId,x.mass]);
 await recipes.update(pool,{companyId:x.companyId,actorId:x.actorId,id:x.recipe.id,body:x.recipeBody});
 // Force the liquid first, then the insufficient mass, so rollback undoes an applied movement.
 await db.query("UPDATE products SET name=CASE WHEN id=$2 THEN 'A liquid' ELSE 'Z mass' END WHERE company_id=$1",[x.companyId,x.liquid]);
 const before=await all();await assert.rejects(x.register([...x.actual('2'),{product_id:x.mass,actual_amount:'0.15',unit:'kg'}]),e=>e.status===409);assert.deepEqual(await all(),before);
});
test('execution preserves six-decimal real precision',async()=>{const x=await executionFixture(),r=await x.register(x.actual('24.123456'));await assertExecution(x,r.data.id,'25.000000','24.123456');});
