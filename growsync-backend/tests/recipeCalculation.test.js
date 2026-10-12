const {test}=require('node:test'),assert=require('node:assert/strict');
const {calculateRecipeItem,sumEffectiveAreas,isRecipeCompatible}=require('../../shared/recipeCalculation.cjs');
const calc=(dose_amount,dose_unit,product_unit,area_ha)=>calculateRecipeItem({dose_amount,dose_unit,product_unit,area_ha});
for(const [dose,unit,base,area,total] of [
  ['2.5','L','L','10','25.000000'],['300','mL','L','10','3.000000'],['15','g','kg','120','1.800000'],
  ['1.5','L','L','104','156.000000'],['2.5','L','L','15','37.500000'],['300','cc','litros','10','3.000000'],
  ['0.000003','L','L','1.25','0.000004'],['0.000003','L','L','1.1','0.000003'],
  ['1','unit','unit','10','10.000000'],['2','bag','bag','1.5','3.000000'],
])test(`exact dose ${dose} ${unit} times ${area} ha`,()=>{
  const result=calc(dose,unit,base,area);assert.equal(result.amount,total);assert.equal(result.unit,base);
  assert.equal(result.dose_amount,dose);assert.equal(result.dose_unit,unit==='cc'?'mL':unit);
});
test('effective areas are summed exactly, preserving explicit partials and fallback snapshots',()=>{
  assert.equal(sumEffectiveAreas([{area_ha:'100',effective_area_ha:'0.1'},{area_ha:'0.2',effective_area_ha:null}]),'0.300000');
  assert.equal(sumEffectiveAreas([{area_ha:'68.7130'},{area_ha:'46.0932'}]),'114.806200');
  assert.equal(calc('12345678.123456','L','L','0.1234').amount,'1523456.680434');
});
test('half-up rounding is deterministic at micro-unit boundaries',()=>{
  assert.equal(calc('0.000001','L','L','1.4999').amount,'0.000001');
  assert.equal(calc('0.000001','L','L','1.5').amount,'0.000002');
  assert.equal(calc('0.000001','L','L','1.5001').amount,'0.000002');
});
test('reject invalid precision, overflow, zero-area, zero-result and incompatible families',()=>{
  for(const args of [['0','L','L','10'],['-1','L','L','10'],['1.0000001','L','L','10'],['1','kg','L','10'],['1','mL','kg','10'],
    ['1','L','L','0'],['1','L','L','-1'],['1','L','L','1.0000001'],['0.000001','L','L','0.0001'],['99999999999999','L','L','10']])assert.throws(()=>calc(...args));
  for(const selections of [[],[{area_ha:null}],[{area_ha:10,effective_area_ha:0}],[{area_ha:-1}]])assert.throws(()=>sumEffectiveAreas(selections));
});
test('compatibility permits general context/crop and requires exact activity/specific fields',()=>{
  const planning={activity_type:'fumigacion',field_context:'stubble',crop_id:'corn'};
  for(const field_context of [null,'stubble'])for(const crop_id of [null,'corn'])assert.equal(isRecipeCompatible({activity_type:'fumigacion',field_context,crop_id},planning),true);
  for(const change of [{activity_type:'fertilizacion'},{field_context:'growing_crop'},{crop_id:'wheat'}])assert.equal(isRecipeCompatible({...planning,...change},planning),false);
});
