import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {createServer} from 'vite';
import conversion from '../vite/inventoryConversionPlugin.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
let server,browser,origin;
before(async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  server=await createServer({root,configFile:false,plugins:[conversion(),{name:'planning-recipes-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
    if(req.url.split('?')[0]!=='/')return next();res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/planningRecipes.fixture.jsx"></script>');
  });}}],cacheDir:'../.test-tools/vite-planning-recipes',server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}},
    optimizeDeps:{entries:[],include:['react','react-dom/client','react-router-dom','react/jsx-runtime','react/jsx-dev-runtime','antd','axios','dayjs','react-responsive','leaflet','react-leaflet','@ant-design/v5-patch-for-react-19','@hugeicons/react','@hugeicons/core-free-icons']}});
  await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}`;browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();});
async function open(width=1440){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  page.on('pageerror',e=>console.error('Fixture error:',e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await page.goto(origin);
  try{await page.locator('.gs-planning button[aria-label^="Editar"]').first().waitFor({timeout:12000});}catch{await page.reload();await page.locator('.gs-planning button[aria-label^="Editar"]').first().waitFor({timeout:60000});}return page;
}
async function choose(page,id,label){const input=page.locator('#'+id);await input.focus();await input.press('ArrowDown');await page.locator('.ant-select-dropdown:visible').getByText(label,{exact:true}).click();}
test('existing snapshot preview resizes independently of mutable source, detach preserves manual totals',async t=>{
  const page=await open();t.after(()=>page.close());await page.locator('.gs-planning button[aria-label^="Editar"]').first().click();
  const drawer=page.locator('.ant-drawer-open');await drawer.locator('.planning-recipe-preview').waitFor();
  await drawer.getByText('Receta: Nombre guardado',{exact:true}).waitFor();await drawer.getByText('25 L',{exact:true}).waitFor();
  assert.equal(await drawer.getByRole('button',{name:'Agregar producto',exact:true}).count(),0);
  const area=drawer.getByRole('spinbutton');await area.fill('15');await area.press('Tab');await drawer.getByText('37,5 L',{exact:true}).waitFor();
  assert.equal(await drawer.getByText('1.485 L',{exact:true}).count(),0);
  await choose(page,'recipe_id','Sin receta / Carga manual');await drawer.getByRole('button',{name:'Agregar producto',exact:true}).waitFor();
  assert.equal(await drawer.locator('.planning-product-row').count(),1);
  assert.ok(await page.evaluate(()=>document.querySelector('input[id="products_0_amount"]')?.value.includes('37')));
  assert.equal(await page.evaluate(()=>window.__planningRecipeWrites.length),0);
});
test('normal create posts only origin, low stock warning does not block; preview reacts to area and mL/g units',async t=>{
  const page=await open();t.after(()=>page.close());await page.getByRole('button',{name:'Nueva Planificación',exact:true}).click();
  await choose(page,'activity_type','Fumigación');await choose(page,'field_context','Rastrojo');await choose(page,'crop_id','Maíz');
  await choose(page,'lot_selection_keys','Lote de prueba · 25 ha');await page.locator('.ant-drawer-open').getByText('Ubicación',{exact:true}).click();
  const drawer=page.locator('.ant-drawer-open');const area=drawer.getByRole('spinbutton');await area.fill('10');await area.press('Tab');
  await choose(page,'recipe_id','Mezcla nueva · Fumigación · Rastrojo · Maíz');
  await drawer.getByText('25 L',{exact:true}).waitFor();await drawer.getByText('0,15 kg',{exact:true}).waitFor();await drawer.getByText('2,5 L',{exact:true}).waitFor();
  await drawer.getByText('Supera disponible',{exact:true}).waitFor();await area.fill('15');await area.press('Tab');await drawer.getByText('37,5 L',{exact:true}).waitFor();
  await drawer.getByRole('textbox',{name:'Fecha',exact:true}).fill('15/10/2026');await drawer.getByRole('textbox',{name:'Fecha',exact:true}).press('Enter');
  await choose(page,'responsible_user','Responsable');
  const save=drawer.getByRole('button',{name:'Crear Planificación',exact:true});assert.equal(await save.isEnabled(),true);await save.click();
  await drawer.waitFor({state:'hidden'});
  const writes=await page.evaluate(()=>window.__planningRecipeWrites);assert.equal(writes.length,1);assert.equal(writes[0].path,'/planning');
  assert.equal(writes[0].body.recipe_id,'fresh');assert.equal(writes[0].body.lot_selections[0].effective_area_ha,15);
  assert.ok(!Object.hasOwn(writes[0].body,'products'));assert.ok(!Object.hasOwn(writes[0].body,'recipe_name_snapshot'));
});
test('mobile preview and saved detail fit; performed mode requires explicit manual products',async t=>{
  const page=await open(390);t.after(()=>page.close());await page.locator('.gs-planning button[aria-label^="Ver detalle"]').first().click();
  await page.getByText('Nombre guardado',{exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.locator('.ant-drawer-open').getByRole('button',{name:/Close|Cerrar/}).click();
  await page.getByRole('button',{name:'Nueva planificacion',exact:true}).click();await choose(page,'activity_type','Fumigación');await choose(page,'field_context','Rastrojo');await choose(page,'crop_id','Maíz');
  await choose(page,'lot_selection_keys','Lote de prueba · 25 ha');await page.locator('.ant-drawer-open').getByText('Ubicación',{exact:true}).click();await choose(page,'recipe_id','Mezcla nueva · Fumigación · Rastrojo · Maíz');
  await page.locator('.planning-recipe-preview').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.getByText('Ya realizada',{exact:true}).click();await page.getByText('Para registrar una actividad realizada elegí Sin receta / Carga manual y cargá sus productos manualmente.',{exact:true}).waitFor();
  await choose(page,'recipe_id','Sin receta / Carga manual');assert.equal(await page.locator('.planning-product-row').count(),0);assert.equal(await page.evaluate(()=>window.__planningRecipeWrites.length),0);
});
