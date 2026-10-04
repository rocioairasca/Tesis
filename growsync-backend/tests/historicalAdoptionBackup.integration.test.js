// Real backup regression in disposable PostgreSQL/WASM; never loads .env or a remote client.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const adoption=require('../services/historicalAdoption');
const read=f=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8');
const catalog=JSON.parse(read('../audit/historical-adoption-schema-readonly.json'));
async function setup(t,timezone) {
  const db=new PGlite();t.after(()=>db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const f of ['tests/historySchema.fixture.sql','migrations/20260916_historical_no_stock.sql','migrations/20261004_adopt_existing_history.sql']) await db.exec(read(f));
  await db.query("SELECT set_config('TimeZone',$1,false)",[timezone]);
  const dir=path.resolve(__dirname,'../../audit/don-santiago-pre-reset/20260916T175923749Z/data'); const readBackup=t=>JSON.parse(fs.readFileSync(path.join(dir,t+'.json')));
  const p=readBackup('planning').find(r=>r.id==='b71d0fad-659e-493b-8127-104b93844983');
  const ins=async(t,r)=>{const keys=Object.keys(r).filter(k=>k!=='date_range');await db.query(`INSERT INTO ${t} (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>r[k]));};
  await ins('companies',{id:p.company_id,name:'Reconstructed',inventory_control_start_date:'2026-09-24'});
  for(const id of [p.created_by,p.responsible_user])await ins('users',{id,company_id:p.company_id,email:id+'@example.test',role:3,enabled:true});
  await ins('campaigns',readBackup('campaigns').find(r=>r.id===p.campaign_id));
  const pl=readBackup('planning_lots').filter(r=>r.planning_id===p.id),pp=readBackup('planning_products').filter(r=>r.planning_id===p.id),u=readBackup('usage_records').filter(r=>r.source_planning_id===p.id);
  for(const r of pl)await ins('lots',{id:r.lot_id,company_id:p.company_id,name:'T1',area:r.area_ha});
  for(const r of pp)await ins('products',readBackup('products').find(x=>x.id===r.product_id));
  await ins('planning',p);
  for(const [t,rows] of Object.entries({planning_lots:pl,planning_products:pp,usage_records:u,usage_lots:readBackup('usage_lots').filter(r=>u.some(x=>x.id===r.usage_id)),planning_product_completions:readBackup('planning_product_completions').filter(r=>r.planning_id===p.id)}))for(const r of rows)await ins(t,r);

  // Verify relevant PostgreSQL types/precision/generated columns against the original backup.
  const schema=JSON.parse(fs.readFileSync(path.resolve(dir,'../schema/schema.json')));
  const relevant=['planning','planning_lots','planning_products','usage_records','usage_lots','planning_product_completions'];
  const columns=(await db.query("SELECT * FROM information_schema.columns WHERE table_schema='public'")).rows;
  for(const expected of schema.columns.filter(c=>relevant.includes(c.table_name))) {
    const actual=columns.find(c=>c.table_name===expected.table_name && c.column_name===expected.column_name);
    assert.ok(actual,expected.table_name+'.'+expected.column_name);
    for(const key of ['data_type','udt_name','datetime_precision','numeric_precision','numeric_scale','is_generated','generation_expression'])
      assert.equal(actual[key],expected[key],expected.table_name+'.'+expected.column_name+': '+key);
  }
  // Actual definitions captured through a catalog-only, read-only production transaction.
  // Install after restoring data: UPDATE of the adoption fields does not fire unit inheritance.
  for(const tr of catalog.triggers.filter(x=>['planning','planning_products','usage_records','planning_lots','usage_lots','planning_product_completions'].includes(x.table_name))) {
    await db.exec(tr.function_definition);
    await db.exec('DROP TRIGGER IF EXISTS "'+tr.tgname+'" ON public."'+tr.table_name+'"');
    await db.exec(tr.definition);
  }
  for(const fn of catalog.functions) await db.exec(fn.definition);
  // Keep stock nonempty to make inventory equality meaningful.
  const batch=(await db.query("INSERT INTO stock_batches(company_id,product_id,initial_quantity,available_quantity,unit,origin,created_by,received_date) VALUES($1,$2,100,100,'kg','purchase',$3,'2026-09-24') RETURNING id",[p.company_id,pp[0].product_id,p.created_by])).rows[0].id;
  await db.query("INSERT INTO stock_movements(company_id,product_id,batch_id,movement_type,quantity,unit,operation_id,idempotency_key,request_hash,created_by) VALUES($1,$2,$3,'receipt',100,'kg',gen_random_uuid(),'fixture-receipt',repeat('a',64),$4)",[p.company_id,pp[0].product_id,batch,p.created_by]);
  const input={companyId:p.company_id,actorId:p.created_by,planningIds:[p.id],key:'real-backup',confirmed:true};
  const pool={async connect(){return {query:(s,a)=>db.query(s,a),release(){}};}};
  const snapshot=async()=>(await db.query('SELECT history_internal.inventory_snapshot($1) s',[p.company_id])).rows[0].s;
  return {db,pool,input,snapshot,p};
}
for(const timezone of ['UTC','America/Argentina/Buenos_Aires'])test('backup T1: reproduce timestamp diff, preserve every other field and inventory ('+timezone+')',async t=>{
  const {db,pool,input,snapshot,p}=await setup(t,timezone);
  const preview=await adoption.prepare(pool,input),graph=preview.items[0].graph,stock=await snapshot();
  assert.equal(preview.can_confirm,true);assert.equal(preview.items[0].effective_date,'2026-06-02');
  assert.equal(graph.planning_lots[0].area_ha,68.8447);
  assert.deepEqual(graph.planning_products.map(r=>r.amount).sort((a,b)=>a-b),[3400,8840]);
  assert.equal(graph.usage_records.length,2);assert.equal(graph.planning_product_completions.length,2);
  assert.equal(graph.crop_assignments.length,0);
  // Reproduce with the original, uninstrumented function first.
  await assert.rejects(adoption.confirm(pool,input),e=>e.status===409 && /La base modificaría/.test(e.message));
  await db.exec(read('migrations/20261005_historical_adoption_diagnostics.sql'));
  let diagnostic;
  await assert.rejects(adoption.confirm(pool,input),e=>{
    diagnostic=e.adoptionDiagnostic;
    assert.equal(e.status,409);assert.equal(diagnostic.stage,'update');assert.equal(diagnostic.table,'planning');
    assert.equal(diagnostic.differences.length,1);
    const d=diagnostic.differences[0];assert.equal(d.id,p.id);assert.equal(d.field,'updated_at');
    assert.equal(d.before,graph.planning[0].updated_at);assert.notEqual(d.before,d.after);
    assert.ok(!JSON.stringify(e).includes('adoptionDiagnostic'));return true;
  });
  t.diagnostic(JSON.stringify(diagnostic));
  assert.deepEqual(await snapshot(),stock);
  assert.equal((await db.query('SELECT count(*)::int n FROM historical_imports')).rows[0].n,0);
  assert.deepEqual((await adoption.prepare(pool,input)).items[0].graph,graph);
  await db.exec(read('migrations/20261005_preserve_adopted_planning_timestamp.sql'));
  const result=await adoption.confirm(pool,input);assert.equal(result.persisted,true);
  assert.equal(result.stock_movements_created,0);assert.equal(result.stock_unchanged,true);
  for(const table of ['planning','usage_records'])for(const before of graph[table]) {
    const after=(await db.query('SELECT to_jsonb(x) r FROM '+table+' x WHERE id=$1',[before.id])).rows[0].r;
    assert.deepEqual(after,{...before,inventory_impact_mode:'HISTORICAL_NO_STOCK',historical_import_id:result.import_id});
  }
  for(const table of ['planning_lots','planning_products','usage_lots','planning_product_completions','crop_assignments']) {
    const rows=(await db.query('SELECT to_jsonb(x) r FROM '+table+' x')).rows.map(x=>x.r);
    const sort=rs=>rs.map(r=>JSON.stringify(r)).sort();assert.deepEqual(sort(rows),sort(graph[table]));
  }
  assert.deepEqual(await snapshot(),stock);
  assert.equal((await db.query('SELECT count(*)::int n FROM history_internal.adoption_permits')).rows[0].n,0);
  assert.equal((await adoption.confirm(pool,input)).replayed,true);
  // Ordinary edits must still stamp updated_at; no permit survives the adoption.
  await db.query("UPDATE planning SET title='Ordinary edit' WHERE id=$1",[p.id]);
  assert.notEqual((await db.query('SELECT to_jsonb(x) r FROM planning x WHERE id=$1',[p.id])).rows[0].r.updated_at,graph.planning[0].updated_at);
  await assert.rejects(db.query("UPDATE planning SET inventory_impact_mode='NORMAL' WHERE id=$1",[p.id]),/immutable/);
});
test('productive changes still fail with a precise private diagnostic and complete rollback',async t=>{
  const {db,pool,input,snapshot}=await setup(t,'UTC');
  for(const f of ['20261005_historical_adoption_diagnostics.sql','20261005_preserve_adopted_planning_timestamp.sql']) await db.exec(read('migrations/'+f));
  const graph=(await adoption.prepare(pool,input)).items[0].graph,stock=await snapshot();
  await db.exec(`CREATE FUNCTION change_amount() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.amount_used=NEW.amount_used+1; RETURN NEW; END $$;
    CREATE TRIGGER zz_change_amount BEFORE UPDATE ON usage_records FOR EACH ROW EXECUTE FUNCTION change_amount();`);
  await assert.rejects(adoption.confirm(pool,input),e=>{
    assert.equal(e.status,409);assert.equal(e.adoptionDiagnostic.table,'usage_records');
    const d=e.adoptionDiagnostic.differences[0];assert.equal(d.field,'amount_used');assert.equal(d.after,d.before+1);return true;
  });
  assert.deepEqual((await adoption.prepare(pool,input)).items[0].graph,graph);assert.deepEqual(await snapshot(),stock);
  assert.equal((await db.query('SELECT count(*)::int n FROM historical_events')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM historical_imports')).rows[0].n,0);
});

test('HTTP keeps field diagnostics exclusively in the server log',()=>{
  const vm=require('node:vm'),module={exports:{}},logs=[];
  vm.runInNewContext(read('middleware/errorHandler.js'),{module,console:{error:(...args)=>logs.push(args)}});
  const error=new Error('No se realizó el cambio porque podría alterar los datos de la planificación. Necesita una revisión antes de continuar.');
  error.status=409;
  Object.defineProperty(error,'adoptionDiagnostic',{value:{kind:'historical_adoption_diff',table:'planning',differences:[{id:'private-record',field:'updated_at',before:'private-before',after:'private-after'}]}});
  let body,status;
  module.exports(error,{}, {status(s){status=s;return this;},json(b){body=b;}},()=>assert.fail('unexpected next'));
  assert.equal(status,409);assert.equal(body.message,error.message);
  assert.equal(JSON.stringify(body).includes('private'),false);
  assert.equal(JSON.stringify(logs).includes('private-record'),true);
});
