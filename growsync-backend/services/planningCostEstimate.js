const {z}=require('zod');
const stock=require('./stock');
const {localToday}=require('./harvestRegistration');
const {normalizeQuantity}=require('./inventoryConversion');
const {sameUnit}=require('./inventoryUnits');
const {eligibleBatchSql,fefoOrderSql}=require('./stockFefo');
const money=require('../../shared/costEstimate.cjs');
const {getEffectivePermissions}=require('../constants/permissions');
const allowedStates=new Set(['pendiente','planificado','en_progreso']);
function authorize(user) {
  const permissions=getEffectivePermissions(user);
  if(!user || user.enabled===false || !['planning.view','inventory.view'].every(p=>permissions.includes(p)||permissions.includes('all')))
    throw stock.fail('Se requieren permisos para ver Planificaciones e Inventario.',403);
  try { z.string().uuid().parse(user.company_id);z.string().uuid().parse(user.id); }
  catch { throw stock.fail('Sesión inválida.',403); }
}
function estimateProduct(product,batches) {
  let required;
  try {
    if(product.amount==null || !product.base_unit) throw new Error('Cantidad o producto no disponible.');
    required=stock.decimal(normalizeQuantity({quantity:product.amount,inputUnit:product.unit??product.base_unit,
      productUnit:product.base_unit,allowZero:true}).normalized_quantity);
  } catch {
    return {planning_product_id:product.id,product_id:product.product_id,name:product.name||'Producto no disponible',
      unit:product.base_unit||product.unit,required_quantity:null,known_quantity:'0.000000',pending_cost_quantity:'0.000000',
      uncovered_quantity:null,known_cost_usd:'0.000000',status:'unavailable',issue:'Cantidad o unidad prevista no válida.',simulated_batches:[]};
  }
  let remaining=required,known=0n,pending=0n,total=0n;
  const allocations=[];
  for(const batch of product.product_enabled?batches:[]) {
    if(!remaining) break;
    if(!sameUnit(batch.unit,product.base_unit)) continue;
    const available=stock.decimal(batch.available_quantity);
    const take=remaining<available?remaining:available;
    const valued=batch.valuation_status==='confirmed' && batch.currency==='USD' && batch.unit_cost_usd!=null;
    const lineCost=valued?take*stock.decimal(batch.unit_cost_usd):null;
    if(valued) {known+=take;total+=lineCost;} else pending+=take;
    allocations.push({batch_id:batch.id,valuation_id:batch.valuation_id,valuation_revision:batch.valuation_revision,
      quantity:stock.amount(take),unit_cost_usd:valued?batch.unit_cost_usd:null,
      known_cost_usd:lineCost==null?null:money.costText(lineCost)});
    remaining-=take;
  }
  return {planning_product_id:product.id,product_id:product.product_id,name:product.name||'Producto no disponible',
    unit:product.base_unit,required_quantity:stock.amount(required),known_quantity:stock.amount(known),
    pending_cost_quantity:stock.amount(pending),uncovered_quantity:stock.amount(remaining),known_cost_usd:money.costText(total),
    status:!pending&&!remaining?'complete':known>0n?'partial':'unavailable',
    issue:product.product_enabled?null:'Producto deshabilitado: no disponible para ejecutar.',simulated_batches:allocations};
}
async function estimate(pool,{user,planningId},clock=()=>localToday()) {
  authorize(user);
  try { z.string().uuid().parse(planningId); } catch { throw stock.fail('Planificación inválida.',400); }
  const today=stock.calendarDate(clock()),client=await pool.connect();
  try {
    // Consistent read-only snapshot. No row locks, reservations or writes.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {rows}=await client.query('SELECT id,status,enabled,inventory_impact_mode FROM planning WHERE id=$1 AND company_id=$2',[planningId,user.company_id]);
    if(!rows.length) throw stock.fail('Planificación no encontrada.',404);
    const planning=rows[0];
    if(!planning.enabled || !allowedStates.has(planning.status) || planning.inventory_impact_mode==='HISTORICAL_NO_STOCK')
      throw stock.fail('La estimación actual está disponible para planificaciones pendientes de ejecución.',409);
    const {rows:areas}=await client.query('SELECT COALESCE(effective_area_ha,area_ha)::text AS area FROM planning_lots WHERE planning_id=$1',[planningId]);
    let area=0n,validArea=areas.length>0;
    for(const row of areas) {
      try { if(row.area==null || stock.decimal(row.area)<=0n) throw new Error('Invalid area');area+=stock.decimal(row.area); }
      catch { validArea=false; }
    }
    const {rows:products}=await client.query(`SELECT pp.id,pp.product_id,pp.amount::text,pp.unit,
      pr.name,pr.unit AS base_unit,pr.enabled AS product_enabled
      FROM planning_products pp LEFT JOIN products pr ON pr.id=pp.product_id AND pr.company_id=$2
      WHERE pp.planning_id=$1 ORDER BY pp.id`,[planningId,user.company_id]);
    const ids=[...new Set(products.filter(p=>p.product_enabled).map(p=>p.product_id))];
    const {rows:batches}=ids.length?await client.query(`SELECT * FROM stock_batches
      WHERE company_id=$1 AND product_id=ANY($2::uuid[]) AND ${eligibleBatchSql}
      ORDER BY ${fefoOrderSql}`,[user.company_id,ids,today]):{rows:[]};
    const {rows:valuations}=batches.length?await client.query(`SELECT DISTINCT ON (batch_id)
      batch_id,id AS valuation_id,revision AS valuation_revision,status AS valuation_status,currency,unit_cost_usd::text
      FROM stock_batch_valuations WHERE company_id=$1 AND batch_id=ANY($2::uuid[])
      ORDER BY batch_id,revision DESC`,[user.company_id,batches.map(b=>b.id)]):{rows:[]};
    const values=new Map(valuations.map(v=>[v.batch_id,v]));
    const byProduct=new Map();
    for(const batch of batches) {
      const list=byProduct.get(batch.product_id)||[];
      list.push({...batch,valuation_id:null,valuation_revision:null,...values.get(batch.id)});
      byProduct.set(batch.product_id,list);
    }
    const result=products.map(p=>estimateProduct(p,byProduct.get(p.product_id)||[]));
    const complete=result.every(p=>p.status==='complete');
    const anyKnown=result.some(p=>stock.decimal(p.known_quantity)>0n || p.required_quantity==='0.000000');
    const response={planning_id:planningId,currency:'USD',simulation:true,as_of_date:today,
      calculated_at:new Date().toISOString(),status:complete?'complete':anyKnown?'partial':'unavailable',
      area_ha:validArea?stock.amount(area):null,area_warning:validArea?null:'Superficie prevista no válida; no se calcula costo por hectárea.',
      products:result,known_products_cost_usd:money.costText(result.reduce((sum,p)=>sum+money.cost(p.known_cost_usd),0n)),
      pending_items:result.filter(p=>stock.decimal(p.pending_cost_quantity)>0n).length,
      stock_shortfalls:result.filter(p=>p.uncovered_quantity!=null && stock.decimal(p.uncovered_quantity)>0n).length,
      invalid_items:result.filter(p=>p.required_quantity==null).length};
    await client.query('COMMIT');return response;
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
}
module.exports={estimate,estimateProduct,allowedStates};
