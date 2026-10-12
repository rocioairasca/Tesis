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
async function pageAt(width){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto(origin);await page.getByRole('button',{name:'Nueva receta',exact:true}).waitFor({timeout:60000});
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
