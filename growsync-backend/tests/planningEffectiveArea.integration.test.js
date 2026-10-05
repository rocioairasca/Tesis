const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),{randomUUID:uuid}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const selections=require('../services/planningSelections'),stock=require('../services/stock');
let db,controller,client;
before(async()=>{
 db=new PGlite();await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
 for(const f of ['./historySchema.fixture.sql','../migrations/20260916_historical_no_stock.sql','../migrations/20261007_planning_effective_area.sql','../migrations/20261008_planning_field_context.sql'])await db.exec(fs.readFileSync(require.resolve(f),'utf8'));
 await db.exec('CREATE FUNCTION ST_AsGeoJSON(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;');
 client={async query(s,a){
  // No PostGIS in PGlite: with a NULL selected geometry the real spatial query returns no intersections.
  if(s.includes('ST_MakeValid')) {
    const ids=Array.isArray(a[0]) ? a[0] : [a[2]],company=Array.isArray(a[0]) ? a[2] : a[1];
    for(const id of ids) assert.equal((await db.query('SELECT geom FROM lots WHERE id=$1 AND company_id=$2',[id,company])).rows[0].geom,null);
    return {rows:[]};
  }
  return db.query(s,a);
 },release(){}};
 const filename=require.resolve('../controllers/planning'),actual=createRequire(filename),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,require:name=>{
  if(name==='../db/supabaseClient')return {pool:{...client,connect:async()=>client}};
  if(name==='./notifications')return {createNotification:async()=>{}};
  return actual(name);
 }},{filename});controller=module.exports;
});
after(()=>db.close());
async function fixture(){
 const companyId=uuid(),actorId=uuid(),lotId=uuid(),cropId=uuid(),campaignId=uuid();
 await db.query("INSERT INTO companies(id,name) VALUES($1,'Test')",[companyId]);
 await db.query("INSERT INTO users(id,company_id,email,role) VALUES($1,$2,$3,3)",[actorId,companyId,actorId+'@example.test']);
 await db.query("INSERT INTO lots(id,company_id,name,area,area_ha) VALUES($1,$2,'Santos test',101.3,101.3)",[lotId,companyId]);
 await db.query("INSERT INTO crops(id,company_id,name) VALUES($1,$2,'Test')",[cropId,companyId]);
 await db.query("INSERT INTO campaigns(id,company_id,name,start_date,end_date,status) VALUES($1,$2,'Test','2026-01-01','2026-12-31','active')",[campaignId,companyId]);
 const user={id:actorId,company_id:companyId,role:3};
 const body={activity_type:'fumigacion',field_context:'growing_crop',start_at:'2026-09-01T00:00:00Z',end_at:'2026-09-01T00:00:00Z',responsible_user:actorId,crop_id:cropId,campaign_id:campaignId,status:'pendiente',lot_selections:[{lot_id:lotId,effective_area_ha:10}]};
 const call=async(method,body={},id,query={})=>{let result,code=200;await controller[method]({body,params:{id},user,query},{status(n){code=n;return this;},json(data){result=data;return this;}},e=>{throw e;});return {code,data:result};};
 return {companyId,actorId,lotId,body,call};
}
test('create/read/update use effective total without trusting client area or touching inventory',async()=>{
 const x=await fixture(),{data:{id}}=await x.call('create',x.body);
 let view=(await x.call('getOne',{},id)).data;
 assert.equal(Number(view.planned_area_ha),10);assert.equal(Number(view.lots[0].area_ha),101.3);assert.equal(Number(view.lots[0].effective_area_ha),10);
 await x.call('update',{lot_selections:[{lot_id:x.lotId,effective_area_ha:'20,5',area_ha:9999}]},id);
 view=(await x.call('getOne',{},id)).data;assert.equal(Number(view.planned_area_ha),20.5);assert.equal(Number(view.lots[0].area_ha),101.3);
 await assert.rejects(x.call('update',{lot_selections:[{lot_id:x.lotId,effective_area_ha:101.31,area_ha:9999}]},id),e=>e.status===400);
 await assert.rejects(x.call('update',{activity_type:'siembra'},id),e=>e.status===400);
 assert.equal((await db.query('SELECT count(*)::int n FROM stock_movements WHERE company_id=$1',[x.companyId])).rows[0].n,0);
});
test('omitted/null, legacy payload and explicit full area preserve compatibility',async()=>{
 for(const variant of ['omitted','null','legacy','full']){
  const x=await fixture();if(variant==='legacy'){delete x.body.lot_selections;x.body.lot_ids=[x.lotId];}
  else if(variant==='omitted')delete x.body.lot_selections[0].effective_area_ha;
  else x.body.lot_selections[0].effective_area_ha=variant==='full'?101.3:null;
  const {data:{id}}=await x.call('create',x.body),view=(await x.call('getOne',{},id)).data;
  assert.equal(Number(view.planned_area_ha),101.3);assert.equal(Number(view.lots[0].effective_area_ha),101.3);
 }
});
test('reject zero, negative, excess, invalid precision and foreign tenant',async()=>{
 const x=await fixture();for(const value of [0,-1,101.31,'NaN','Infinity','10.00001',''])await assert.rejects(x.call('create',{...x.body,lot_selections:[{lot_id:x.lotId,area_ha:999999,effective_area_ha:value}]}),e=>e.status===400);
 const other=await fixture();await assert.rejects(x.call('create',{...x.body,lot_selections:[{lot_id:other.lotId,effective_area_ha:10}]}),e=>e.status===400);
});
test('sublot partial work and sowing full selected area',async()=>{
 const x=await fixture(),layoutId=uuid(),subId=uuid();
 await db.query("INSERT INTO lot_layouts(id,company_id,lot_id,name,status,version,parent_geom_snapshot,parent_area_ha_snapshot) VALUES($1,$2,$3,'Test','active',1,'{}',101.3)",[layoutId,x.companyId,x.lotId]);
 await db.query("INSERT INTO sub_lots(id,company_id,lot_id,layout_id,name,code,area_ha,geom) VALUES($1,$2,$3,$4,'A','A',41.08,'{}')",[subId,x.companyId,x.lotId,layoutId]);
 const row=(await selections.resolveLotSelections(client,[{lot_id:x.lotId,sub_lot_id:subId,effective_area_ha:20}],x.companyId,{activityType:'fumigacion'}))[0];
 assert.equal(Number(row.area_ha),41.08);assert.equal(Number(row.effective_area_ha),20);
 await assert.rejects(x.call('create',{...x.body,activity_type:'siembra'}),e=>e.status===400);
 assert.equal((await x.call('create',{...x.body,activity_type:'siembra',lot_selections:[{lot_id:x.lotId,effective_area_ha:101.3}]})).code,201);
});
test('partial conflicts by identity; completed snapshots survive physical area changes',async()=>{
 const x=await fixture(),{data:{id}}=await x.call('create',x.body);
 await assert.rejects(x.call('create',x.body),e=>e.status===409);
 await db.query("UPDATE planning SET status='completado' WHERE id=$1",[id]);await db.query('UPDATE lots SET area_ha=150,area=150 WHERE id=$1',[x.lotId]);
 await x.call('update',{description:'Only text',lot_selections:[{lot_id:x.lotId,effective_area_ha:10}]},id);
 const view=(await x.call('getOne',{},id)).data;assert.equal(Number(view.planned_area_ha),10);assert.equal(Number(view.lots[0].area_ha),101.3);
 await assert.rejects(x.call('update',{lot_selections:[{lot_id:x.lotId,effective_area_ha:15}]},id),e=>e.status===409);
});
test('completion uses effective area and consumes the unchanged explicit product quantity',async()=>{
 const x=await fixture(),productId=uuid();await db.query("INSERT INTO products(id,company_id,name,unit,total_quantity,available_quantity) VALUES($1,$2,'Test','kg',0,0)",[productId,x.companyId]);
 const oldFlag=process.env.INVENTORY_V1_ENABLED;process.env.INVENTORY_V1_ENABLED='true';
 try {
 await db.query('UPDATE companies SET inventory_control_start_date=$1 WHERE id=$2',['2026-01-01',x.companyId]);
 await stock.transaction({connect:async()=>client},c=>stock.receiveStock(c,{companyId:x.companyId,actorId:x.actorId,productId,quantity:100,unit:'kg',origin:'purchase',received_date:'2026-01-01',key:uuid()}));
 const {data:{id}}=await x.call('create',{...x.body,products:[{product_id:productId,amount:7,unit:'kg'}]});
 const result=await x.call('completeWork',{effective_date:'2026-09-01'},id);assert.equal(result.code,200);
 const usage=(await db.query('SELECT total_area,amount_used FROM usage_records WHERE source_planning_id=$1',[id])).rows[0];assert.equal(Number(usage.total_area),10);assert.equal(Number(usage.amount_used),7);
 assert.equal(Number((await db.query('SELECT sum(available_quantity) AS available_quantity FROM stock_batches WHERE product_id=$1',[productId])).rows[0].available_quantity),93);
 }finally{if(oldFlag===undefined)delete process.env.INVENTORY_V1_ENABLED;else process.env.INVENTORY_V1_ENABLED=oldFlag;}
});
test('DB constraints reject invalid effective areas independently of API',async()=>{
 const x=await fixture(),{data:{id}}=await x.call('create',x.body);
 for(const value of ['0','-1','101.31','NaN'])await assert.rejects(db.query('UPDATE planning_lots SET effective_area_ha=$1 WHERE planning_id=$2',[value,id]),e=>e.code==='23514');
});
test('register-completed keeps effective snapshot and full lot versus sublot conflict rules',async()=>{
 const x=await fixture();const result=await x.call('registerCompleted',{...x.body,activity_type:'riego',effective_date:'2026-09-01'});
 assert.equal(result.code,201);const view=(await x.call('getOne',{},result.data.id)).data;
 assert.equal(view.status,'completado');assert.equal(Number(view.planned_area_ha),10);
 const conflicts=await selections.checkLotScheduleConflicts(client,[{lot_id:x.lotId,sub_lot_id:uuid()}],x.body.start_at,x.body.end_at,x.companyId);
 assert.equal(conflicts.length,1);
 for(const type of ['fertilizacion','riego','mantenimiento','otro'])assert.equal(selections.validateEffectiveArea(10,101.3,type,null),'10');
});
test('migration preserves existing corrected snapshots without backfill',async()=>{
 const isolated=new PGlite();try{
 await isolated.exec('CREATE TABLE planning_lots(planning_id integer,area_ha numeric(12,4)); INSERT INTO planning_lots VALUES(1,70.97),(2,46.0932),(3,NULL);');
 const before=(await isolated.query('SELECT * FROM planning_lots ORDER BY planning_id')).rows;
 await isolated.exec(fs.readFileSync(require.resolve('../migrations/20261007_planning_effective_area.sql'),'utf8'));
 const after=(await isolated.query('SELECT * FROM planning_lots ORDER BY planning_id')).rows;
 assert.deepEqual(after.map(({effective_area_ha,...row})=>row),before);assert.ok(after.every(row=>row.effective_area_ha===null));
 }finally{await isolated.close();}
});
test('unchanged selections preserve full sowing snapshot even after the physical lot changes',async()=>{
 const x=await fixture();const {data:{id}}=await x.call('create',{...x.body,activity_type:'siembra',lot_selections:[{lot_id:x.lotId}]});
 await db.query('UPDATE lots SET area_ha=150 WHERE id=$1',[x.lotId]);
 await x.call('update',{lot_selections:[{lot_id:x.lotId,effective_area_ha:101.3}]},id);
 const view=(await x.call('getOne',{},id)).data;assert.equal(Number(view.planned_area_ha),101.3);
});
test('Santos stubble: saves context, maize and 10ha without changing cycles or inventory',async()=>{
 const x=await fixture();await db.query("UPDATE crops SET name='Maíz' WHERE id=$1",[x.body.crop_id]);
 await db.query('INSERT INTO crop_assignments(company_id,campaign_id,lot_id,crop_id,start_date,area_ha) VALUES($1,$2,$3,$4,$5,101.3)',[x.companyId,x.body.campaign_id,x.lotId,x.body.crop_id,'2026-01-01']);
 const snapshot=async()=>({cycles:(await db.query('SELECT * FROM crop_assignments WHERE company_id=$1',[x.companyId])).rows,stock:(await db.query('SELECT * FROM stock_movements WHERE company_id=$1',[x.companyId])).rows});
 const before=await snapshot();const {data:{id}}=await x.call('create',{...x.body,field_context:'stubble',start_at:'2026-09-22T00:00:00Z',end_at:'2026-09-22T00:00:00Z'});
 const view=(await x.call('getOne',{},id)).data;assert.equal(view.field_context,'stubble');assert.equal(view.crop_name,'Maíz');assert.equal(Number(view.planned_area_ha),10);
 await x.call('update',{field_context:'pre_sowing'},id);assert.deepEqual(await snapshot(),before);
 await x.call('update',{field_context:'stubble'},id);assert.deepEqual(await snapshot(),before);
});
test('context validation on new activities and PATCH merged with existing fields',async()=>{
 const {createSchema}=require('../validations/planning.schema');
 for(const context of ['growing_crop','stubble']){
  const x=await fixture(),body={...x.body,field_context:context,crop_id:null};
  assert.equal(createSchema.safeParse({body}).success,false);await assert.rejects(x.call('create',body),e=>e.status===400);
 }
 for(const context of ['fallow','pre_sowing','other'])for(const activity of ['fumigacion','fertilizacion']){
  const x=await fixture(),body={...x.body,field_context:context,crop_id:null,activity_type:activity};
  assert.equal(createSchema.safeParse({body}).success,true);
  const {data:{id}}=await x.call('create',body);assert.equal((await x.call('getOne',{},id)).data.field_context,context);
  await assert.rejects(x.call('update',{field_context:'stubble'},id),e=>e.status===400);
  await x.call('update',{field_context:'pre_sowing',crop_id:x.body.crop_id},id);
 }
 for(const context of [undefined,null,'unknown']){
  const x=await fixture(),body={...x.body,field_context:context};assert.equal(createSchema.safeParse({body}).success,false);
  await assert.rejects(x.call('create',body),e=>e.status===400);
 }
});
test('legacy NULL context remains readable/editable without inferring a situation',async()=>{
 const x=await fixture(),{data:{id}}=await x.call('create',x.body);await db.query('UPDATE planning SET field_context=NULL WHERE id=$1',[id]);
 await x.call('update',{description:'Texto corregido',crop_id:x.body.crop_id,field_context:null},id);
 const view=(await x.call('getOne',{},id)).data;assert.equal(view.field_context,null);assert.equal(view.crop_id,x.body.crop_id);
 await assert.rejects(db.query("UPDATE planning SET field_context='unknown' WHERE id=$1",[id]),e=>e.code==='23514');
});
test('sowing normalizes context without changing creation of productive cycle',async()=>{
 const x=await fixture();await db.query("UPDATE companies SET inventory_control_start_date='2026-01-01' WHERE id=$1",[x.companyId]);
 const {data:{id}}=await x.call('create',{...x.body,activity_type:'siembra',field_context:'stubble',lot_selections:[{lot_id:x.lotId}]});
 assert.equal((await x.call('getOne',{},id)).data.field_context,null);
 const result=await x.call('completeSowing',{effective_date:'2026-09-01'},id);assert.equal(result.code,200);
 const cycles=(await db.query('SELECT crop_id,area_ha FROM crop_assignments WHERE source_planning_id=$1',[id])).rows;
 assert.equal(cycles.length,1);assert.equal(cycles[0].crop_id,x.body.crop_id);assert.equal(Number(cycles[0].area_ha),101.3);
 await assert.rejects(x.call('create',{...x.body,activity_type:'siembra',crop_id:null}),e=>e.status===400);
});
test('stubble completion does not imply a growing crop or create productive cycles',async()=>{
 const x=await fixture(),productId=uuid();await db.query("INSERT INTO products(id,company_id,name,unit,total_quantity,available_quantity) VALUES($1,$2,'Test','kg',0,0)",[productId,x.companyId]);
 await db.query("UPDATE companies SET inventory_control_start_date='2026-01-01' WHERE id=$1",[x.companyId]);
 await stock.transaction({connect:async()=>client},c=>stock.receiveStock(c,{companyId:x.companyId,actorId:x.actorId,productId,quantity:100,unit:'kg',origin:'purchase',received_date:'2026-01-01',key:uuid()}));
 const {data:{id}}=await x.call('registerCompleted',{...x.body,field_context:'stubble',effective_date:'2026-09-22',products:[{product_id:productId,amount:7,unit:'kg'}]});
 const usage=(await db.query('SELECT crop_id,current_crop,total_area,amount_used FROM usage_records WHERE source_planning_id=$1',[id])).rows[0];
 assert.equal(usage.crop_id,x.body.crop_id);assert.equal(usage.current_crop,null);assert.equal(Number(usage.total_area),10);assert.equal(Number(usage.amount_used),7);
 assert.equal((await db.query('SELECT count(*)::int n FROM crop_assignments WHERE company_id=$1',[x.companyId])).rows[0].n,0);
});
test('field context migration leaves existing records untouched including historical markers',async()=>{
 const isolated=new PGlite();try{
 await isolated.exec("CREATE TABLE planning(id int, crop_id text,inventory_impact_mode text);INSERT INTO planning VALUES(1,'legacy','NORMAL'),(2,'corrected','HISTORICAL_NO_STOCK');");
 const before=(await isolated.query('SELECT * FROM planning ORDER BY id')).rows;
 await isolated.exec(fs.readFileSync(require.resolve('../migrations/20261008_planning_field_context.sql'),'utf8'));
 const after=(await isolated.query('SELECT * FROM planning ORDER BY id')).rows;assert.deepEqual(after.map(({field_context,...r})=>r),before);assert.ok(after.every(r=>r.field_context===null));
 }finally{await isolated.close();}
});
