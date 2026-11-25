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
 server=await createServer({root,configFile:false,cacheDir:process.env.TEMP+'/growsync-vite-lot-geometry',plugins:[{name:'lot-geometry-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
  if(req.url.split('?')[0]!=='/')return next();res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/lotGeometry.fixture.jsx"></script>');
 });}}],optimizeDeps:{entries:['tests/lotGeometry.fixture.jsx'],include:['react','react-dom/client','react-router-dom','react/jsx-runtime','react/jsx-dev-runtime','antd','axios','dayjs','react-responsive','leaflet','react-leaflet','@ant-design/v5-patch-for-react-19','@hugeicons/react','@hugeicons/core-free-icons']},server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root+'/..',realpathSync(root+'/node_modules')]}}});
 await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;browser=await chromium.launch({channel:'msedge',headless:true});
});
after(async()=>{await browser?.close();await server?.close();});
async function open(t,width=1440){
 const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 t.after(async()=>{await page.close();assert.deepEqual(errors,[]);});
 await page.route('**/*',route=>{
  if(route.request().url().startsWith(origin+'/'))return route.continue();
  return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8eee3"/></svg>'});
 });
 await page.goto(origin,{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('button',{name:'Nuevo lote',exact:true}).waitFor({timeout:60000});
 return page;
}
async function quickEdit(page,name){
 // Use the real list action, not a fixture shortcut to open the drawer.
 await page.getByText('Lista',{exact:true}).click();
 const row=page.getByRole('row').filter({hasText:name});
 await row.getByRole('button',{name:/Acciones/}).click();
 await page.getByRole('menuitem',{name:'Editar lote',exact:true}).click();
 await page.getByRole('textbox',{name:'Nombre del Lote'}).waitFor();
}
async function editor(page){
 await page.getByRole('button',{name:'Seleccionar ubicación en el mapa',exact:true}).click();
 await page.locator('.ant-drawer:visible .leaflet-pm-icon-polygon').waitFor();
 await page.locator('.ant-drawer:visible .leaflet-pm-icon-edit').waitFor();
 await page.waitForFunction(()=>Boolean(window.__lastLotMap?.pm));
}
async function draw(page){
 const map=page.locator('.ant-drawer:visible .leaflet-container');
 await page.locator('.ant-drawer:visible .leaflet-pm-icon-polygon').click();
 const box=await map.boundingBox();
 const points=[[.25,.3],[.65,.3],[.65,.65],[.25,.65],[.25,.3]];
 for(const [x,y] of points) await map.click({position:{x:box.width*x,y:box.height*y}});
 await page.getByRole('button',{name:'Listo',exact:true}).click();
}
for(const width of [1440,1024,390])test('create requires polygon; real drawing and read-only area at '+width,async t=>{
 const page=await open(t,width);
 await page.getByRole('button',{name:'Nuevo lote',exact:true}).click();
 await page.getByRole('textbox',{name:'Nombre del Lote'}).fill('Nuevo sintético');
 assert.equal(await page.getByRole('spinbutton').count(),0);
 assert.equal(await page.getByRole('button',{name:'Guardar Lote',exact:true}).isDisabled(),true);
 await page.getByText('Superficie: pendiente de dibujar',{exact:true}).waitFor();
 await editor(page);await draw(page);
 await page.waitForFunction(()=>document.querySelector('output')?.textContent.includes('Superficie estimada:'));
 assert.equal(await page.getByRole('button',{name:'Guardar Lote',exact:true}).isEnabled(),true);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const estimate=await page.locator('output').textContent();
 const reads=await page.evaluate(()=>window.__lotReads);
 await page.getByRole('button',{name:'Guardar Lote',exact:true}).click();
 await page.waitForFunction(()=>window.__lotWrites.length===1);
 const body=await page.evaluate(()=>window.__lotWrites[0].body);
 assert.equal(JSON.parse(body.location).type,'Polygon');assert.equal(Object.hasOwn(body,'area'),false);
 await page.waitForFunction(previous=>window.__lotReads>previous,reads);
 await page.getByText('Lista',{exact:true}).click();
 const row=width===390?page.locator('.gs-ui-records > li').filter({hasText:'Nuevo sintético'}):page.getByRole('row').filter({hasText:'Nuevo sintético'});
 await row.getByText(/128,69 ha/).waitFor();
 assert.doesNotMatch(await row.textContent(),/999 ha/);
 // Reopen via the actual actions on every viewport; no stale Turf value survives saving.
 await page.getByRole('button',{name:'Acciones de Nuevo sintético',exact:true}).click();
 await page.getByRole('menuitem',{name:'Editar lote',exact:true}).click();
 await page.getByText('Superficie calculada: 128,6859 ha',{exact:true}).waitFor();
 assert.notEqual(estimate,'Superficie estimada: 128,6859 ha');
 assert.equal(await page.getByText(estimate,{exact:true}).count(),0);

});
test('first quick edit waits for lazy Geoman; legacy can draw; reopening spatial geometry remains editable',async t=>{
 const page=await open(t);
 let release;const held=new Promise(resolve=>release=resolve);let requested;
 const sawImport=new Promise(resolve=>requested=resolve);
 await page.route(/leaflet-geoman.*\.js/,async route=>{requested();await held;await route.continue();});
 await quickEdit(page,'Lote histórico');
 await page.getByText('Este lote todavía no tiene una superficie geográfica definida. Dibujala en el mapa para continuar.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Actualizar Lote',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Seleccionar ubicación en el mapa',exact:true}).click();
 await Promise.race([sawImport,new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(new Error('Geoman import was not requested')),15000);timeout.unref();})]);
 assert.equal(await page.locator('.ant-drawer:visible .leaflet-container').count(),0,'no map is constructed before plugin init hooks exist');
 release();
 await page.locator('.ant-drawer:visible .leaflet-pm-icon-polygon').waitFor();
 await page.locator('.ant-drawer:visible .leaflet-pm-icon-edit').waitFor();
 await draw(page);
 await page.getByRole('button',{name:'Actualizar Lote',exact:true}).click();
 await page.waitForFunction(()=>window.__lotWrites.length===1);
 await quickEdit(page,'Lote espacial');
 await page.getByRole('textbox',{name:'Nombre del Lote'}).fill('Solo nombre');
 await page.getByRole('button',{name:'Actualizar Lote',exact:true}).click();
 await page.waitForFunction(()=>window.__lotWrites.length===2);
 assert.deepEqual(await page.evaluate(()=>window.__lotWrites[1].body),{name:'Solo nombre'});
 await quickEdit(page,'Solo nombre');await editor(page);
 await page.waitForFunction(()=>Object.values(window.__lastLotMap._layers).some(l=>l.pm?.enabled?.()&&l instanceof window.__leaflet.Polygon));
 await page.waitForFunction(()=>!document.querySelector('.ant-drawer-content-wrapper')?.getAnimations().some(a=>a.playState==='running'));
 const marker=page.locator('.ant-drawer:visible .marker-icon:not(.marker-icon-middle)').first();
 await marker.click({trial:true});
 const point=await marker.boundingBox();assert.ok(point);
 await page.mouse.move(point.x+point.width/2,point.y+point.height/2);await page.mouse.down();await page.mouse.move(point.x+point.width/2+15,point.y+point.height/2+10,{steps:5});await page.mouse.up();
 await page.waitForFunction(()=>Boolean(document.querySelector('input#location')?.value));
 await page.getByRole('button',{name:'Listo',exact:true}).click();
 await page.getByRole('button',{name:'Actualizar Lote',exact:true}).click();
 await page.waitForFunction(()=>window.__lotWrites.length===3);
 assert.equal(JSON.parse((await page.evaluate(()=>window.__lotWrites[2].body)).location).type,'Polygon');
 await quickEdit(page,'Solo nombre');
 await page.getByText('Superficie calculada: 128,6859 ha',{exact:true}).waitFor();
});
