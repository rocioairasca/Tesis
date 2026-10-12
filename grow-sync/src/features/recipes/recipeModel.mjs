import {compatibleUnitOptions,normalizeQuantity} from '../../utils/inventoryConversion.js';
import {unitLabel} from '../../utils/inventoryUnits.js';
export const RECIPE_ACTIVITIES=[{value:'fumigacion',label:'Fumigación'},{value:'fertilizacion',label:'Fertilización'},{value:'siembra',label:'Siembra'}];
export const RECIPE_CONTEXTS=[{value:'growing_crop',label:'Implantado'},{value:'stubble',label:'Rastrojo'},{value:'fallow',label:'Barbecho'},{value:'pre_sowing',label:'Pre-siembra'},{value:'other',label:'Otro'}];
export const activityLabel=value=>RECIPE_ACTIVITIES.find(a=>a.value===value)?.label||'—';
export const contextLabel=value=>RECIPE_CONTEXTS.find(c=>c.value===value)?.label||'—';
export const doseUnitOptions=unit=>compatibleUnitOptions(unit).map(o=>({...o,label:o.label+'/ha'}));
export function doseLabel(amount,unit){
  const [whole,fraction='']=String(amount).replace(',','.').split('.');
  const tail=fraction.replace(/0+$/,'');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')}${tail?','+tail:''} ${unitLabel(unit)}/ha`;
}
export function recipePayload(values,products){
  if(!values.name?.trim())throw new Error('Ingresá un nombre para la receta.');
  if(!RECIPE_ACTIVITIES.some(a=>a.value===values.activity_type))throw new Error('Seleccioná una actividad.');
  if(!values.items?.length)throw new Error('Agregá al menos un producto.');
  const seen=new Set();
  const items=values.items.map(item=>{
    if(seen.has(item.product_id))throw new Error('No podés agregar el mismo producto dos veces.');seen.add(item.product_id);
    const product=products.find(p=>p.id===item.product_id);
    if(!product)throw new Error('Seleccioná un producto en cada fila.');
    if(!item.dose_unit)throw new Error('Seleccioná una unidad para cada dosis.');
    const dose=normalizeQuantity({quantity:item.dose_amount,inputUnit:item.dose_unit,productUnit:product.unit});
    return {product_id:item.product_id,dose_amount:dose.entered_quantity,dose_unit:dose.entered_unit};
  });
  return {name:values.name.trim(),activity_type:values.activity_type,field_context:values.field_context||null,crop_id:values.crop_id||null,items};
}
export function filterRecipes(rows,{search='',activity,crop}={}){
  const text=search.trim().toLocaleLowerCase('es');
  return rows.filter(r=>(!text||r.name.toLocaleLowerCase('es').includes(text))&&(!activity||r.activity_type===activity)&&(!crop||r.crop_id===crop));
}
export function recipeProducts(options,recipe){
  const all=new Map(options.map(p=>[p.id,p]));
  for(const item of recipe?.items||[])if(!all.has(item.product_id))all.set(item.product_id,{id:item.product_id,name:item.product_name,unit:item.product_unit,enabled:item.product_enabled});
  return [...all.values()];
}
