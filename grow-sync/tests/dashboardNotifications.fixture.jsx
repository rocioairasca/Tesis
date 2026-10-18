import React, {useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {ConfigProvider,Button} from 'antd';
import Dashboard from '../src/features/dashboard/Dashboard';import {createDashboardSource} from '../src/features/dashboard/dashboardSource';import NotificationsDrawer from '../src/components/NotificationsDrawer';import {FixtureNotifications} from './dashboardNotifications.fixtureContext';
import '../src/App.css';
import '../src/index.css';
import '../src/layout/shell.css';
import '@ant-design/v5-patch-for-react-19';
import {appTheme} from '../src/theme/theme';
import {cssVariables} from '../src/theme/tokens';
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
window.__marked=[];window.__geoCalls=0;window.__weatherCalls=0;
const mode=new URLSearchParams(location.search).get('mode')||'success';window.__mode=mode;
Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>({state:window.__mode==='denied'?'denied':'granted'})}});
Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(ok,bad){window.__geoCalls++;setTimeout(()=>window.__mode==='timeout'?bad({code:3}):window.__mode==='unavailable'?bad({code:2}):ok({coords:{latitude:-32.4,longitude:-63.2,accuracy:120},timestamp:Date.now()}),150);}}});
const saved={temperature:18,humidity:70,wind_speed:8,date:'2026-01-01',...(mode==='timed'?{observed_at:'2026-10-18T00:00:00Z'}:{})};
const source=createDashboardSource({get:async path=>({data:path==='/weather/latest'?saved:{data:[],total:0,inventory_v1_enabled:true}}),post:async()=>{window.__weatherCalls++;await new Promise(resolve=>setTimeout(resolve,300));if(['provider','timed'].includes(window.__mode))throw Error('Provider failure');if(window.__mode==='limited')throw Object.assign(Error('rate limited'),{response:{status:429,data:{error:'WeatherRateLimited',retry_after_seconds:900}}});return {data:{temperature:21,humidity:64,wind_speed:12,wind_direction:45,weather_code:61,source:'open-meteo',observed_at:'2026-10-16T12:00:00Z'}};}},{});
function Fixture(){
 const [open,setOpen]=useState(false),[revision,setRevision]=useState(0),[mount,setMount]=useState(0);
 const user={id:'fixture-user',company_id:'fixture-company',name:'Ana',role:0,custom_permissions:[...(mode==='noRain'?[]:['rain_records.view']),...(revision%2?['inventory.view']:[])]};
 return <main style={{padding:16,maxWidth:1100,margin:'auto'}}><h1>Dashboard de prueba</h1>
   <Dashboard key={mount} source={source} user={user} today={revision%2?'2026-10-17':'2026-10-16'} />
   <Button onClick={()=>setRevision(value=>value+1)}>Actualizar otras secciones</Button>
   <Button onClick={()=>setMount(value=>value+1)}>Volver a montar Dashboard</Button>
   <Button onClick={()=>setOpen(true)}>Abrir notificaciones</Button>
   <NotificationsDrawer open={open} onClose={()=>setOpen(false)}/>
 </main>;
}
if(import.meta.env.DEV)createRoot(document.getElementById('root')).render(<React.StrictMode><ConfigProvider theme={appTheme}><MemoryRouter><FixtureNotifications><Fixture/></FixtureNotifications></MemoryRouter></ConfigProvider></React.StrictMode>);
