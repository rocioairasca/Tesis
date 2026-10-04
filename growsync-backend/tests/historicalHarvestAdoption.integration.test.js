const {test}=require('node:test'),assert=require('node:assert/strict');
const setup=require('./historicalHarvestAdoption.fixture');
const adoption=require('../services/historicalAdoption');
const mutation=require('../services/historicalMutation');
test('backup A/B/C: adopción completa conserva todos los campos, áreas independientes, rendimiento e inventario',async t=>{
  const x=await setup(t,false);
  assert.equal((await adoption.prepare(x.pool,x.input())).can_confirm,false);
  await x.apply();
  const stock=await x.stock();
  const expected=[[46.0932,46.09,45,89640],[92.6495,92.65,92,315700],[19.8314,19.83,19.83,45000]];
  for(const [index,id] of x.ids.entries()){
    const input=x.input([id]),preview=await adoption.prepare(x.pool,input),before=await x.graph(id);
    assert.equal(preview.can_confirm,true,JSON.stringify(preview.items[0].blockers));
    const h=before.harvest_records[0];assert.deepEqual([before.planning_lots[0].area_ha,before.crop_assignments[0].area_ha,h.harvested_area_ha,h.production_kg],expected[index]);
    const result=await adoption.confirm(x.pool,input),after=await x.graph(id);
    for(const [table,rows] of Object.entries(before)){
      const converted=['planning','usage_records','crop_assignments','harvest_records'].includes(table);
      assert.deepEqual(after[table],rows.map(r=>converted?{...r,inventory_impact_mode:'HISTORICAL_NO_STOCK',historical_import_id:result.import_id}:r),table);
    }
    assert.deepEqual(await x.stock(),stock);assert.equal(result.stock_movements_created,0);
    assert.equal((await adoption.confirm(x.pool,input)).replayed,true);
    const events=(await x.db.query('SELECT * FROM historical_events WHERE entity_id=$1',[id])).rows;
    assert.equal(events.length,1);assert.equal(events[0].actor_id,x.actorId);
    assert.deepEqual(events[0].after_data.graph,after);
    await assert.rejects(x.db.query("UPDATE harvest_records SET inventory_impact_mode='NORMAL' WHERE id=$1",[h.id]),/immutable/);
    await mutation.mutate(x.pool,{companyId:x.companyId,actorId:x.actorId,table:'planning',id,body:{description:'Corrección histórica'}});
    assert.deepEqual((await x.graph(id)).harvest_records,after.harvest_records);
    assert.deepEqual((await x.graph(id)).crop_assignments,after.crop_assignments);
  }
});
for(const table of ['planning','crop_assignments','harvest_records'])test(`fallo en ${table} revierte el lote completo de tres antecedentes`,async t=>{
  const x=await setup(t),before=await Promise.all(x.ids.map(x.graph)),stock=await x.stock();
  const id=table==='planning'?x.ids[2]:table==='crop_assignments'?x.cycles[2].id:x.harvests[2].id;
  await x.db.exec(`CREATE FUNCTION fail_adoption() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.id='${id}'::uuid THEN RAISE EXCEPTION 'Fallo de prueba' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER zzz_fail_adoption BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_adoption();`);
  await assert.rejects(adoption.confirm(x.pool,x.input()),e=>e.status===409);
  assert.deepEqual(await Promise.all(x.ids.map(x.graph)),before);assert.deepEqual(await x.stock(),stock);
  for(const table of ['historical_imports','historical_events','history_internal.adoption_permits'])assert.equal((await x.db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
});
test('fecha posterior, cierre explícito y cosecha fuera de empresa bloquean sin escrituras',async t=>{
  const x=await setup(t),h=x.harvests[0],ca=x.cycles.find(c=>c.id===x.links.find(l=>l.harvest_id===h.id).crop_assignment_id);
  const input=x.input([ca.source_planning_id]);
  await x.db.query("UPDATE harvest_records SET harvest_date='2026-08-31' WHERE id=$1",[h.id]);
  assert.equal((await adoption.prepare(x.pool,input)).can_confirm,false);assert.equal((await adoption.confirm(x.pool,input)).conflict,true);
  await x.db.query('UPDATE harvest_records SET harvest_date=$2 WHERE id=$1',[h.id,h.harvest_date]);
  await x.db.query(`INSERT INTO harvest_cycle_closures(company_id,crop_assignment_id,finalized_date,reason,created_by,total_area_ha,harvested_area_ha,remaining_area_ha)
    VALUES($1,$2,'2026-05-01','loss',$3,46.09,45,1.09)`,[x.companyId,ca.id,x.actorId]);
  const p=await adoption.prepare(x.pool,input);assert.equal(p.can_confirm,false);assert.match(p.items[0].blockers.join(' '),/cierre de cosecha/);
  assert.equal((await adoption.confirm(x.pool,input)).conflict,true);
  await x.db.exec('DELETE FROM harvest_cycle_closures');
  const foreign=(await x.db.query("INSERT INTO companies(name) VALUES('Foreign fixture') RETURNING id")).rows[0].id;
  await x.db.query('UPDATE harvest_records SET company_id=$2 WHERE id=$1',[h.id,foreign]);
  const blocked=await adoption.prepare(x.pool,input);assert.equal(blocked.can_confirm,false);assert.equal(blocked.items[0].graph,null);
  assert.equal((await x.db.query('SELECT count(*)::int n FROM historical_imports')).rows[0].n,0);
});for(const sabotage of ['inventory','relationship','audit_effect'])test(`cualquier efecto secundario ${sabotage} revierte entidades y auditoría`,async t=>{
  const x=await setup(t),before=await Promise.all(x.ids.map(x.graph)),stock=await x.stock();
  const action=sabotage==='inventory'?"UPDATE products SET available_quantity=available_quantity+1;":
    "UPDATE harvest_crop_assignments SET harvested_area_ha=harvested_area_ha+0.01;";
  const table=sabotage==='audit_effect'?'historical_events':'harvest_records';
  const operation=sabotage==='audit_effect'?'INSERT':'UPDATE';
  await x.db.exec(`CREATE FUNCTION sabotage_cycle_adoption() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${action} RETURN NEW; END $$;
    CREATE TRIGGER sabotage_cycle_adoption AFTER ${operation} ON ${table} FOR EACH ROW EXECUTE FUNCTION sabotage_cycle_adoption();`);
  await assert.rejects(adoption.confirm(x.pool,x.input()),e=>{
    assert.equal(e.status,409);assert.ok(e.adoptionDiagnostic);return true;
  });
  assert.deepEqual(await Promise.all(x.ids.map(x.graph)),before);assert.deepEqual(await x.stock(),stock);
  assert.equal((await x.db.query('SELECT count(*)::int n FROM historical_events')).rows[0].n,0);
  assert.equal((await x.db.query('SELECT count(*)::int n FROM historical_imports')).rows[0].n,0);
});
test('cosecha compartida no se adopta parcialmente y helpers privados siguen inaccesibles',async t=>{
  const x=await setup(t);
  const h=x.harvests[0],linked=x.links.find(l=>l.harvest_id===h.id),other=x.cycles.find(c=>c.id!==linked.crop_assignment_id);
  await x.db.query('INSERT INTO harvest_crop_assignments(harvest_id,crop_assignment_id,harvested_area_ha) VALUES($1,$2,1)',[h.id,other.id]);
  const preview=await adoption.prepare(x.pool,x.input());assert.equal(preview.can_confirm,false);
  assert.match(preview.items.flatMap(i=>i.blockers).join(' '),/otras actividades/);
  assert.equal((await adoption.confirm(x.pool,x.input())).conflict,true);
  for(const fn of ['history_internal.cycle_adoption_graph(uuid,uuid)','history_internal.assert_cycle_adoption(uuid,uuid,jsonb,uuid)',
    'history_internal.preserve_adopted_harvest_timestamp()']){
    assert.equal((await x.db.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') allowed",[fn])).rows[0].allowed,false);
  }
  await assert.rejects(x.db.query("UPDATE harvest_records SET inventory_impact_mode='HISTORICAL_NO_STOCK' WHERE id=$1",[h.id]),/immutable/);
});
