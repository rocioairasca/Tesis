// Real controller + PostgreSQL semantics in disposable PGlite. No .env/network/production.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),{randomUUID:uuid}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const { dateKey } = require('../services/campaignWindow');
let db,client,controller,events=[],inTransaction=false,failCommit=false,failNotification=false;
const migration=fs.readFileSync(require.resolve('../migrations/20261018_planning_assignment.sql'),'utf8');
before(async()=>{
  db=new PGlite();await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const f of ['./historySchema.fixture.sql','../migrations/20261103_add_campaign_work_end_date.sql','../migrations/20260916_historical_no_stock.sql','../migrations/20261007_planning_effective_area.sql',
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
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,Date,process:{env:{NODE_ENV:'production'}},require:name=>{
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
  const call=async(method,body={},id,actorId=actor,query={},permissions)=>{
    let data,code=200;await controller[method]({body,params:{id},query,user:{id:actorId,company_id:company,role:3,...(permissions?{custom_permissions:permissions}:{})}},
      {status(value){code=value;return this;},json(value){data=value;return this;}},error=>{throw error;});return {code,data};
  };
  return {company,actor,responsible,third,lot,lot2,crop,campaign,product,body,call,create:async(patch={})=>(await call('create',{...body,...patch})).data.id,
    row:async id=>(await db.query('SELECT * FROM planning WHERE id=$1',[id])).rows[0]};
}

const windowDates = { work_start_date:'2026-07-30', start_date:'2026-11-01', end_date:'2027-06-30', work_end_date:'2027-07-31' };
async function campaignFixture() {
  const x = await fixture();
  await db.query('UPDATE campaigns SET name=$2,work_start_date=$3,start_date=$4,end_date=$5,work_end_date=$6 WHERE id=$1',
    [x.campaign,'Gruesa 2026-2027',...Object.values(windowDates)]);
  return x;
}
const dates = (start, end=start) => ({ start_at:start+'T00:00:00.000Z', end_at:end+'T00:00:00.000Z' });
function loadController(name) {
  const filename=require.resolve('../controllers/'+name),actual=createRequire(filename),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,Date,process:{env:{NODE_ENV:'production'}},require:key=>
    key==='../db/supabaseClient'?{pool:{...client,connect:async()=>client}}:actual(key)},{filename});
  return module.exports;
}
async function callOther(name, method, x, body={}, id=x.campaign) {
  let code=200,data;
  await loadController(name)[method]({body,params:{id},query:{includeClosed:true},user:{id:x.actor,company_id:x.company,role:3}},
    {status(v){code=v;return this;},json(v){data=v;return this;}},error=>{throw error;});
  return {code,data};
}
for (const date of ['2026-07-30','2026-10-20','2026-11-01','2027-06-30','2027-07-15','2027-07-31']) {
  test('ordinary work accepts inclusive operational date '+date,async()=>{
    const x=await campaignFixture(),id=await x.create(dates(date));
    assert.equal((await x.row(id)).campaign_id,x.campaign);
  });
}
for (const range of [['2026-07-29'],['2027-08-01'],['2026-07-29','2026-10-20'],['2026-10-20','2027-08-01']]) {
  test('rejects out-of-window range '+range.join('/'),async()=>{
    const x=await campaignFixture();
    await assert.rejects(x.create(dates(...range)),e=>e.status===400 && e.message==='La fecha seleccionada está fuera de la ventana operativa de Gruesa 2026-2027.');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM planning WHERE company_id=$1',[x.company])).rows[0].n,0);
  });
}
test('multi-day range spanning both official boundaries is accepted',async()=>{
  const x=await campaignFixture();assert.ok(await x.create(dates('2026-07-30','2027-07-31')));
});
for(const mode of ['registerCompleted','completeSowing']) test(mode+' sowing October 20 uses operational window and explicit campaign',async()=>{
  const x=await campaignFixture(),body={...x.body,...dates('2026-10-20'),activity_type:'siembra',field_context:null,lot_selections:[{lot_id:x.lot}]};
  let id;
  if(mode==='registerCompleted')id=(await x.call(mode,{...body,effective_date:'2026-10-20'})).data.id;
  else {id=await x.create(body);await x.call(mode,{effective_date:'2026-10-20'},id);}
  assert.equal((await x.row(id)).status,'completado');
  const cycles=(await db.query('SELECT campaign_id,start_date FROM crop_assignments WHERE source_planning_id=$1',[id])).rows;
  assert.equal(cycles.length,1);assert.equal(cycles[0].campaign_id,x.campaign);assert.equal(dateKey(cycles[0].start_date),'2026-10-20');
});
for(const mode of ['completeSowing','completeWork']) test(mode+' rejects execution beyond operational end without effects',async()=>{
  const x=await campaignFixture(),id=await x.create({...(mode==='completeSowing'?{activity_type:'siembra',field_context:null}:{}),...dates('2026-10-20'),lot_selections:[{lot_id:x.lot}]});
  await assert.rejects(x.call(mode,{effective_date:'2027-08-01'},id),e=>e.status===400);
  assert.equal((await x.row(id)).status,'pendiente');
});
test('overlap preserves explicit ID, missing ID and foreign company are rejected',async()=>{
  const x=await campaignFixture(),second=uuid(),other=await campaignFixture();
  await put('campaigns',{id:second,company_id:x.company,name:'Superpuesta',...windowDates});
  const id=await x.create({...dates('2026-10-20'),campaign_id:second});
  assert.equal((await x.row(id)).campaign_id,second);
  for(const campaign_id of [null,other.campaign])await assert.rejects(x.create({...dates('2026-10-22'),campaign_id}),e=>e.status===400);
});
test('existing incompatible Planning accepts metadata with unchanged dates and ID; changed dates fail',async()=>{
  const x=await campaignFixture(),id=await x.create(dates('2026-10-20'));
  await db.query("UPDATE planning SET start_at='2025-10-20T00:00:00Z',end_at='2025-10-20T00:00:00Z' WHERE id=$1",[id]);
  await x.call('update',{description:'Revisión',campaign_id:x.campaign,...dates('2025-10-20')},id);
  assert.equal((await x.row(id)).campaign_id,x.campaign);
  await assert.rejects(x.call('update',dates('2025-10-21'),id),e=>e.status===400);
  await x.call('update',dates('2026-10-21'),id);
});
test('open campaign has no upper bound and nullable operational dates fall back to official',async()=>{
  const x=await campaignFixture();
  await db.query('UPDATE campaigns SET work_start_date=NULL,work_end_date=NULL,end_date=NULL WHERE id=$1',[x.campaign]);
  assert.ok(await x.create(dates('2035-01-01')));
  await assert.rejects(x.create(dates('2026-10-20')),e=>e.status===400);
});
test('campaign API reads/writes all four dates; invalid internal order rejected',async()=>{
  const x=await campaignFixture();
  const created=await callOther('campaigns','create',x,{name:'Nueva',...windowDates});
  assert.equal(created.code,201);assert.equal(dateKey(created.data.work_end_date),'2027-07-31');
  const listed=await callOther('campaigns','list',x);assert.ok(listed.data.some(c=>c.id===created.data.id && dateKey(c.work_end_date)==='2027-07-31'));
  for(const patch of [{work_end_date:'2027-06-29'},{end_date:null},{work_start_date:'2026-11-02'},{end_date:'2026-10-31'}]) {
    assert.equal((await callOther('campaigns','update',x,patch)).code,400);
  }
  assert.equal((await callOther('campaigns','update',x,{work_end_date:null,end_date:null})).code,200);
});
test('rename and expansion tolerate historic inconsistencies; reduction diagnoses newly excluded references',async()=>{
  const x=await campaignFixture(),id=await x.create(dates('2027-07-20'));
  await x.create({...dates('2026-10-20'),lot_selections:[{lot_id:x.lot2}]});
  await db.query("UPDATE planning SET start_at='2025-10-20T00:00:00Z',end_at='2025-10-20T00:00:00Z' WHERE company_id=$1 AND id<>$2",[x.company,id]);
  assert.equal((await callOther('campaigns','update',x,{name:'Renombrada'})).code,200);
  assert.equal((await callOther('campaigns','update',x,{work_end_date:'2027-08-31'})).code,200);
  await assert.rejects(callOther('campaigns','update',x,{work_end_date:'2027-07-10'}),e=>e.status===409 && e.details.out_of_range_count===2 && dateKey(e.details.max_date)==='2027-07-20');
  assert.equal((await callOther('campaigns','update',x,{work_end_date:'2027-07-25'})).code,200,'pre-existing anomaly does not block a reduction that excludes no additional reference');
});
test('cycle October start accepted; nullable biological end and existing optional end checks preserved',async()=>{
  const x=await campaignFixture();
  const result=await callOther('cropAssignments','create',x,{campaign_id:x.campaign,crop_id:x.crop,lot_id:x.lot,start_date:'2026-10-20',end_date:null});
  assert.equal(result.code,201);assert.equal(result.data.end_date,null);
  await db.query("UPDATE crop_assignments SET end_date='2027-07-01',harvest_closure_source='legacy' WHERE id=$1",[result.data.id]);
  const updated=await callOther('cropAssignments','update',x,{end_date:'2027-07-20'},result.data.id);
  assert.equal(updated.code,200);
  await assert.rejects(callOther('cropAssignments','update',x,{end_date:'2027-08-01'},result.data.id),e=>e.status===400);
});
test('migration backfill preserves IDs, work starts, null ends and references without historical validation',async()=>{
  const isolated=new PGlite();
  try {
    await isolated.exec(`CREATE TABLE campaigns(id text PRIMARY KEY,start_date date NOT NULL,end_date date,work_start_date date,
      CHECK(start_date<=end_date),CHECK(work_start_date<=start_date));
      INSERT INTO campaigns VALUES ('closed','2026-11-01','2027-06-30','2026-07-30'),('open','2026-01-01',NULL,NULL);
      CREATE TABLE planning(campaign_id text REFERENCES campaigns(id),start_at date);
      INSERT INTO planning VALUES ('closed','2020-01-01');`);
    await isolated.exec(fs.readFileSync(require.resolve('../migrations/20261103_add_campaign_work_end_date.sql'),'utf8'));
    const rows=(await isolated.query('SELECT * FROM campaigns ORDER BY id')).rows;
    assert.deepEqual(rows.map(r=>[r.id,dateKey(r.work_start_date),dateKey(r.work_end_date)]),[['closed','2026-07-30','2027-06-30'],['open',null,null]]);
    assert.equal((await isolated.query('SELECT campaign_id FROM planning')).rows[0].campaign_id,'closed');
    await assert.rejects(isolated.exec("UPDATE campaigns SET work_end_date='2027-01-01' WHERE id='open'"),e=>e.code==='23514');
  } finally {await isolated.close();}
});
test('campaign Zod schema preserves work_end_date and rejects inconsistent nullable combinations',()=>{
  const schema=require('../validations/campaigns.schema');
  assert.equal(schema.createBody.parse({body:{name:'Campaña',...windowDates}}).body.work_end_date,'2027-07-31');
  assert.equal(schema.createBody.safeParse({body:{name:'Campaña',...windowDates,end_date:null}}).success,false);
  assert.equal(schema.createBody.safeParse({body:{name:'Abierta',start_date:'2026-01-01',end_date:null}}).success,true);
});

for(const mode of ['completeSowing','completeWork']) test(mode+' accepts operational end after official end',async()=>{
  const x=await campaignFixture(),id=await x.create({...dates('2027-07-31'),
    ...(mode==='completeSowing'?{activity_type:'siembra',field_context:null}:{}),lot_selections:[{lot_id:x.lot}]});
  await x.call(mode,{effective_date:'2027-07-31'},id);
  assert.equal((await x.row(id)).status,'completado');
});
test('reducing the operational start protects the inclusive first day',async()=>{
  const x=await campaignFixture();await x.create(dates('2026-07-30'));
  await assert.rejects(callOther('campaigns','update',x,{work_start_date:'2026-07-31'}),
    e=>e.status===409 && dateKey(e.details.min_date)==='2026-07-30');
});
