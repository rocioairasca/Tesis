import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
test('weather and notifications: source errors, retry, WMO and persisted text presentation',async()=>{
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {createDashboardSource}=await server.ssrLoadModule('/src/features/dashboard/dashboardSource.js');
  const {sanitizeNotification,presentNotification}=await server.ssrLoadModule('/src/utils/userFriendlyErrors.js');
  const {getWeatherPresentation}=await server.ssrLoadModule('/src/features/dashboard/weatherPresentation.jsx');
  for(const [raw,expected] of [['1.000000','1'],['0.800000','0,8'],['1.250000','1,25'],['0.015000','0,015'],['1000.000000','1.000'],['1234.250000','1.234,25']]){
   const original={type:'low_stock',message:'Bogard quedó con bajo stock: '+raw+' L.'};
   assert.equal(presentNotification(original).message,'Bogard quedó con bajo stock: '+expected+' L.');assert.ok(original.message.includes(raw));
   assert.equal(presentNotification(sanitizeNotification(original)).message,presentNotification(original).message);
  }
  assert.equal(sanitizeNotification({type:'planning_assigned',message:'Aplicar 1.000000 L'}).message,'Aplicar 1.000000 L');
  for(const [code,label] of [[0,'Despejado'],[2,'Parcialmente nublado'],[3,'Nublado'],[45,'Niebla'],[61,'Lluvia leve'],[95,'Tormenta']]) assert.equal(getWeatherPresentation({source:'open-meteo',weather_code:code}).label,label);
  for(const code of [undefined,null,999]) assert.equal(getWeatherPresentation({source:'open-meteo',weather_code:code,humidity:90,temperature:35}).label,'Condición no informada');
  const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server'),{MemoryRouter}=await import('react-router-dom');
  const {Weather}=await server.ssrLoadModule('/src/features/dashboard/DashboardView.jsx');
  const render=request=>renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(Weather,{request,canViewRain:true})));
  const reading={temperature:16.7,humidity:51,wind_speed:12.5,date:'2026-10-17'};
  const stale=render({status:'success',data:{reading,fallback:true,failure:'rate_limited',retry_after_seconds:900,retryable:true},retry:()=>{}});
  assert.ok(stale.includes('Último dato disponible · Desactualizado'));assert.ok(stale.includes('Última lectura: 17/10/26'));assert.ok(stale.includes('Condición no informada'));assert.doesNotMatch(stale,/Open-Meteo|límite de consultas|hora no registrada|Ubicación actual|15 min/);assert.equal((stale.match(/>Reintentar</g)||[]).length,1);
  const currentView=render({status:'success',data:{reading:{...reading,weather_code:0},fallback:false}});assert.ok(currentView.includes('Despejado'));assert.doesNotMatch(currentView,/Desactualizado|Clima actual|ubicación|Reintentar/);
  const empty=render({status:'success',data:{reading:null,fallback:true,failure:'permission_denied',retryable:false}});assert.ok(empty.includes('Habilitá el permiso'));assert.doesNotMatch(empty,/Reintentar|Última lectura/);
  const failed=render({status:'error',error:new Error('Open-Meteo rate limit'),retry:()=>{}});assert.ok(failed.includes('No se pudo consultar el clima.'));assert.doesNotMatch(failed,/Open-Meteo|rate limit/);assert.equal((failed.match(/>Reintentar</g)||[]).length,1);
  const saved={temperature:18,humidity:70,wind_speed:8,date:'2026-01-01'};const current={temperature:20,humidity:65,wind_speed:10,wind_direction:90,weather_code:2,source:'open-meteo',observed_at:'2026-10-16T12:00:00Z'};
  let geoCalls=0,postCalls=0,fail=true;const phases=[];
  const source=createDashboardSource({get:async()=>({data:saved}),post:async(path,body,config)=>{postCalls++;assert.equal(config.timeout,15000);if(fail)throw Object.assign(Error('HTTP'),{response:{status:502}});return {data:current};}}, {},()=>({getCurrentPosition:ok=>{geoCalls++;ok({coords:{latitude:-32,longitude:-63}});}}));
  const first=await source.weather({onProgress:phase=>phases.push(phase)});assert.equal(first.failure,'provider_error');assert.equal(first.fallback,true);assert.equal(first.reading,saved);assert.equal(first.location.latitude,-32);assert.equal(first.retryable,true);assert.deepEqual(phases,['location','weather']);
  fail=false;const second=await source.weather({});assert.equal(second.fallback,false);assert.equal(second.reading,current);assert.equal(geoCalls,2);assert.equal(postCalls,2);
  for(const [code,expected,retryable] of [[1,'permission_denied',false],[2,'position_unavailable',true],[3,'timeout',true]]){
   const result=await createDashboardSource({get:async()=>({data:saved}),post:()=>assert.fail()}, {},()=>({getCurrentPosition:(ok,bad)=>bad({code})})).weather({});
   assert.equal(result.failure,expected);assert.equal(result.retryable,retryable);assert.equal(result.location,null);
  }
  const limited = await createDashboardSource({post:async()=>{throw Object.assign(Error('provider private payload'),{response:{status:429,data:{error:'WeatherRateLimited',retry_after_seconds:900}}});},get:async()=>({data:saved})},{},()=>({getCurrentPosition:ok=>ok({coords:{latitude:-32,longitude:-63}})})).weather({});
  assert.equal(limited.failure,'rate_limited');assert.equal(limited.retry_after_seconds,900);assert.equal(limited.fallback,true);assert.equal(limited.reading,saved);assert.equal(limited.location.latitude,-32);assert.equal(limited.retryable,true);
  const noSaved=await createDashboardSource({get:async()=>{throw Error('Offline');}}, {},()=>null).weather({});assert.equal(noSaved.reading,null);assert.equal(noSaved.failure,'unsupported');
  for(const response of [{},{temperature:null},{...current,humidity:null}]){
   const result=await createDashboardSource({post:async()=>({data:response}),get:async()=>({data:saved})},{},()=>({getCurrentPosition:ok=>ok({coords:{latitude:0,longitude:0}})})).weather({});assert.equal(result.failure,'provider_error');assert.equal(result.fallback,true);
  }
 }finally{await server.close();}
});
