// Real Planning UI; all API reads/writes are synthetic and recorded locally.
import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ConfigProvider} from 'antd';
import {MemoryRouter} from 'react-router-dom';
import {appTheme} from '../src/theme/theme';
import {cssVariables} from '../src/theme/tokens';
import api from '../src/services/apiClient';
import '../src/index.css';
import '../src/App.css';
localStorage.clear();
localStorage.setItem('user',JSON.stringify({id:'user',role:0,custom_permissions:['planning.view','planning.create','planning.edit']}));
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
const campaign={id:'gruesa',name:'Gruesa 2026-2027',work_start_date:'2026-07-30',start_date:'2026-11-01',end_date:'2027-06-30',work_end_date:'2027-07-31',status:'active'};
const campaigns=new URLSearchParams(location.search).has('single')?[campaign]:[
  {...campaign,id:'outside',name:'Campaña posterior',work_start_date:'2028-01-01',start_date:'2028-02-01',end_date:null,work_end_date:null},
  campaign,{...campaign,id:'overlap',name:'Otra compatible'}
];
const row={id:'plan',status:'planificado',activity_type:'siembra',crop_id:'crop',crop_name:'Maíz',
  campaign_id:'gruesa',campaign_name:campaign.name,start_at:'2025-10-20T00:00:00.000Z',end_at:'2025-10-20T00:00:00.000Z',
  responsible_user:'user',responsible_name:'Responsable',description:'Registro previo',
  lots:[{lot_id:'lot',id:'lot',name:'Lote de prueba',lot_name:'Lote de prueba',area_ha:25}],products:[]};
window.__campaignWrites=[];
api.defaults.adapter=async config=>{
  const response=data=>({data:structuredClone(data),status:200,statusText:'OK',headers:{},config});
  if(config.method!=='get'){
    if(!['/planning','/planning/plan','/planning/register-completed'].includes(config.url))throw Error('Unexpected write '+config.url);
    window.__campaignWrites.push({path:config.url,method:config.method,body:JSON.parse(config.data)});
    return response({id:'saved',ok:true});
  }
  if(config.url==='/planning/plan')return response(row);
  if(config.url==='/planning')return response({data:[row],total:1});
  if(config.url==='/campaigns')return response(campaigns);
  if(config.url==='/users/planning-responsibles')return response([{id:'user',full_name:'Responsable'}]);
  if(config.url==='/crops')return response([{id:'crop',name:'Maíz'}]);
  if(config.url==='/lots')return response([{id:'lot',name:'Lote de prueba',area_ha:25}]);
  return response([]);
};
const {default:Planning}=await import('../src/features/planning/Planning.jsx');
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter initialEntries={['/planificaciones']}><Planning /></MemoryRouter></ConfigProvider>);
