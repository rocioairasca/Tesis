// Local browser acceptance. PLAYWRIGHT_MODULE may use an existing runtime.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {createServer} from 'vite';
import conversion from '../vite/inventoryConversionPlugin.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
let server,browser,origin;
before(async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  server=await createServer({root,configFile:false,plugins:[conversion(),{name:'recipes-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
    if(req.url.split('?')[0]!=='/')return next();res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/tests/recipes.fixture.jsx"></script>');
  });}}],cacheDir:'../.test-tools/vite-recipes',server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}},
    optimizeDeps:{entries:[],include:['react','react-dom/client','react-router-dom','react/jsx-runtime','react/jsx-dev-runtime','antd','axios','react-responsive','@ant-design/v5-patch-for-react-19','@hugeicons/react','@hugeicons/core-free-icons']}});
  await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();});
async function pageAt(width,mode){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto(origin+(mode?'/?mode='+mode:''));
  if(['editor','none','view'].includes(mode))return page;
  await page.getByRole('button',{name:'Nueva receta',exact:true}).waitFor({timeout:60000});
  await page.getByRole('button',{name:'Nueva receta',exact:true}).isEnabled();
  await page.locator('.gs-ui-loading').waitFor({state:'hidden',timeout:60000});return page;
}
async function select(page,label,option){await page.getByRole('combobox',{name:label,exact:true}).focus();await page.getByRole('combobox',{name:label,exact:true}).press('ArrowDown');await page.locator('.ant-select-dropdown:visible').getByText(option,{exact:true}).click();}
test('desktop create, invalid dose, detail, edit, soft disable and restore with state filtering',async t=>{
  const page=await pageAt(1440);t.after(()=>page.close());
  assert.equal(await page.locator('table').count(),1);
  await page.getByRole('button',{name:'Nueva receta',exact:true}).click();
  await page.getByLabel('Nombre',{exact:true}).fill('Mezcla nueva');await select(page,'Producto 1','Glifosato');
  await page.getByRole('textbox',{name:'Dosis 1',exact:true}).fill('0');await page.getByRole('button',{name:'Guardar receta'}).click();
  await page.getByText('La cantidad debe ser mayor a cero.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__recipeWrites.length),0);
  await page.getByRole('textbox',{name:'Dosis 1',exact:true}).fill('2,5');
  await page.getByRole('button',{name:'Agregar producto'}).click();await select(page,'Producto 2','Coadyuvante');
  await page.getByRole('textbox',{name:'Dosis 2',exact:true}).fill('300');await select(page,'Unidad de dosis 2','mL/ha');
  await page.getByRole('button',{name:'Guardar receta'}).click();await page.locator('.ant-drawer-open').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Mezcla nueva',exact:true}).click();await page.getByText('300 mL/ha',{exact:true}).waitFor();await page.getByText('2,5 L/ha',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Editar receta',exact:true}).click();await page.getByLabel('Nombre',{exact:true}).fill('Mezcla editada');
  await page.getByRole('button',{name:'Guardar receta'}).click();await page.locator('.ant-drawer-open').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Acciones de Mezcla editada'}).click();await page.getByRole('menuitem',{name:'Deshabilitar',exact:true}).click();
  await page.getByRole('button',{name:'Deshabilitar',exact:true}).click();await page.locator('.ant-modal:visible').waitFor({state:'hidden'});
  await select(page,'Filtrar por estado','Deshabilitadas');await page.getByRole('button',{name:'Mezcla editada',exact:true}).waitFor();
  await page.getByRole('button',{name:'Acciones de Mezcla editada'}).click();await page.getByRole('menuitem',{name:'Restaurar',exact:true}).click();
  await page.getByRole('button',{name:'Restaurar',exact:true}).click();await page.locator('.ant-modal:visible').waitFor({state:'hidden'});
  await select(page,'Filtrar por estado','Activas');await page.getByRole('button',{name:'Mezcla editada',exact:true}).waitFor();
  const writes=await page.evaluate(()=>window.__recipeWrites);assert.deepEqual(writes.map(w=>w.method),['post','put','delete','post']);
  assert.ok(writes.every(w=>w.path.startsWith('/recipes')));assert.equal(writes[0].body.items[1].dose_unit,'mL');
});
test('mobile cards, detail, search, filter sheet and product form do not overflow',async t=>{
  const page=await pageAt(390);t.after(()=>page.close());assert.equal(await page.locator('table').count(),0);
  await page.getByRole('button',{name:'Ver receta Barbecho Maíz',exact:true}).click();await page.getByText('2,5 L/ha',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.locator('.ant-drawer-open').getByRole('button',{name:'Close'}).click();
  await page.getByRole('searchbox',{name:'Buscar recetas por nombre'}).fill('Fertilización');
  await page.getByRole('button',{name:'Ver receta Fertilización general',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Ver receta Barbecho Maíz',exact:true}).count(),0);
  await page.getByRole('searchbox',{name:'Buscar recetas por nombre'}).fill('');
  await page.getByRole('button',{name:'Filtros',exact:true}).click();await select(page,'Filtrar por estado','Deshabilitadas');
  await page.getByRole('button',{name:'Ver resultados',exact:true}).click();await page.getByRole('button',{name:'Ver receta Receta anterior',exact:true}).waitFor();
  await page.getByRole('button',{name:'Nueva receta',exact:true}).click();await select(page,'Producto 1','Glifosato');
  await page.getByRole('textbox',{name:'Dosis 1',exact:true}).fill('2,5');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
});

test('recipe table prioritizes name, has six compact columns and centered pagination without record count',async t=>{
 for(const width of [1440,1024,390]){
  const page=await pageAt(width);t.after(()=>page.close());
  const longName='Rastrojo de maíz — Glifosato + EHE + Atrazina + MSO siliconado';
  await page.evaluate(name=>{window.__recipeRows[0].name=name;},longName);
  if(width===390)await page.getByRole('button',{name:'Filtros',exact:true}).click();
  await select(page,'Filtrar por estado','Todas');
  if(width===390)await page.locator('.ant-drawer-open').getByRole('button',{name:/Close|Cerrar/}).click();
  const table=page.getByRole('region',{name:'Listado de recetas'});
  assert.equal(await table.locator('.ant-pagination-total-text').count(),0);
  if(width>767){
   assert.deepEqual(await table.locator('thead th').allTextContents(),['Receta','Actividad','Contexto','Cultivo','Productos','Acciones']);
   const widths=await table.locator('thead th').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));
   assert.ok(widths[0]>Math.max(...widths.slice(1)));for(const [i,expected] of [[1,140],[2,120],[3,120],[4,100],[5,80]])assert.ok(Math.abs(widths[i]-expected)<2);
   await table.getByRole('button',{name:longName,exact:true}).waitFor();await table.locator('.recipe-disabled-badge').getByText('Deshabilitada',{exact:true}).waitFor();
  }
  const centered=await table.locator('.ant-pagination').evaluate(el=>getComputedStyle(el).justifyContent);assert.equal(centered,'center');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await page.evaluate(()=>window.__recipeWrites.length),0);
 }
});

test('legacy usage custom permissions retain recipe access; view-only hides mutations and disabled recipes',async t=>{
 const legacy=await pageAt(1440,'legacy');t.after(()=>legacy.close());await legacy.getByRole('button',{name:'Nueva receta',exact:true}).click();await legacy.getByLabel('Nombre',{exact:true}).waitFor();
 const view=await pageAt(1440,'view');t.after(()=>view.close());await view.getByRole('button',{name:'Barbecho Maíz',exact:true}).waitFor({timeout:60000});
 assert.equal(await view.getByRole('button',{name:'Nueva receta',exact:true}).count(),0);const states=view.getByRole('combobox',{name:'Filtrar por estado'});await states.focus();await states.press('ArrowDown');
 assert.deepEqual(await view.locator('.ant-select-dropdown:visible .ant-select-item-option-content').allTextContents(),['Activas']);await states.press('Escape');
 await view.getByRole('button',{name:'Barbecho Maíz',exact:true}).click();await view.getByText('2,5 L/ha',{exact:true}).waitFor();assert.equal(await view.getByRole('button',{name:'Editar receta',exact:true}).count(),0);
});

test('recipe-only permissions expose sidebar/mobile navigation and GuardedRoute denies users without view',async t=>{
 for(const width of [1440,390]){
  const page=await pageAt(width,'nav');t.after(()=>page.close());
  if(width>767)assert.equal(await page.getByRole('link',{name:'Recetas',exact:true}).getAttribute('href'),'/usage');
  else {await page.getByRole('button',{name:'Más opciones',exact:true}).click();await page.locator('.ant-drawer-open').getByText('Recetas',{exact:true}).waitFor();}
  const denied=await pageAt(width,'none');t.after(()=>denied.close());await denied.getByText('Sin acceso a Recetas',{exact:true}).waitFor({timeout:60000});
  assert.equal(await denied.getByRole('link',{name:'Recetas',exact:true}).count(),0);assert.equal(await denied.getByRole('button',{name:'Nueva receta',exact:true}).count(),0);
 }
});

test('permission editor separates Recipes from usage and saves recipe-only permissions without adding usage',async t=>{
 const page=await pageAt(1024,'editor');t.after(()=>page.close());await page.getByRole('button',{name:'Permisos',exact:true}).click();
 const drawer=page.locator('.ant-drawer-open'),recipes=drawer.getByRole('group',{name:'Recetas',exact:true}),usage=drawer.getByRole('group',{name:'Registros de uso',exact:true});
 assert.equal(await recipes.getByRole('checkbox').count(),6);assert.equal(await usage.getByRole('checkbox').count(),6);
 for(const label of ['Ver','Crear','Editar','Deshabilitar','Habilitar','Ver deshabilitadas'])await recipes.getByRole('checkbox',{name:label,exact:true}).waitFor();
 for(const label of ['Ver','Crear','Editar'])await recipes.getByRole('checkbox',{name:label,exact:true}).check();
 assert.equal(await usage.locator('input:checked').count(),0);
 await drawer.getByRole('button',{name:'Guardar Permisos',exact:true}).click();await drawer.waitFor({state:'hidden'});
 assert.deepEqual((await page.evaluate(()=>window.__permissionWrites))[0].custom_permissions,['recipes.view','recipes.create','recipes.edit']);
});
