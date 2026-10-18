// Real Dashboard source, Dashboard and Planning; synthetic transport only.
import '@ant-design/v5-patch-for-react-19';
import React from 'react';import {createRoot} from 'react-dom/client';
import {BrowserRouter,useLocation} from 'react-router-dom';import {ConfigProvider} from 'antd';
import {appTheme} from '../src/theme/theme';import {cssVariables} from '../src/theme/tokens';
import api from '../src/services/apiClient';import Dashboard from '../src/features/dashboard/Dashboard';import {createDashboardSource} from '../src/features/dashboard/dashboardSource';
import '../src/index.css';import '../src/App.css';import '../src/layout/shell.css';
const mode=new URLSearchParams(location.search).get('mode'),uid='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const user={id:uid,company_id:'company',full_name:'Agustina Airasca',role:0,custom_permissions:mode==='denied'?[]:mode==='manager'?['planning.view','planning.edit']:['planning.view']};
localStorage.clear();localStorage.setItem('user',JSON.stringify(user));
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
const rows=Array.from({length:9},(_,i)=>({id:'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0'),title:'Trabajo personal '+(i+1),activity_type:'fumigacion',field_context:'stubble',crop_name:'Maíz',crop_id:'crop',campaign_id:'campaign',status:'pendiente',status_effective:i<2?'en_demora':'pendiente',enabled:true,
 start_at:'2026-10-'+(i<2?'10':i<4?'18':i<7?String(19+i-4):'30')+'T00:00:00.000Z',end_at:'2026-10-'+(i<2?'11':i<4?'18':i<7?String(19+i-4):'30')+'T00:00:00.000Z',
 responsible_user:uid,responsible_name:user.full_name,assigned_by_name:i===1?null:'Juan Pérez',assigned_at:'2026-10-01T12:00:00Z',lots:[{id:'lot',lot_id:'lot',name:'Lote T4',area_ha:10}],products:[]}));
const dataset=mode==='future'?rows.slice(7):mode==='empty'?[]:rows;
window.__requests=[];window.__mutations=[];
api.defaults.adapter=async config=>{
 if(config.method!=='get'){window.__mutations.push(config.url);throw Error('No mutations allowed');}
 const params=config.params||{};window.__requests.push({path:config.url,params});
 let data=[];
 if(config.url==='/planning'){
  if(params.mine && window.__failMine)throw Error('Synthetic list failure');
  let selected=[...dataset];
  if(params.responsible && params.responsible!==uid)selected=[];
  if(params.status)selected=selected.filter(row=>row.status_effective===params.status);
  if(params.to)selected=selected.filter(row=>row.start_at<=params.to);
  if(params.from)selected=selected.filter(row=>row.end_at>=params.from);
  const size=params.pageSize||20,page=params.page||1;data={data:selected.slice((page-1)*size,page*size),total:selected.length};
 }else if(config.url.startsWith('/planning/'))data=rows.find(row=>config.url==='/planning/'+row.id);
 else if(config.url==='/users/planning-responsibles')data=[user,{id:other,full_name:'Otra persona',email:'other@example.test'}];
 else if(config.url==='/crops')data=[{id:'crop',name:'Maíz'}];
 else if(config.url==='/lots')data=[{id:'lot',name:'Lote T4',area_ha:10}];
 else if(config.url==='/campaigns')data=[{id:'campaign',name:'2026',start_date:'2026-01-01',end_date:'2026-12-31',status:'active'}];
 return {data,status:200,statusText:'OK',headers:{},config};
};
const source={...createDashboardSource(api),weather:async()=>({reading:null})};
const {default:Planning}=await import('../src/features/planning/Planning.jsx');
function Fixture(){const current=useLocation();return <main style={{padding:12,maxWidth:1400,margin:'auto',minWidth:0}}>{current.pathname==='/dashboard'?<Dashboard source={source} user={user} today="2026-10-18"/>:<Planning/>}</main>;}
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><BrowserRouter><Fixture/></BrowserRouter></ConfigProvider>);
