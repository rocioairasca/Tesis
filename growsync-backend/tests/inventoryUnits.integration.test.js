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
after(async()=>{delete process.env.INVENTORY_V1_COMPANY_IDS;await db.close();});
async function fixture(unit='g'){
 const companyId=randomUUID(),actorId=randomUUID(),productId=randomUUID(),lotId=randomUUID();
 await db.query('INSERT INTO companies VALUES($1)',[companyId]);await db.query('INSERT INTO users VALUES($1,$2,true)',[actorId,companyId]);
 await db.query("INSERT INTO products(id,company_id,name,unit) VALUES($1,$2,'Producto de prueba',$3)",[productId,companyId,unit]);
 await db.query('INSERT INTO lots VALUES($1,$2)',[lotId,companyId]);
 process.env.INVENTORY_V1_COMPANY_IDS=companyId;
 const ctx={companyId,actorId,productId,unit};
 return {...ctx,lotId,receive:(quantity,date='2099-01-01')=>stock.transaction(pool,c=>stock.receiveStock(c,{...ctx,quantity,expiration_date:date,origin:'purchase',received_date:'2026-01-01',key:randomUUID()})),balance:async()=> (await stock.balances(client,companyId,[productId])).get(productId).available_quantity};
}
for(const unit of units.codes)test(`producto e ingreso ${unit}`,async()=>{
 assert.equal(schema.createBody.parse({body:{name:'Prueba',category:'agroquimicos',unit}}).body.unit,unit);
 const x=await fixture(unit);const result=await x.receive('0.125');assert.equal(result[0].unit,unit);assert.equal(result[0].quantity,'0.125000');
 await assert.rejects(stock.transaction(pool,c=>stock.receiveStock(c,{...x,unit:unit==='L'?'mL':'L',quantity:1,origin:'purchase',received_date:'2026-01-01',key:randomUUID()})),/unidad/i);
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

