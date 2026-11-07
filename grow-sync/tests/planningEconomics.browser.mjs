import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {realpathSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import conversion from '../vite/inventoryConversionPlugin.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
let server,browser,origin;
const id='11111111-1111-4111-8111-000000000021';
before(async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 server=await createServer({root,configFile:false,plugins:[conversion(),{name:'economic-fixture',configureServer(s){
  s.middlewares.use((req,res,next)=>{if(req.url.split('?')[0]!=='/planificaciones')return next();
   res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/planningList.fixture.jsx"></script>');});
 }}],cacheDir:join(tmpdir(),'growsync-economic-browser'),server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}},
 optimizeDeps:{entries:[],include:['react','react-dom/client','react-router-dom','react/jsx-runtime','react/jsx-dev-runtime','antd','axios','dayjs','dayjs/plugin/isBetween','dayjs/plugin/customParseFormat.js','react-responsive','leaflet','react-leaflet','@ant-design/v5-patch-for-react-19','@hugeicons/react','@hugeicons/core-free-icons',
  ...[...readFileSync(new URL('../src/components/AppIcons.jsx',import.meta.url),'utf8').matchAll(/['"](@phosphor-icons\/react\/dist\/csr\/[^'"]+)['"]/g)].map(m=>m[1])] }});
 await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();});
const drawer=p=>p.locator('.planning-detail-drawer');
const actual=p=>p.getByRole('region',{name:'Costo real',exact:true});
const lists=p=>p.evaluate(()=>window.__requests.filter(r=>r.path==='/planning').length);
async function open(t,width=1440,mode='complete'){
 const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce'});t.after(()=>page.close());page.setDefaultTimeout(20000);
 await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await page.goto(origin+'/planificaciones?economic='+mode+'&page=2&pageSize=20&search=Trabajo',{waitUntil:'domcontentloaded',timeout:60000});
 await page.locator('.gs-planning-results[aria-busy="false"]').waitFor({timeout:60000});
 await page.waitForFunction(()=>window.__requests?.some(r=>r.path==='/planning'&&r.response?.data?.length===20));
 await page.locator('.gs-shell-scroll').evaluate(el=>el.scrollTop=Math.min(300,el.scrollHeight-el.clientHeight));
 const scroll=await page.locator('.gs-shell-scroll').evaluate(el=>el.scrollTop);
 await page.evaluate(id=>{const url=new URL(location.href);url.searchParams.set('planningId',id);window.__navigate(url.pathname+url.search);},id);
 await drawer(page).getByText('Responsable',{exact:true}).waitFor();
 return {page,scroll};
}
async function select(page,scope,label,value){
 const input=scope.getByLabel(label,{exact:true});
 await input.scrollIntoViewIfNeeded();await input.press('ArrowDown');
 const controls=await input.getAttribute('aria-controls');
 const popup=page.locator('.ant-select-dropdown').filter({has:page.locator('[id="'+controls+'"]')});
 await popup.waitFor({state:'visible'});
 const labels=await popup.locator('.ant-select-item-option-content').allTextContents();
 const index=labels.indexOf(value);assert(index>=0,'expected option '+value);
 // Select the observed option directly; keyboard navigation can race the popup's initial active option.
 await popup.locator('.ant-select-item-option-content').nth(index).click();
 await popup.waitFor({state:'hidden'});
}

async function start(page){
 await drawer(page).getByRole('button',{name:/^Completar/}).click();
 const modal=page.getByRole('dialog',{name:/^Completar/});
 await modal.getByRole('region',{name:'Resumen económico de ejecución'}).waitFor();return modal;
}
async function confirm(page,modal){
 await modal.getByRole('button',{name:'Confirmar trabajo',exact:true}).click();await modal.waitFor({state:'hidden'});
 await actual(page).locator('[data-testid="actual-cost-total"]').waitFor();
 await page.waitForFunction(()=>document.querySelector('.gs-planning-results[aria-busy="false"]'));
}
async function fits(page,scope){
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert(await scope.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
}
for(const width of [1440,1024,390])test('complete execution, USD labor, historical cost and list state at '+width,async t=>{
 const {page,scroll}=await open(t,width),modal=await start(page);
 await select(page,modal,'Estado de la labor','Confirmada');await select(page,modal,'Moneda de la labor','USD');
 await modal.getByLabel('Tarifa real por ha',{exact:true}).fill('6');await fits(page,modal);
 await confirm(page,modal);
 assert.equal(await actual(page).getByTestId('actual-cost-total').innerText(),'USD 744,00');
 assert.equal(await actual(page).getByTestId('actual-cost-per-ha').innerText(),'USD 8,00');
 const count=await lists(page);
 await actual(page).getByRole('button',{name:'Ver detalle económico',exact:true}).click();
 await actual(page).getByText('Prorrateado por superficie. No representa consumo medido por lote.',{exact:true}).waitFor();
 await actual(page).getByText('Glifosato',{exact:true}).waitFor();
 await actual(page).getByRole('button',{name:'Ver historial económico',exact:true}).click();
 await actual(page).locator('summary').waitFor();assert.equal(await lists(page),count);
 await fits(page,drawer(page).locator('.ant-drawer-body'));
 const writes=await page.evaluate(()=>window.__mutations);assert.equal(writes.length,1);assert.equal(writes[0].body.economic.labor.currency,'USD');
 await drawer(page).getByRole('button',{name:/Close|Cerrar/}).click();await drawer(page).waitFor({state:'hidden'});
 const url=new URL(page.url());assert.equal(url.searchParams.get('page'),'2');assert.equal(url.searchParams.get('search'),'Trabajo');assert.equal(url.searchParams.get('pageSize'),'20');
 assert.equal(await lists(page),count);
 assert(Math.abs(await page.locator('.gs-shell-scroll').evaluate(el=>el.scrollTop)-scroll)<=1);
});
test('missing batch price and pending labor allow completion without a complete total or per-ha',async t=>{
 const {page}=await open(t,390,'partial'),modal=await start(page);await confirm(page,modal);
 await actual(page).getByText('Costo económico parcial',{exact:true}).waitFor();
 await actual(page).getByText('1 partida(s) con costo pendiente.',{exact:true}).waitFor();
 assert.equal(await actual(page).getByText('Costo real total',{exact:true}).count(),0);assert.equal(await actual(page).getByTestId('actual-cost-per-ha').count(),0);
 assert.equal(await page.evaluate(()=>window.__mutations.length),1);
});
test('stubble requires explicit beneficiaries; soy economic target does not replace agronomic maize',async t=>{
 const {page}=await open(t,1024,'stubble'),modal=await start(page);
 await modal.getByRole('button',{name:'Confirmar trabajo',exact:true}).click();
 await modal.getByText('Seleccioná el cultivo beneficiario.',{exact:true}).first().waitFor();
 assert.equal(await page.evaluate(()=>window.__mutations.length),0);
 await select(page,modal,'Cultivo beneficiario · Lote A','Soja');await select(page,modal,'Cultivo beneficiario · Lote B','Soja');
 await confirm(page,modal);
 assert.deepEqual(await page.evaluate(()=>window.__mutations[0].body.economic.targets.map(t=>t.beneficiary_crop_id)),['soy','soy']);
 await actual(page).getByRole('button',{name:'Ver detalle económico'}).click();await actual(page).getByText(/Lote A · Soja/).waitFor();
});
test('ARS confirmation needs payment-date FX and source; saves manual evidence',async t=>{
 const {page}=await open(t,390),modal=await start(page);
 await select(page,modal,'Estado de la labor','Confirmada');await select(page,modal,'Moneda de la labor','ARS');
 await modal.getByLabel('Tarifa real por ha',{exact:true}).fill('6000');await modal.getByRole('button',{name:'Confirmar trabajo',exact:true}).click();
 await modal.getByText('ARS requiere fecha de pago.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__mutations.length),0);
 for(const label of ['Fecha de pago','Fecha de cotización']){await modal.getByLabel(label,{exact:true}).fill('05/11/2026');await modal.getByLabel(label,{exact:true}).press('Enter');}
 await modal.getByLabel('Cotización · ARS por USD',{exact:true}).fill('1000');await modal.getByLabel('Fuente de la cotización',{exact:true}).fill('Comprobante mayorista');
 await fits(page,modal);await confirm(page,modal);
 assert.equal(await actual(page).getByTestId('actual-cost-total').innerText(),'USD 744,00');
 const body=await page.evaluate(()=>window.__mutations[0].body.economic.labor);
 assert.equal(body.payment_date,'2026-11-05');assert.equal(body.fx_date,body.payment_date);assert.equal(body.fx_source,'Comprobante mayorista');
});
test('revision resolves pending information and history preserves previous subtotal without list GET',async t=>{
 const {page}=await open(t,1440,'partial'),modal=await start(page);await confirm(page,modal);
 const count=await lists(page);
 await page.evaluate(()=>window.__invoiceAvailable=true);
 await actual(page).getByRole('button',{name:'Revisar costo económico'}).click();
 const revision=page.getByRole('dialog',{name:'Revisar costo económico',exact:true});
 await select(page,revision,'Estado de la labor','Confirmada');await select(page,revision,'Moneda de la labor','USD');
 await revision.getByLabel('Tarifa real por ha',{exact:true}).fill('6');
 await revision.getByLabel('Motivo de la revisión',{exact:true}).fill('Factura recibida');
 await revision.getByRole('button',{name:'Guardar revisión',exact:true}).click();await revision.waitFor({state:'hidden'});
 await actual(page).getByText('Estado económico: Completo',{exact:true}).waitFor();
 assert.equal(await actual(page).getByTestId('actual-cost-total').innerText(),'USD 744,00');
 assert.equal(await lists(page),count);
 await actual(page).getByRole('button',{name:'Ver historial económico'}).click();await actual(page).getByText('Revisión 1 · Pendiente · Ejecución original',{exact:true}).waitFor();
 const writes=await page.evaluate(()=>window.__mutations);assert.equal(writes.length,2);assert(writes[1].headers['Idempotency-Key']);
});
for(const mode of ['readonly','denied'])test('economic permissions '+mode,async t=>{
 const {page}=await open(t,1024,mode);
 if(mode==='denied'){assert.equal(await actual(page).count(),0);assert.equal(await page.evaluate(()=>window.__requests.filter(r=>r.path.includes('/economics')).length),0);}
 else {await actual(page).getByText('Costo real total',{exact:true}).waitFor();assert.equal(await actual(page).getByRole('button',{name:'Revisar costo económico'}).count(),0);}
});
test('economic error stays inside detail; retry does not reload list',async t=>{
 const {page}=await open(t,390,'error'),count=await lists(page);
 await actual(page).getByRole('button',{name:'Reintentar costo real'}).waitFor();
 await drawer(page).getByText('Responsable',{exact:true}).waitFor();
 await page.evaluate(()=>window.__economicFail=false);await actual(page).getByRole('button',{name:'Reintentar costo real'}).click();
 await actual(page).getByText('Costo real total',{exact:true}).waitFor();assert.equal(await lists(page),count);
});


test('history loads older revisions without refetching the Planning list',async t=>{
 const {page}=await open(t,1440,'existing'),count=await lists(page);
 await actual(page).getByText('Costo real total',{exact:true}).waitFor();
 await page.evaluate(id=>{
  const first=window.__economicHistory[id][0];
  window.__economicHistory[id]=Array.from({length:30},(_,i)=>({...structuredClone(first),snapshot:{...first.snapshot,id:'revision-'+i,revision:30-i,reason:'Historial '+(30-i)}}));
 },id);
 await actual(page).getByRole('button',{name:'Ver historial económico',exact:true}).click();
 await actual(page).getByRole('button',{name:'Cargar revisiones anteriores',exact:true}).waitFor();
 assert.equal(await actual(page).locator('summary').count(),25);
 await actual(page).getByRole('button',{name:'Cargar revisiones anteriores',exact:true}).click();
 await actual(page).getByText('Revisión 1 · Completo · Historial 1',{exact:true}).waitFor();
 assert.equal(await actual(page).locator('summary').count(),30);assert.equal(await lists(page),count);
 assert.equal(await actual(page).getByRole('button',{name:'Cargar revisiones anteriores',exact:true}).count(),0);
});
