// Restores only local backup data into disposable PostgreSQL/WASM. Never loads credentials.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const adoption=require('../services/historicalAdoption');
const migration='20261006_adopt_historical_cycles_with_harvest.sql';
const read=f=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8');
module.exports=async function fixture(t,apply=true){
  const db=new PGlite();t.after(()=>db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const f of ['tests/historySchema.fixture.sql','migrations/20260916_historical_no_stock.sql','migrations/20261004_adopt_existing_history.sql','migrations/20261005_historical_adoption_diagnostics.sql'])await db.exec(read(f));
  await db.exec("SET TIME ZONE 'UTC'");
  const backup=table=>JSON.parse(read('../audit/don-santiago-pre-reset/20260916T175923749Z/data/'+table+'.json'));
  const ids=['446de46f-9204-43ea-a8b9-ffbb9f1b01ba','8beb0869-876f-4dd8-8b0b-c54851b9867c','e9a5fbee-e1c9-47ea-ab9c-b0f76a4afb7b'];
  const planning=backup('planning').filter(p=>ids.includes(p.id));
  const companyId=planning[0].company_id,actorId=planning[0].responsible_user;
  const cycles=backup('crop_assignments').filter(c=>ids.includes(c.source_planning_id));
  const links=backup('harvest_crop_assignments').filter(h=>cycles.some(c=>c.id===h.crop_assignment_id));
  const harvests=backup('harvest_records').filter(h=>links.some(l=>l.harvest_id===h.id));
  const lots=backup('planning_lots').filter(l=>ids.includes(l.planning_id));
  const insert=async(table,row)=>{const keys=Object.keys(row).filter(k=>!['date_range','yield_kg_ha'].includes(k));await db.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]));};
  await insert('companies',{id:companyId,name:'Historical cycle fixture',inventory_control_start_date:'2026-08-31'});
  for(const u of backup('users').filter(u=>u.company_id===companyId))await insert('users',{id:u.id,company_id:companyId,email:u.id+'@example.test',role:3,enabled:true});
  for(const table of ['crops','campaigns'])for(const row of backup(table).filter(r=>planning.some(p=>p[table==='crops'?'crop_id':'campaign_id']===r.id)))await insert(table,row);
  for(const row of backup('lots').filter(r=>lots.some(l=>l.lot_id===r.id)))await insert('lots',row);
  const subs=backup('sub_lots').filter(r=>lots.some(l=>l.sub_lot_id===r.id));
  for(const row of backup('lot_layouts').filter(r=>subs.some(s=>s.layout_id===r.id)))await insert('lot_layouts',row);
  for(const row of subs)await insert('sub_lots',row);
  for(const [table,rows] of Object.entries({planning,planning_lots:lots,crop_assignments:cycles,harvest_records:harvests,harvest_crop_assignments:links}))for(const row of rows)await insert(table,row);
  const catalog=JSON.parse(read('../audit/historical-adoption-schema-readonly.json'));
  for(const tr of catalog.triggers.filter(t=>['planning','crop_assignments'].includes(t.table_name)&&t.tgname!=='protect_inventory_impact_mode')){
    await db.exec(tr.function_definition);await db.exec(tr.definition);
  }
  await db.exec(read('migrations/20261005_preserve_adopted_planning_timestamp.sql'));
  // Technical timestamp trigger is adversarial coverage: the local schema captures omit harvest timestamp triggers.
  await db.exec(`CREATE FUNCTION test_harvest_stamp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
    CREATE TRIGGER trg_harvest_stamp BEFORE UPDATE ON harvest_records FOR EACH ROW EXECUTE FUNCTION test_harvest_stamp();`);
  const productId=randomUUID(),batchId=randomUUID();
  await insert('products',{id:productId,company_id:companyId,name:'Stock test',unit:'kg',total_quantity:100,available_quantity:100});
  await insert('stock_batches',{id:batchId,company_id:companyId,product_id:productId,initial_quantity:100,available_quantity:100,unit:'kg',origin:'legacy',created_by:actorId});
  await insert('stock_movements',{company_id:companyId,product_id:productId,batch_id:batchId,movement_type:'receipt',quantity:100,unit:'kg',operation_id:randomUUID(),idempotency_key:'fixture',request_hash:'a'.repeat(64),created_by:actorId});
  if(apply)await db.exec(read('migrations/'+migration));
  let tail=Promise.resolve();
  const pool={async connect(){const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query:(s,a)=>db.query(s,a),release};}};
  const input=(planningIds=ids,key=randomUUID())=>({companyId,actorId,planningIds,key,confirmed:true});
  const graph=async id=>(await db.query('SELECT history_internal.cycle_adoption_graph($1,$2) value',[companyId,id])).rows[0].value;
  const stock=async()=>(await db.query('SELECT history_internal.inventory_snapshot($1) value',[companyId])).rows[0].value;
  return {db,pool,companyId,actorId,ids,planning,cycles,links,harvests,lots,input,graph,stock,apply:()=>db.exec(read('migrations/'+migration)),adoption};
};