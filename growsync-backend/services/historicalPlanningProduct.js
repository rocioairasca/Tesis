const stock = require('./stock');
const {getEffectivePermissions} = require('../constants/permissions');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function inventorySnapshot(client,companyId){
  // JSON is produced in PostgreSQL so numeric and timestamp precision is retained.
  const {rows}=await client.query(`SELECT jsonb_build_object(
    'products',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM products x WHERE company_id=$1),
    'batches',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM stock_batches x WHERE company_id=$1),
    'movements',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM stock_movements x WHERE company_id=$1),
    'notifications',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM notifications x WHERE company_id=$1),
    'balances',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY product_id),'[]') FROM (
      SELECT product_id,sum(initial_quantity) total,sum(available_quantity) available
      FROM stock_batches WHERE company_id=$1 AND enabled GROUP BY product_id) x))::text AS snapshot`,[companyId]);
  return rows[0].snapshot;
}
async function addProduct(pool,{companyId,actorId,planningId,body={}}){
  if(!body || typeof body!=='object' || Array.isArray(body))throw stock.fail('Revisá el producto y la cantidad.',400);
  if(!UUID.test(planningId||'') || !UUID.test(body.product_id||'') || Object.keys(body).some(k=>!['product_id','amount'].includes(k)))
    throw stock.fail('Seleccioná una planificación y un producto válidos.',400);
  const quantity=stock.decimal(body.amount);
  if(quantity<=0n)throw stock.fail('Ingresá una cantidad positiva.',400);
  return stock.transaction(pool,async client=>{
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    // Serialize additions and inventory snapshots, including phantom inserts and trigger effects.
    await client.query(`LOCK TABLE companies,users,planning,planning_products,planning_product_completions,
      products,stock_batches,stock_movements,notifications IN SHARE ROW EXCLUSIVE MODE`);
    await authorizePlanning(client,{companyId,actorId,planningId});
    const product=(await client.query('SELECT id,name,unit FROM products WHERE id=$1 AND company_id=$2',[body.product_id,companyId])).rows[0];
    if(!product)throw stock.fail('El producto no está disponible en esta empresa.',404);
    const existing=(await client.query(`SELECT pp.*,pc.actual_amount FROM planning_products pp
      LEFT JOIN planning_product_completions pc ON pc.planning_product_id=pp.id
      WHERE pp.planning_id=$1 AND pp.product_id=$2`,[planningId,product.id])).rows;
    if(existing.length){
      if(existing.length!==1 || existing[0].amount==null || stock.decimal(existing[0].amount)!==quantity || existing[0].actual_amount==null || stock.decimal(existing[0].actual_amount)!==quantity)
        throw stock.fail('El producto ya está registrado. Corregí sus cantidades desde Productos registrados.',409);
      return {replayed:true,product:{...existing[0],planning_product_id:existing[0].id,name:product.name}};
    }
    const beforeStock=await inventorySnapshot(client,companyId);
    const graph=async()=> (await client.query(`SELECT jsonb_build_object(
      'planning',(SELECT to_jsonb(p) FROM planning p WHERE id=$1),
      'products',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM planning_products p WHERE planning_id=$1),
      'completions',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY planning_product_id),'[]') FROM planning_product_completions p WHERE planning_id=$1))::text AS value`,[planningId])).rows[0].value;
    const before=await graph();
    const pp=(await client.query(`INSERT INTO planning_products(planning_id,product_id,amount,unit)
      VALUES($1,$2,$3,$4) RETURNING *`,[planningId,product.id,stock.amount(quantity),product.unit])).rows[0];
    await client.query(`INSERT INTO planning_product_completions(planning_id,planning_product_id,actual_amount)
      VALUES($1,$2,$3)`,[planningId,pp.id,stock.amount(quantity)]);
    const after=await graph();
    await client.query(`INSERT INTO historical_events(company_id,actor_id,entity_table,entity_id,before_data,after_data)
      VALUES($1,$2,'planning',$3,$4::text::jsonb,$5::text::jsonb || $6::text::jsonb)`,[companyId,actorId,planningId,before,after,JSON.stringify({
        operation:'add_historical_product',planning_id:planningId,product_id:product.id,amount:stock.amount(quantity),unit:product.unit})]);
    if(await inventorySnapshot(client,companyId)!==beforeStock)
      throw stock.fail('No se agregó el producto porque se detectó un cambio en el inventario. Necesita una revisión.',409);
    return {replayed:false,product:{...pp,planning_product_id:pp.id,name:product.name,actual_amount:stock.amount(quantity),usage_id:null}};
  }).catch(error=>{
    if(['55P03','40P01','57014'].includes(error.code))throw stock.fail('Hay operaciones en curso. Intentá agregar el producto nuevamente en unos momentos.',409);
    throw error;
  });
}
async function authorizePlanning(client,{companyId,actorId,planningId}) {
  if(!UUID.test(planningId||''))throw stock.fail('Seleccioná una planificación válida.',400);
    const actor=(await client.query('SELECT * FROM users WHERE id=$1 AND company_id=$2 AND enabled=true',[actorId,companyId])).rows[0];
    const permissions=actor?getEffectivePermissions(actor):[];
    if(!actor || (!permissions.includes('all') && !['planning.edit','history.import'].every(p=>permissions.includes(p))))
      throw stock.fail('No tenés permiso para corregir antecedentes históricos.',403);
    const planning=(await client.query('SELECT * FROM planning WHERE id=$1 AND company_id=$2',[planningId,companyId])).rows[0];
    if(!planning)throw stock.fail('No encontramos la planificación.',404);
    if(planning.inventory_impact_mode!=='HISTORICAL_NO_STOCK')throw stock.fail('Solo podés agregar productos a un registro histórico.',409);
}
async function listProducts(pool,input) {
  return stock.transaction(pool,async client=>{
    await authorizePlanning(client,input);
    return (await client.query('SELECT id,name,unit FROM products WHERE company_id=$1 ORDER BY name,id',[input.companyId])).rows;
  });
}
module.exports={addProduct,listProducts,inventorySnapshot};