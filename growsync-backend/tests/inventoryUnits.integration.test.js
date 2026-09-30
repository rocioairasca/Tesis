const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const {PGlite}=require(process.env.INVENTORY_TEST_PGLITE || '@electric-sql/pglite');
const stock=require('../services/stock');
const units=require('../services/inventoryUnits');
const history=require('../services/productUnitHistory');
const planning=require('../services/planningCompletion');
const usage=require('../services/stockUsage');
const schema=require('../validations/products.schema');
const migration=fs.readFileSync(require.resolve('../migrations/20260914_inventory_base_units.sql'),'utf8');
let db,client,pool;
before(async()=>{
 db=new PGlite();client={query:(text,params=[])=>db.query(text,params),release(){}};pool={...client,connect:async()=>client};
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE companies(id uuid PRIMARY KEY);
 CREATE TABLE users(id uuid PRIMARY KEY,company_id uuid,enabled boolean DEFAULT true);
 CREATE TABLE products(id uuid PRIMARY KEY,company_id uuid,name text,unit text,enabled boolean DEFAULT true,available_quantity numeric DEFAULT 0,total_quantity numeric DEFAULT 0,expiration_date date,acquisition_date date);
 CREATE TABLE planning_products(id uuid PRIMARY KEY,planning_id uuid,product_id uuid REFERENCES products(id),amount numeric,unit text);
 CREATE TABLE usage_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,product_id uuid REFERENCES products(id),amount_used numeric,unit text,date date,total_area numeric,previous_crop text,current_crop text,user_id uuid,created_by uuid,crop_id uuid,source_planning_id uuid,source_planning_product_id uuid,enabled boolean DEFAULT true);
 CREATE TABLE planning_product_completions(planning_product_id uuid PRIMARY KEY REFERENCES planning_products(id),planning_id uuid,usage_id uuid REFERENCES usage_records(id),actual_amount numeric(12,4));
 CREATE TABLE lots(id uuid PRIMARY KEY,company_id uuid);
 CREATE TABLE usage_lots(usage_id uuid,lot_id uuid,sub_lot_id uuid);
 CREATE TABLE crop_assignments(company_id uuid,lot_id uuid,sub_lot_id uuid,crop_id uuid,start_date date,end_date date);`);
 await db.exec(require('./stockSchema.fixture'));
 // Existing legacy data must survive unchanged, including immutable movements.
 const c=randomUUID(),p=randomUUID(),a=randomUUID();
 await db.query('INSERT INTO companies VALUES($1)',[c]);await db.query('INSERT INTO users VALUES($1,$2,true)',[a,c]);
 await db.query("INSERT INTO products(id,company_id,name,unit) VALUES($1,$2,'Legacy','litros')",[p,c]);
 await stock.transaction(pool,tx=>stock.receiveStock(tx,{companyId:c,productId:p,actorId:a,quantity:'0.125',unit:'litros',origin:'purchase',received_date:'2026-01-01',key:randomUUID()}));
 const snapshot=await db.query('SELECT * FROM stock_movements');
 await db.exec('BEGIN;'+migration+'COMMIT;');
 await db.exec('BEGIN;'+migration+'COMMIT;');
 assert.deepEqual((await db.query('SELECT * FROM stock_movements')).rows,snapshot.rows);
 assert.equal((await db.query('SELECT unit FROM products WHERE id=$1',[p])).rows[0].unit,'litros');
});
after(async()=>{await db.close();});
async function fixture(unit='g'){
 const companyId=randomUUID(),actorId=randomUUID(),productId=randomUUID(),lotId=randomUUID();
 await db.query('INSERT INTO companies VALUES($1)',[companyId]);await db.query('INSERT INTO users VALUES($1,$2,true)',[actorId,companyId]);
 await db.query("INSERT INTO products(id,company_id,name,unit) VALUES($1,$2,'Producto de prueba',$3)",[productId,companyId,unit]);
 await db.query('INSERT INTO lots VALUES($1,$2)',[lotId,companyId]);

 const ctx={companyId,actorId,productId,unit};
 return {...ctx,lotId,receive:(quantity,date='2099-01-01')=>stock.transaction(pool,c=>stock.receiveStock(c,{...ctx,quantity,expiration_date:date,origin:'purchase',received_date:'2026-01-01',key:randomUUID()})),balance:async()=> (await stock.balances(client,companyId,[productId])).get(productId).available_quantity};
}
for(const unit of units.codes)test(`producto e ingreso ${unit}`,async()=>{
 assert.equal(schema.createBody.parse({body:{name:'Prueba',category:'agroquimicos',unit}}).body.unit,unit);
 const x=await fixture(unit);const result=await x.receive('0.125');assert.equal(result[0].unit,unit);assert.equal(result[0].quantity,'0.125000');
 await assert.rejects(stock.transaction(pool,c=>stock.receiveStock(c,{...x,unit:['L','mL'].includes(unit)?'kg':'L',quantity:1,origin:'purchase',received_date:'2026-01-01',key:randomUUID()})),/unidad/i);
});
for(const [unit,total,take,expected] of [['g','130','20','110.000000'],['L','50','12.5','37.500000'],['kg','1','0.005','0.995000'],['bag','10','1.25','8.750000']])test(`FEFO, ajuste +/− y Usage ${unit}`,async()=>{
 const x=await fixture(unit);await x.receive(total);
 const result=await usage.createManualUsage(pool,{companyId:x.companyId,actorId:x.actorId,key:randomUUID(),body:{product_id:x.productId,unit,amount_used:take,date:'2026-01-01',lot_ids:[x.lotId]}});
 assert(result.id);assert.equal(await x.balance(),expected);
 await stock.transaction(pool,c=>stock.adjustStock(c,{...x,quantity:'0.125',direction:'in',reason:'Prueba',key:randomUUID()}));
 await stock.transaction(pool,c=>stock.adjustStock(c,{...x,quantity:'0.125',direction:'out',reason:'Prueba',key:randomUUID()}));
 assert.equal(await x.balance(),expected);
});
test('cambio sin historial permitido; historial deshabilitado bloqueado; unidad equivalente conserva literal',async()=>{
 const x=await fixture();let product=(await db.query('SELECT * FROM products WHERE id=$1',[x.productId])).rows[0];
 assert.equal(await history.resolveUnitChange(client,x.companyId,product,'mL'),'mL');
 await db.query("UPDATE products SET unit='mL' WHERE id=$1",[x.productId]);
 await db.query("INSERT INTO usage_records(company_id,product_id,unit,enabled) VALUES($1,$2,'mL',false)",[x.companyId,x.productId]);
 product=(await db.query('SELECT * FROM products WHERE id=$1',[x.productId])).rows[0];
 await assert.rejects(history.resolveUnitChange(client,x.companyId,product,'L'),/registros asociados/);
 await assert.rejects(db.query("UPDATE products SET unit='L' WHERE id=$1",[x.productId]),/registros asociados/);
 const legacy=(await db.query("SELECT * FROM products WHERE unit='litros'")).rows[0];
 assert.equal(await history.resolveUnitChange(client,legacy.company_id,legacy,'L'),'litros');
});
test('Planning hereda unidad y completion conserva seis decimales en Usage y movimientos',async()=>{
 const x=await fixture('g');await x.receive('130');const line=randomUUID(),planningId=randomUUID();
 await db.query('INSERT INTO planning_products(id,planning_id,product_id,amount) VALUES($1,$2,$3,40)',[line,planningId,x.productId]);
 assert.equal((await db.query('SELECT unit FROM planning_products WHERE id=$1',[line])).rows[0].unit,'g');
 await assert.rejects(db.query("UPDATE products SET unit='kg' WHERE id=$1",[x.productId]),/registros asociados/);
 await stock.transaction(pool,c=>planning.applyPlanningProductUsage(c,{companyId:x.companyId,actorId:x.actorId,effectiveDate:'2026-01-01',planning:{id:planningId,responsible_user:x.actorId},selections:[{lot_id:x.lotId,area_ha:1}],plannedProducts:[{id:line,product_id:x.productId,amount:40,unit:'g'}],actualProducts:[{planning_product_id:line,actual_amount:'35.000001'}]}));
 const record=(await db.query('SELECT * FROM planning_product_completions WHERE planning_product_id=$1',[line])).rows[0];
 assert.equal(record.actual_amount,'35.000001');
 const movement=(await db.query('SELECT unit,quantity FROM stock_movements WHERE usage_id=$1',[record.usage_id])).rows[0];
 assert.deepEqual(movement,{unit:'g',quantity:'-35.000001'});
 await assert.rejects(db.query("INSERT INTO planning_products(id,product_id,unit) VALUES($1,$2,'kg')",[randomUUID(),x.productId]),/unidad/);
});
test('catálogo normaliza etiquetas legacy sin convertir magnitud',()=>{
 assert.equal(units.normalizeUnit('litros'),'L');assert.equal(units.normalizeUnit('bolsas'),'bag');assert(!units.sameUnit('L','mL'));assert(!units.sameUnit('kg','g'));
 assert(!schema.createBody.safeParse({body:{name:'Prueba',category:'semillas',unit:'bidon'}}).success);
 assert.equal(stock.amount(stock.decimal('0.125')),'0.125000');
});

for(const unit of ['g','L','bag'])test(`FEFO prioriza vencimiento entre partidas ${unit}`,async()=>{
 const x=await fixture(unit);
 const later=await x.receive('10','2099-12-01');
 const earlier=await x.receive('1.25','2099-01-01');
 await stock.transaction(pool,c=>stock.adjustStock(c,{...x,quantity:'1.5',direction:'out',reason:'Prueba FEFO',key:randomUUID()}));
 const remaining=(await db.query('SELECT id,available_quantity FROM stock_batches WHERE product_id=$1',[x.productId])).rows;
 assert.equal(remaining.find(r=>r.id===earlier[0].batch_id).available_quantity,'0.000000');
 assert.equal(remaining.find(r=>r.id===later[0].batch_id).available_quantity,'9.750000');
});

test('migración rechaza checks desconocidos y revierte sin tocar datos',async()=>{
 await db.exec('BEGIN');
 try {
  await db.exec("ALTER TABLE stock_batches DROP CONSTRAINT stock_batches_unit_check; ALTER TABLE stock_batches ADD CONSTRAINT stock_batches_unit_check CHECK (unit IN ('L','mL','kg','g','unit','bag','litros','bolsas') AND unit <> 'otro')");
  await assert.rejects(db.exec(migration),/Unexpected unit constraint/);
 } finally {await db.exec('ROLLBACK');}
 await db.exec('BEGIN;'+migration+'COMMIT;');
});

const conversion=require('../services/inventoryConversion');
const usageSchema=require('../validations/usage.schema');
const planningSchema=require('../validations/planning.schema');
// Exercise the actual controller's product validation under an isolated SQL client.
// Supabase and notifications are replaced before loading, so no .env or network is used.
function planningProductValidator(){
 const file=require.resolve('../controllers/planning');
 const realRequire=require('node:module').createRequire(file),mod={exports:{}};
 require('node:vm').runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports.validateProducts=assertProductTenancy;',{
  module:mod,exports:mod.exports,console,require:id=>id.includes('supabaseClient')?{pool}:id==='./notifications'?{createNotification:async()=>{}}:realRequire(id)
 });
 return mod.exports.validateProducts;
}

test('conversión exacta mL/cc/L y g/kg; aliases históricos; familias incompatibles',()=>{
 for(const [quantity,inputUnit,productUnit,expected] of [
  ['250','mL','L','0.250000'],['250','cc','L','0.250000'],['250','cc','mL','250.000000'],
  ['15','g','kg','0.015000'],['0.25','L','mL','250.000000'],['0.015','kg','g','15.000000'],
  ['250','cc','litros','0.250000'],['1','litros','L','1.000000'],['2','bolsas','bag','2.000000']
 ])assert.equal(conversion.normalizeQuantity({quantity,inputUnit,productUnit}).normalized_quantity,expected);
 for(const [inputUnit,productUnit] of [['L','kg'],['kg','L']])assert.throws(()=>conversion.normalizeQuantity({quantity:'1',inputUnit,productUnit}),/compatible/);
 assert.equal(units.inputUnitSchema.parse('cc'),'mL');
 assert(!schema.createBody.safeParse({body:{name:'Prueba',category:'agroquimicos',unit:'cc'}}).success);
});

test('precisión: no redondear antes/después de convertir ni perder dígitos en validación',()=>{
 assert.equal(conversion.normalizeQuantity({quantity:'0.001',inputUnit:'cc',productUnit:'L'}).normalized_quantity,'0.000001');
 assert.throws(()=>conversion.normalizeQuantity({quantity:'0.000001',inputUnit:'mL',productUnit:'L'}),/seis decimales/);
 assert.throws(()=>conversion.normalizeQuantity({quantity:'0.0000001',inputUnit:'L',productUnit:'L'}),/seis decimales/);
 const input=require('../services/inventoryQuantity').inputQuantitySchema;
 assert.equal(input.parse('99999999999999.123456'),'99999999999999.123456');
 assert.equal(input.parse('0,001'),'0.001');
 assert.equal(input.safeParse('bad').success,false);
 assert.equal(input.safeParse('0').success,false);
 assert.throws(()=>conversion.normalizeQuantity({quantity:'99999999999999',inputUnit:'L',productUnit:'mL'}),/máximo/);
});

for(const [base,unit,amount,expected] of [['L','mL','250','0.250000'],['L','cc','250','0.250000'],['kg','g','15','0.015000']]){
 test(`Usage ${amount} ${unit}: normaliza, consume y reintenta sin duplicar`,async()=>{
  const x=await fixture(base);await x.receive('1');
  const body=usageSchema.createBody.parse({body:{product_id:x.productId,amount_used:amount,unit,date:'2026-01-01',lot_ids:[x.lotId]}}).body;
  const args={companyId:x.companyId,actorId:x.actorId,key:randomUUID(),body};
  const result=await usage.createManualUsage(pool,args);
  assert.equal((await usage.createManualUsage(pool,args)).replayed,true);
  const record=(await db.query('SELECT amount_used,unit FROM usage_records WHERE id=$1',[result.id])).rows[0];
  assert.equal(stock.amount(stock.decimal(record.amount_used)),expected);assert.equal(record.unit,base);
  const moves=(await db.query('SELECT quantity,unit FROM stock_movements WHERE usage_id=$1',[result.id])).rows;
  assert.deepEqual(moves,[{quantity:'-'+expected,unit:base}]);
  assert.equal(await x.balance(),stock.amount(stock.decimal('1')-stock.decimal(expected)));
  assert.equal((await db.query('SELECT unit FROM stock_batches WHERE product_id=$1',[x.productId])).rows[0].unit,base);
 });
}

test('Usage rechaza stock insuficiente normalizado, familia incompatible y pérdida de precisión sin escrituras parciales',async()=>{
 const x=await fixture('L');await x.receive('0.2');
 for(const [amount_used,unit,error] of [['250','cc',/insuficiente/],['15','g',/compatible/],['0.000001','mL',/seis decimales/]]){
  await assert.rejects(usage.createManualUsage(pool,{companyId:x.companyId,actorId:x.actorId,key:randomUUID(),body:{product_id:x.productId,amount_used,unit,date:'2026-01-01',lot_ids:[x.lotId]}}),error);
 }
 assert.equal(await x.balance(),'0.200000');
 assert.equal((await db.query('SELECT * FROM usage_records WHERE product_id=$1',[x.productId])).rows.length,0);
});

async function planningLine(x,amount,unit){
 const planId=randomUUID(),lineId=randomUUID();
 const items=planningSchema.updateSchema.parse({params:{id:planId},body:{products:[{product_id:x.productId,amount,unit}]}}).body.products;
 await stock.transaction(pool,async c=>{
  await planningProductValidator()(c,items,x.companyId);
  await c.query('INSERT INTO planning_products(id,planning_id,product_id,amount,unit) VALUES($1,$2,$3,$4,$5)',[lineId,planId,x.productId,items[0].amount,items[0].unit]);
 });
 return (await db.query('SELECT * FROM planning_products WHERE id=$1',[lineId])).rows[0];
}
const completeLine=(x,line,actualProducts)=>stock.transaction(pool,c=>planning.applyPlanningProductUsage(c,{
 companyId:x.companyId,actorId:x.actorId,effectiveDate:'2026-01-01',planning:{id:line.planning_id,responsible_user:x.actorId},
 selections:[{lot_id:x.lotId,area_ha:1}],plannedProducts:[line],actualProducts
}));

for(const [base,unit,amount,expected] of [['L','mL','250','0.250000'],['L','cc','250','0.250000'],['kg','g','15','0.015000']]){
 test(`Planning ${amount} ${unit}: persiste en ${base} y completa sin doble conversión`,async()=>{
  const x=await fixture(base);await x.receive('1');
  const line=await planningLine(x,amount,unit);
  assert.equal(line.unit,base);assert.equal(stock.amount(stock.decimal(line.amount)),expected);
  await completeLine(x,line,[]);
  const completion=(await db.query('SELECT * FROM planning_product_completions WHERE planning_product_id=$1',[line.id])).rows[0];
  assert.equal(completion.actual_amount,expected);
  assert.deepEqual((await db.query('SELECT quantity,unit FROM stock_movements WHERE usage_id=$1',[completion.usage_id])).rows,[{quantity:'-'+expected,unit:base}]);
 });
}

test('Planning completion acepta unidad real alternativa; omitir unidad sigue usando la planificada',async()=>{
 const x=await fixture('L');await x.receive('1');
 const line=await planningLine(x,'0.5','L');
 const body=planningSchema.completeWorkSchema.parse({params:{id:line.planning_id},body:{effective_date:'2026-01-01',actual_products:[{planning_product_id:line.id,actual_amount:'250',unit:'cc'}]}}).body;
 await completeLine(x,line,body.actual_products);
 assert.equal((await db.query('SELECT actual_amount FROM planning_product_completions WHERE planning_product_id=$1',[line.id])).rows[0].actual_amount,'0.250000');
 assert.equal(await x.balance(),'0.750000');
 const next=await planningLine(x,'0.5','L');
 await completeLine(x,next,[{planning_product_id:next.id,actual_amount:'0.001001'}]);
 assert.equal(await x.balance(),'0.748999');
});

test('Planning valida familia y stock después de normalizar; rollback y precisión al completar',async()=>{
 const x=await fixture('L');await x.receive('0.2');
 await assert.rejects(planningLine(x,'15','g'),/compatible/);
 const line=await planningLine(x,'250','cc');
 await assert.rejects(completeLine(x,line,[]),/stock suficiente/);
 await assert.rejects(completeLine(x,line,[{planning_product_id:line.id,actual_amount:'250',unit:'mL'}]),/stock suficiente/);
 await assert.rejects(completeLine(x,line,[{planning_product_id:line.id,actual_amount:'1',unit:'kg'}]),/compatible/);
 await assert.rejects(completeLine(x,line,[{planning_product_id:line.id,actual_amount:'0.000001',unit:'cc'}]),/seis decimales/);
 assert.equal(await x.balance(),'0.200000');
 assert.equal((await db.query('SELECT * FROM planning_product_completions WHERE planning_product_id=$1',[line.id])).rows.length,0);
 assert.equal((await db.query('SELECT * FROM usage_records WHERE product_id=$1',[x.productId])).rows.length,0);
 await completeLine(x,line,[{planning_product_id:line.id,actual_amount:'0.001',unit:'cc'}]);
 assert.equal(await x.balance(),'0.199999');
});

test('ingresos cc: precio siempre por unidad base y denominación explícita si hay conversión',async()=>{
 const x=await fixture('L');
 const receipt={...x,quantity:'250',unit:'cc',origin:'purchase',received_date:'2026-01-01',unit_price:'100',currency:'ARS',key:randomUUID()};
 await assert.rejects(stock.transaction(pool,c=>stock.receiveStock(c,receipt)),/unit_price_unit/);
 await assert.rejects(stock.transaction(pool,c=>stock.receiveStock(c,{...receipt,unit_price_unit:'mL'})),/unidad base/);
 const result=await stock.transaction(pool,c=>stock.receiveStock(c,{...receipt,unit_price_unit:'L'}));
 const batch=(await db.query('SELECT initial_quantity,unit,unit_price FROM stock_batches WHERE id=$1',[result[0].batch_id])).rows[0];
 assert.deepEqual(batch,{initial_quantity:'0.250000',unit:'L',unit_price:'100.000000'});
});

