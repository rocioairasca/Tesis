const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
function load(file,stubs){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../controllers',file),'utf8'),{module,exports:module.exports,require:id=>{if(!(id in stubs))throw Error('Unexpected dependency '+id);return stubs[id];},console:{error(){}},Date,Intl,Number},{filename:file});return module.exports;}
const current={temperature_2m:21,relative_humidity_2m:65,weather_code:61,wind_speed_10m:12,wind_direction_10m:90,time:1792152000};
async function weather(data,error){let writes=0,request;const controller=load('openWeatherMap.js',{'dotenv':{config(){}},axios:{get:async(url,config)=>{request={url,...config};if(error)throw error;return {data};}},'../db/supabaseClient':{from:table=>{assert.equal(table,'weather');return {insert:rows=>{writes++;return {select:()=>({single:async()=>({data:rows[0]})})};}};}}});let status=200,body;await controller.fetchWeather({query:{latitude:-32,longitude:-63},body:{}},{status(code){status=code;return this;},json(value){body=value;}});return {status,body,writes,request};}
test('Open-Meteo: current fields, WMO and UTC observation, existing weather persistence only',async()=>{
 const result=await weather({current});assert.equal(result.status,200);assert.equal(result.writes,1);assert.equal(result.body.weather_code,61);assert.equal(result.body.condition,'Lluvia leve');assert.ok(result.body.observed_at.endsWith('Z'));assert.equal(result.request.params.timezone,'auto');assert.equal(result.request.params.timeformat,'unixtime');assert.equal(result.request.timeout,10000);
 for(const name of ['temperature_2m','relative_humidity_2m','weather_code','wind_speed_10m','wind_direction_10m'])assert.ok(result.request.params.current.split(',').includes(name));
});
test('Open-Meteo: missing values are not zero and incomplete replies are not persisted',async()=>{
 for(const data of [{},{current:{}},{current:{...current,temperature_2m:null}},{current:{...current,time:null}},{current:{...current,relative_humidity_2m:101}}]){const result=await weather(data);assert.equal(result.status,502);assert.equal(result.writes,0);}
 const missingCode=await weather({current:{...current,weather_code:null}});assert.equal(missingCode.body.weather_code,null);assert.equal(missingCode.body.condition,'Condicion desconocida');
 const zero=await weather({current:{...current,temperature_2m:0,weather_code:0}});assert.equal(zero.body.temperature,0);assert.equal(zero.body.condition,'Despejado');
});
test('Open-Meteo: HTTP failure and timeout do not persist readings',async()=>{
 for(const error of [Object.assign(Error('HTTP'),{response:{status:503}}),Object.assign(Error('timeout'),{code:'ECONNABORTED'})]){const result=await weather(null,error);assert.equal(result.status,502);assert.equal(result.writes,0);}
});
test('rain synchronization: manual and edited_api records remain untouched',async()=>{
 for(const source of ['manual','edited_api']){
  let writes=0;const existing={id:'saved',source,rain_mm:'20'};
  const controller=load('rainRecords.js',{'../db/supabaseClient':{pool:{query:async sql=>{if(!/^\s*SELECT/.test(sql)){writes++;throw Error('Unexpected mutation');}return {rows:[existing]};}}},axios:{get:async()=>({data:{daily:{time:['2026-10-16'],precipitation_sum:[3]}}})}});
  let body;await controller.syncTodayRain({body:{latitude:-32,longitude:-63},user:{company_id:'company',id:'user'}},{status(){return this;},json(value){body=value;}},error=>{throw error;});assert.equal(body.skipped,true);assert.equal(body.data,existing);assert.equal(writes,0);
 }
});
