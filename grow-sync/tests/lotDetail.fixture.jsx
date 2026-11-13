// Synthetic, local-only data: no backend or production calls.
import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {ConfigProvider} from 'antd';
import L from 'leaflet';
import api from '../src/services/apiClient';
import LotDivisions from '../src/features/lots/LotDivisions';
import {appTheme} from '../src/theme/theme';
import {cssVariables} from '../src/theme/tokens';
import '../src/index.css';
import '../src/App.css';
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
localStorage.setItem('user',JSON.stringify({id:'synthetic',role:0,custom_permissions:['lots.view','planning.create','planning.edit','soil_analysis.view','soil_analysis.create']}));
const polygon=(west,east)=>({type:'Polygon',coordinates:[[[west,-32],[east,-32],[east,-31.99],[west,-31.99],[west,-32]]]});
const geom=polygon(-62,-61.99),a=polygon(-62,-61.995),b=polygon(-61.995,-61.99);
const lot={id:'lot',name:'Lote de prueba',area_ha:104.85823,enabled:true,location:geom};
const sub=(id,name,geom)=>({id,name,code:id,geom,area_ha:52.429115,enabled:true});
const layouts=[{id:'active',version:2,status:'active',parent_geom_snapshot:geom,parent_area_ha_snapshot:lot.area_ha,sub_lots:[sub('A','División A',a),sub('B','División B',b)]},
 {id:'draft',version:3,status:'draft',parent_geom_snapshot:geom,parent_area_ha_snapshot:lot.area_ha,sub_lots:[sub('draft-A','Borrador A',a),sub('draft-B','Borrador B',b)]}];
const history=[
 {type:'activity',activity_type:'fertilizacion',products:[{name:'Fertilizante sintético',amount:'46353.8851',unit:'kg'}]},
 {type:'harvest',details:{production_kg:'126462',yield_kg_ha:'4683.7851'}},
 {type:'activity',activity_type:'fumigacion',description:'Aplicación registrada'},
 {type:'activity',activity_type:'siembra'},
 {type:'crop_cycle',source_id:'cycle',details:{start_date:'2026-07-01',end_date:'2026-09-01'}},
 {type:'harvest_closure',details:{reason:'weather',total_area_ha:52.429115,harvested_area_ha:50,remaining_area_ha:2.429115,notes:'Nota de cierre'}},
 {type:'activity',activity_type:'riego'},
].map((e,i)=>({...e,id:'event-'+i,event_date:'2026-10-'+String(20-i).padStart(2,'0'),lot_id:lot.id,area_ha:52.429115,sub_lot_name:'División A',crop:i===6?'Trigo':'Maíz',crop_id:i===6?'wheat':'corn',campaign:i===6?'2025/26':'2026/27',campaign_id:i===6?'previous':'current'}));
window.__lotRequests=[];window.__lotWrites=[];window.__lotOriginal=structuredClone(layouts);window.__leaflet=L;
L.Map.addInitHook(function(){window.__lotMap=this;});
api.defaults.adapter=async config=>{
 window.__lotRequests.push({method:config.method,url:config.url});
 const response=data=>({data:structuredClone(data),status:200,statusText:'OK',headers:{},config});
 if(config.method==='get'){
  if(config.url==='/lots')return response([lot]);
  if(config.url==='/lots/lot/layouts')return response(layouts);
  if(config.url.startsWith('/lots/lot/layouts/'))return response(layouts.find(l=>config.url.endsWith('/'+l.id)));
  if(config.url==='/lots/lot/history')return response(history);
  if(config.url==='/lots/lot/productive-state')return response({units:[{lot_id:'lot',name:lot.name,area_ha:lot.area_ha,state:{kind:'stubble',crop:{id:'corn',name:'Maíz'},quality:'confirmed'},previous_crops:[]}]});
  if(config.url==='/soil-analysis')return response([]);
  if(config.url==='/crops')return response([{id:'corn',name:'Maíz'}]);
  if(config.url==='/campaigns')return response([{id:'current',name:'2026/27',start_date:'2026-07-01',end_date:'2027-06-30',status:'active'}]);
 }
 const body=config.data?JSON.parse(config.data):undefined;
 window.__lotWrites.push({url:config.url,method:config.method,body});
 if(config.method==='put'&&config.url.endsWith('/sub-lots')){
  const layout=layouts.find(l=>config.url.includes('/'+l.id+'/'));
  layout.sub_lots=body.subLots.map((sub,i)=>({...sub,id:sub.id||'saved-'+i,enabled:true}));
  return response({layout});
 }
 if(config.url.endsWith('/validate'))return response({valid:true,summary:{coverage_percent:100},issues:[]});
 if(config.url.endsWith('/activate')){layouts.forEach(l=>{l.status=l.id==='draft'?'active':'locked';});return response({});}
 if(config.method==='post'&&config.url==='/lots/lot/layouts'){
  const layout={...structuredClone(layouts[0]),id:'new',version:4,status:'draft'};layouts.push(layout);return response(layout);
 }
 throw new Error('Unexpected synthetic request '+config.method+' '+config.url);
};
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter initialEntries={['/lotes/lot/divisiones']}><Routes>
 <Route path="/lotes/:lotId/divisiones" element={<LotDivisions/>}/>
 <Route path="/lotes" element={<h1>Listado de lotes</h1>}/>
 <Route path="/lotes/:lotId/analisis-suelo" element={<h1>Análisis del lote</h1>}/>
</Routes></MemoryRouter></ConfigProvider>);
