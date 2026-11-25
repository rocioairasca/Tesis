const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const express = require('express');
const schemas = require('../validations/lots.schema');
const validate = require('../middleware/validate');
const database = require('./stockInitialDatabase.fixture');
const { saveLot } = require('../services/lotGeometry');
const polygon = {type:'Polygon',coordinates:[[[-62,-32],[-61.99,-32],[-61.99,-31.99],[-62,-31.99],[-62,-32]]]};
const legacy = JSON.stringify([polygon.coordinates[0].map(([lng,lat])=>({lat,lng}))]);
const invalidLocations = [undefined,null,'',{},[],JSON.stringify({type:'Point',coordinates:[-62,-32]}),
  {type:'Polygon',coordinates:[]},{type:'Polygon',coordinates:[[[181,0],[182,0],[182,1],[181,0]]]}];
for (const location of invalidLocations) test('schema rejects missing/non-polygon location '+JSON.stringify(location),()=>{
 assert.equal(schemas.createBody.safeParse({body:{name:'Synthetic',area:100,location}}).success,false);
});
test('schema accepts current MapSelector format and GeoJSON, ignores manual area',()=>{
 for(const location of [legacy,polygon]) assert.equal(schemas.createBody.safeParse({body:{name:'Synthetic',area:999,location}}).success,true);
 assert.equal(schemas.updateBody.safeParse({params:{id:randomUUID()},body:{name:'Renamed'}}).success,true);
});

test('HTTP lot integrity against disposable PostgreSQL/PostGIS', {skip: !process.env.STOCK_INITIAL_POSTGIS_URL}, async t=>{
 const db = await database(t); assert.equal(db.postgis,true);
 await db.query(`CREATE TABLE companies(id uuid PRIMARY KEY); CREATE TABLE users(id uuid PRIMARY KEY);
 CREATE TABLE lots(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid REFERENCES companies(id),
 name text NOT NULL,area numeric NOT NULL,location jsonb,enabled boolean DEFAULT true,created_at timestamptz DEFAULT now());`);
 // Apply the existing spatial definition to empty synthetic tables, never to a real database.
 await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20260830_add_lot_layouts_sub_lots_postgis.sql'),'utf8'));
 const company=randomUUID(),other=randomUUID();
 await db.query('INSERT INTO companies VALUES ($1),($2)',[company,other]);
 const transactionPool=await db.concurrentPool(); t.after(()=>transactionPool.end());
 const pool={...transactionPool, query:db.query};
 const file=path.resolve(__dirname,'../controllers/lots/lot.js'),actual=createRequire(file),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,console,Promise,require:id=>id==='../../db/supabaseClient'?{pool}:actual(id)},{filename:file});
 const controllers=module.exports;
 const app=express(); app.use(express.json()); app.use((req,res,next)=>{req.user={company_id:req.headers['x-company']||company};next();});
 app.get('/lots',controllers.listLots);
 app.post('/lots',validate(schemas.createBody),controllers.addLot);
 app.put('/lots/:id',validate(schemas.updateBody),controllers.editLot);
 app.use(require('../middleware/errorHandler'));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const request=async(method,url,body,tenant=company)=>{
  const response=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{method,headers:{'Content-Type':'application/json','x-company':tenant},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
 };
 const stored=async id=>(await db.query('SELECT geom,ST_IsValid(geom) valid,area,area_ha FROM lots WHERE id=$1',[id])).rows[0];
 for(const location of invalidLocations) await t.test('POST rejects '+JSON.stringify(location),async()=>{
  assert.equal((await request('POST','/lots',{name:'Rejected',area:100,location})).status,400);
 });
 const bowtie={type:'Polygon',coordinates:[[[-62,-32],[-61.99,-31.99],[-61.99,-32],[-62,-31.99],[-62,-32]]]};
 await t.test('PostGIS rejects self-intersection and zero/rounded-zero area without a row',async()=>{
  for(const location of [bowtie,{type:'Polygon',coordinates:[[[-62,-32],[-62,-32],[-62,-32],[-62,-32]]]},
   {type:'Polygon',coordinates:[[[0,0],[0.000000001,0],[0.000000001,0.000000001],[0,0]]]}]) {
   const result=await request('POST','/lots',{name:'Rejected',location}); assert.equal(result.status,400);
   assert.match(result.body.message,/Dibujá/);assert.doesNotMatch(JSON.stringify(result.body),/PostGIS|ST_|coordinates|Self-intersection/);
  }
  assert.equal(Number((await db.query('SELECT count(*) FROM lots')).rows[0].count),0);
 });
 let id;
 await t.test('valid POST calculates actual geometry and both areas, not client area',async()=>{
  const result=await request('POST','/lots',{name:'Spatial',area:999999,location:legacy});assert.equal(result.status,201);
  assert.equal(typeof result.body.lot.area,'number');assert.equal(typeof result.body.lot.area_ha,'number');
  id=result.body.lot.id;const row=await stored(id);assert.ok(row.geom);assert.equal(row.valid,true);assert.ok(Number(row.area_ha)>0);
  assert.equal(Number(row.area),Number(row.area_ha));assert.notEqual(Number(row.area),999999);
  for(const key of ['id','name','area','area_ha','location','enabled'])assert.ok(Object.hasOwn(result.body.lot,key),key);
  assert.equal(result.body.lot.area_ha,Number(row.area_ha));
 });
 await t.test('metadata-only edit preserves geometry; attempted erase never removes it',async()=>{
  const original=await stored(id);
  assert.equal((await request('PUT','/lots/'+id,{name:'Renamed',area:1})).status,200);
  assert.deepEqual(await stored(id),original);
  for(const location of [null,'',JSON.stringify({type:'Point',coordinates:[-62,-32]}),bowtie]) {
   const result=await request('PUT','/lots/'+id,{location});assert.ok([200,400].includes(result.status));assert.deepEqual(await stored(id),original);
  }
 });
 await t.test('redrawing an existing lot replaces geom and recalculates area',async()=>{
  const before=await stored(id);const next=structuredClone(polygon);next.coordinates[0][1][0]=-61.98;next.coordinates[0][2][0]=-61.98;
  const result=await request('PUT','/lots/'+id,{location:next,area:1});assert.equal(result.status,200);
  for(const key of ['id','name','area','area_ha','location','enabled'])assert.ok(Object.hasOwn(result.body.lot,key),key);
  assert.equal(result.body.lot.area_ha,Number((await stored(id)).area_ha));
  const after=await stored(id);assert.notEqual(after.geom,before.geom);assert.ok(Number(after.area_ha)>Number(before.area_ha));
 });
 await t.test('pagination keeps its total beyond last page',async()=>{
  const result=await request('GET','/lots?page=99&pageSize=1');assert.equal(result.status,200);assert.equal(result.body.total,1);assert.deepEqual(result.body.data,[]);
 });
 await t.test('polygon holes are preserved and excluded from area',async()=>{
  const holed=structuredClone(polygon);
  holed.coordinates.push([[-61.998,-31.998],[-61.992,-31.998],[-61.992,-31.992],[-61.998,-31.992],[-61.998,-31.998]]);
  const result=await request('POST','/lots',{name:'With hole',location:holed});assert.equal(result.status,201);assert.equal(result.body.lot.geom.coordinates.length,2);
  const area=(await db.query('SELECT ROUND((ST_Area(gs_polygon_from_location_text($1)::geography)/10000)::numeric,4) AS expected',[JSON.stringify(holed)])).rows[0].expected;
  assert.equal(result.body.lot.area_ha,Number(area));
 });
 const legacyId=randomUUID();await db.query('INSERT INTO lots(id,company_id,name,area) VALUES($1,$2,$3,100)',[legacyId,company,'Legacy']);
 await t.test('legacy stays readable, metadata edit rejected, drawing regularizes',async()=>{
  for(const suffix of ['', '?includeActiveLayout=true']){
   const result=await request('GET','/lots'+suffix);assert.equal(result.status,200);
   const old=result.body.data.find(l=>l.id===legacyId);assert.equal(old.geom,null);assert.equal(old.area_ha,null);
   const spatial=result.body.data.find(l=>l.id===id);assert.ok(spatial.geom);
   assert.ok(Object.hasOwn(spatial,'area_ha'));assert.equal(Number(spatial.area_ha),Number((await stored(id)).area_ha));
   if(suffix)assert.ok(Object.hasOwn(spatial,'active_layout'));
  }
  assert.equal((await request('PUT','/lots/'+legacyId,{name:'Not saved'})).status,400);assert.equal((await stored(legacyId)).geom,null);
  assert.equal((await request('PUT','/lots/'+legacyId,{name:'Regularized',location:polygon})).status,200);assert.ok((await stored(legacyId)).geom);
 });
 await t.test('tenant isolation: other company cannot edit or list this lot',async()=>{
  const before=await stored(id);assert.equal((await request('PUT','/lots/'+id,{location:polygon},other)).status,404);assert.deepEqual(await stored(id),before);
  assert.deepEqual((await request('GET','/lots',null,other)).body.data,[]);
 });
 await t.test('failed post-write invariant rolls back insertion',async()=>{
  await db.query(`CREATE FUNCTION sabotage_area() RETURNS trigger AS $$ BEGIN NEW.area_ha=0; RETURN NEW; END $$ LANGUAGE plpgsql;
   CREATE TRIGGER zz_sabotage BEFORE INSERT ON lots FOR EACH ROW EXECUTE FUNCTION sabotage_area();`);
  const count=(await db.query('SELECT count(*) FROM lots')).rows[0].count;
  await assert.rejects(saveLot(pool,{companyId:company,name:'Rolled back',location:polygon}),e=>e.status===400);
  assert.equal((await db.query('SELECT count(*) FROM lots')).rows[0].count,count);
 });
});

test('Supabase disabled-lot list selects area_ha and retains legacy null',async()=>{
 const file=path.resolve(__dirname,'../controllers/lots/lot.disabled.js'),module={exports:{}};
 const records=[{id:'spatial',area:999,area_ha:128.6859},{id:'legacy',area:100,area_ha:null}];
 const filters=[];let columns;
 const query={select(value){columns=value.split(',');return this;},eq(...args){filters.push(args);return this;},order(){return this;},range(){return this;},
  then(resolve,reject){return Promise.resolve({data:records.map(row=>Object.fromEntries(columns.map(key=>[key,row[key]]))),count:2}).then(resolve,reject);}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,console,Promise,require:()=>({from:table=>{assert.equal(table,'lots');return query;}})},{filename:file});
 let response;
 await module.exports.listDisabledLots({user:{company_id:'tenant'},query:{}},{json:value=>{response=value;}},error=>{throw error;});
 assert.ok(columns.includes('area_ha'));assert.equal(response.data[0].area_ha,128.6859);assert.equal(response.data[1].area_ha,null);
 assert.ok(filters.some(([key,value])=>key==='company_id'&&value==='tenant'));
});
