// Run with node tests/stockInitialDate.browser.mjs; open http://127.0.0.1:5201.
// Disposable browser fixture: all API requests are intercepted.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import conversion from '../vite/inventoryConversionPlugin.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)).replaceAll(String.fromCharCode(92),'/').replace(/\/$/,'');
const source = `
import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import StockInitial from '/src/features/inventory/components/StockInitial.jsx';
import api from '/src/services/apiClient';
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
let date=null,opened=false;
api.defaults.adapter=async config=>{
 let data;const body=config.data?JSON.parse(config.data):{};
 if(config.url.endsWith('/inventory-control-start')){date=body.inventory_control_start_date;data={inventory_control_start_date:date};}
 else if(config.url.endsWith('/prepare'))data={...body,preview_hash:'a'.repeat(64)};
 else if(config.url.endsWith('/confirm')){opened=true;data={persisted:true};}
 else if(config.url.endsWith('/status'))data={inventory_control_start_date:date,opening:{exists:opened},stock:{batches:0,movements:0},can_prepare:!!date&&!opened,can_confirm:!!date&&!opened,blockers:[]};
 else throw new Error('Unexpected API '+config.url);
 return {data,status:200,statusText:'OK',headers:{},config};
};
const click=async name=>{const button=await screen.findByRole('button',{name,exact:true});await waitFor(()=>assert(!button.disabled,'Button ready: '+name));fireEvent.click(button);};
const pick=async value=>{const input=await screen.findByPlaceholderText('Seleccioná una fecha');fireEvent.change(input,{target:{value}});fireEvent.keyDown(input,{key:'Enter',code:'Enter',keyCode:13});fireEvent.blur(input);await waitFor(()=>assert(!screen.getByRole('button',{name:'Continuar',exact:true}).disabled,'Continue enabled'));};
const result=document.getElementById('result');
try{
 localStorage.clear();
 render(<StockInitial user={{company_id:'date-test',custom_permissions:['history.import']}} products={[{id:'p',name:'Producto sintético',unit:'kg',enabled:true}]} ready onSaved={()=>{}}/>);
 await click('Configurar inventario inicial');
 assert((await screen.findByPlaceholderText('Seleccioná una fecha')).value==='','Date starts empty');
 assert(screen.getByRole('button',{name:'Continuar'}).disabled,'Explicit date required');
 await pick('01/02/2026');await click('Continuar');
 await screen.findByText('Fecha de inicio: 01/02/2026');
 fireEvent.mouseDown(screen.getByRole('combobox',{name:'Buscar producto'}));
 fireEvent.click(await screen.findByText('Producto sintético'));
 await click('Agregar');
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'5'}});
 await click('Revisar inventario inicial');await screen.findByText('Revisá las cantidades antes de confirmar.');
 await click('Volver');assert(screen.getByRole('spinbutton').value==='5','Back preserves quantity');
 await click('Cambiar');await pick('02/02/2026');await click('Continuar');
 await screen.findByText('Ya cargaste productos para el inventario inicial. Si cambiás la fecha, revisá que esas cantidades correspondan a la nueva fecha.');
 await click('Cancelar');assert(date==='2026-02-01','Cancel preserves date');
 await click('Continuar');await click('Cambiar fecha');
 await screen.findByText('Fecha de inicio: 02/02/2026');
 assert(screen.getByRole('spinbutton').value==='5','Date change preserves quantity');
 assert(localStorage.getItem('growsync:stock-initial:v1:date-test:2026-02-01')===null,'Old draft removed');
 assert(JSON.parse(localStorage.getItem('growsync:stock-initial:v1:date-test:2026-02-02')).entries[0].quantity==='5','New draft saved');
 await click('Volver a Fecha');await click('Volver a la carga');
 assert(screen.getByRole('spinbutton').value==='5','Date navigation preserves quantity');
 await click('Revisar inventario inicial');await screen.findByText('Revisá las cantidades antes de confirmar.');
 await click('Confirmar inventario inicial');
 const buttons=await screen.findAllByRole('button',{name:'Confirmar inventario inicial',exact:true});fireEvent.click(buttons.at(-1));
 await waitFor(()=>assert(opened,'Synthetic confirmation completed'));
 await waitFor(()=>assert(!screen.queryByRole('button',{name:'Configurar inventario inicial'}),'Confirmed opening cannot reopen'));
 result.textContent='PASS: empty date, explicit selection, back/review, warning/cancel, draft migration, back/date, confirmation lock. Real API calls: 0';
}catch(e){result.textContent='FAIL: '+e.stack;}finally{cleanup();}
`;
const virtual=root+'/tests/stockInitialDate.synthetic.jsx';
const server=await createServer({root,configFile:false,plugins:[conversion(),{name:'date-regression',enforce:'pre',resolveId(id){if(id==='/date-test.jsx')return virtual;},load(id){if(id===virtual)return source;},configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<pre id="result">RUNNING</pre><script type="module" src="/date-test.jsx"></script>');}else next();});}}],optimizeDeps:{entries:[],include:['react','react/jsx-runtime','react-dom/client','antd','dayjs','axios','react-responsive','@phosphor-icons/react','@testing-library/react','@ant-design/v5-patch-for-react-19']},server:{port:5201,strictPort:true,host:'127.0.0.1',hmr:false}});
await server.listen();console.log('Synthetic date regression: http://127.0.0.1:5201');
