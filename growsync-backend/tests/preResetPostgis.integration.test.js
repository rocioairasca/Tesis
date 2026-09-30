// Real local PostgreSQL/PostGIS only, using the same guarded disposable harness.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const database=require('./stockInitialDatabase.fixture');
const stock=require('../services/stock'),initial=require('../services/stockInitialPlan'),history=require('../services/historicalImport');
const options={skip:!process.env.STOCK_INITIAL_POSTGIS_URL};
const sqlFile=name=>fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8');
const newMigrations=['20260916_historical_no_stock.sql','20260916_stock_initial.sql'];
async function legacySchema(db){
  await db.exec(fs.readFileSync(path.join(__dirname,'historySchema.fixture.sql'),'utf8'));
  // This is a captured prerequisite schema, NOT a claimed clean install migration.
  await db.exec('BEGIN;'+sqlFile('20260830_add_lot_layouts_sub_lots_postgis.sql')+'COMMIT;');
  const inventorySql=require('./stockSchema.fixture');
  const guards=inventorySql.slice(inventorySql.indexOf('CREATE FUNCTION inventory_stamp_updated_at()'),inventorySql.indexOf('ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY'));
  assert.ok(guards.includes('inventory_guard_movement'));
  await db.exec(guards);
  // Reinstall the already-existing harvest trigger definitions on the captured
  // post-partial-harvest schema; do not rerun its non-idempotent ALTERs.
  const harvest=sqlFile('20260908_add_partial_harvests.sql');
  await db.exec(harvest.slice(harvest.indexOf('CREATE FUNCTION normalize_new_harvest_cycle_area()'),harvest.lastIndexOf('COMMIT;')));
  await db.exec('BEGIN;'+sqlFile('20260914_inventory_base_units.sql')+'COMMIT;');
}
async function seed(db){
  const x={companyId:randomUUID(),actorId:randomUUID(),productId:randomUUID(),lotId:randomUUID(),layoutId:randomUUID(),subLotId:randomUUID(),planningId:randomUUID(),ppId:randomUUID(),usageId:randomUUID()};
  await db.query("INSERT INTO companies(id,name) VALUES($1,'Local synthetic validation')",[x.companyId]);
  await db.query("INSERT INTO users(id,company_id,email,role,enabled) VALUES($1,$2,$3,3,true)",[x.actorId,x.companyId,x.actorId+'@example.test']);
  await db.query("INSERT INTO products(id,company_id,name,unit,total_quantity,available_quantity) VALUES($1,$2,'Synthetic kg','kg',30,25)",[x.productId,x.companyId]);
  await db.query("INSERT INTO lots(id,company_id,name,area,geom) VALUES($1,$2,'Synthetic polygon',2,ST_GeomFromText('POLYGON((-61 -34,-61 -33.999,-60.999 -33.999,-60.999 -34,-61 -34))',4326))",[x.lotId,x.companyId]);
  await db.query("INSERT INTO lot_layouts(id,lot_id,company_id,version,name,status,parent_geom_snapshot,parent_area_ha_snapshot,created_by) SELECT $1,id,company_id,1,'Historical layout','locked',geom,area_ha,$3 FROM lots WHERE id=$2",[x.layoutId,x.lotId,x.actorId]);
  await db.query("INSERT INTO sub_lots(id,layout_id,lot_id,company_id,code,name,geom,area_ha) VALUES($1,$2,$3,$4,'A','Historical part',ST_GeomFromText('POLYGON((-61 -34,-61 -33.999,-60.9995 -33.999,-60.9995 -34,-61 -34))',4326),1)",[x.subLotId,x.layoutId,x.lotId,x.companyId]);
  await db.query("INSERT INTO planning(id,company_id,title,activity_type,status,start_at,end_at,effective_date,responsible_user) VALUES($1,$2,'Legacy unchanged','fumigacion','completado','2019-01-01','2019-01-01','2019-01-01',$3)",[x.planningId,x.companyId,x.actorId]);
  await db.query('INSERT INTO planning_lots(planning_id,lot_id,sub_lot_id,area_ha) VALUES($1,$2,$3,0.5)',[x.planningId,x.lotId,x.subLotId]);
  await db.query("INSERT INTO planning_products(id,planning_id,product_id,amount,unit) VALUES($1,$2,$3,5,'kg')",[x.ppId,x.planningId,x.productId]);
  await db.query("INSERT INTO usage_records(id,company_id,product_id,amount_used,unit,date,user_id,source_planning_id,source_planning_product_id) VALUES($1,$2,$3,5,'kg','2019-01-01',$4,$5,$6)",[x.usageId,x.companyId,x.productId,x.actorId,x.planningId,x.ppId]);
  return x;
}
async function geometries(db){
  return (await db.query(`SELECT 'lot' kind,id,encode(ST_AsEWKB(geom),'hex') ewkb,ST_SRID(geom) srid,ST_NPoints(geom) points,area_ha::text area,NULL::uuid parent,NULL::uuid layout FROM lots
    UNION ALL SELECT 'layout',id,encode(ST_AsEWKB(parent_geom_snapshot),'hex'),ST_SRID(parent_geom_snapshot),ST_NPoints(parent_geom_snapshot),parent_area_ha_snapshot::text,lot_id,id FROM lot_layouts
    UNION ALL SELECT 'sub_lot',id,encode(ST_AsEWKB(geom),'hex'),ST_SRID(geom),ST_NPoints(geom),area_ha::text,lot_id,layout_id FROM sub_lots ORDER BY kind,id`)).rows;
}
test('clean database: repository migrations expose missing historical baseline (not silently repaired)',options,async t=>{
  const db=await database(t);
  await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS btree_gist; CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
  await assert.rejects(db.exec('BEGIN;'+sqlFile('create_companies_and_invitations.sql')+'COMMIT;'),e=>e.code==='42P01'&&/users/.test(e.message));
  await db.query('ROLLBACK');
  assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema=current_schema()")).rows[0].n,0);
  t.diagnostic('Clean install blocked: base users/products/lots/planning/usage/inventory schema is not created by the repository migration chain.');
});
test('legacy migration and historical spatial chain preserve quantities, mode defaults, EWKB, SRID and layout identity',options,async t=>{
  const db=await database(t);await legacySchema(db);const x=await seed(db);
  const crop=randomUUID(),campaign=randomUUID(),assignment=randomUUID(),harvest=randomUUID();
  await db.query("INSERT INTO crops(id,company_id,name) VALUES($1,$2,'Synthetic crop')",[crop,x.companyId]);
  await db.query("INSERT INTO campaigns(id,company_id,name,start_date,end_date) VALUES($1,$2,'Synthetic campaign','2019-01-01','2019-12-31')",[campaign,x.companyId]);
  await db.query("INSERT INTO crop_assignments(id,company_id,campaign_id,lot_id,sub_lot_id,crop_id,start_date,area_ha,source_planning_id) VALUES($1,$2,$3,$4,$5,$6,'2019-01-01',0.50,$7)",[assignment,x.companyId,campaign,x.lotId,x.subLotId,crop,x.planningId]);
  await db.query("INSERT INTO harvest_records(id,company_id,lot_id,sub_lot_id,crop_id,campaign_id,crop,campaign,harvest_date,production_kg,harvested_area_ha,created_by) VALUES($1,$2,$3,$4,$5,$6,'Synthetic crop','2019-2020','2019-06-01',100,0.25,$7)",[harvest,x.companyId,x.lotId,x.subLotId,crop,campaign,x.actorId]);
  await db.query('INSERT INTO harvest_crop_assignments(harvest_id,crop_assignment_id,harvested_area_ha) VALUES($1,$2,0.25)',[harvest,assignment]);
  const beforeGeometry=await geometries(db);
  const beforeProducts=(await db.query('SELECT to_jsonb(p) value FROM products p')).rows;
  const beforePlanning=(await db.query('SELECT to_jsonb(p) value FROM planning p')).rows;
  const beforeUsage=(await db.query('SELECT to_jsonb(u) value FROM usage_records u')).rows;
  const beforeAssignment=(await db.query('SELECT to_jsonb(a) value FROM crop_assignments a')).rows;
  const beforeHarvest=(await db.query('SELECT to_jsonb(h) value FROM harvest_records h')).rows;
  for(const file of newMigrations) await db.exec(sqlFile(file));
  assert.deepEqual(await geometries(db),beforeGeometry);
  assert.deepEqual((await db.query('SELECT to_jsonb(p) value FROM products p')).rows,beforeProducts);
  assert.deepEqual((await db.query("SELECT to_jsonb(p)-ARRAY['inventory_impact_mode','historical_import_id'] value FROM planning p")).rows,beforePlanning);
  assert.deepEqual((await db.query("SELECT to_jsonb(u)-ARRAY['inventory_impact_mode','historical_import_id'] value FROM usage_records u")).rows,beforeUsage);
  assert.deepEqual((await db.query("SELECT to_jsonb(a)-ARRAY['inventory_impact_mode','historical_import_id'] value FROM crop_assignments a")).rows,beforeAssignment);
  assert.deepEqual((await db.query("SELECT to_jsonb(h)-ARRAY['inventory_impact_mode','historical_import_id'] value FROM harvest_records h")).rows,beforeHarvest);
  for(const table of ['planning','usage_records','crop_assignments','harvest_records']) assert.equal((await db.query('SELECT inventory_impact_mode FROM '+table)).rows[0].inventory_impact_mode,'NORMAL');
  assert.equal((await db.query('SELECT inventory_control_start_date FROM companies')).rows[0].inventory_control_start_date,null);
  assert.equal((await db.query('SELECT count(*)::int n FROM stock_movements')).rows[0].n,0);
  const p=randomUUID(),pp=randomUUID(),u=randomUUID();
  const pool={async connect(){return {query:(s,a)=>db.query(s,a),release(){}};}};
  await history.importHistory(pool,{companyId:x.companyId,actorId:x.actorId,key:randomUUID(),source:'PostGIS synthetic historical chain',confirmedNoStock:true,records:{
    planning:[{id:p,company_id:x.companyId,title:'Historical polygon untouched',activity_type:'fumigacion',status:'completado',start_at:'2018-01-01',end_at:'2018-01-01',effective_date:'2018-01-01',responsible_user:x.actorId}],
    planning_lots:[{planning_id:p,lot_id:x.lotId,sub_lot_id:x.subLotId,area_ha:0.5}],
    planning_products:[{id:pp,planning_id:p,product_id:x.productId,amount:200,unit:'kg'}],
    usage_records:[{id:u,company_id:x.companyId,product_id:x.productId,amount_used:200,unit:'kg',date:'2018-01-01',user_id:x.actorId,source_planning_id:p,source_planning_product_id:pp}],
    usage_lots:[{usage_id:u,lot_id:x.lotId,sub_lot_id:x.subLotId}],
    planning_product_completions:[{planning_id:p,planning_product_id:pp,usage_id:u,actual_amount:200}],
  }});
  assert.deepEqual(await geometries(db),beforeGeometry);
  assert.deepEqual((await db.query('SELECT to_jsonb(p) value FROM products p')).rows,beforeProducts);
  assert.equal((await db.query('SELECT count(*)::int n FROM stock_movements')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM notifications')).rows[0].n,0);
  const inventory=(await db.query(`SELECT count(*) FILTER(WHERE contype='f')::int fks,count(*) FILTER(WHERE contype='c')::int checks
    FROM pg_constraint WHERE connamespace=(SELECT oid FROM pg_namespace WHERE nspname=current_schema())`)).rows[0];
  assert.ok(inventory.fks>40&&inventory.checks>40);
  const trigger=(await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname IN ('stock_initial_complete','stock_initial_movement_guard','lots_set_geom_area','sub_lots_set_area') AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=current_schema()))")).rows[0].n;
  assert.equal(trigger,4);
  const definitions={};
  definitions.functions=(await db.query("SELECT proname,pg_get_functiondef(p.oid) definition FROM pg_proc p WHERE pronamespace=(SELECT oid FROM pg_namespace WHERE nspname=current_schema()) ORDER BY proname")).rows;
  definitions.triggers=(await db.query("SELECT tgname,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=current_schema()) AND NOT t.tgisinternal ORDER BY tgname")).rows;
  definitions.constraints=(await db.query("SELECT conname,contype,convalidated,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=(SELECT oid FROM pg_namespace WHERE nspname=current_schema()) ORDER BY conname")).rows;
  definitions.indexes=(await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() ORDER BY indexname")).rows;
  definitions.types=(await db.query("SELECT table_name,column_name,data_type,udt_name,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,ordinal_position")).rows;
  assert.ok(definitions.constraints.every(c=>c.convalidated));
  const evidencePath=path.join(__dirname,'../../audit/local-postgis-validation');fs.mkdirSync(evidencePath,{recursive:true});
  fs.writeFileSync(path.join(evidencePath,'schema-check.json'),JSON.stringify({definitions,geometry_before:beforeGeometry,geometry_after:await geometries(db),legacy_quantities_unchanged:true,existing_modes_normal:true,control_date_null:true},null,2)+'\n');
  t.diagnostic(JSON.stringify({geometry_rows:beforeGeometry.length,ewkb_identical:true,srid:4326,...inventory}));
});
test('real concurrent sessions: retry, different-key opening and receipt race never produce duplicate or partial opening',options,async t=>{
  const db=await database(t);await legacySchema(db);for(const f of newMigrations) await db.exec(sqlFile(f));
  const pool=await db.concurrentPool();
  try{
    for(const scenario of ['same-key','different-key','receipt']){
      const x=await seed(db);await db.query("UPDATE companies SET inventory_control_start_date='2020-01-01' WHERE id=$1",[x.companyId]);

      const args={companyId:x.companyId,actorId:x.actorId,date:'2020-01-01',entries:[{product_id:x.productId,quantity:'10',unit:'kg',expiration_date:null}],confirmed:true,key:randomUUID()};
      args.previewHash=(await initial.prepare(pool,args)).preview_hash;
      const a=initial.confirm(pool,args);
      const b=scenario==='receipt'?stock.transaction(pool,c=>stock.receiveStock(c,{companyId:x.companyId,actorId:x.actorId,productId:x.productId,quantity:5,unit:'kg',origin:'purchase',received_date:'2020-01-02',key:randomUUID()})):
        initial.confirm(pool,{...args,key:scenario==='same-key'?args.key:randomUUID()});
      const outcomes=await Promise.allSettled([a,b]);
      const n=(await db.query('SELECT count(*)::int n FROM stock_initial_openings WHERE company_id=$1',[x.companyId])).rows[0].n;
      if(scenario==='same-key'){assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,2);assert.equal(n,1);}
      if(scenario==='different-key'){assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(n,1);}
      if(scenario==='receipt'){
        assert.equal(outcomes[1].status,'fulfilled');
        if(outcomes[0].status==='rejected')assert.equal(outcomes[0].reason.status,409);
      }
      const batch=(await db.query('SELECT count(*)::int n FROM stock_batches WHERE company_id=$1 AND origin=\'stock_initial\'',[x.companyId])).rows[0].n;
      const move=(await db.query('SELECT count(*)::int n FROM stock_movements WHERE company_id=$1 AND movement_type=\'stock_initial\'',[x.companyId])).rows[0].n;
      assert.equal(batch,n);assert.equal(move,n);
      const sums=(await db.query('SELECT (SELECT COALESCE(sum(available_quantity),0)::text FROM stock_batches WHERE company_id=$1) balance,(SELECT COALESCE(sum(quantity),0)::text FROM stock_movements WHERE company_id=$1) movements',[x.companyId])).rows[0];
      assert.equal(Number(sums.balance),Number(sums.movements));
      t.diagnostic(JSON.stringify({scenario,results:outcomes.map(o=>o.status==='fulfilled'?'ok':o.reason.code||o.reason.status),openings:n,balance:sums.balance}));
    }
  }finally{await pool.end();}
});
