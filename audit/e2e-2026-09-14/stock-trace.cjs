// Synthetic PostgreSQL schema in RAM, no migration files or external connection.
const {PGlite}=require('../../grow-sync/node_modules/.cache/phase31-pglite/dist/index.cjs');
const {randomUUID}=require('node:crypto'),fs=require('node:fs');
const stock=require('../../growsync-backend/services/stock');
const planning=require('../../growsync-backend/services/planningCompletion');
const usage=require('../../growsync-backend/services/stockUsage');
const schema=require('../../growsync-backend/tests/stockSchema.fixture');
const assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 const client={query:(q,p=[])=>db.query(q,p),release(){}},pool={...client,connect:async()=>client};
 const results=[];
 try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE companies(id uuid PRIMARY KEY);
 CREATE TABLE users(id uuid PRIMARY KEY,company_id uuid,enabled boolean DEFAULT true);
 CREATE TABLE products(id uuid PRIMARY KEY,company_id uuid,name text,unit text,enabled boolean DEFAULT true,available_quantity numeric DEFAULT 0,total_quantity numeric DEFAULT 0,expiration_date date,acquisition_date date);
 CREATE TABLE lots(id uuid PRIMARY KEY,company_id uuid,enabled boolean DEFAULT true);
 CREATE TABLE usage_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,product_id uuid,amount_used numeric,unit text,date date,total_area numeric,previous_crop text,current_crop text,user_id uuid,created_by uuid,crop_id uuid,source_planning_id uuid,source_planning_product_id uuid,enabled boolean DEFAULT true);
 CREATE TABLE usage_lots(usage_id uuid,lot_id uuid,sub_lot_id uuid);
 CREATE TABLE crop_assignments(company_id uuid,lot_id uuid,sub_lot_id uuid,crop_id uuid,start_date date,end_date date);
 CREATE TABLE planning_product_completions(planning_product_id uuid PRIMARY KEY,planning_id uuid,usage_id uuid,actual_amount numeric(20,6));`);
 // Fixture represents target units. It is NOT the installed company's schema.
 await db.exec(schema.replaceAll("'kg','litros'","'L','mL','kg','g','unit','bag','litros'"));
 for(const [unit,opening,actual] of [['L','38','8.5'],['mL','100','0.125'],['kg','1','0.005'],['g','130','35'],['unit','10','1'],['bag','10','1.25']]){
  const companyId=randomUUID(),actorId=randomUUID(),productId=randomUUID(),lotId=randomUUID(),subLotId=randomUUID(),planningId=randomUUID(),lineId=randomUUID();
  process.env.INVENTORY_V1_COMPANY_IDS=companyId;
  await db.query('INSERT INTO companies VALUES($1)',[companyId]);await db.query('INSERT INTO users VALUES($1,$2,true)',[actorId,companyId]);
  await db.query("INSERT INTO products(id,company_id,name,unit) VALUES($1,$2,'QA aislado',$3)",[productId,companyId,unit]);
  await db.query('INSERT INTO lots VALUES($1,$2,true)',[lotId,companyId]);
  const x={companyId,actorId,productId,unit};
  await stock.transaction(pool,c=>stock.receiveStock(c,{...x,quantity:opening,origin:'purchase',received_date:'2026-09-01',expiration_date:'2099-01-01',key:randomUUID()}));
  const response=await stock.transaction(pool,c=>planning.applyPlanningProductUsage(c,{companyId,actorId,planning:{id:planningId,responsible_user:actorId},selections:[{lot_id:lotId,sub_lot_id:subLotId,area_ha:10}],plannedProducts:[{id:lineId,product_id:productId,amount:10,unit}],actualProducts:[{planning_product_id:lineId,actual_amount:actual}],effectiveDate:'2026-09-14'}));
  const {rows}=await db.query(`SELECT pc.actual_amount,u.unit,u.source_planning_id,ul.lot_id,ul.sub_lot_id,m.quantity,m.usage_id FROM planning_product_completions pc JOIN usage_records u ON u.id=pc.usage_id JOIN usage_lots ul ON ul.usage_id=u.id JOIN stock_movements m ON m.usage_id=u.id WHERE pc.planning_product_id=$1`,[lineId]);
  assert.equal(rows.length,1);assert.equal(rows[0].unit,unit);assert.equal(rows[0].source_planning_id,planningId);assert.equal(rows[0].sub_lot_id,subLotId);
  assert.equal(rows[0].quantity,stock.amount(-stock.decimal(actual)));
  const balance=(await stock.balances(client,companyId,[productId])).get(productId).available_quantity;
  assert.equal(balance,stock.amount(stock.decimal(opening)-stock.decimal(actual)));
  results.push({case:'PRODUCT_RECEIPT_COMPLETION_USAGE_MOVEMENT',unit,opening,actual,balance,linkedRows:rows.length,response});
  if(unit==='L'){
   await db.query('UPDATE lots SET enabled=false WHERE id=$1',[lotId]);
   const result=await usage.createManualUsage(pool,{companyId,actorId,key:randomUUID(),body:{product_id:productId,amount_used:'0.125',unit,date:'2026-09-14',lot_ids:[lotId]}});
   results.push({case:'V1_DISABLED_LOT_ACCEPTED',result});
  }
 }
 fs.writeFileSync(require('node:path').join(__dirname,'stock-trace-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 } finally {delete process.env.INVENTORY_V1_COMPANY_IDS;await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
