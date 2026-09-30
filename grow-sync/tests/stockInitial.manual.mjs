import { createServer } from 'vite';
import conversion from '../vite/inventoryConversionPlugin.mjs';
const source = `import '@ant-design/v5-patch-for-react-19';
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Form,ConfigProvider} from 'antd';
import StockInitial from '/src/features/inventory/components/StockInitial.jsx';
import api from '/src/services/apiClient';
const products=Array.from({length:60},(_,i)=>({id:String(i),name:'Producto '+String(i).padStart(2,'0'),unit:'L',enabled:true}));
let opening = false;
api.defaults.adapter=async config=>{
  let data;
  if(config.url.endsWith('/prepare')) {const body=JSON.parse(config.data); data={...body,preview_hash:'a'.repeat(64),inventory_v1_enabled:true};}
  else if(config.url.endsWith('/confirm')) {opening=true; data={persisted:true};}
  else data={inventory_control_start_date:'2026-09-24',inventory_v1_enabled:true,opening:{exists:opening},can_prepare:!opening,can_confirm:!opening,blockers:[]};
  return {data,status:200,statusText:'OK',headers:{},config};
};
window.__rows={};
function Harness(){return <ConfigProvider><StockInitial user={{company_id:'synthetic-only',custom_permissions:['history.import']}} products={products} ready onSaved={()=>{}} /></ConfigProvider>}
createRoot(document.getElementById('root')).render(<Harness/>);`;
const server=await createServer({root:new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),configFile:false,
plugins:[conversion(),{name:'synthetic-harness',enforce:'pre',resolveId(id){if(id==='/synthetic.jsx')return new URL('./synthetic.jsx',import.meta.url).pathname.replace(/^\/(\w:)/,'$1');},load(id){if(id===new URL('./synthetic.jsx',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'))return source;},
transform(code,id){if(id.endsWith('/StockInitial.jsx'))return code.replace('const multiple = indices.length > 1;','window.__rows[field.name]=(window.__rows[field.name]||0)+1; const multiple = indices.length > 1;').replace('className="stock-initial-row"','className="stock-initial-row" data-renders={window.__rows[field.name]} data-row-key={field.key}').replace('entries: restored || []','entries: restored || Array.from({length:40},(_,i)=>({product_id:String(i),quantity:"1",unit:"L"}))');},
configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/synthetic.jsx"></script>');}else next();});}}],
optimizeDeps:{noDiscovery:false,entries:[],include:['react','react/jsx-dev-runtime','react/jsx-runtime','react-dom/client','antd','dayjs','axios','react-responsive','@phosphor-icons/react']},server:{port:5199,strictPort:true,host:'127.0.0.1'}});
await server.listen();
console.log('Synthetic-only harness: http://127.0.0.1:5199');
