// Reconstructed from the read-only backup; this helper creates only a disposable in-memory database.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {addProduct}=require('../services/historicalPlanningProduct');
const {planningGraph}=require('../services/historicalPlanningGuard');
module.exports=async function fixture(t,withHarvest=false){
  const db=new PGlite();t.after(()=>db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const f of ['./historySchema.fixture.sql','../migrations/20260916_historical_no_stock.sql'])await db.exec(fs.readFileSync(require.resolve(f),'utf8'));
  await db.exec("SET TIME ZONE 'UTC'");
  const read=table=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../audit/don-santiago-pre-reset/20260916T175923749Z/data',table+'.json')));
  const planning=read('planning').find(p=>p.id==='fe4b75d4-84eb-4f4b-814e-3d06653e572e');
  const lots=read('planning_lots').filter(p=>p.planning_id===planning.id);
  const cycle=read('crop_assignments').find(p=>p.source_planning_id===planning.id);
  const insert=async(table,row)=>{const keys=Object.keys(row).filter(k=>!['date_range','yield_kg_ha'].includes(k));await db.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]));};
  const companyId=planning.company_id,actorId=planning.responsible_user,id=planning.id;
  await insert('companies',{id:companyId,name:'Fixture T2'});
  for(const uid of new Set([planning.responsible_user,planning.created_by]))await insert('users',{id:uid,company_id:companyId,email:uid+'@example.test',role:3,enabled:true});
  await insert('crops',read('crops').find(p=>p.id===planning.crop_id));
  await insert('campaigns',read('campaigns').find(p=>p.id===planning.campaign_id));
  const lot=read('lots').find(p=>p.id===lots[0].lot_id);
  await insert('lots',{id:lot.id,name:lot.name,company_id:companyId,area:lot.area,area_ha:lot.area_ha});
  // Model the already historical state reported by the user; never reclassify the backup or live data.
  await insert('planning',{...planning,inventory_impact_mode:'HISTORICAL_NO_STOCK'});
  for(const row of lots)await insert('planning_lots',row);
  await insert('crop_assignments',{...cycle,...(withHarvest?{end_date:'2026-05-01',harvest_closure_source:'manual'}:{}),inventory_impact_mode:'HISTORICAL_NO_STOCK'});
  if(withHarvest){
    // Additional adversarial coverage, not a claim that T2 has these harvests in the backup.
    const harvestId=randomUUID();
    await insert('harvest_records',{id:harvestId,company_id:companyId,lot_id:lot.id,crop:'Soja',campaign:'2025-2026',crop_id:planning.crop_id,campaign_id:planning.campaign_id,
      harvest_date:'2026-05-01',production_kg:1000,harvested_area_ha:70,inventory_impact_mode:'HISTORICAL_NO_STOCK'});
    await insert('harvest_crop_assignments',{harvest_id:harvestId,crop_assignment_id:cycle.id,harvested_area_ha:70});
    await insert('harvest_cycle_closures',{id:randomUUID(),company_id:companyId,crop_assignment_id:cycle.id,finalized_date:'2026-05-01',reason:'loss',created_by:actorId,total_area_ha:70.97,harvested_area_ha:70,remaining_area_ha:0.97});
  }
  // Install documented production triggers after restoring source rows. No cycle writes are needed by corrections.
  const catalog=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../audit/historical-adoption-schema-readonly.json')));
  for(const tr of catalog.triggers.filter(t=>['planning','crop_assignments'].includes(t.table_name)&&t.tgname!=='protect_inventory_impact_mode')){
    await db.exec(tr.function_definition);await db.exec(tr.definition);
  }
  const productId=randomUUID();
  await insert('products',{id:productId,company_id:companyId,name:'Semilla Soja',unit:'kg',total_quantity:100,available_quantity:100});
  await insert('stock_batches',{id:randomUUID(),company_id:companyId,product_id:productId,initial_quantity:100,available_quantity:100,unit:'kg',origin:'legacy',created_by:actorId});
  const pool={async connect(){return {query:(s,a)=>db.query(s,a),release(){}};}};
  const added=await addProduct(pool,{companyId,actorId,planningId:id,body:{product_id:productId,amount:'4613.05'}});
  const snapshot=async()=>{
    const out={};
    for(const table of ['crop_assignments','harvest_records','harvest_crop_assignments','harvest_cycle_closures','lots','sub_lots','crops','campaigns','products','stock_batches','stock_movements'])
      out[table]=(await db.query(`SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]')::text value FROM ${table} x`)).rows[0].value;
    return out;
  };
  return {db,pool,planning,cycle,companyId,actorId,id,lotId:lot.id,product:added.product,snapshot,graph:()=>planningGraph(db,id),
    input:{companyId,actorId,table:'planning',id},lots};
};