// Embedded PostgreSQL only. No .env, Supabase or production connection.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const service=require('../services/recipes');
let db,pool;
before(async()=>{
  db=new PGlite();await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(fs.readFileSync(require.resolve('./historySchema.fixture.sql'),'utf8'));
  await db.exec(fs.readFileSync(require.resolve('../migrations/20261012_recipes.sql'),'utf8'));
  pool={query:(s,a)=>db.query(s,a),async connect(){return {query:(s,a)=>db.query(s,a),release(){}};}};
});
after(()=>db?.close());
async function put(table,row){const keys=Object.keys(row);await db.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]));}
async function fixture(){
  await db.exec('TRUNCATE companies CASCADE');
  const companyId=randomUUID(),other=randomUUID(),actorId=randomUUID(),foreignActor=randomUUID(),crop=randomUUID(),foreignCrop=randomUUID();
  const liter=randomUUID(),mass=randomUUID(),foreignProduct=randomUUID(),disabled=randomUUID();
  for(const [id,name] of [[companyId,'A'],[other,'B']])await put('companies',{id,name});
  for(const [id,company] of [[actorId,companyId],[foreignActor,other]])await put('users',{id,company_id:company,email:id+'@example.test',role:3});
  for(const [id,company] of [[crop,companyId],[foreignCrop,other]])await put('crops',{id,company_id:company,name:'Maíz'});
  for(const [id,company,unit,enabled] of [[liter,companyId,'litros',true],[mass,companyId,'kg',true],[foreignProduct,other,'L',true],[disabled,companyId,'L',false]])
    await put('products',{id,company_id:company,name:id,unit,enabled,total_quantity:100,available_quantity:90});
  const batch=randomUUID();await put('stock_batches',{id:batch,company_id:companyId,product_id:liter,initial_quantity:100,available_quantity:90,unit:'litros',origin:'purchase',received_date:'2026-10-01',created_by:actorId});
  await put('usage_records',{id:randomUUID(),company_id:companyId,product_id:liter,date:'2026-10-01',amount_used:10,unit:'L',created_by:actorId});
  const input={companyId,actorId};
  const body={name:'Barbecho Maíz',activity_type:'fumigacion',field_context:'stubble',crop_id:crop,items:[{product_id:liter,dose_amount:'2.5',dose_unit:'L'},{product_id:mass,dose_amount:'300',dose_unit:'g'}]};
  return {input,body,other,foreignActor,crop,foreignCrop,liter,mass,foreignProduct,disabled,create:(patch={})=>service.create(pool,{...input,body:{...body,...patch}})};
}
async function snapshot(){const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;const out={};for(const {tablename} of tables)out[tablename]=(await db.query(`SELECT to_jsonb(t)::text AS value FROM "${tablename}" t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.value);return out;}
test('valid multi-product recipe retains entered units and only writes new recipe tables',async()=>{
  const x=await fixture(),before=await snapshot(),r=await x.create(),after=await snapshot();
  assert.equal(r.name,'Barbecho Maíz');assert.equal(r.crop_name,'Maíz');assert.equal(r.items.length,2);assert.equal(r.company_id,x.input.companyId);
  assert.equal(r.items.find(i=>i.product_id===x.mass).dose_unit,'g');assert.equal(r.items.find(i=>i.product_id===x.liter).dose_amount,'2.500000');
  for(const table of Object.keys(before).filter(t=>!['recipes','recipe_items'].includes(t)))assert.deepEqual(after[table],before[table],table);
  assert.equal((await service.list(pool,x.input)).length,1);
});
test('general recipes do not require a crop or field context; cc is an existing input alias',async()=>{
  const x=await fixture(),r=await x.create({crop_id:null,field_context:null,items:[{product_id:x.liter,dose_amount:'300',dose_unit:'cc'}]});
  assert.equal(r.crop_id,null);assert.equal(r.field_context,null);assert.equal(r.items[0].dose_unit,'mL');assert.equal(r.items[0].dose_amount,'300.000000');
});
for(const [name,change] of [
  ['duplicate product',x=>({items:[x.body.items[0],x.body.items[0]]})],
  ['foreign product',x=>({items:[{...x.body.items[0],product_id:x.foreignProduct}]})],
  ['disabled new product',x=>({items:[{...x.body.items[0],product_id:x.disabled}]})],
  ['foreign crop',x=>({crop_id:x.foreignCrop})],['empty name',()=>({name:'   '})],['zero',x=>({items:[{...x.body.items[0],dose_amount:0}]})],
  ['negative',x=>({items:[{...x.body.items[0],dose_amount:-1}]})],['seven decimals',x=>({items:[{...x.body.items[0],dose_amount:'1.0000001'}]})],
  ['incompatible unit',x=>({items:[{...x.body.items[0],dose_unit:'kg'}]})],['incompatible mass unit',x=>({items:[{...x.body.items[1],dose_unit:'mL'}]})],
  ['missing unit',x=>({items:[{product_id:x.liter,dose_amount:1}]})],['empty items',()=>({items:[]})],['invalid activity',()=>({activity_type:'cosecha'})],
  ['body company',x=>({company_id:x.other})],['NaN',x=>({items:[{...x.body.items[0],dose_amount:'NaN'}]})],
])test('rejects '+name+' without any writes',async()=>{
  const x=await fixture(),before=await snapshot();await assert.rejects(x.create(change(x)),e=>e.status===400);assert.deepEqual(await snapshot(),before);
});
test('six decimals are accepted; extra conversion precision uses shared rules',async()=>{
  const x=await fixture(),r=await x.create({items:[{...x.body.items[0],dose_amount:'0.000001'}]});assert.equal(r.items[0].dose_amount,'0.000001');
  await assert.rejects(x.create({name:'Otra',items:[{...x.body.items[0],dose_amount:'0.000001',dose_unit:'mL'}]}),/seis decimales/);
});
test('tenant isolation applies to list, get, update, disable, enable, options',async()=>{
  const x=await fixture(),r=await x.create(),input={companyId:x.other,actorId:x.foreignActor,id:r.id,body:x.body};
  assert.deepEqual(await service.list(pool,input),[]);
  for(const fn of ['get','update','disable','enable'])await assert.rejects(service[fn](pool,input),e=>e.status===404);
  const opts=await service.options(pool,input);assert.equal(opts.products.length,1);assert.equal(opts.products[0].id,x.foreignProduct);
});
test('update atomically replaces item selection and rollback preserves prior recipe',async()=>{
  const x=await fixture(),r=await x.create();
  const saved=await service.update(pool,{...x.input,id:r.id,body:{...x.body,name:'Nueva',items:[{...x.body.items[0],dose_amount:'300',dose_unit:'mL'}]}});
  assert.equal(saved.name,'Nueva');assert.equal(saved.items.length,1);assert.equal(saved.items[0].dose_unit,'mL');
  const before=await snapshot();await assert.rejects(service.update(pool,{...x.input,id:r.id,body:{...x.body,name:'No guardar',items:[x.body.items[0],{...x.body.items[1],dose_amount:0}]}}),e=>e.status===400);
  assert.deepEqual(await snapshot(),before);
  await db.exec(`CREATE FUNCTION recipe_attack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$;
    CREATE TRIGGER recipe_attack BEFORE INSERT ON recipe_items FOR EACH ROW EXECUTE FUNCTION recipe_attack();`);
  try{await assert.rejects(service.update(pool,{...x.input,id:r.id,body:x.body}),/fixture rollback/);assert.deepEqual(await snapshot(),before);}
  finally{await db.exec('DROP TRIGGER recipe_attack ON recipe_items; DROP FUNCTION recipe_attack()');}
});
test('soft delete, list states, restore and normalized active-name conflicts',async()=>{
  const x=await fixture(),r=await x.create();await assert.rejects(x.create({name:'  BARBECHO MAÍZ  '}),e=>e.status===409);
  await service.disable(pool,{...x.input,id:r.id});assert.deepEqual(await service.list(pool,x.input),[]);
  assert.equal((await service.list(pool,{...x.input,enabled:'false'})).length,1);
  const next=await x.create();await assert.rejects(service.enable(pool,{...x.input,id:r.id}),e=>e.status===409);
  await service.disable(pool,{...x.input,id:next.id});const restored=await service.enable(pool,{...x.input,id:r.id});assert.equal(restored.enabled,true);
  assert.equal((await service.list(pool,{...x.input,enabled:'all'})).length,2);
});
test('existing disabled products remain readable and editable; cannot add them to another recipe',async()=>{
  const x=await fixture(),r=await x.create();await db.query('UPDATE products SET enabled=false WHERE id=$1',[x.liter]);
  const read=await service.get(pool,{...x.input,id:r.id});assert.equal(read.items.find(i=>i.product_id===x.liter).product_enabled,false);
  const edited=await service.update(pool,{...x.input,id:r.id,body:{...x.body,name:'Editada'}});assert.equal(edited.items.length,2);
  await assert.rejects(x.create({name:'Otra'}),/habilitados/);
});
test('DB guards foreign crop/product, duplicates, missing items and zero dose',async()=>{
  const x=await fixture(),r=await x.create();
  await assert.rejects(db.query('UPDATE recipes SET crop_id=$2 WHERE id=$1',[r.id,x.foreignCrop]),e=>e.code==='23514');
  await assert.rejects(db.query('INSERT INTO recipe_items(recipe_id,product_id,dose_amount,dose_unit) VALUES($1,$2,1,\'L\')',[r.id,x.foreignProduct]),e=>e.code==='23514');
  await assert.rejects(db.query('INSERT INTO recipe_items(recipe_id,product_id,dose_amount,dose_unit) VALUES($1,$2,1,\'L\')',[r.id,x.liter]),e=>e.code==='23505');
  await assert.rejects(db.query('UPDATE recipe_items SET dose_amount=0 WHERE recipe_id=$1',[r.id]),e=>e.code==='23514');
  await assert.rejects(db.query('DELETE FROM recipe_items WHERE recipe_id=$1',[r.id]),e=>e.code==='23514');
  assert.equal((await service.get(pool,{...x.input,id:r.id})).items.length,2);
});
test('filters by name, activity, crop and invalid state',async()=>{
  const x=await fixture();await x.create();await x.create({name:'General',crop_id:null,activity_type:'siembra'});
  assert.equal((await service.list(pool,{...x.input,search:'maíz'})).length,1);
  assert.equal((await service.list(pool,{...x.input,activity:'siembra'})).length,1);
  assert.equal((await service.list(pool,{...x.input,cropId:x.crop})).length,1);
  await assert.rejects(service.list(pool,{...x.input,enabled:'bad'}),e=>e.status===400);
});
for(const prefix of ['recipes','usage'])test('HTTP '+prefix+' custom permissions support recipe CRUD and protect disabled reads',async t=>{
  const x=await fixture(),express=require('express'),app=express();let permissions=[`${prefix}.view`,`${prefix}.create`,`${prefix}.edit`];
  app.use(express.json());app.use((req,res,next)=>{req.user={id:x.input.actorId,company_id:x.input.companyId,role:0,custom_permissions:permissions};next();});
  app.use('/api/recipes',require('../routes/recipes')(pool));app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const url='http://127.0.0.1:'+server.address().port+'/api/recipes';
  const request=(method,path='',body)=>fetch(url+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('POST','',{...x.body,company_id:x.other})).status,400);
  const created=await request('POST','',x.body);assert.equal(created.status,201);const r=await created.json();
  assert.equal((await request('PUT','/'+r.id,{...x.body,name:'Editada por permiso'})).status,200);
  assert.equal((await request('GET')).status,200);assert.equal((await request('GET','/options')).status,200);
  permissions.push(`${prefix}.disable`,`${prefix}.enable`,`${prefix}.view_disabled`);
  for(const [method,path,key,body] of [['GET','',`${prefix}.view`],['POST','',`${prefix}.create`,x.body],['PUT','/'+r.id,`${prefix}.edit`,x.body],['DELETE','/'+r.id,`${prefix}.disable`],['POST','/'+r.id+'/enable',`${prefix}.enable`]]){
    const prior=permissions;permissions=prior.filter(p=>p!==key);assert.equal((await request(method,path,body)).status,403);permissions=prior;
  }
  permissions=[`${prefix}.disable`];assert.equal((await request('DELETE','/'+r.id)).status,200);permissions=[`${prefix}.view`];
  for(const path of ['?enabled=false','?enabled=all','/'+r.id])assert.equal((await request('GET',path)).status,403);
  permissions.push(`${prefix}.view_disabled`);
  for(const path of ['?enabled=false','?enabled=all','/'+r.id])assert.equal((await request('GET',path)).status,200);
  permissions=[`${prefix}.enable`];assert.equal((await request('POST','/'+r.id+'/enable')).status,200);
});

test('complete CRUD lifecycle leaves Usage, stock, inventory and all unrelated tables unchanged',async()=>{
  const x=await fixture(),before=await snapshot(),recipe=await x.create();
  await service.update(pool,{...x.input,id:recipe.id,body:{...x.body,name:'Editada',items:[{...x.body.items[0],dose_amount:'300',dose_unit:'mL'}]}});
  await service.disable(pool,{...x.input,id:recipe.id});await service.enable(pool,{...x.input,id:recipe.id});
  const after=await snapshot();for(const table of Object.keys(before).filter(t=>!['recipes','recipe_items'].includes(t)))assert.deepEqual(after[table],before[table],table);
});

test('editing an active recipe cannot collide with another normalized name',async()=>{
  const x=await fixture(),a=await x.create(),b=await x.create({name:'Otra receta'}),before=await snapshot();
  await assert.rejects(service.update(pool,{...x.input,id:b.id,body:{...x.body,name:'  BARBECHO MAÍZ  '}}),e=>e.status===409);
  assert.deepEqual(await snapshot(),before);assert.equal((await service.get(pool,{...x.input,id:a.id})).name,'Barbecho Maíz');
});