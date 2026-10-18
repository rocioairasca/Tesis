// Real Planning, bell and notification drawer, synthetic API with all external traffic blocked.
import '@ant-design/v5-patch-for-react-19';
import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,useLocation,useNavigate} from 'react-router-dom';
import {ConfigProvider,Button} from 'antd';
import {appTheme} from '../src/theme/theme';
import {cssVariables} from '../src/theme/tokens';
import api from '../src/services/apiClient';
import NotificationBell from '../src/components/NotificationBell';
import NotificationsDrawer from '../src/components/NotificationsDrawer';
import {FixtureNotifications} from './planningAssignments.fixtureContext';
import '../src/index.css';import '../src/App.css';import '../src/layout/shell.css';
localStorage.clear();localStorage.setItem('user',JSON.stringify({id:'user',company_id:'company',role:0,custom_permissions:location.search.includes('noPermission')?[]:['planning.view','planning.create','planning.edit']}));
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
const id='11111111-1111-4111-8111-111111111111';
const row={id,status:'pendiente',activity_type:'fumigacion',field_context:'stubble',crop_id:'crop',crop_name:'Maíz',campaign_id:'campaign',campaign_name:'2026',
  title:'Fumigación lote T4 y revisión de sectores con un título extenso para comprobar el espacio',
  start_at:'2026-10-21T00:00:00.000Z',end_at:'2026-10-21T00:00:00.000Z',responsible_user:'responsible',responsible_name:'Agustina Airasca',
  assigned_by:'assigner',assigned_by_name:'Juan Pérez',assigned_at:'2026-10-18T17:30:00Z',
  lots:[{id:'lot',lot_id:'lot',name:'Lote de prueba',area_ha:25,effective_area_ha:10}],planned_area_ha:10,products:[]};
window.__events=[];window.__gets=[];window.__aborted=[];
api.defaults.adapter=async config=>{
  if(config.method==='post' && config.url==='/planning/'+id+'/start'){
    row.status='en_progreso'; return {data:{ok:true},status:200,statusText:'OK',headers:{},config};
  }
  if(config.method==='patch' && config.url==='/planning/'+id){
    row.status=JSON.parse(config.data).status;
    return {data:{ok:true},status:200,statusText:'OK',headers:{},config};
  }
  if(config.method!=='get')throw Error('Unexpected mutation in browser fixture');
  window.__gets.push(config.url);
  const response=data=>({data,status:200,statusText:'OK',headers:{},config});
  if(config.url==='/planning')return response({data:location.search.includes('listed')?[row]:[],total:location.search.includes('listed')?1:0});
  if(config.url.startsWith('/planning/11111111-')){
    const key=config.url.slice(-1);
    config.signal?.addEventListener('abort',()=>window.__aborted.push(config.url));
    if(key==='8')await new Promise(r=>setTimeout(r,700));
    const status=['2','5'].includes(key)?404:['3','4'].includes(key)?403:null;
    if(status)throw Object.assign(new Error('Hidden technical error'),{response:{status,data:{message:'Do not expose'}}});
    return response({...row,id:config.url.split('/').pop(),...(key==='6'?{assigned_by:null,assigned_by_name:null,assigned_at:null}:{}),...(key==='7'?{responsible_name:'agustina@example.test',assigned_by_name:'juan@example.test'}:{}),...(key==='8'?{title:'Respuesta lenta obsoleta'}:{}),...(key==='9'?{assigned_by_name:'Juan Pérez '+ 'ApellidoExtenso'.repeat(12),responsible_name:'Agustina Airasca '+ 'ApellidoExtenso'.repeat(12)}:{})});
  }
  if(config.url==='/users/planning-responsibles')return response([]);
  if(config.url==='/crops')return response([{id:'crop',name:'Maíz'}]);
  if(config.url==='/lots')return response([{id:'lot',name:'Lote de prueba',area_ha:25}]);
  if(config.url==='/campaigns')return response([{id:'campaign',name:'2026',start_date:'2026-01-01',end_date:'2026-12-31',status:'active'}]);
  return response([]);
};
const {default:Planning}=await import('../src/features/planning/Planning.jsx');
function Fixture(){
  const [open,setOpen]=useState(false),location=useLocation(),navigate=useNavigate();
  useEffect(()=>{window.__events.push('navigate:'+location.search);},[location.search]);
  useEffect(()=>{window.__navigate=next=>navigate(next);},[navigate]);
  return <main style={{padding:16,maxWidth:1200,margin:'auto',minWidth:0}}>
    <h1>Asignaciones de prueba</h1><NotificationBell onOpenDrawer={()=>setOpen(true)}/>
    <Button onClick={()=>setOpen(true)}>Abrir notificaciones</Button>
    <NotificationsDrawer open={open} onClose={()=>setOpen(false)}/><Planning/>
  </main>;
}
createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><BrowserRouter><FixtureNotifications><Fixture/></FixtureNotifications></BrowserRouter></ConfigProvider>);
