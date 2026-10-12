import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {recipePayload,doseLabel,doseUnitOptions,filterRecipes,recipeProducts,activityLabel,contextLabel} from '../src/features/recipes/recipeModel.mjs';
const products=[{id:'liquid',name:'Glifosato',unit:'L',enabled:true},{id:'mass',name:'Fertilizante',unit:'kg',enabled:true}];
const values={name:'  Barbecho Maíz  ',activity_type:'fumigacion',field_context:'stubble',crop_id:'corn',items:[{product_id:'liquid',dose_amount:'2,5',dose_unit:'L'}]};
test('recipe payload is a reusable dose template without operational fields',()=>{
  const before=structuredClone(values),body=recipePayload(values,products);
  assert.deepEqual(body,{...values,name:'Barbecho Maíz',items:[{product_id:'liquid',dose_amount:'2.5',dose_unit:'L'}]});
  assert.deepEqual(values,before);
  assert.deepEqual(Object.keys(body).sort(),['activity_type','crop_id','field_context','items','name']);
  assert.equal(recipePayload({...values,crop_id:null,field_context:null},products).crop_id,null);
});
test('unit selector uses existing compatible families and dose labels preserve precision',()=>{
  assert.deepEqual(doseUnitOptions('L').map(o=>o.value),['L','mL','cc']);
  assert.deepEqual(doseUnitOptions('kg').map(o=>o.value),['kg','g']);
  assert.deepEqual(doseUnitOptions('unit').map(o=>o.value),['unit']);
  assert.equal(doseUnitOptions('L')[0].label,'L/ha');
  assert.equal(doseLabel('2.500000','L'),'2,5 L/ha');assert.equal(doseLabel('300','mL'),'300 mL/ha');
  assert.equal(doseLabel('12345678901234.123456','kg'),'12.345.678.901.234,123456 kg/ha');
  assert.equal(recipePayload({...values,items:[{product_id:'liquid',dose_amount:'300',dose_unit:'cc'}]},products).items[0].dose_unit,'mL');
});
test('form validation rejects duplicates, missing products, invalid doses and incompatible units in Spanish',()=>{
  for(const [items,pattern] of [
    [[values.items[0],values.items[0]],/dos veces/],[[{product_id:'absent',dose_amount:1,dose_unit:'L'}],/Seleccioná un producto/],
    [[{...values.items[0],dose_amount:0}],/mayor a cero/],[[{...values.items[0],dose_amount:'1.0000001'}],/seis decimales/],
    [[{...values.items[0],dose_unit:'kg'}],/compatible/],[[{...values.items[0],dose_unit:null}],/Seleccioná una unidad/],
    [[],/al menos un producto/],
  ])assert.throws(()=>recipePayload({...values,items},products),pattern);
});
test('recipe filters compose name, activity and optional crop without mutating state',()=>{
  const rows=[{id:'a',name:'Barbecho Maíz',activity_type:'fumigacion',crop_id:'corn',enabled:true},{id:'b',name:'General',activity_type:'fertilizacion',crop_id:null,enabled:false}];
  assert.deepEqual(filterRecipes(rows,{search:' MAÍZ ',activity:'fumigacion',crop:'corn'}).map(r=>r.id),['a']);
  assert.equal(filterRecipes(rows,{activity:'siembra'}).length,0);assert.equal(filterRecipes(rows).length,2);
  assert.equal(activityLabel('fumigacion'),'Fumigación');assert.equal(contextLabel('stubble'),'Rastrojo');
});
test('disabled existing products remain in edit/detail data without duplicating active options',()=>{
  const merged=recipeProducts(products,{items:[{product_id:'liquid',product_name:'Glifosato',product_unit:'L',product_enabled:true},
    {product_id:'old',product_name:'Producto anterior',product_unit:'L',product_enabled:false}]});
  assert.equal(merged.length,3);assert.equal(merged.find(p=>p.id==='old').enabled,false);
});
test('navigation uses Recipes on /usage, redirects disabled Usage, and retains legacy permission keys and sources',()=>{
  const read=path=>fs.readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
  const app=read('App.jsx');assert.match(app,/features\/recipes\/Recipes.jsx/);assert.match(app,/<Recipes \/>/);
  assert.doesNotMatch(app,/features\/usages\/Usage.jsx|<Usage \/>|<DisabledUsages \/>/);
  assert.match(app,/path="\/usages-disabled"[\s\S]*?<Navigate to="\/usage" replace \/>/);
  for(const file of ['layout/Sidebar.jsx','components/NavbarBottom.jsx']){const source=read(file);assert.ok(source.includes('Recetas'));assert.ok(source.includes('/usage'));assert.ok(source.includes('PERMISSIONS.USAGE_VIEW'));assert.ok(!source.includes('Registros de Uso'));}
  const permissions=read('components/users/UserTable.jsx');assert.ok(permissions.includes('Recetas: ['));assert.ok(permissions.includes('Ver recetas deshabilitadas'));assert.ok(permissions.includes('PERMISSIONS.USAGE_CREATE'));
  for(const file of ['features/usages/Usage.jsx','features/usages/DisabledUsages.jsx'])assert.ok(fs.existsSync(new URL('../src/'+file,import.meta.url)));
});
test('form, list, errors, disabled states and mobile use the shared design system',async()=>{
  const {createServer}=await import('vite'),React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
  const {Context}=await import('react-responsive'),{MemoryRouter}=await import('react-router-dom');
  const conversion=(await import('../vite/inventoryConversionPlugin.mjs')).default;
  const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,plugins:[conversion()],optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
  const prior=globalThis.localStorage;
  try{
    globalThis.localStorage={getItem:()=>JSON.stringify({custom_permissions:['usage.view','usage.create','usage.edit','usage.view_disabled']})};
    const {default:Page}=await server.ssrLoadModule('/src/features/recipes/Recipes.jsx');
    const {default:RecipeForm}=await server.ssrLoadModule('/src/features/recipes/components/RecipeForm.jsx');
    const {Form}=await import('antd');
    const ui=await server.ssrLoadModule('/src/components/ui/index.js');
    const render=(Component,props,width=1280)=>renderToStaticMarkup(React.createElement(Context.Provider,{value:{width}},React.createElement(MemoryRouter,null,React.createElement(Component,props))));
    const page=render(Page,{});assert.ok(page.includes('Recetas'));assert.ok(page.includes('Mezclas y dosis por hectárea'));assert.ok(page.includes('Nueva receta'));
    function Wrapper(){const [form]=Form.useForm();form.setFieldsValue({...values,items:[values.items[0]]});return React.createElement(RecipeForm,{form,products,crops:[{id:'corn',name:'Maíz'}],busy:false,onFinish:()=>{}});}
    const form=render(Wrapper,{});for(const label of ['Nombre','Actividad','Cultivo relacionado','Productos','Producto','Dosis','Unidad /ha','Agregar producto'])assert.ok(form.includes(label),label);
    const row={id:'a',name:'Barbecho Maíz',enabled:false,items:values.items};
    for(const width of [1280,390]){
      const list=render(ui.DataTable,{columns:[{title:'Receta',dataIndex:'name'},{title:'Estado',dataIndex:'enabled',render:e=>e?'Activa':'Deshabilitada'}],dataSource:[row],rowLabel:r=>r.name},width);
      assert.ok(list.includes('Barbecho Maíz'));assert.ok(list.includes('Deshabilitada'));assert.equal(list.includes('<table'),width===1280);
    }
    const err=render(ui.ErrorState,{error:{response:{status:409,data:{message:'Ya existe una receta activa con ese nombre.'}}}});assert.ok(err.includes('Ya existe una receta activa'));
    const source=fs.readFileSync(new URL('../src/features/recipes/Recipes.jsx',import.meta.url),'utf8');
    assert.match(source,/renderMobile=\{/);assert.match(source,/canDisabled/);assert.match(source,/getUserFriendlyError/);
    const css=fs.readFileSync(new URL('../src/features/recipes/recipes.css',import.meta.url),'utf8');assert.match(css,/@media \(max-width: 767px\)/);assert.match(css,/minmax\(0,1fr\)/);
  }finally{globalThis.localStorage=prior;await server.close();}
});
