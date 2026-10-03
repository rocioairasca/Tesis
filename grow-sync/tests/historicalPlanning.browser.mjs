// Synthetic browser acceptance. All API calls use an in-memory adapter.
// Run with node tests/historicalPlanning.browser.mjs, then open the printed URL.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import conversion from '../vite/inventoryConversionPlugin.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const source = `
import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import api from '/src/services/apiClient';
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const params=new URLSearchParams(location.search);
const normal=params.has('normal'), denied=params.has('denied');
localStorage.setItem('user',JSON.stringify({id:'user',company_id:'synthetic',custom_permissions:['planning.view','planning.edit',...(denied?[]:['history.import'])]}));
const row={id:'planning',title:'Antecedente sintético',status:'completado',activity_type:'fumigacion',
 inventory_impact_mode:normal?'NORMAL':'HISTORICAL_NO_STOCK',responsible_user:'user',responsible_name:'Responsable',
 start_at:'2021-02-03T00:00:00Z',end_at:'2021-02-04T00:00:00Z',effective_date:'2021-02-04',
 lots:[{id:'lot',lot_id:'lot',name:'Lote de prueba',area_ha:'1.25'}],
 products:[{id:'pp',planning_product_id:'pp',product_id:'product',name:'Producto existente',unit:'kg',amount:'5',actual_amount:'4',usage_id:'usage'}]};
window.__patches=[];let reject=true;
api.defaults.adapter=async config=>{
 let data=[];
 if(config.method==='patch'){
   const body=JSON.parse(config.data);window.__patches.push({url:config.url,body});
   if(reject)throw {response:{status:409,data:{message:'El antecedente tiene ciclos vinculados: requiere corrección histórica integral.'}}};
   data={ok:true};
 }else if(config.method!=='get')throw Error('Unexpected mutation '+config.method);
 else if(config.url==='/planning')data={data:[row]};
 else if(config.url==='/users/planning-responsibles')data=[{id:'user',name:'Responsable',enabled:true}];
 else if(config.url==='/lots')data=[{id:'lot',name:'Lote de prueba',area_ha:99}];
 else if(config.url==='/products')data={inventory_v1_enabled:true,data:[{id:'product',name:'Producto existente',unit:'kg',available_quantity:0}]};
 return {data,status:200,statusText:'OK',headers:{},config};
};
const result=document.getElementById('result');
try{
 const {default:Planning}=await import('/src/features/planning/Planning.jsx');
 render(<MemoryRouter><Planning/></MemoryRouter>);
 await screen.findByText('Lote de prueba');
 if(denied){
   assert(!screen.queryByRole('button',{name:/Editar/}),'Historical edit hidden without history.import');
   assert(screen.getAllByText(/Histórico · Sin impacto en inventario/).length>0,'Historical badge retained');
 }else{
   fireEvent.click(await screen.findByRole('button',{name:/Editar/}));
   if(normal){
     await screen.findByText('Los datos productivos de una actividad completada no pueden modificarse desde esta edición.');
     assert(!screen.queryByLabelText('Cantidad real utilizada'),'Normal completed editor unchanged');
     reject=false;fireEvent.click(screen.getByRole('button',{name:'Actualizar',exact:true}));
     await waitFor(()=>assert(window.__patches.length===1,'Normal patch sent'));
     assert(!('products' in window.__patches[0].body),'Normal completed payload remains metadata only');
   }else{
     await screen.findByText('Esta actividad es histórica. Los cambios no modifican el inventario.');
     const area=screen.getByRole('spinbutton',{name:/Superficie histórica/});
     assert(area.value==='1.25','Uses stored historical area, not geometry area 99');
     fireEvent.change(area,{target:{value:'0.75'}});
     fireEvent.change(screen.getByRole('spinbutton',{name:'Cantidad planificada'}),{target:{value:'9'}});
     fireEvent.change(screen.getByRole('spinbutton',{name:'Cantidad real utilizada'}),{target:{value:'8'}});
     assert(screen.getByLabelText('Producto').readOnly,'Product read only');
     assert(screen.getByLabelText('Unidad').readOnly,'Unit read only');
     assert(!screen.queryByRole('button',{name:'Agregar producto'}),'No product addition');
     assert(!screen.queryByRole('button',{name:'Eliminar',exact:true}),'No product deletion');
     fireEvent.click(screen.getByRole('button',{name:'Guardar corrección'}));
     await screen.findByText('El antecedente tiene ciclos vinculados: requiere corrección histórica integral.');
     assert(screen.getByRole('spinbutton',{name:'Cantidad real utilizada'}).value==='8','Error preserves edits');
     const {url,body}=window.__patches[0];assert(url==='/planning/planning','Existing endpoint');
     assert(JSON.stringify(body.products)==='[{"planning_product_id":"pp","actual_amount":"8","amount":"9"}]','Historical product contract');
     assert(body.lot_selections[0].area_ha==='0.75','Explicit historical area sent');
     for(const key of ['inventory_impact_mode','status','activity_type'])assert(!(key in body),'No '+key);
     assert(!('start_at' in body)&&!('end_at' in body),'Unchanged period omitted');
     reject=false;fireEvent.click(screen.getByRole('button',{name:'Guardar corrección'}));
     await screen.findByText('Antecedente corregido');
     assert(window.__patches.length===2,'Retry sent once');
   }
 }
 result.textContent='PASS: '+(normal?'NORMAL':denied?'historical read only':'historical correction and friendly error')+'; real API calls: 0';
}catch(e){result.textContent='FAIL: '+e.stack;}finally{cleanup();}
`;
const virtual = root + '/tests/historicalPlanning.synthetic.jsx';
const server = await createServer({ root, configFile: false, cacheDir: '../.test-tools/vite-history',
  plugins: [conversion(), { name: 'historical-planning-acceptance', enforce: 'pre',
    resolveId(id) { if (id === '/history-test.jsx') return virtual; },
    load(id) { if (id === virtual) return source; },
    configureServer(s) { s.middlewares.use((req, res, next) => {
      if (req.url.split('?')[0] === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<pre id="result">RUNNING</pre><script type="module" src="/history-test.jsx"></script>'); }
      else next();
    }); },
  }], optimizeDeps: { entries: [], include: ['react', 'react/jsx-runtime', 'react-dom/client', 'antd', 'dayjs', 'axios', 'react-responsive', '@phosphor-icons/react', '@testing-library/react', '@ant-design/v5-patch-for-react-19'] },
  server: { host: '127.0.0.1', port: 5203, strictPort: true, hmr: false, fs: { allow: [root + '/..', realpathSync(root + '/node_modules')] } },
});
await server.listen();
console.log('Synthetic Planning acceptance: http://127.0.0.1:5203 (?denied or ?normal for alternate cases)');
