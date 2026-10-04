const {test}=require('node:test'),assert=require('node:assert/strict');
const {mutate}=require('../services/historicalMutation');
const fixture=require('./historicalCycle.fixture');
for(const harvest of [false,true])test(`T2: corrección de superficie y cantidades conserva ciclo, cosechas e inventario (cosecha=${harvest})`,async t=>{
  const x=await fixture(t,harvest),protectedBefore=await x.snapshot();
  const {buildHistoricalPayload}=await import('../../grow-sync/src/features/planning/historicalPlanning.mjs');
  const dayjs=require('../../grow-sync/node_modules/dayjs');
  const editing={...x.planning,inventory_impact_mode:'HISTORICAL_NO_STOCK',lots:x.lots,products:[x.product]};
  const body=buildHistoricalPayload(editing,{title:editing.title,description:editing.description,responsible_user:editing.responsible_user,
    date_range:[dayjs('2025-12-04'),dayjs('2025-12-05')],effective_date:dayjs('2025-12-05'),historical_lots:[{area_ha:'70.97'}],products:[x.product]});
  assert.deepEqual(body.lot_selections,[{lot_id:x.lotId,sub_lot_id:null,area_ha:'70.97'}]);
  assert.equal(body.start_at,undefined);assert.equal(body.end_at,undefined);assert.equal(body.effective_date,undefined);
  assert.equal(body.products,undefined);
  assert.equal((await mutate(x.pool,{...x.input,body})).ok,true);
  assert.deepEqual(await x.snapshot(),protectedBefore);
  let graph=JSON.parse(await x.graph());assert.equal(graph.lots[0].area_ha,70.97);
  assert.equal(graph.products[0].amount,4613.05);assert.equal(graph.completions[0].actual_amount,4613.05);
  assert.equal(graph.inventory_impact_mode,'HISTORICAL_NO_STOCK');
  // Prove area is independent of the structural cycle, not just the same rounding.
  await mutate(x.pool,{...x.input,body:{lot_selections:[{lot_id:x.lotId,sub_lot_id:null,area_ha:'70.5'}],products:[{planning_product_id:x.product.id,amount:'4620',actual_amount:'4600'}]}});
  assert.deepEqual(await x.snapshot(),protectedBefore);
  graph=JSON.parse(await x.graph());assert.equal(graph.lots[0].area_ha,70.5);assert.equal(graph.products[0].amount,4620);assert.equal(graph.completions[0].actual_amount,4600);
  const events=(await x.db.query('SELECT * FROM historical_events WHERE entity_id=$1 ORDER BY occurred_at',[x.id])).rows;
  assert.equal(events.length,3);assert.equal(events[1].actor_id,x.actorId);
  assert.equal(events[1].before_data.lots[0].area_ha,70.9676);assert.equal(events[1].after_data.lots[0].area_ha,70.97);
  assert.equal(events[2].before_data.completions[0].actual_amount,4613.05);assert.equal(events[2].after_data.completions[0].actual_amount,4600);
});
test('las fechas y pertenencia reales siguen bloqueadas; reenviar fechas iguales no cambia timestamps',async t=>{
  const x=await fixture(t),before=await x.graph(),protectedBefore=await x.snapshot();
  for(const body of [{start_at:'2025-12-03T00:00:00Z'},{end_at:'2025-12-06T00:00:00Z'},{effective_date:'2025-12-04'},
    {lot_selections:[]},{lot_selections:[{lot_id:'00000000-0000-4000-8000-000000000001',area_ha:'70.97'}]},
    {lot_selections:[{lot_id:x.lotId,sub_lot_id:'00000000-0000-4000-8000-000000000001',area_ha:'70.97'}]},
    {campaign_id:x.planning.campaign_id},{crop_id:x.planning.crop_id}]){
    await assert.rejects(mutate(x.pool,{...x.input,body}),e=>[400,409].includes(e.status));
    assert.equal(await x.graph(),before);assert.deepEqual(await x.snapshot(),protectedBefore);
  }
  await mutate(x.pool,{...x.input,body:{start_at:x.planning.start_at,end_at:x.planning.end_at,effective_date:x.planning.effective_date}});
  assert.equal(await x.graph(),before);assert.deepEqual(await x.snapshot(),protectedBefore);
});
for(const target of ['harvest_records','products'])test(`efecto secundario en ${target}: rollback también de cantidades y auditoría`,async t=>{
  const x=await fixture(t,true),before=await x.graph(),protectedBefore=await x.snapshot();
  const action=target==='products'?"UPDATE products SET available_quantity=available_quantity+1;":"UPDATE harvest_records SET notes='alterado';";
  await x.db.exec(`CREATE FUNCTION sabotage_area() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${action} RETURN NEW; END $$;
    CREATE TRIGGER sabotage_area AFTER UPDATE ON planning_lots FOR EACH ROW EXECUTE FUNCTION sabotage_area();`);
  await assert.rejects(mutate(x.pool,{...x.input,body:{lot_selections:[{lot_id:x.lotId,area_ha:'70.97'}]}}),e=>e.status===409);
  assert.equal(await x.graph(),before);assert.deepEqual(await x.snapshot(),protectedBefore);
  assert.equal((await x.db.query('SELECT count(*)::int n FROM historical_events')).rows[0].n,1);
});
test('se conservan permisos de baja/restauración y la corrección exige planning.edit',async t=>{
  const x=await fixture(t),protectedBefore=await x.snapshot();
  await x.db.query('UPDATE users SET custom_permissions=$2::text::jsonb WHERE id=$1',[x.actorId,JSON.stringify(['history.import','planning.disable','planning.enable'])]);
  await assert.rejects(mutate(x.pool,{...x.input,body:{title:'Cambio'}}),e=>e.status===403);
  await mutate(x.pool,{...x.input,enabled:false});
  await mutate(x.pool,{...x.input,enabled:true});
  assert.deepEqual(await x.snapshot(),protectedBefore);
});
