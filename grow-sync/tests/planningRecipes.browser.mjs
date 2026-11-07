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
async function open(width=1440,recipeReader=false,formRedesign=false){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  page.on('pageerror',e=>console.error('Fixture error:',e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await page.goto(origin+(formRedesign?'/?formRedesign=1':recipeReader?'/?recipeReader=1':''));
  const ready=recipeReader?page.getByRole('button',{name:'Nueva Planificación',exact:true}):page.locator('.gs-planning button[aria-label^="Editar"]').first();
  try{await ready.waitFor({timeout:12000});}catch{await page.reload();await ready.waitFor({timeout:60000});}return page;
}
async function choose(page,id,label){const input=page.locator('[id="'+id+'"]');await input.scrollIntoViewIfNeeded();await input.focus();await input.press('ArrowDown');await page.locator('.ant-select-dropdown:visible').getByText(label,{exact:true}).click();}
test('existing snapshot preview resizes independently of mutable source, detach preserves manual totals',async t=>{
  const page=await open();t.after(()=>page.close());await page.locator('.gs-planning button[aria-label^="Editar"]').first().click();
  const drawer=page.locator('.planning-form-modal');await drawer.locator('.planning-recipe-preview').waitFor();
  await drawer.getByText('Receta: Nombre guardado',{exact:true}).waitFor();await drawer.getByText('25 L',{exact:true}).waitFor();
  assert.equal(await drawer.getByRole('button',{name:'Agregar producto',exact:true}).count(),0);
  const area=drawer.getByRole('spinbutton');await area.fill('15');await area.press('Tab');await drawer.getByText('37,5 L',{exact:true}).waitFor();
  assert.equal(await drawer.getByText('1.485 L',{exact:true}).count(),0);
  await choose(page,'recipe_id','Sin receta / Carga manual');await drawer.getByRole('button',{name:'Agregar producto',exact:true}).waitFor();
  assert.equal(await drawer.locator('.planning-product-row').count(),1);
  assert.ok(await page.evaluate(()=>document.querySelector('input[id="products_0_amount"]')?.value.includes('37')));
  assert.equal(await page.evaluate(()=>window.__planningRecipeWrites.length),0);
});
test('planning.create + recipes.view can select and apply a recipe without recipe edit or usage permissions',async t=>{
  const page=await open(1440,true);t.after(()=>page.close());await page.getByRole('button',{name:'Nueva Planificación',exact:true}).click();
  await choose(page,'activity_type','Fumigación');await choose(page,'field_context','Rastrojo');await choose(page,'crop_id','Maíz');
  await choose(page,'lot_selection_keys','Lote de prueba · 25 ha');await page.locator('.planning-form-modal').getByText('Ubicación',{exact:true}).click();
  const drawer=page.locator('.planning-form-modal');await drawer.getByLabel('Tipo de selección',{exact:true}).press('ArrowDown');await page.locator('.ant-select-dropdown:visible').getByText('Porción del lote',{exact:true}).click();const area=drawer.getByRole('spinbutton');await area.fill('10');await area.press('Tab');
  await choose(page,'recipe_id','Mezcla nueva · Fumigación · Rastrojo · Maíz');
  await drawer.getByText('25 L',{exact:true}).waitFor();await drawer.getByText('0,15 kg',{exact:true}).waitFor();await drawer.getByText('2,5 L',{exact:true}).waitFor();
  await drawer.getByText('Supera disponible',{exact:true}).waitFor();await area.fill('15');await area.press('Tab');await drawer.getByText('37,5 L',{exact:true}).waitFor();
  await drawer.getByRole('textbox',{name:'Fecha',exact:true}).fill('15/10/2026');await drawer.getByRole('textbox',{name:'Fecha',exact:true}).press('Enter');
  await choose(page,'responsible_user','Responsable');
  await choose(page,'campaign_id','2026');
  const save=drawer.getByRole('button',{name:'Crear Planificación',exact:true});assert.equal(await save.isEnabled(),true);await save.click();
  await drawer.waitFor({state:'hidden'});
  const writes=await page.evaluate(()=>window.__planningRecipeWrites);assert.equal(writes.length,1);assert.equal(writes[0].path,'/planning');
  assert.equal(writes[0].body.recipe_id,'fresh');assert.equal(writes[0].body.lot_selections[0].effective_area_ha,15);
  assert.ok(!Object.hasOwn(writes[0].body,'products'));assert.ok(!Object.hasOwn(writes[0].body,'recipe_name_snapshot'));
});
test('mobile preview and saved detail fit; performed mode shows real quantities and fits mobile',async t=>{
  const page=await open(390);t.after(()=>page.close());await page.locator('.gs-planning button[aria-label^="Ver detalle"]').first().click();
  await page.getByText('Nombre guardado',{exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.locator('.ant-drawer-open').getByRole('button',{name:/Close|Cerrar/}).click();
  await page.getByRole('button',{name:'Nueva planificacion',exact:true}).click();await choose(page,'activity_type','Fumigación');await choose(page,'field_context','Rastrojo');await choose(page,'crop_id','Maíz');
  await choose(page,'lot_selection_keys','Lote de prueba · 25 ha');await page.locator('.planning-form-modal').getByText('Ubicación',{exact:true}).click();await choose(page,'recipe_id','Mezcla nueva · Fumigación · Rastrojo · Maíz');
  await page.locator('.planning-recipe-preview').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.getByText('Ya realizada',{exact:true}).click();await page.getByRole('region',{name:'Productos utilizados'}).waitFor();
  const real=page.getByRole('spinbutton',{name:'Cantidad realmente utilizada'});assert.equal(await real.count(),3);
  assert.ok((await real.first().inputValue()).includes('62'));await real.first().fill('24');await real.first().press('Tab');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await choose(page,'recipe_id','Sin receta / Carga manual');assert.equal(await page.locator('.planning-product-row').count(),0);assert.equal(await page.evaluate(()=>window.__planningRecipeWrites.length),0);
});

test('performed recipe payload confirms real amounts, resets on area change and preserves edits on metadata',async t=>{
 const page=await open();t.after(()=>page.close());await page.getByRole('button',{name:'Nueva Planificación',exact:true}).click();
 await choose(page,'activity_type','Fumigación');await page.getByText('Ya realizada',{exact:true}).click();await choose(page,'field_context','Rastrojo');await choose(page,'crop_id','Maíz');
 await choose(page,'lot_selection_keys','Lote de prueba · 25 ha');await page.locator('.planning-form-modal').getByText('Ubicación',{exact:true}).click();
 const drawer=page.locator('.planning-form-modal');await drawer.getByLabel('Tipo de selección',{exact:true}).press('ArrowDown');await page.locator('.ant-select-dropdown:visible').getByText('Porción del lote',{exact:true}).click();const area=drawer.getByRole('spinbutton').first();await area.fill('10');await area.press('Tab');
 await choose(page,'recipe_id','Mezcla nueva · Fumigación · Rastrojo · Maíz');const real=drawer.getByRole('spinbutton',{name:'Cantidad realmente utilizada'});await real.first().waitFor();
 assert.equal(Number((await real.first().inputValue()).replace(',','.')),25);await real.first().fill('24');await real.first().press('Tab');
 await choose(page,'responsible_user','Responsable');await drawer.getByRole('textbox',{name:'Observaciones',exact:true}).fill('Confirmación sintética');
 const date=drawer.locator('#effective_date');await date.fill('01/10/2026');await date.press('Tab');assert.equal(await real.first().inputValue(),'24');
 await area.fill('15');await area.press('Tab');await page.waitForFunction(()=>document.querySelector('[aria-label="Cantidad realmente utilizada"]').value.includes('37'));
 await choose(page,'recipe_id','Fuente renombrada · Fumigación · Rastrojo · Maíz');
 await page.waitForFunction(()=>document.querySelector('[aria-label="Cantidad realmente utilizada"]').value.includes('1485'));
 await choose(page,'recipe_id','Mezcla nueva · Fumigación · Rastrojo · Maíz');
 await page.waitForFunction(()=>document.querySelector('[aria-label="Cantidad realmente utilizada"]').value.includes('37'));
 await real.first().fill('24');await real.first().press('Tab');await choose(page,'campaign_id','2026');await choose(page,'economicTargets_0','Maíz');await drawer.getByRole('button',{name:'Registrar actividad',exact:true}).click();await drawer.waitFor({state:'hidden'});
 const writes=await page.evaluate(()=>window.__planningRecipeWrites);assert.equal(writes.length,1);assert.equal(writes[0].path,'/planning/register-completed');assert.equal(writes[0].body.economic.targets[0].beneficiary_crop_id,'crop');assert.equal(writes[0].body.recipe_id,'fresh');assert.ok(!Object.hasOwn(writes[0].body,'products'));assert.equal(writes[0].body.actual_products.length,3);assert.deepEqual(writes[0].body.actual_products[0],{product_id:'glifo',actual_amount:'24',unit:'L'});
});

test('future recipe completion modal shows saved name and dose and posts planning-product IDs',async t=>{
 const page=await open();t.after(()=>page.close());await page.locator('button[aria-label="Cambiar estado planificado"]').first().click();await page.getByText('Completar trabajo',{exact:true}).click();
 const modal=page.getByRole('dialog');await modal.getByText('Receta: Nombre guardado',{exact:true}).waitFor();await modal.getByText('Dosis: 2,5 L/ha',{exact:true}).waitFor();assert.match(await modal.innerText(),/Planificado:\s*25 L/);
 const real=modal.getByRole('spinbutton',{name:'Cantidad real',exact:true});assert.equal(Number((await real.inputValue()).replace(',','.')),25);await real.fill('24');await real.press('Tab');
 await choose(page,'economicTargets_0','Maíz');await modal.getByRole('button',{name:'Confirmar trabajo',exact:true}).click();await modal.waitFor({state:'hidden'});
 const writes=await page.evaluate(()=>window.__planningRecipeWrites);assert.equal(writes.length,1);assert.equal(writes[0].path,'/planning/plan/complete-work');assert.equal(writes[0].body.economic.targets[0].beneficiary_crop_id,'crop');assert.deepEqual(writes[0].body.actual_products[0],{planning_product_id:'pp',actual_amount:'24',unit:'L'});
});

async function chooseLabel(page,scope,label,value){
 const input=scope.getByLabel(label,{exact:true});await input.scrollIntoViewIfNeeded();await input.press('ArrowDown');
 await page.locator('.ant-select-dropdown:visible').getByText(value,{exact:true}).click();
}
for(const width of [1440,1024,390])test('redesigned registration modal, manual portion, quantities and fixed footer '+width,async t=>{
 const page=await open(width,false,true);t.after(()=>page.close());
 const reads=await page.evaluate(()=>window.__planningReads.length),url=page.url();
 const newButton=page.getByRole('button',{name:width===390?'Nueva planificacion':'Nueva Planificación',exact:true});
 await newButton.click();const modal=page.locator('.planning-form-modal');await modal.waitFor();
 await modal.getByRole('button',{name:'Cancelar',exact:true}).click();await modal.waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.__planningReads.length),reads);assert.equal(page.url(),url);
 await newButton.click();await choose(page,'activity_type','Fumigación');
 const sectionNames=await modal.locator('.planning-form-section').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));
 assert.deepEqual(sectionNames,['Trabajo','Contexto productivo','Ubicación','Recursos','Productos','Costo de la labor','Observaciones']);
 await choose(page,'campaign_id','2026');await choose(page,'field_context','Rastrojo');await choose(page,'crop_id','Maíz');
 assert.equal(await modal.getByLabel('Cultivo beneficiario',{exact:true}).count(),1);
 await choose(page,'lot_selection_keys','Lote completo · 25 ha');await modal.getByText('Ubicación',{exact:true}).click();
 await chooseLabel(page,modal,'Tipo de selección','Porción del lote');
 const area=modal.getByLabel('Superficie a trabajar',{exact:true});await area.fill('0');await area.press('Tab');
 await modal.getByText('Indicá una superficie mayor que cero, sin superar la superficie seleccionada.',{exact:true}).waitFor();
 await area.fill('26');await area.press('Tab');await modal.getByText('Indicá una superficie mayor que cero, sin superar la superficie seleccionada.',{exact:true}).waitFor();
 await area.fill('10');await area.press('Tab');await modal.getByText('Superficie seleccionada: 10,00 ha (40%)',{exact:false}).waitFor();
 await choose(page,'responsible_user','Responsable');
 await modal.getByRole('button',{name:'Agregar producto',exact:true}).click();await choose(page,'products_0_product_id','Glifosato');
 await modal.locator('[id="products_0_ui_dose"]').fill('2');await modal.locator('[id="products_0_ui_dose"]').press('Tab');
 await page.waitForFunction(()=>Number(document.querySelector('[id="products_0_amount"]').value.replace(',','.'))===20);
 await area.fill('15');await area.press('Tab');await page.waitForFunction(()=>Number(document.querySelector('[id="products_0_amount"]').value.replace(',','.'))===30);
 const row=modal.locator('.planning-form-product-row');
 assert.equal(await row.locator('.ant-select-selection-item svg').count(),0);
 for(const name of ['Editar','Eliminar']){const button=row.getByRole('button',{name,exact:true});assert.equal((await button.innerText()).trim(),'');assert.equal(await button.locator('svg').count(),1);}
 await row.getByRole('button',{name:'Editar',exact:true}).focus();await page.getByRole('tooltip',{name:'Editar',exact:true}).waitFor();
 await page.getByText('Ya realizada',{exact:true}).click();await choose(page,'economicTargets_0','Maíz');
 const cost=modal.getByRole('region',{name:'Costo de la labor',exact:true});await cost.getByLabel('Estado de la labor',{exact:true}).waitFor();
 assert.equal(await cost.getByLabel('Moneda de la labor',{exact:true}).count(),0);assert.equal(await cost.getByLabel('Tarifa real por ha',{exact:true}).count(),0);
 await chooseLabel(page,cost,'Estado de la labor','Confirmada');await cost.getByLabel('Tarifa real por ha',{exact:true}).waitFor();
 await chooseLabel(page,cost,'Estado de la labor','Pendiente');
 const date=modal.locator('#effective_date');await date.fill('01/10/2026');await date.press('Tab');
 await modal.locator('.ant-modal-body').evaluate(el=>el.scrollTop=el.scrollHeight);
 const geometry=await modal.evaluate(el=>{const content=el.querySelector('.ant-modal-content'),body=el.querySelector('.ant-modal-body'),footer=el.querySelector('.ant-modal-footer');return {height:content.getBoundingClientRect().height,viewport:innerHeight,overflow:body.scrollWidth>body.clientWidth+1,footer:footer.getBoundingClientRect().bottom};});
 assert(!geometry.overflow);assert(geometry.height<=geometry.viewport);assert(geometry.footer<=geometry.viewport);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(process.env.PLANNING_FORM_SCREENSHOTS){await modal.locator('.ant-modal-body').evaluate(el=>el.scrollTop=0);await page.screenshot({path:process.env.PLANNING_FORM_SCREENSHOTS+'/planning-form-'+width+'.png',animations:'disabled'});}
 await modal.getByRole('button',{name:'Registrar actividad',exact:true}).click();await modal.waitFor({state:'hidden'});
 const write=await page.evaluate(()=>window.__planningRecipeWrites.at(-1));assert.equal(write.path,'/planning/register-completed');
 assert.equal(write.body.campaign_id,'campaign');assert.deepEqual(write.body.lot_selections,[{lot_id:'lot',sub_lot_id:null,effective_area_ha:15,selection_mode:'manual_portion'}]);
 assert.equal(Number(write.body.products[0].amount),30);assert.equal(write.body.economic.labor.status,'pending');
});
test('full lot and sublot choices stay distinct; sowing cannot choose manual portion',async t=>{
 const page=await open(1440,false,true);t.after(()=>page.close());await page.getByRole('button',{name:'Nueva Planificación',exact:true}).click();
 const modal=page.locator('.planning-form-modal');await choose(page,'activity_type','Siembra');await choose(page,'lot_selection_keys','Lote completo · 25 ha');await modal.getByText('Ubicación',{exact:true}).click();
 await modal.getByLabel('Tipo de selección',{exact:true}).press('ArrowDown');await page.locator('.ant-select-dropdown:visible .ant-select-item-option-disabled').getByText('Porción del lote',{exact:true}).waitFor();
 await modal.getByText('Ubicación',{exact:true}).click();assert(await modal.getByLabel('Superficie a trabajar',{exact:true}).isDisabled());
 await modal.locator('.ant-select-selection-item-remove').first().click();await choose(page,'lot_selection_keys','Sector A · 10 ha');await modal.getByText('Ubicación',{exact:true}).click();
 await modal.getByText('Sublote existente',{exact:true}).waitFor();assert.equal(await modal.getByLabel('Superficie a trabajar',{exact:true}).inputValue(),'10');
});

test('editing a saved manual portion submits the same identity and updated operational area',async t=>{
 const page=await open();t.after(()=>page.close());await page.locator('.gs-planning button[aria-label^="Editar"]').first().click();
 const modal=page.locator('.planning-form-modal');await modal.getByText('Porción del lote',{exact:true}).waitFor();
 const area=modal.getByLabel('Superficie a trabajar',{exact:true});await area.fill('15');await area.press('Tab');
 await modal.getByRole('button',{name:'Actualizar',exact:true}).click();await modal.waitFor({state:'hidden'});
 const write=await page.evaluate(()=>window.__planningRecipeWrites.at(-1));assert.equal(write.method,'patch');assert.equal(write.path,'/planning/plan');
 assert.deepEqual(write.body.lot_selections,[{lot_id:'lot',sub_lot_id:null,selection_mode:'manual_portion',effective_area_ha:15}]);assert.equal(write.body.campaign_id,'campaign');
});
