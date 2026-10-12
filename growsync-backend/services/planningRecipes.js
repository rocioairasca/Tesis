const {calculateRecipeItem,sumEffectiveAreas,isRecipeCompatible}=require('../../shared/recipeCalculation.cjs');
const stock=require('./stock');
const fail=message=>stock.fail(message,400);
const incompatible='La receta seleccionada ya no es compatible con la actividad, contexto o cultivo.';
function rejectClientSnapshot(body){
  if(Object.hasOwn(body,'recipe_name_snapshot')||(body.products||[]).some(p=>Object.hasOwn(p,'dose_amount')||Object.hasOwn(p,'dose_unit')))
    throw fail('El nombre histórico y las dosis de la receta se resuelven en el servidor.');
  if(body.recipe_id&&body.products!==undefined)throw fail('No envíes productos manuales cuando seleccionás una receta.');
}
async function source(client,companyId,id,{enabled=true}={}){
  const recipe=(await client.query('SELECT * FROM recipes WHERE id=$1 AND company_id=$2 FOR SHARE',[id,companyId])).rows[0];
  if(!recipe)throw fail('La receta no pertenece a tu empresa o no está disponible.');
  if(enabled&&!recipe.enabled)throw fail('La receta está deshabilitada. Seleccioná una receta activa.');
  return recipe;
}
async function build(client,companyId,id,planning,selections){
  const recipe=await source(client,companyId,id);
  if(!isRecipeCompatible(recipe,planning))throw fail(incompatible);
  const items=(await client.query(`SELECT i.product_id,i.dose_amount::text AS dose_amount,i.dose_unit,p.unit AS product_unit,p.enabled
    FROM recipe_items i JOIN products p ON p.id=i.product_id AND p.company_id=$2 WHERE i.recipe_id=$1 ORDER BY i.id FOR SHARE OF i,p`,[id,companyId])).rows;
  const count=(await client.query('SELECT count(*)::int n FROM recipe_items WHERE recipe_id=$1',[id])).rows[0].n;
  if(!items.length||items.length!==count||items.some(p=>p.enabled!==true))throw fail('La receta contiene productos no disponibles en tu empresa.');
  const area=sumEffectiveAreas(selections);
  return {id:recipe.id,name:recipe.name,items:items.map(item=>({product_id:item.product_id,...calculateRecipeItem({...item,area_ha:area})}))};
}
async function persistItems(client,planningId,items){
  for(const item of items)await client.query(`INSERT INTO planning_products(planning_id,product_id,amount,unit,dose_amount,dose_unit)
    VALUES($1,$2,$3::numeric,$4,$5::numeric,$6)`,[planningId,item.product_id,item.amount,item.unit,item.dose_amount,item.dose_unit]);
}
async function update(client,{companyId,id,current,body,selections,planning}){
  rejectClientSnapshot(body);
  const origin=current.recipe_id||null,newId=body.recipe_id!==undefined?body.recipe_id:origin;

  const fieldsChanged=['activity_type','field_context','crop_id'].some(k=>body[k]!==undefined&&(body[k]??null)!==(current[k]??null));
  const lotsChanged=body.lot_ids!==undefined||body.lot_selections!==undefined;
  const recipeTouched=body.recipe_id!==undefined&&newId!==origin;
  if(current.status==='completado'&&(recipeTouched||(origin&&(body.products!==undefined||lotsChanged||fieldsChanged))))
    throw stock.fail('La receta y los productos de una planificación completada no pueden modificarse.',409);
  if(current.inventory_impact_mode==='HISTORICAL_NO_STOCK'&&body.recipe_id!==undefined)
    throw stock.fail('Las recetas no pueden agregarse ni modificarse en antecedentes históricos.',409);
  if(origin&&newId&&body.products!==undefined)throw fail('Los productos derivados de una receta no se pueden editar manualmente. Quitá la receta para usar carga manual.');
  if(!newId){
    if(origin){
      await client.query('UPDATE planning SET recipe_id=NULL,recipe_name_snapshot=NULL WHERE id=$1 AND company_id=$2',[id,companyId]);
      await client.query('UPDATE planning_products SET dose_amount=NULL,dose_unit=NULL WHERE planning_id=$1',[id]);
    }
    return false;
  }
  if(newId!==origin){
    const snapshot=await build(client,companyId,newId,planning,selections);
    await client.query('UPDATE planning SET recipe_id=$3,recipe_name_snapshot=$4 WHERE id=$1 AND company_id=$2',[id,companyId,snapshot.id,snapshot.name]);
    await client.query('DELETE FROM planning_products WHERE planning_id=$1',[id]);await persistItems(client,id,snapshot.items);return true;
  }
  if(fieldsChanged&&!isRecipeCompatible(await source(client,companyId,newId,{enabled:false}),planning))throw fail(incompatible);
  if(lotsChanged){
    const items=(await client.query('SELECT id,product_id,unit AS product_unit,dose_amount::text AS dose_amount,dose_unit FROM planning_products WHERE planning_id=$1 ORDER BY id FOR UPDATE',[id])).rows;
    if(!items.length||items.some(p=>p.dose_amount==null||p.dose_unit==null))throw fail('La planificación no tiene un snapshot completo de dosis.');
    const area=sumEffectiveAreas(selections);
    for(const item of items){const total=calculateRecipeItem({...item,area_ha:area});
      await client.query('UPDATE planning_products SET amount=$2::numeric WHERE id=$1 AND planning_id=$3',[item.id,total.amount,id]);
    }
  }
  return true;
}
async function options(pool,companyId,planning){
  if(!['fumigacion','fertilizacion','siembra'].includes(planning.activity_type))return [];
  const recipes=(await pool.query(`SELECT r.*,c.name AS crop_name FROM recipes r LEFT JOIN crops c ON c.id=r.crop_id AND c.company_id=r.company_id WHERE r.company_id=$1 AND r.enabled=true AND r.activity_type=$2
    AND (r.field_context IS NULL OR r.field_context IS NOT DISTINCT FROM $3::text)
    AND (r.crop_id IS NULL OR r.crop_id IS NOT DISTINCT FROM $4::uuid)
    AND NOT EXISTS(SELECT 1 FROM recipe_items i LEFT JOIN products p ON p.id=i.product_id AND p.company_id=r.company_id
      WHERE i.recipe_id=r.id AND (p.id IS NULL OR p.enabled IS NOT TRUE)) ORDER BY r.name,r.id`,[companyId,planning.activity_type,planning.field_context??null,planning.crop_id??null])).rows;
  const items=recipes.length?(await pool.query(`SELECT i.recipe_id,i.product_id,p.name AS product_name,p.unit AS product_unit,
    i.dose_amount::text AS dose_amount,i.dose_unit FROM recipe_items i JOIN products p ON p.id=i.product_id AND p.company_id=$1
    WHERE i.recipe_id=ANY($2::uuid[]) ORDER BY i.id`,[companyId,recipes.map(r=>r.id)])).rows:[];
  const balances=await stock.balances(pool,companyId,[...new Set(items.map(i=>i.product_id))]);
  return recipes.map(r=>({...r,items:items.filter(i=>i.recipe_id===r.id).map(i=>({...i,available_quantity:balances.get(i.product_id)?.available_quantity||'0'}))}));
}
// Register-completed alone accepts product IDs before planning-product IDs exist.
async function actualProductsForRegistration(client,planningId,companyId,provided){
  const planned=(await client.query(`SELECT pp.id,pp.product_id,p.unit AS product_unit FROM planning_products pp
    JOIN products p ON p.id=pp.product_id AND p.company_id=$2 WHERE pp.planning_id=$1 FOR UPDATE OF pp`,[planningId,companyId])).rows;
  if(!Array.isArray(provided)||provided.length!==planned.length)throw fail('Confirmá la cantidad realmente utilizada de todos los productos de la receta. Usá cero si no se utilizó.');
  const byProduct=new Map(planned.map(p=>[p.product_id,p])),seen=new Set();
  return provided.map(item=>{
    const product=byProduct.get(item.product_id);
    if(!product)throw fail('Uno de los productos informados no pertenece a la receta planificada.');
    if(seen.has(item.product_id))throw fail('Hay productos repetidos en la confirmación.');
    seen.add(item.product_id);
    const normalized=require('./inventoryConversion').normalizeQuantity({quantity:item.actual_amount,inputUnit:item.unit,productUnit:product.product_unit,allowZero:true});
    return {planning_product_id:product.id,actual_amount:normalized.normalized_quantity,unit:product.product_unit};
  });
}
module.exports={rejectClientSnapshot,build,persistItems,update,options,actualProductsForRegistration};
