import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import conversion from '../vite/inventoryConversionPlugin.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
let server,browser,origin;
const id='11111111-1111-4111-8111-000000000001';
before(async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  server=await createServer({root,configFile:false,plugins:[conversion(),{name:'estimate-fixture',configureServer(s){
    s.middlewares.use((req,res,next)=>{
      if(req.url.split('?')[0]!=='/planificaciones')return next();
      res.setHeader('Content-Type','text/html');
      res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/planningList.fixture.jsx"></script>');
    });
  }}],cacheDir:join(tmpdir(),'growsync-cost-estimate-vite'),server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}},
    optimizeDeps:{entries:['tests/planningList.fixture.jsx'],include:['react','react-dom/client','react-router-dom','react/jsx-runtime','react/jsx-dev-runtime','antd','axios','dayjs','react-responsive','leaflet','react-leaflet','@ant-design/v5-patch-for-react-19','@hugeicons/react','@hugeicons/core-free-icons']}});
  await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();});
const section=page=>page.getByRole('region',{name:'Costo estimado',exact:true});
const drawer=page=>page.locator('.planning-detail-drawer');
async function open(t,width=1440,mode='complete') {
  const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce'});
  t.after(()=>page.close());page.setDefaultTimeout(20000);
  await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await page.goto(origin+'/planificaciones?cost='+mode+'&planningId='+id,{waitUntil:'domcontentloaded',timeout:60000});
  await drawer(page).getByText('Responsable',{exact:true}).waitFor({timeout:60000});
  return page;
}
for(const width of [1440,1024,390])test('detail simulates labor, resets on close, never writes; responsive '+width,async t=>{
  const page=await open(t,width),cost=section(page);
  await cost.getByText('Estimación completa de insumos',{exact:true}).waitFor();
  await cost.getByLabel('Tarifa estimada de labor · USD / ha',{exact:true}).fill('6');
  await page.waitForFunction(()=>document.querySelector('[data-testid="estimate-total"]')?.textContent==='USD 1.243,40');
  assert.equal(await cost.getByTestId('estimate-per-ha').innerText(),'USD 13,37');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert(await cost.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
  const keys=await page.evaluate(()=>Object.keys(localStorage).sort());
  await drawer(page).getByRole('button',{name:/Close|Cerrar/}).click();
  await drawer(page).waitFor({state:'hidden'});
  await page.evaluate(id=>window.__navigate('/planificaciones?cost=complete&planningId='+id),id);
  await cost.getByText('Total estimado (sin labor)',{exact:true}).waitFor();
  assert.equal(await cost.getByLabel('Tarifa estimada de labor · USD / ha',{exact:true}).inputValue(),'');
  assert.deepEqual(await page.evaluate(()=>window.__mutations),[]);
  assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).sort()),keys);
});
test('partial estimate keeps warnings, subtotal and suppresses complete total/per-ha',async t=>{
  const page=await open(t,390,'partial'),cost=section(page);
  await cost.getByText('Estimación parcial',{exact:true}).waitFor();
  await cost.getByText('50 L sin stock disponible actualmente',{exact:true}).waitFor();
  await cost.getByLabel('Tarifa estimada de labor · USD / ha',{exact:true}).fill('6');
  assert.equal(await cost.getByText('Total estimado',{exact:true}).count(),0);
  assert.equal(await cost.getByTestId('estimate-per-ha').count(),0);
  await cost.getByText('Subtotal conocido',{exact:true}).waitFor();
});
test('unknown prices remain pending and never produce a complete zero total',async t=>{
  const page=await open(t,1024,'unavailable'),cost=section(page);
  await cost.getByText('Estimación no disponible',{exact:true}).waitFor();
  await cost.getByText('200 L con costo pendiente',{exact:true}).waitFor();
  assert.equal(await cost.getByText('Total estimado (sin labor)',{exact:true}).count(),0);
  assert.equal(await cost.getByTestId('estimate-per-ha').count(),0);
});
for(const mode of ['denied','completed'])test('no estimate rendered or requested for '+mode,async t=>{
  const page=await open(t,1440,mode);
  assert.equal(await section(page).count(),0);
  assert.equal(await page.evaluate(()=>window.__requests.filter(r=>r.path.endsWith('/cost-estimate')).length),0);
});
test('refresh uses a new read; failures do not retain stale totals',async t=>{
  const page=await open(t),cost=section(page);
  await cost.getByText('Estimación completa de insumos',{exact:true}).waitFor();
  await page.evaluate(()=>{window.__costEstimate.known_products_cost_usd='700.000000';});
  await cost.getByRole('button',{name:'Actualizar estimación',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="estimate-total"]')?.textContent==='USD 700,00');
  await page.evaluate(()=>{window.__costFail=true;});
  await cost.getByRole('button',{name:'Actualizar estimación',exact:true}).click();
  await cost.getByRole('button',{name:'Reintentar',exact:true}).waitFor();
  assert.equal(await cost.getByTestId('estimate-total').count(),0);
  await page.evaluate(()=>{window.__costFail=false;});
  await cost.getByRole('button',{name:'Reintentar',exact:true}).click();
  await cost.getByText('Total estimado (sin labor)',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__requests.filter(r=>r.path.endsWith('/cost-estimate')).length),4);
  assert.deepEqual(await page.evaluate(()=>window.__mutations),[]);
});
