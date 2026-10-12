import calculation from '../../../../shared/recipeCalculation.cjs';
import {doseLabel} from '../recipes/recipeModel.mjs';
import {exceedsAvailable} from '../../utils/inventoryConversion.js';
export const {isRecipeCompatible,sumEffectiveAreas,calculateRecipeItem}=calculation;
export const MANUAL_RECIPE='__manual__';
export const recipeId=value=>value&&value!==MANUAL_RECIPE?value:null;
export const totalLabel=(value,unit)=>doseLabel(value,unit).replace(/\/ha$/,'');
export function planningRecipeSnapshot(planning){
  if(!planning?.recipe_id)return null;
  return {id:planning.recipe_id,name:planning.recipe_name_snapshot,activity_type:planning.activity_type,field_context:planning.field_context,crop_id:planning.crop_id,snapshot:true,
    items:(planning.products||[]).map(p=>({product_id:p.product_id,product_name:p.name,product_unit:p.unit,dose_amount:p.dose_amount,dose_unit:p.dose_unit,amount:p.amount,available_quantity:p.available_quantity}))};
}
export function recipePreview(recipe,selections,{readOnly=false}={}){
  const area=sumEffectiveAreas(selections);
  const items=recipe.items.map(item=>{
    const total=readOnly?{amount:item.amount,unit:item.product_unit,dose_amount:item.dose_amount,dose_unit:item.dose_unit}:calculateRecipeItem({...item,area_ha:area});
    let insufficient=false;
    try{insufficient=exceedsAvailable(total.amount,total.unit,item.product_unit,item.available_quantity??'0');}catch{}
    return {...item,...total,insufficient};
  });
  return {name:recipe.name,area,items};
}
export const detachRecipeProducts=preview=>preview.items.map(({product_id,amount,unit})=>({product_id,amount,unit}));

// Only semantic preview inputs reset confirmations; metadata is deliberately excluded.
export const realQuantityDefaults=preview=>Object.fromEntries(preview.items.map(i=>[i.product_id,{actual_amount:i.amount,unit:i.unit}]));
export const realQuantityKey=(preview,{selected,activity,context,crop,selections})=>JSON.stringify({selected,activity,context,crop,selections:selections.map(i=>[i.lot_id,i.sub_lot_id??null,i.effective_area_ha??i.area_ha]),items:preview.items.map(i=>[i.product_id,i.amount,i.unit])});
export const registeredRecipeActualProducts=values=>Object.entries(values||{}).map(([product_id,item])=>({product_id,actual_amount:item.actual_amount,unit:item.unit}));
