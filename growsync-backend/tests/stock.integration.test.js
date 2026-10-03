// Isolated PostgreSQL engine only; never loads .env or connects to Supabase.
// INVENTORY_TEST_PGLITE points to an installed @electric-sql/pglite package.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.INVENTORY_TEST_PGLITE || '@electric-sql/pglite');
const stock=require('../services/stock');
const usage=require('../services/stockUsage');
const planning=require('../services/planningCompletion');
const legacy=require('../services/stockLegacy');
let db;
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE companies(id uuid PRIMARY KEY);
    CREATE TABLE users(id uuid PRIMARY KEY,company_id uuid,enabled boolean DEFAULT true);
    CREATE TABLE products(id uuid PRIMARY KEY,company_id uuid,name text,unit text,enabled boolean DEFAULT true,
      available_quantity numeric,total_quantity numeric,expiration_date date,acquisition_date date);
    CREATE TABLE usage_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,product_id uuid,
      amount_used numeric,unit text,date date,total_area numeric,previous_crop text,current_crop text,user_id uuid,created_by uuid,crop_id uuid,
      source_planning_id uuid,source_planning_product_id uuid,enabled boolean DEFAULT true);
    CREATE TABLE lots(id uuid PRIMARY KEY,company_id uuid);
    CREATE TABLE usage_lots(usage_id uuid,lot_id uuid,sub_lot_id uuid);
    CREATE TABLE crop_assignments(company_id uuid,lot_id uuid,sub_lot_id uuid,crop_id uuid,start_date date,end_date date);
    CREATE TABLE planning_product_completions(planning_product_id uuid PRIMARY KEY,planning_id uuid,usage_id uuid,actual_amount numeric);`);
  await db.exec(require('./stockSchema.fixture'));
});
after(async()=>{await db.close();});
async function fixture(){
  const companyId=randomUUID(),actorId=randomUUID(),productId=randomUUID(),usageId=randomUUID(),lotId=randomUUID();
  await db.query('INSERT INTO companies VALUES($1)',[companyId]);
  await db.query('INSERT INTO users(id,company_id) VALUES($1,$2)',[actorId,companyId]);
  await db.query("INSERT INTO products(id,company_id,name,unit,available_quantity,total_quantity) VALUES($1,$2,'Test','kg',999,1000)",[productId,companyId]);
  await db.query('INSERT INTO usage_records(id,company_id,product_id,amount_used,unit) VALUES($1,$2,$3,1,\'kg\')',[usageId,companyId,productId]);
  await db.query('INSERT INTO lots VALUES($1,$2)',[lotId,companyId]);

  const queries=[];
  const client={query:(sql,args=[])=>{queries.push(sql);return db.query(sql,args);},release(){}};
  const pool={query:client.query,connect:async()=>client};
  const ctx={companyId,actorId,productId,usageId,unit:'kg'};
  const receive=(quantity,expiration_date=null,received_date='2020-01-01')=>stock.transaction(pool,c=>stock.receiveStock(c,{...ctx,usageId:undefined,quantity,expiration_date,received_date,origin:'purchase',key:randomUUID()}));
  const consume=(quantity,key=randomUUID(),extra={})=>stock.transaction(pool,c=>stock.consumeStock(c,{...ctx,quantity,key,...extra}));
  const total=async()=> (await db.query('SELECT sum(available_quantity)::text AS n FROM stock_batches WHERE product_id=$1',[productId])).rows[0].n;
  return {ctx,pool,queries,receive,consume,total,lotId};
}
test('fecha operativa: excluye ingresos posteriores y rechaza con 409 aunque alcance el saldo actual',async()=>{
  const x=await fixture();
  await db.query("UPDATE usage_records SET date='2026-09-22' WHERE id=$1",[x.ctx.usageId]);
  await x.receive(10,null,'2026-09-25');
  await assert.rejects(x.consume(1),e=>e.status===409 && /insuficiente/.test(e.message));
  const earlier=(await x.receive(2,null,'2026-09-20'))[0].batch_id;
  await assert.rejects(x.consume(3),e=>e.status===409);
  assert.equal(await x.total(),'12.000000');
  const movements=await x.consume(2);
  assert.deepEqual(movements.map(m=>m.batch_id),[earlier]);
  assert.equal(await x.total(),'10.000000');
});

test('vencimiento retrospectivo y FEFO se evalúan en D, inclusive fin de mes',async()=>{
  const x=await fixture();
  await db.query("UPDATE usage_records SET date='2026-09-22' WHERE id=$1",[x.ctx.usageId]);
  const monthly=(await x.receive(1,null,'2026-09-20'))[0].batch_id;
  await db.query('UPDATE stock_batches SET expiration_year=2026,expiration_month=9 WHERE id=$1',[monthly]);
  const first=(await x.receive(1,'2026-09-23','2026-09-20'))[0].batch_id;
  const exact=(await x.receive(1,'2026-09-30','2026-09-21'))[0].batch_id;
  await x.receive(10,'2026-09-20','2026-09-20');
  await x.receive(10,'2026-09-22','2026-09-25');
  const moves=await x.consume(3);
  assert.deepEqual(moves.map(m=>m.batch_id),[first,monthly,exact]);
  await assert.rejects(x.consume(1),e=>e.status===409);
});

test('partidas sin ingreso usan creación local como límite, sin inventar fechas de recepción',async()=>{
  const x=await fixture();
  await db.query("UPDATE usage_records SET date='2026-09-22' WHERE id=$1",[x.ctx.usageId]);
  const [batch]=await stock.transaction(x.pool,c=>stock.receiveStock(c,{...x.ctx,usageId:undefined,
    origin:'adjustment',quantity:2,key:randomUUID()}));
  await db.query("UPDATE stock_batches SET created_at='2026-09-23T03:00:00Z' WHERE id=$1",[batch.batch_id]);
  await assert.rejects(x.consume(1),e=>e.status===409);
  await db.query("UPDATE stock_batches SET created_at='2026-09-23T02:59:00Z' WHERE id=$1",[batch.batch_id]);
  await x.consume(1);
  assert.equal((await db.query('SELECT received_date FROM stock_batches WHERE id=$1',[batch.batch_id])).rows[0].received_date,null);
});

for(const flow of ['Usage','Planning'])test(`${flow} NORMAL usa fecha persistida y revierte todo si solo hay ingreso posterior`,async()=>{
  const x=await fixture();await x.receive(10,null,'2026-09-25');
  const run=()=>flow==='Usage'
    ? usage.createManualUsage(x.pool,{...x.ctx,key:randomUUID(),body:{product_id:x.ctx.productId,
      amount_used:1,unit:'kg',date:'2026-09-22',lot_ids:[x.lotId]}})
    : stock.transaction(x.pool,c=>planning.applyPlanningProductUsage(c,{...x.ctx,effectiveDate:'2026-09-22',
      planning:{id:randomUUID(),responsible_user:x.ctx.actorId},selections:[{lot_id:x.lotId,area_ha:1}],
      plannedProducts:[{id:randomUUID(),product_id:x.ctx.productId,amount:1,unit:'kg',product_unit:'kg'}],actualProducts:[]}));
  await assert.rejects(run(),e=>e.status===409);
  assert.equal((await db.query('SELECT count(*)::int n FROM usage_records WHERE product_id=$1',[x.ctx.productId])).rows[0].n,1);
  assert.equal(await x.total(),'10.000000');
  await x.receive(1,'2026-09-30','2026-09-20');
  await run();assert.equal(await x.total(),'10.000000');
});

test('una partida, saldo exacto y legacy no se sobrescribe',async()=>{
  const x=await fixture();await x.receive('2.1');const m=await x.consume('0.1');
  assert.equal(m.length,1);assert.equal(m[0].quantity,'-0.100000');assert.equal(await x.total(),'2.000000');
  assert.equal((await db.query('SELECT available_quantity::text FROM products WHERE id=$1',[x.ctx.productId])).rows[0].available_quantity,'999');
  assert(x.queries.some(q=>q.includes('FOR UPDATE')));
});
test('varias partidas: FEFO, desempate ingreso, NULL al final, vencidas y disabled fuera',async()=>{
  const x=await fixture();const noExpiry=(await x.receive(10))[0].batch_id;
  const expired=(await x.receive(20,'2020-01-01'))[0].batch_id;
  const late=(await x.receive(4,'2099-02-01'))[0].batch_id;
  const second=(await x.receive(2,'2099-01-01','2021-01-01'))[0].batch_id;
  const first=(await x.receive(3,'2099-01-01','2020-01-01'))[0].batch_id;
  const disabled=(await x.receive(100,'2098-01-01'))[0].batch_id;
  await db.query('UPDATE stock_batches SET enabled=false WHERE id=$1',[disabled]);
  const m=await x.consume(10);
  assert.deepEqual(m.map(v=>v.batch_id),[first,second,late,noExpiry]);
  assert.deepEqual(m.map(v=>v.quantity),['-3.000000','-2.000000','-4.000000','-1.000000']);
  assert.equal(new Set(m.map(v=>v.operation_id)).size,1);
  assert.equal((await db.query('SELECT available_quantity FROM stock_batches WHERE id=$1',[expired])).rows[0].available_quantity,'20.000000');
});
test('insuficiente revierte todo y no permite saldo negativo',async()=>{
  const x=await fixture();await x.receive(2);await assert.rejects(x.consume(3),/insuficiente/);
  assert.equal(await x.total(),'2.000000');
  assert.equal((await db.query("SELECT count(*)::int n FROM stock_movements WHERE product_id=$1 AND movement_type='consumption'",[x.ctx.productId])).rows[0].n,0);
  await assert.rejects(db.query('UPDATE stock_batches SET available_quantity=-1 WHERE product_id=$1',[x.ctx.productId]),/check constraint/);
});
test('idempotencia consumo y conflicto de payload',async()=>{
  const x=await fixture();await x.receive(5);const key=randomUUID();const first=await x.consume(2,key),retry=await x.consume(2,key);
  assert.equal(first[0].id,retry[0].id);assert.equal(await x.total(),'3.000000');
  await assert.rejects(x.consume(3,key),/otra operación/);
});
test('ingreso idempotente conserva una partida y rechaza cambio de fecha/precio',async()=>{
  const x=await fixture();const input={...x.ctx,usageId:undefined,key:randomUUID(),quantity:3,unit:'kg',origin:'purchase',received_date:'2026-01-01'};
  const a=await stock.transaction(x.pool,c=>stock.receiveStock(c,input));
  const b=await stock.transaction(x.pool,c=>stock.receiveStock(c,input));
  assert.equal(a[0].batch_id,b[0].batch_id);assert.equal(await x.total(),'3.000000');
  await assert.rejects(stock.transaction(x.pool,c=>stock.receiveStock(c,{...input,received_date:'2026-01-02'})),/otra operación/);
});
test('fallo en segundo movimiento revierte también el primer débito',async()=>{
  const x=await fixture();await x.receive(2);await x.receive(2);
  let inserts=0;const pool={connect:async()=>{const c=await x.pool.connect();return {release(){},query(sql,args){
    if(sql.includes('INSERT INTO stock_movements')&&++inserts===2)throw Error('fallo simulado');
    return c.query(sql,args);
  }};}};
  await assert.rejects(stock.transaction(pool,c=>stock.consumeStock(c,{...x.ctx,key:randomUUID(),quantity:3})),/fallo simulado/);
  assert.equal(await x.total(),'4.000000');
  assert.equal((await db.query("SELECT count(*)::int n FROM stock_movements WHERE product_id=$1 AND movement_type='consumption'",[x.ctx.productId])).rows[0].n,0);
});
test('reversión devuelve a originales aunque ahora estén bloqueadas; doble reversión impedida',async()=>{
  const x=await fixture();await x.receive(2,'2099-01-01');await x.receive(2);const consumed=await x.consume(3);
  await db.query('UPDATE stock_batches SET enabled=false WHERE product_id=$1',[x.ctx.productId]);
  const key=randomUUID(),request={...x.ctx,key,originalOperationId:consumed[0].operation_id};
  const reverse=()=>stock.transaction(x.pool,c=>stock.reverseStock(c,request));
  const reversed=await reverse();assert.equal(reversed.length,2);assert.equal(await x.total(),'4.000000');
  assert.deepEqual(new Set(reversed.map(m=>m.batch_id)),new Set(consumed.map(m=>m.batch_id)));
  assert.deepEqual(new Set(reversed.map(m=>m.reversed_movement_id)),new Set(consumed.map(m=>m.id)));
  assert.equal((await reverse())[0].operation_id,reversed[0].operation_id);
  await assert.rejects(stock.transaction(x.pool,c=>stock.reverseStock(c,{...request,key:randomUUID()})),/ya fue revertido/);
});
test('movimientos inmutables y FK de empresa/unidad protegidas',async()=>{
  const x=await fixture();const [receipt]=await x.receive(4);await x.consume(1);
  await assert.rejects(db.query('UPDATE stock_movements SET quantity=1 WHERE id=$1',[receipt.id]),/immutable/);
  await assert.rejects(db.query('DELETE FROM stock_movements WHERE id=$1',[receipt.id]),/immutable/);
  await assert.rejects(db.query('TRUNCATE stock_movements'),/immutable/);
  await assert.rejects(db.query("UPDATE stock_batches SET unit='litros' WHERE product_id=$1",[x.ctx.productId]),/foreign key/);
  await assert.rejects(x.consume(1,randomUUID(),{unit:'litros'}),/Unidad incompatible/);
  await assert.rejects(x.consume(1,randomUUID(),{companyId:randomUUID()}),/Usuario no disponible/);
  await assert.rejects(x.consume(1,randomUUID(),{actorId:randomUUID()}),/Usuario no disponible/);
});
test('reversión de operación ajena no es accesible',async()=>{
  const a=await fixture();await a.receive(4);const m=await a.consume(1);const b=await fixture();
  await assert.rejects(stock.transaction(b.pool,c=>stock.reverseStock(c,{...b.ctx,key:randomUUID(),originalOperationId:m[0].operation_id})),/no encontrado/);
  assert.equal(await a.total(),'3.000000');
});
test('manual Usage integra creación/lotes/descuento en la misma transacción e idempotencia',async()=>{
  const x=await fixture();await x.receive(4);const input={companyId:x.ctx.companyId,actorId:x.ctx.actorId,key:randomUUID(),body:{product_id:x.ctx.productId,amount_used:2,unit:'kg',date:'2026-01-01',lot_ids:[x.lotId]}};
  const a=await usage.createManualUsage(x.pool,input),b=await usage.createManualUsage(x.pool,input);
  assert.equal(a.id,b.id);assert.equal(await x.total(),'2.000000');
  assert.equal((await db.query('SELECT count(*)::int n FROM stock_movements WHERE usage_id=$1',[a.id])).rows[0].n,1);
  await usage.disableManualUsage(x.pool,{companyId:x.ctx.companyId,actorId:x.ctx.actorId,usageId:a.id});
  assert.equal(await x.total(),'4.000000');
  await usage.disableManualUsage(x.pool,{companyId:x.ctx.companyId,actorId:x.ctx.actorId,usageId:a.id});
  assert.equal(await x.total(),'4.000000');
});
test('fallo de Usage o lote de otra empresa revierte registro, lotes y movimientos',async()=>{
  const x=await fixture();await x.receive(1);
  const input={companyId:x.ctx.companyId,actorId:x.ctx.actorId,key:randomUUID(),body:{product_id:x.ctx.productId,amount_used:2,unit:'kg',date:'2026-01-01',lot_ids:[x.lotId]}};
  await assert.rejects(usage.createManualUsage(x.pool,input),/insuficiente/);
  assert.equal((await db.query('SELECT count(*)::int n FROM usage_records WHERE product_id=$1',[x.ctx.productId])).rows[0].n,1);
  await assert.rejects(usage.createManualUsage(x.pool,{...input,body:{...input.body,lot_ids:[randomUUID()]}}),/Lotes no disponibles/);
  assert.equal(await x.total(),'1.000000');
});
test('Planning invoca mismo FEFO, reparto y completion sin tocar saldo legacy',async()=>{
  const x=await fixture();await x.receive(2);await x.receive(3);
  const planningId=randomUUID(),lineId=randomUUID();
  await stock.transaction(x.pool,client=>planning.applyPlanningProductUsage(client,{
    companyId:x.ctx.companyId,actorId:x.ctx.actorId,effectiveDate:'2026-01-01',
    planning:{id:planningId,responsible_user:x.ctx.actorId},selections:[{lot_id:x.lotId,area_ha:1}],
    plannedProducts:[{id:lineId,product_id:x.ctx.productId,amount:4,unit:'kg',product_unit:'kg'}],actualProducts:[],
  }));
  assert.equal(await x.total(),'1.000000');
  const {rows}=await db.query('SELECT * FROM planning_product_completions WHERE planning_product_id=$1',[lineId]);
  assert.equal(rows.length,1);
  const {rows:movements}=await db.query('SELECT * FROM stock_movements WHERE usage_id=$1',[rows[0].usage_id]);
  assert.equal(movements.length,2);assert.equal(new Set(movements.map(m=>m.operation_id)).size,1);
});
test('Planning insuficiente revierte efectos previos de la transacción',async()=>{
  const x=await fixture();await x.receive(1);const id=randomUUID();
  await assert.rejects(stock.transaction(x.pool,async client=>{
    await client.query('INSERT INTO lots(id,company_id) VALUES($1,$2)',[id,x.ctx.companyId]);
    await planning.applyPlanningProductUsage(client,{companyId:x.ctx.companyId,actorId:x.ctx.actorId,
      effectiveDate:'2026-01-01',planning:{id:randomUUID(),responsible_user:x.ctx.actorId},selections:[],
      plannedProducts:[{id:randomUUID(),product_id:x.ctx.productId,amount:4,unit:'kg'}],actualProducts:[]});
  }),/stock.*suficiente/i);
  assert.equal((await db.query('SELECT id FROM lots WHERE id=$1',[id])).rows.length,0);
});
test('apertura excluye Finesse, disabled, revisión, sin aprobación y otra empresa',async()=>{
  const c=randomUUID(),p={id:randomUUID(),company_id:c,name:'Aprobado',enabled:true,unit:'kg',available_quantity:2,total_quantity:900};
  const rows=[p,{...p,id:randomUUID(),name:'FINESSE (150grs)'},{...p,id:randomUUID(),enabled:false},
    {...p,id:'589e5362-c45d-43a2-8f33-d12825843f9b'}, {...p,id:randomUUID(),company_id:randomUUID()}];
  assert.equal(legacy.proposeOpenings(rows,{companyId:c}).length,0);
  const result=legacy.proposeOpenings(rows,{companyId:c,approvedProductIds:rows.map(p=>p.id)});
  assert.equal(result.length,1);assert.equal(result[0].quantity,'2.000000');assert.equal(result[0].unit_price,null);
});
test('apertura explícita usa disponible aprobado, no total ni usos históricos',async()=>{
  const x=await fixture();
  const input={companyId:x.ctx.companyId,actorId:x.ctx.actorId,runId:randomUUID(),received_date:'2026-01-01',approved:[{productId:x.ctx.productId,quantity:999}]};
  await stock.transaction(x.pool,c=>legacy.openApprovedLegacy(c,input));
  assert.equal(await x.total(),'999.000000');
  const {rows}=await db.query('SELECT movement_type,quantity FROM stock_movements WHERE product_id=$1',[x.ctx.productId]);
  assert.deepEqual(rows,[{movement_type:'opening',quantity:'999.000000'}]);
  // A run/cutoff date must not become an invented physical receipt date.
  assert.equal((await db.query('SELECT received_date FROM stock_batches WHERE product_id=$1',[x.ctx.productId])).rows[0].received_date,null);
  await assert.rejects(stock.transaction(x.pool,c=>legacy.openApprovedLegacy(c,input)),/ya tiene partidas/);
});
test('purchase y return requieren fecha, legacy y adjustment permiten NULL u omisión',async()=>{
  const x=await fixture();
  for(const origin of ['purchase','return','legacy','adjustment']){
    for(const received_date of [undefined,null]){
      const input={...x.ctx,usageId:undefined,origin,approvedLegacy:true,quantity:1,key:randomUUID(),received_date};
      const run=()=>stock.transaction(x.pool,c=>stock.receiveStock(c,input));
      if(['purchase','return'].includes(origin))await assert.rejects(run(),/fecha de ingreso es obligatoria/);
      else{
        const [m]=await run();
        const {rows}=await db.query('SELECT received_date FROM stock_batches WHERE id=$1',[m.batch_id]);
        assert.equal(rows[0].received_date,null);
      }
    }
    const [m]=await stock.transaction(x.pool,c=>stock.receiveStock(c,{...x.ctx,usageId:undefined,origin,
      approvedLegacy:true,quantity:1,key:randomUUID(),received_date:'2020-02-29'}));
    assert.equal((await db.query('SELECT received_date::text FROM stock_batches WHERE id=$1',[m.batch_id])).rows[0].received_date,'2020-02-29');
  }
});
test('fechas suministradas siguen siendo válidas y no futuras para todos los orígenes',async()=>{
  const x=await fixture();
  for(const origin of ['purchase','return','legacy','adjustment'])for(const received_date of ['','2026-02-30','2999-01-01']){
    await assert.rejects(stock.transaction(x.pool,c=>stock.receiveStock(c,{...x.ctx,origin,approvedLegacy:true,
      quantity:1,key:randomUUID(),received_date})),/inválida|futura/);
  }
});
test('CHECK de DB impide NULL en compras/devoluciones y lo admite en legacy/ajustes',async()=>{
  const x=await fixture();
  for(const origin of ['purchase','return','legacy','adjustment']){
    const insert=()=>db.query(`INSERT INTO stock_batches(company_id,product_id,initial_quantity,available_quantity,unit,origin)
      VALUES($1,$2,1,1,'kg',$3) RETURNING received_date`,[x.ctx.companyId,x.ctx.productId,origin]);
    if(['purchase','return'].includes(origin))await assert.rejects(insert(),/stock_batches_received_date_required/);
    else assert.equal((await insert()).rows[0].received_date,null);
  }
});
test('FEFO prioriza vencimiento, desempata fecha conocida antes de NULL y finalmente id',async()=>{
  const x=await fixture();
  const add=async(expiration_date,received_date)=>{
    const [m]=await stock.transaction(x.pool,c=>stock.receiveStock(c,{...x.ctx,usageId:undefined,quantity:1,
      origin:'adjustment',key:randomUUID(),expiration_date,received_date}));return m.batch_id;
  };
  const first=await add('2099-01-01',null);
  const unknownA=await add('2099-02-01',null),unknownB=await add('2099-02-01',null);
  const known=await add('2099-02-01','2020-01-01');
  const noExpiryUnknown=await add(null,null),noExpiryKnown=await add(null,'2020-01-01');
  const result=await x.consume(6);
  assert.deepEqual(result.map(m=>m.batch_id),[first,known,...[unknownA,unknownB].sort(),noExpiryKnown,noExpiryUnknown]);
});
test('legacy conserva solo la fecha física verificada por producto y no exige fecha de corrida',async()=>{
  const x=await fixture();
  await stock.transaction(x.pool,c=>legacy.openApprovedLegacy(c,{companyId:x.ctx.companyId,actorId:x.ctx.actorId,
    runId:randomUUID(),approved:[{productId:x.ctx.productId,quantity:999,verifiedReceivedDate:'2020-01-01'}]}));
  assert.equal((await db.query('SELECT received_date::text FROM stock_batches WHERE product_id=$1',[x.ctx.productId])).rows[0].received_date,'2020-01-01');
  const y=await fixture();
  await stock.transaction(y.pool,c=>legacy.openApprovedLegacy(c,{companyId:y.ctx.companyId,actorId:y.ctx.actorId,
    runId:randomUUID(),approved:[{productId:y.ctx.productId,quantity:999}]}));
  assert.equal((await db.query('SELECT received_date FROM stock_batches WHERE product_id=$1',[y.ctx.productId])).rows[0].received_date,null);
});
test('idempotencia normaliza fecha omitida y NULL, pero detecta fecha distinta',async()=>{
  const x=await fixture();const input={...x.ctx,usageId:undefined,origin:'adjustment',quantity:1,key:randomUUID()};
  const [a]=await stock.transaction(x.pool,c=>stock.receiveStock(c,input));
  const [b]=await stock.transaction(x.pool,c=>stock.receiveStock(c,{...input,received_date:null}));
  assert.equal(a.id,b.id);
  await assert.rejects(stock.transaction(x.pool,c=>stock.receiveStock(c,{...input,received_date:'2020-01-01'})),/otra operación/);
});
test('V1 global ignora saldo legacy y sin partidas expone cero; lectura deriva partidas',async()=>{
  const x=await fixture();const p={id:x.ctx.productId,available_quantity:999,total_quantity:1000};

  assert.equal(stock.isEnabled(x.ctx.companyId),true);

  assert.equal((await stock.decorate(x.pool,x.ctx.companyId,[p]))[0].available_quantity,'0');
  await x.receive(3);await x.receive(4,'2020-01-01');
  const [current]=await stock.decorate(x.pool,x.ctx.companyId,[p]);
  assert.equal(current.available_quantity,'3.000000');assert.equal(current.on_hand_quantity,'7.000000');
  assert.equal(JSON.parse(JSON.stringify(current.next_expiration_date)).slice(0,10),'2020-01-01');
});
test('precisión, fechas inválidas y umbral unificado',()=>{
  assert.equal(stock.amount(stock.decimal('1.000001')),'1.000001');
  assert.throws(()=>stock.decimal('0.0000001'),/6 decimales/);
  assert.throws(()=>stock.decimal(NaN),/inválida/);
  assert.throws(()=>stock.calendarDate('2026-02-30'),/inválida/);
  assert.equal(stock.calendarDate('2027-06-01'),'2027-06-01');
  assert.equal(stock.isLowStock({available_quantity:0,minimum_stock:0}),true);
  assert.equal(stock.isLowStock({available_quantity:6,minimum_stock:8}),true);
  assert.equal(stock.isLowStock({available_quantity:6}),false);
});

test('ajustes positivos auditados, NULL, replay y conflictos',async()=>{
  const x=await fixture(),key=randomUUID(),body={...x.ctx,usageId:undefined,key,direction:'in',quantity:'2.000001',reason:'Stock encontrado',notes:'Conteo físico'};
  const run=b=>stock.transaction(x.pool,c=>stock.adjustStock(c,b));
  const a=await run(body),b=await run(body);
  assert.deepEqual(a,b);assert.equal(await x.total(),'2.000001');
  assert.equal(a[0].movement_type,'adjustment_in');assert.match(a[0].notes,/Motivo: Stock encontrado/);assert.match(a[0].notes,/Conteo físico/);
  assert.equal(a[0].created_by,x.ctx.actorId);assert.equal(a[0].usage_id,null);
  const batch=(await db.query('SELECT * FROM stock_batches WHERE id=$1',[a[0].batch_id])).rows[0];
  assert.equal(batch.origin,'adjustment');assert.equal(batch.received_date,null);assert.equal(batch.expiration_date,null);
  for(const change of [{quantity:3},{direction:'out'},{reason:'Otro motivo'},{notes:'Distinto'}])await assert.rejects(()=>run({...body,...change}),/idempotencia/);
  await assert.rejects(()=>db.query('UPDATE stock_movements SET notes=$1 WHERE id=$2',['edit',a[0].id]));
});
test('ajuste negativo FEFO incluye vencidas, reparte y excluye deshabilitadas',async()=>{
  const x=await fixture();
  const noDate=(await x.receive(8))[0].batch_id;
  const expired=(await x.receive(5,'2020-01-01'))[0].batch_id;
  const future=(await x.receive(20,'2099-01-01'))[0].batch_id;
  const disabled=(await x.receive(50,'2019-01-01'))[0].batch_id;
  await db.query('UPDATE stock_batches SET enabled=false WHERE id=$1',[disabled]);
  const body={...x.ctx,key:randomUUID(),direction:'out',quantity:12,reason:'Pérdida'};
  const run=()=>stock.transaction(x.pool,c=>stock.adjustStock(c,body));
  const m=await run();assert.deepEqual(m.map(v=>v.batch_id),[expired,future]);
  assert.deepEqual(m.map(v=>v.quantity),['-5.000000','-7.000000']);assert(m.every(v=>v.movement_type==='adjustment_out'));
  assert.equal(new Set(m.map(v=>v.operation_id)).size,1);assert.deepEqual(await run(),[...m].sort((a,b)=>a.id.localeCompare(b.id)));
  for(const [id,expected] of [[expired,'0.000000'],[future,'13.000000'],[noDate,'8.000000'],[disabled,'50.000000']])assert.equal((await db.query('SELECT available_quantity FROM stock_batches WHERE id=$1',[id])).rows[0].available_quantity,expected);
  await assert.rejects(()=>stock.transaction(x.pool,c=>stock.adjustStock(c,{...body,key:randomUUID(),quantity:22})),/stock suficiente/);
});
test('ajustes validan cantidad, motivo, clave y aislamiento con V1 global',async()=>{
  const x=await fixture();await x.receive(10);
  const body={...x.ctx,key:randomUUID(),direction:'out',quantity:1,reason:'Conteo'};
  const run=change=>stock.transaction(x.pool,c=>stock.adjustStock(c,{...body,...change}));
  for(const quantity of [0,-1,'0.0000001'])await assert.rejects(()=>run({quantity}));
  for(const reason of ['',null,'   '])await assert.rejects(()=>run({reason}));
  await assert.rejects(()=>run({key:''}),/Idempotency-Key/);
  await assert.rejects(()=>run({productId:randomUUID()}),/Producto no disponible/);
  await assert.rejects(()=>run({actorId:randomUUID()}),/Usuario no disponible/);
  const foreign=await fixture();
  await assert.rejects(()=>stock.transaction(foreign.pool,c=>stock.adjustStock(c,{...body,companyId:foreign.ctx.companyId,actorId:foreign.ctx.actorId})),/Producto no disponible/);

  assert.equal(stock.isEnabled(x.ctx.companyId),true);
  await run({});assert.equal(await x.total(),'9.000000');
});
test('V1 bloquea deshabilitar con stock y conserva partidas al deshabilitar saldo cero',async()=>{
  const x=await fixture();await x.receive(2,'2020-01-01');
  const disable=()=>stock.transaction(x.pool,c=>stock.disableStockProduct(c,x.ctx.companyId,x.ctx.productId));
  await assert.rejects(disable,/primero ajustá/);
  await stock.transaction(x.pool,c=>stock.adjustStock(c,{...x.ctx,key:randomUUID(),direction:'out',quantity:2,reason:'Rotura'}));
  await disable();
  assert.equal((await db.query('SELECT enabled FROM products WHERE id=$1',[x.ctx.productId])).rows[0].enabled,false);
  assert.equal((await db.query('SELECT count(*)::int n FROM stock_batches WHERE product_id=$1',[x.ctx.productId])).rows[0].n,1);
});
