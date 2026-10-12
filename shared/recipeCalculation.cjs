const conversion=require('./inventoryConversion.cjs');
const {decimalText,normalizeQuantity}=conversion;
const SCALE=1000000n,MAX=100000000000000000000n;
const fail=message=>Object.assign(new Error(message),{status:400});
const micros=value=>{const [a,b='']=decimalText(value).split('.');return BigInt(a)*SCALE+BigInt(b.padEnd(6,'0'));};
const text=value=>`${value/SCALE}.${String(value%SCALE).padStart(6,'0')}`;
function sumEffectiveAreas(selections){
  if(!Array.isArray(selections)||!selections.length)throw fail('Seleccioná una superficie efectiva mayor a cero para calcular la receta.');
  const total=selections.reduce((sum,row)=>{
    const area=micros(row.effective_area_ha??row.area_ha);
    if(area<=0n)throw fail('La superficie efectiva debe ser mayor a cero.');return sum+area;
  },0n);
  if(total>=MAX)throw fail('La superficie total supera el máximo permitido.');return text(total);
}
function calculateRecipeItem({dose_amount,dose_unit,product_unit,area_ha}){
  const dose=normalizeQuantity({quantity:dose_amount,inputUnit:dose_unit,productUnit:product_unit});
  const area=micros(area_ha);if(area<=0n)throw fail('La superficie efectiva debe ser mayor a cero.');
  // Exact micro-unit multiplication, rounded half up to six decimal places.
  const amount=(micros(dose.normalized_quantity)*area+SCALE/2n)/SCALE;
  if(amount<=0n)throw fail('La cantidad calculada es menor a la precisión admitida. Revisá la dosis o superficie.');
  if(amount>=MAX)throw fail('La cantidad calculada supera el máximo permitido.');
  return {amount:text(amount),unit:product_unit,dose_amount:dose.entered_quantity,dose_unit:dose.entered_unit};
}
function isRecipeCompatible(recipe,planning){
  return recipe.activity_type===planning.activity_type&&
    (recipe.field_context==null||recipe.field_context===(planning.field_context??null))&&
    (recipe.crop_id==null||recipe.crop_id===(planning.crop_id??null));
}
module.exports={calculateRecipeItem,sumEffectiveAreas,isRecipeCompatible};
