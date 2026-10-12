import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {calculateRecipeItem,sumEffectiveAreas,isRecipeCompatible,MANUAL_RECIPE,recipeId,recipePreview,planningRecipeSnapshot,detachRecipeProducts} from '../src/features/planning/planningRecipe.mjs';
const recipe={id:'recipe',name:'Barbecho Maíz',activity_type:'fumigacion',field_context:'stubble',crop_id:'corn',items:[
  {product_id:'liquid',product_name:'Glifosato',product_unit:'L',dose_amount:'2.5',dose_unit:'L',available_quantity:'30'},
  {product_id:'mass',product_name:'Finesse',product_unit:'kg',dose_amount:'15',dose_unit:'g',available_quantity:'100'},
  {product_id:'small',product_name:'MSO',product_unit:'L',dose_amount:'250',dose_unit:'mL',available_quantity:'0'},
]};
test('preview reuses exact arithmetic and reacts to effective-area changes and multiple selections',()=>{
  const a=recipePreview(recipe,[{area_ha:100,effective_area_ha:10}]),b=recipePreview(recipe,[{area_ha:100,effective_area_ha:15}]);
  assert.equal(a.area,'10.000000');assert.equal(a.items[0].amount,'25.000000');assert.equal(b.items[0].amount,'37.500000');
  assert.equal(a.items[1].amount,'0.150000');assert.equal(a.items[2].amount,'2.500000');
  assert.equal(a.items[0].insufficient,false);assert.equal(b.items[0].insufficient,true);assert.equal(a.items[2].insufficient,true);
  assert.equal(sumEffectiveAreas([{area_ha:25,effective_area_ha:'7.5'},{area_ha:'2.5'}]),'10.000000');
  assert.equal(calculateRecipeItem({dose_amount:300,dose_unit:'mL',product_unit:'L',area_ha:10}).amount,'3.000000');
});
test('general and specific recipe compatibility follows activity, context and crop',()=>{
  const planning={activity_type:'fumigacion',field_context:'stubble',crop_id:'corn'};
  for(const field_context of [null,'stubble'])for(const crop_id of [null,'corn'])assert.ok(isRecipeCompatible({...recipe,field_context,crop_id},planning));
  for(const patch of [{activity_type:'siembra'},{field_context:'growing_crop'},{crop_id:'wheat'}])assert.ok(!isRecipeCompatible({...recipe,...patch},planning));
});
test('existing and disabled-source plans use saved name/doses, never mutable recipe data',()=>{
  const planning={recipe_id:'recipe',recipe_name_snapshot:'Nombre histórico',activity_type:'fumigacion',field_context:'stubble',crop_id:'corn',
    products:[{product_id:'liquid',name:'Glifosato',amount:'25.000000',unit:'L',dose_amount:'2.500000',dose_unit:'L',available_quantity:30}]};
  const snapshot=planningRecipeSnapshot(planning),before=structuredClone(planning);
  const live={...recipe,name:'Renombrada',enabled:false,items:[{...recipe.items[0],dose_amount:99}]};
  assert.equal(snapshot.id,live.id);assert.equal(snapshot.name,'Nombre histórico');
  assert.equal(recipePreview(snapshot,[{area_ha:100,effective_area_ha:15}]).items[0].amount,'37.500000');
  assert.equal(recipePreview(snapshot,[{area_ha:100,effective_area_ha:15}],{readOnly:true}).items[0].amount,'25.000000');
  assert.deepEqual(planning,before);assert.equal(planningRecipeSnapshot({products:[]}),null);
});
test('explicit removal keeps current totals as manual values without doses or origin',()=>{
  const preview=recipePreview(recipe,[{area_ha:10}]),manual=detachRecipeProducts(preview);
  assert.deepEqual(manual[0],{product_id:'liquid',amount:'25.000000',unit:'L'});
  assert.ok(manual.every(p=>!Object.hasOwn(p,'dose_amount')&&!Object.hasOwn(p,'dose_unit')));
  assert.equal(recipeId(MANUAL_RECIPE),null);assert.equal(recipeId(undefined),null);assert.equal(recipeId('recipe'),'recipe');
});
test('area, unit and precision failures are reported before submitting',()=>{
  assert.throws(()=>recipePreview(recipe,[]),/superficie/);
  assert.throws(()=>recipePreview(recipe,[{area_ha:0}]),/mayor a cero/);
  assert.throws(()=>recipePreview({...recipe,items:[{...recipe.items[0],dose_unit:'kg'}]},[{area_ha:10}]),/compatible/);
});
test('selector placement and payload preserve manual and completed flows; stock is informational for recipes',()=>{
  const planning=fs.readFileSync(new URL('../src/features/planning/Planning.jsx',import.meta.url),'utf8');
  const drawer=planning.slice(planning.indexOf('{/* Drawer crear/editar'),planning.indexOf('{/* Drawer Detalle'));
  assert.ok(drawer.indexOf('<EffectiveAreaFields')<drawer.indexOf('<PlanningRecipeFields'));
  assert.match(drawer,/!selectedRecipeId && <Form.List name="products">/);
  assert.ok(planning.includes('if(effectiveRecipeId)payload.recipe_id=effectiveRecipeId'));
  assert.match(planning,/!effectiveRecipeId && !isEditingCompleted && values.products/);
  assert.match(planning,/!selectedRecipeId && !registerCompleted/);
  assert.match(planning,/label="Receta">\{viewing.recipe_name_snapshot\}/);
  assert.match(planning,/shouldRegisterCompleted && effectiveRecipeId/);
});
test('rendered preview shows original doses, normalized totals and stock warning with mobile layout',async()=>{
  const {createServer}=await import('vite'),React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
  const conversion=(await import('../vite/inventoryConversionPlugin.mjs')).default;
  const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,plugins:[conversion()],optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
  try{
    const {RecipeCalculationPreview}=await server.ssrLoadModule('/src/features/planning/components/PlanningRecipeFields.jsx');
    const html=renderToStaticMarkup(React.createElement(RecipeCalculationPreview,{preview:recipePreview(recipe,[{area_ha:100,effective_area_ha:15}])}));
    for(const label of ['Barbecho Maíz','2,5 L/ha','37,5 L','15 g/ha','0,225 kg','250 mL/ha','3,75 L','Disponible','Supera disponible','Podés guardar la planificación'])assert.ok(html.includes(label),label);
    assert.ok(!html.includes('<input'));assert.ok(!html.includes('contenteditable'));
    const source=fs.readFileSync(new URL('../src/features/planning/components/PlanningRecipeFields.jsx',import.meta.url),'utf8');
    assert.match(source,/Sin receta \/ Carga manual/);assert.match(source,/selected===snapshot\?\.id\?snapshot/);assert.match(source,/if\(registerCompleted\)form.setFieldValue\('products',\[\]\)/);
  }finally{await server.close();}
});
