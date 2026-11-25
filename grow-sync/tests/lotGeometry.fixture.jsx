// Synthetic fixture: real Lotes/MapSelector/Geoman, no external API or data.
import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {ConfigProvider} from 'antd';
import L from 'leaflet';
import Lotes from '../src/features/lots/Lotes';
import api from '../src/services/apiClient';
import {appTheme} from '../src/theme/theme';
import {cssVariables} from '../src/theme/tokens';
import '../src/index.css';
import '../src/App.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
localStorage.setItem('user',JSON.stringify({id:'synthetic',role:0,company_id:'synthetic-company',custom_permissions:['lots.view','lots.create','lots.edit']}));
const geom={type:'Polygon',coordinates:[[[-62,-32],[-61.99,-32],[-61.99,-31.99],[-62,-31.99],[-62,-32]]]};
window.__lotWrites=[]; window.__lotReads=0; window.__leaflet=L;
L.Map.addInitHook(function(){window.__lastLotMap=this;});
const lots=[{id:'spatial',name:'Lote espacial',area:105,area_ha:104.8582,geom,location:JSON.stringify(geom),enabled:true},
 {id:'legacy',name:'Lote histórico',area:100,area_ha:null,geom:null,location:null,enabled:true}];
api.defaults.adapter=async config=>{
 const response=data=>({data:structuredClone(data),status:200,statusText:'OK',headers:{},config});
 if(config.method==='get'){
  if(config.url==='/lots'){window.__lotReads++;return response({data:lots,total:lots.length});}
  if(config.url==='/lots/productive-states')return response({data:[]});
 }
 if(['post','put'].includes(config.method)&&config.url.startsWith('/lots')){
  const body=JSON.parse(config.data),index=lots.findIndex(lot=>config.url==='/lots/'+lot.id);
  const previous=index>=0?lots[index]:null;
  // Deliberately different from Turf and the legacy field: the UI must use area_ha.
  const saved={...previous,id:previous?.id||'created-'+window.__lotWrites.length,...body,
   area:999,area_ha:body.location?128.6859:previous.area_ha,enabled:true,
   geom:body.location?JSON.parse(body.location):previous.geom};
  if(index>=0)lots[index]=saved;else lots.push(saved);
  window.__lotWrites.push({url:config.url,body,saved:structuredClone(saved)});
  return response({lot:saved});
 }
 throw new Error('Unexpected fixture request: '+config.method+' '+config.url);
};
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter><Lotes/></MemoryRouter></ConfigProvider>);
