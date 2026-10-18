// Real screens; synthetic transport only. No API or persistent data is accessed.
import '@ant-design/v5-patch-for-react-19';
import React from 'react';import {createRoot} from 'react-dom/client';
import {BrowserRouter,useLocation} from 'react-router-dom';import {ConfigProvider} from 'antd';
import {appTheme} from '../src/theme/theme';import {cssVariables} from '../src/theme/tokens';
import api from '../src/services/apiClient';import Dashboard from '../src/features/dashboard/Dashboard';import {createDashboardSource} from '../src/features/dashboard/dashboardSource';
import UserTable from '../src/components/users/UserTable';
import '../src/index.css';import '../src/App.css';import '../src/layout/shell.css';
const query=new URLSearchParams(location.search),mode=query.get('mode'),activity=query.get('activity')||'riego';
const id='11111111-1111-4111-8111-000000000001',uid='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const user={id:uid,company_id:'company',full_name:'Agustina Airasca',role:0,custom_permissions:mode==='admin'?['all']:mode==='noView'?['planning.execute']:mode==='view'?['planning.view']:mode==='editor'?['planning.view','planning.edit']:['planning.view','planning.execute']};
localStorage.clear();localStorage.setItem('user',JSON.stringify(user));
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
const productive=['siembra','fumigacion','fertilizacion'].includes(activity);
const row={id,company_id:'company',title:'Tarea de ejecución',activity_type:activity,field_context:activity==='siembra'?null:'stubble',crop_name:'Maíz',crop_id:'crop',campaign_id:'campaign',status:query.get('status')||'pendiente',enabled:true,
 start_at:'2026-10-21T00:00:00.000Z',end_at:'2026-10-21T00:00:00.000Z',responsible_user:mode==='other'||mode==='editor'?other:uid,responsible_name:mode==='other'||mode==='editor'?'Otra persona':user.full_name,assigned_by_name:'Juan Pérez',assigned_at:'2026-10-01T12:00:00Z',lots:[{id:'lot',lot_id:'lot',name:'Lote T4',area_ha:10}],products:productive?[{id:'pp',product_id:'product',name:'Producto de prueba',amount:'1',unit:'litros',available_quantity:10}]:[]};
window.__requests=[];window.__mutations=[];
window.fetch=async(url,options={})=>{
 if(options.method==='PUT' && String(url).endsWith('/users/'+other+'/permissions')){window.__mutations.push({method:'put',path:'/users/'+other+'/permissions',body:JSON.parse(options.body)});return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});}
 throw Error('Unexpected fetch in synthetic fixture: '+url);
};
api.defaults.adapter=async config=>{
 const params=config.params||{},body=config.data?JSON.parse(config.data):{};window.__requests.push({path:config.url,params});let data=[];
 if(config.method!=='get'){
  window.__mutations.push({method:config.method,path:config.url,body});
  if(mode==='reassigned')throw Object.assign(Error('Forbidden'),{response:{status:403,data:{message:'No tenés permiso para ejecutar esta tarea.'}}});
  if(config.method!=='post'||!['start','complete-sowing','complete-work','complete-activity'].some(action=>config.url==='/planning/'+id+'/'+action))throw Error('Unexpected mutation');
  row.status=config.url.endsWith('/start')?'en_progreso':'completado';if(row.status==='completado')row.effective_date=body.effective_date;data={ok:true,message:row.status==='completado'?'La tarea fue completada.':undefined};
 }else if(config.url==='/planning'){
  const selected=params.mine && (row.responsible_user!==uid||row.status==='completado')?[]:[{...row,status_effective:row.status}];data={data:selected,total:selected.length};
 }else if(config.url==='/planning/'+id)data={...row,status_effective:row.status};
 else if(config.url==='/users')data=[{id:other,email:'persona@example.test',full_name:'Persona de prueba',role:0,enabled:true,custom_permissions:[]}];
 else if(config.url==='/users/planning-responsibles')data=[user,{id:other,full_name:'Otra persona',email:'other@example.test'}];
 else if(config.url==='/crops')data=[{id:'crop',name:'Maíz'}];
 else if(config.url==='/lots')data=[{id:'lot',name:'Lote T4',area_ha:10}];
 else if(config.url==='/products')throw Object.assign(Error('No inventory.view'),{response:{status:403}});
 else if(config.url==='/campaigns')data=[{id:'campaign',name:'2026',start_date:'2026-01-01',end_date:'2026-12-31',status:'active'}];
 return {data,status:200,statusText:'OK',headers:{},config};
};
const source={...createDashboardSource(api),weather:async()=>({reading:null})};
const {default:Planning}=await import('../src/features/planning/Planning.jsx');
function Fixture(){const current=useLocation();return <main style={{padding:12,maxWidth:1400,margin:'auto',minWidth:0}}>{current.pathname==='/dashboard'?<Dashboard source={source} user={user} today="2026-10-18"/>:current.pathname==='/users'?<UserTable/>:<Planning/>}</main>;}
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><BrowserRouter><Fixture/></BrowserRouter></ConfigProvider>);
