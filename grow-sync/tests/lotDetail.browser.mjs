import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {createServer} from 'vite';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
let server,browser,origin;
before(async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 server=await createServer({root,configFile:false,cacheDir:'../.test-tools/vite-lot-detail',plugins:[{name:'lot-detail-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
  if(req.url.split('?')[0]!=='/')return next();res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/lotDetail.fixture.jsx"></script>');
 });}}],optimizeDeps:{entries:['tests/lotDetail.fixture.jsx'],include:['react','react-dom/client','react-router-dom','react/jsx-runtime','react/jsx-dev-runtime','antd','axios','dayjs','react-responsive','leaflet','react-leaflet','@ant-design/v5-patch-for-react-19','@hugeicons/react','@hugeicons/core-free-icons']},server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}}});
 await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();});
async function open(t,width=1440){
 const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error'&&!/^Warning: \[antd: (notification|Modal)\] Static function can not consume context/.test(msg.text()))errors.push(msg.text()+' '+JSON.stringify(msg.location()));});
 t.after(async()=>{await page.close();assert.deepEqual(errors,[],'no browser errors');});
 await page.route('**/*',route=>{
  if(route.request().url().startsWith(origin+'/'))return route.continue();
  if(route.request().resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8eee3"/></svg>'});
  return route.fulfill({contentType:'text/css',body:''});
 });
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Lote de prueba',exact:true}).waitFor({timeout:60000});
 await page.locator('.leaflet-tooltip').getByText('División A',{exact:true}).waitFor();
 await page.waitForFunction(()=>window.__lotRequests.some(r=>r.url==='/lots/lot/layouts/draft'));
 return page;
}
async function tab(page,name){await page.getByRole('tab',{name,exact:true}).click();assert.equal(await page.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true');await page.waitForFunction(()=>{const active=document.querySelector('.lot-detail-tabs .ant-tabs-tab-active').getBoundingClientRect(),ink=document.querySelector('.lot-detail-tabs .ant-tabs-ink-bar').getBoundingClientRect();return Math.abs((active.left+active.right)/2-(ink.left+ink.right)/2)<3;});}
async function select(page,label,text){await page.getByRole('combobox',{name:label,exact:true}).click();await page.locator('.ant-select-dropdown:visible').getByText(text,{exact:true}).click();}
async function noOverflow(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');}
for(const width of [1440,1024,390])test('lot detail responsive summary, activities and editor at '+width,async t=>{
 const page=await open(t,width);
 assert.equal(await page.getByRole('tab',{name:'Resumen',exact:true}).getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('.leaflet-container').count(),1);assert.equal(await page.locator('.lot-history-event').count(),5);
 await page.getByText('Rastrojo de Maíz',{exact:true}).waitFor();await page.getByText('46.353,89 kg',{exact:false}).waitFor();await page.getByText('126.462 kg',{exact:true}).waitFor();await page.getByText('4.683,79 kg/ha',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Dibujar sublote',exact:true}).count(),0);assert.equal(await page.evaluate(()=>Object.values(window.__lotMap._layers).filter(l=>l.pm?.enabled?.()).length),0);await page.getByRole('button',{name:'Centrar mapa',exact:true}).click();
 for(const name of ['Actualizar','Registrar cultivo','Nueva división'])await page.getByRole('button',{name,exact:true}).waitFor();
 const left=await page.locator('.lot-detail-map-column').boundingBox(),right=await page.locator('.lot-detail-summary-column').boundingBox();
 if(width>767){assert.ok(right.x>left.x+left.width);assert.ok(Math.abs(left.y-right.y)<2);}else assert.ok(right.y>=left.y+left.height);
 await noOverflow(page);
 if(process.env.LOT_DETAIL_SCREENSHOTS)await page.screenshot({path:process.env.LOT_DETAIL_SCREENSHOTS+'/lot-summary-'+width+'.png',fullPage:true});
 await page.evaluate(()=>{window.__initialMap=document.querySelector('.leaflet-container');});
 await page.getByRole('button',{name:/Ver todas las actividades/}).click();assert.equal(await page.locator('.lot-history-event').count(),7);
 assert.equal(await page.getByRole('tab',{name:'Actividades',exact:true}).getAttribute('aria-selected'),'true');
 await select(page,'Filtrar por tipo de actividad','Fumigación');assert.equal(await page.locator('.lot-history-event').count(),1);await page.getByText('Aplicación registrada',{exact:true}).waitFor();
 await noOverflow(page);await tab(page,'Divisiones');await page.getByRole('button',{name:'Dibujar sublote',exact:true}).waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Dibujar sublote')&&!b.disabled));
 assert.ok(await page.evaluate(()=>document.querySelector('.leaflet-container')===window.__initialMap));await page.waitForFunction(()=>Object.values(window.__lotMap._layers).filter(l=>l.pm?.enabled?.()).length===2);
 await page.locator('.sub-lot-editor input').first().fill('Nombre pendiente');
 await tab(page,'Resumen');await page.locator('.leaflet-tooltip').getByText('División A',{exact:true}).waitFor();assert.equal(await page.locator('.leaflet-tooltip').getByText('Nombre pendiente',{exact:true}).count(),0);
 await tab(page,'Divisiones');assert.equal(await page.locator('.sub-lot-editor input').first().inputValue(),'Nombre pendiente');
 await page.getByRole('button',{name:'Guardar cambios',exact:true}).waitFor();await noOverflow(page);
 if(process.env.LOT_DETAIL_SCREENSHOTS)await page.screenshot({path:process.env.LOT_DETAIL_SCREENSHOTS+'/lot-divisions-'+width+'.png',fullPage:true});
 await tab(page,'Análisis de suelo');await page.getByRole('button',{name:'Cargar análisis',exact:true}).waitFor();await noOverflow(page);
 assert.equal(await page.evaluate(()=>window.__lotWrites.length),0);
});
test('division save keeps geometry and payload; validation, activation and new draft use existing actions',async t=>{
 const page=await open(t);await tab(page,'Divisiones');await page.locator('.sub-lot-editor input').first().fill('Nombre editado');
 await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
 await page.waitForFunction(()=>window.__lotWrites.some(w=>w.method==='put'));await page.getByRole('button',{name:'Comprobar división',exact:true}).waitFor();
 const {write,original}=await page.evaluate(()=>({write:window.__lotWrites.find(w=>w.method==='put'),original:window.__lotOriginal[1].sub_lots}));
 assert.equal(write.url,'/lots/lot/layouts/draft/sub-lots');assert.deepEqual(Object.keys(write.body),['subLots']);assert.equal(write.body.subLots.length,2);
 assert.equal(write.body.subLots[0].name,'Nombre editado');write.body.subLots.forEach((s,i)=>assert.deepEqual(s.geom,original[i].geom));
 await page.getByRole('button',{name:'Comprobar división',exact:true}).click();await page.getByRole('button',{name:'Activar división',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Activar división',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await tab(page,'Resumen');await page.getByText('V3 · Activa',{exact:true}).waitFor();await page.locator('.leaflet-tooltip').getByText('Nombre editado',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Nueva división',exact:true}).click();await page.getByText('Versión 4',{exact:true}).first().waitFor();assert.equal(await page.getByRole('tab',{name:'Divisiones',exact:true}).getAttribute('aria-selected'),'true');
 assert.deepEqual((await page.evaluate(()=>window.__lotWrites)).map(w=>w.url),['/lots/lot/layouts/draft/sub-lots','/lots/lot/layouts/draft/validate','/lots/lot/layouts/draft/activate','/lots/lot/layouts']);
});
test('crop action, local filters, refresh and guarded back navigation remain available',async t=>{
 const page=await open(t);await page.getByRole('button',{name:'Registrar cultivo',exact:true}).click();await page.getByRole('dialog').getByLabel('Cultivo',{exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click();
 await tab(page,'Actividades');const reads=await page.evaluate(()=>window.__lotRequests.length);await select(page,'Filtrar por campaña','2025/26');assert.equal(await page.locator('.lot-history-event').count(),1);await page.getByText('Cultivo: Trigo',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__lotRequests.length),reads);
 await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.waitForFunction(n=>window.__lotRequests.length>n,reads);
 await tab(page,'Divisiones');await page.locator('.sub-lot-editor input').first().fill('No perder');await page.getByRole('button',{name:'Volver a Lotes',exact:true}).click();
 const modal=page.getByRole('dialog');await modal.waitFor();await modal.getByRole('button',{name:'Seguir editando'}).click();assert.equal(await page.locator('.sub-lot-editor input').first().inputValue(),'No perder');assert.equal(await page.evaluate(()=>window.__lotWrites.length),0);
});
