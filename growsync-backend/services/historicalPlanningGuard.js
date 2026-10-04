const {inventorySnapshot}=require('./historicalPlanningProduct');
const {getEffectivePermissions}=require('../constants/permissions');
const {fail}=require('./inventoryImpact');
async function protectPlanning(client,companyId,actorId,permission='planning.edit'){
  const actor=(await client.query('SELECT * FROM users WHERE id=$1 AND company_id=$2 AND enabled=true',[actorId,companyId])).rows[0];
  const permissions=actor?getEffectivePermissions(actor):[];
  if(!permissions.includes('all') && ![permission,'history.import'].every(p=>permissions.includes(p)))throw fail('No tenés permiso para corregir antecedentes históricos.',403);
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='30s'");
  await client.query(`LOCK TABLE companies,users,planning,planning_lots,planning_products,planning_product_completions,
    usage_records,usage_lots,crop_assignments,harvest_records,harvest_crop_assignments,harvest_cycle_closures,
    lots,sub_lots,campaigns,crops,products,stock_batches,stock_movements,notifications IN SHARE ROW EXCLUSIVE MODE`);
  const structure=async()=>{
    const result={};
    for(const table of ['crop_assignments','harvest_records','harvest_cycle_closures','lots','sub_lots','campaigns','crops']) {
      result[table]=(await client.query(`SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]')::text value FROM ${table} x WHERE company_id=$1`,[companyId])).rows[0].value;
    }
    result.harvest_crop_assignments=(await client.query(`SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY harvest_id,crop_assignment_id),'[]')::text value
      FROM harvest_crop_assignments x WHERE crop_assignment_id IN (SELECT id FROM crop_assignments WHERE company_id=$1)
      OR harvest_id IN (SELECT id FROM harvest_records WHERE company_id=$1)`,[companyId])).rows[0].value;
    return JSON.stringify(result);
  };
  const beforeStructure=await structure(),beforeStock=await inventorySnapshot(client,companyId);
  return async()=>{
    if(await structure()!==beforeStructure)throw fail('No se guardó la corrección porque modificaría un cultivo, una cosecha o la estructura de un lote. Necesita una revisión.',409);
    if(await inventorySnapshot(client,companyId)!==beforeStock)throw fail('No se guardó la corrección porque modificaría el inventario. Necesita una revisión.',409);
  };
}
async function planningGraph(client,id){
  return (await client.query(`SELECT (to_jsonb(p)||jsonb_build_object(
    'products',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM planning_products x WHERE planning_id=p.id),
    'completions',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY planning_product_id),'[]') FROM planning_product_completions x WHERE planning_id=p.id),
    'lots',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY lot_id,sub_lot_id),'[]') FROM planning_lots x WHERE planning_id=p.id),
    'usages',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM usage_records x WHERE source_planning_id=p.id)
  ))::text value FROM planning p WHERE id=$1`,[id])).rows[0].value;
}
async function planningMembership(client,id){
  return (await client.query(`SELECT jsonb_build_object(
    'planning',to_jsonb(p)-ARRAY['title','description','responsible_user','updated_at','enabled'],
    'lots',(SELECT COALESCE(jsonb_agg(to_jsonb(x)-'area_ha' ORDER BY lot_id,sub_lot_id),'[]') FROM planning_lots x WHERE planning_id=p.id),
    'products',(SELECT COALESCE(jsonb_agg(to_jsonb(x)-'amount' ORDER BY id),'[]') FROM planning_products x WHERE planning_id=p.id),
    'completions',(SELECT COALESCE(jsonb_agg(to_jsonb(x)-'actual_amount' ORDER BY planning_product_id),'[]') FROM planning_product_completions x WHERE planning_id=p.id),
    'usage_lots',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY usage_id,lot_id,sub_lot_id),'[]') FROM usage_lots x WHERE usage_id IN (SELECT id FROM usage_records WHERE source_planning_id=p.id))
  )::text value FROM planning p WHERE id=$1`,[id])).rows[0].value;
}
module.exports={protectPlanning,planningGraph,planningMembership};