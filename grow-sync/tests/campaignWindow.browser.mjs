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
  server=await createServer({root,configFile:false,plugins:[conversion(),{name:'campaign-window-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
    if(req.url.split('?')[0]!=='/')return next();res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/campaignWindow.fixture.jsx"></script>');
  });}}],cacheDir:'../.test-tools/vite-campaign-window',server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}},
    optimizeDeps:{entries:[],include:['react','react-dom/client','react-router-dom','react/jsx-runtime','react/jsx-dev-runtime','antd','axios','dayjs','react-responsive','leaflet','react-leaflet','@ant-design/v5-patch-for-react-19','@hugeicons/react','@hugeicons/core-free-icons']}});
  await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}`;browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();});

async function open(width,query='') {
 const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce',timezoneId:'America/Argentina/Buenos_Aires'});
 page.setDefaultTimeout(15000);
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 await page.goto(origin+'/'+query,{waitUntil:'domcontentloaded',timeout:60000});
 try{await page.locator('.gs-planning').waitFor({timeout:15000});}
 catch{await page.reload({waitUntil:'domcontentloaded'});await page.locator('.gs-planning').waitFor({timeout:60000});}
 await page.waitForFunction(()=>document.querySelector('.gs-planning-results[aria-busy="false"]'));
 return page;
}
const drawer=page=>page.locator('.ant-drawer-open');
async function choose(page,id,label) {
 const input=drawer(page).locator('#'+id);await input.scrollIntoViewIfNeeded();await input.focus();await input.press('ArrowDown');
 await page.locator('.ant-select-dropdown:visible').getByText(label,{exact:true}).click();
}
async function setDate(page,date) {
 const input=drawer(page).getByRole('textbox',{name:'Fecha',exact:true});
 await input.fill(date);await input.press('Tab');
 await page.waitForFunction(value=>document.querySelector('[aria-label="Fecha"]').value===value,date);
}
async function createForm(page,width) {
 await page.getByRole('button',{name:width===390?'Nueva planificacion':'Nueva Planificación',exact:true}).click();
 await choose(page,'activity_type','Siembra');
 await setDate(page,'20/10/2026');
}
const selected=page=>drawer(page).locator('#campaign_id').locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]');
async function fits(page) {
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.ok(await drawer(page).locator('.ant-drawer-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
}
for(const width of [1440,1024,390]) {
 test('explicit October sowing, overlap, ordering and retained selection at '+width,async t=>{
  const page=await open(width);t.after(()=>page.close());await createForm(page,width);
  assert.doesNotMatch(await selected(page).innerText(),/Gruesa|Otra compatible/);
  await drawer(page).locator('#campaign_id').focus();await drawer(page).locator('#campaign_id').press('ArrowDown');
  const options=page.locator('.ant-select-dropdown:visible .ant-select-item-option');
  await options.first().waitFor();
  const labels=await options.allTextContents();
  assert.equal(labels.length,3);assert.match(labels[0],/Gruesa/);assert.match(labels[1],/Otra compatible/);assert.match(labels[2],/Campaña posterior/);
  assert.match(labels[0],/Oficial: 01\/11\/2026 – 30\/06\/2027/);
  assert.match(labels[0],/Trabajos: 30\/07\/2026 – 31\/07\/2027/);
  await options.filter({hasText:'Otra compatible'}).click();
  await choose(page,'crop_id','Maíz');await choose(page,'lot_selection_keys','Lote de prueba · 25 ha');
  await drawer(page).getByText('Ubicación',{exact:true}).click();await choose(page,'responsible_user','Responsable');

  await setDate(page,'01/08/2027');
  assert.match(await selected(page).innerText(),/Otra compatible/);
  await drawer(page).getByText('La fecha seleccionada está fuera de la ventana operativa de Otra compatible.',{exact:true}).waitFor();
  await drawer(page).getByRole('button',{name:'Crear Planificación',exact:true}).click();
  await drawer(page).locator('.ant-form-item-explain-error').filter({hasText:'fuera de la ventana operativa'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__campaignWrites.length),0);
  await setDate(page,'20/10/2026');assert.match(await selected(page).innerText(),/Otra compatible/);
  await choose(page,'campaign_id','Gruesa 2026-2027');
  await fits(page);
  await drawer(page).getByRole('button',{name:'Crear Planificación',exact:true}).click();
  await page.waitForFunction(()=>window.__campaignWrites.length===1);
  const [write]=await page.evaluate(()=>window.__campaignWrites);
  assert.equal(write.path,'/planning');assert.equal(write.body.campaign_id,'gruesa');
  assert.equal(write.body.start_at,'2026-10-20T00:00:00.000Z');assert.equal(write.body.activity_type,'siembra');
 });
 test('sole compatible campaign is never auto-selected at '+width,async t=>{
  const page=await open(width,'?single=1');t.after(()=>page.close());await createForm(page,width);
  assert.doesNotMatch(await selected(page).innerText(),/Gruesa/);
  await setDate(page,'21/10/2026');assert.doesNotMatch(await selected(page).innerText(),/Gruesa/);
  await choose(page,'campaign_id','Gruesa 2026-2027');await setDate(page,'29/07/2026');
  assert.match(await selected(page).innerText(),/Gruesa/);await fits(page);
 });
 test('existing incompatible campaign stays selected, warns, and allows metadata edit at '+width,async t=>{
  const page=await open(width);t.after(()=>page.close());
  await page.locator('.gs-planning button[aria-label^="Editar"]').first().click();
  assert.match(await selected(page).innerText(),/Gruesa/);
  await drawer(page).getByText('La fecha seleccionada está fuera de la ventana operativa de Gruesa 2026-2027.',{exact:true}).waitFor();
  await drawer(page).getByRole('textbox',{name:'Descripción',exact:true}).fill('Revisión sin alterar fecha');
  await fits(page);
  await drawer(page).getByRole('button',{name:'Actualizar',exact:true}).click();
  await page.waitForFunction(()=>window.__campaignWrites.length===1);
  const [write]=await page.evaluate(()=>window.__campaignWrites);
  assert.equal(write.body.campaign_id,'gruesa');assert.equal(write.body.description,'Revisión sin alterar fecha');
  assert.equal(Object.hasOwn(write.body,'start_at'),false);assert.equal(Object.hasOwn(write.body,'end_at'),false);
 });
}

test('register completed sowing October 20 selects the same operational window',async t=>{
 const page=await open(1440);t.after(()=>page.close());await createForm(page,1440);
 await page.getByText('Ya realizada',{exact:true}).click();
 const date=drawer(page).locator('#effective_date');await date.fill('20/10/2026');await date.press('Tab');
 await choose(page,'campaign_id','Gruesa 2026-2027');await choose(page,'crop_id','Maíz');
 await choose(page,'lot_selection_keys','Lote de prueba · 25 ha');await drawer(page).getByText('Ubicación',{exact:true}).click();
 await choose(page,'responsible_user','Responsable');
 await drawer(page).getByRole('button',{name:'Registrar actividad',exact:true}).click();
 await page.waitForFunction(()=>window.__campaignWrites.length===1);
 const [write]=await page.evaluate(()=>window.__campaignWrites);
 assert.equal(write.path,'/planning/register-completed');assert.equal(write.body.campaign_id,'gruesa');assert.equal(write.body.effective_date,'2026-10-20');
});
