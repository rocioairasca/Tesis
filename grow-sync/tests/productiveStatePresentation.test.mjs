import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stateLabel,observedLabel,unitCampaign,conflictMessage} from '../src/features/lots/productiveStatePresentation.mjs';
import {buildLotRows,filterLotRows} from '../src/features/lots/lotsOverviewModel.mjs';
const unit=state=>({state,current_crop:{assignment_id:'real-soy',crop_id:'soy',crop_name:'Soja',campaign_name:'Anterior'}});
for(const [kind,crop,label] of [['growing_crop',{id:'wheat',name:'Trigo'},'Trigo'],['stubble',{id:'soy',name:'Soja'},'Rastrojo de Soja'],['fallow',null,'Barbecho'],['unknown',null,'Estado no determinado']])
 test('presentación '+kind,()=>assert.equal(stateLabel(unit({kind,crop,source:'declaration'})),label));
test('observación confirmada nunca se usa como fecha agronómica ni campaña legacy ajena',()=>{
 const u=unit({kind:'growing_crop',crop:{id:'wheat',name:'Trigo'},source:'declaration',observed_on:'2026-10-06'});
 assert.equal(observedLabel(u),'Confirmado el 06/10/2026');assert.equal(unitCampaign(u),null);assert.equal(u.current_crop.assignment_id,'real-soy');
 assert.ok(!observedLabel(u).includes('sembrado'));assert.equal(stateLabel({current_crop:u.current_crop}),'Soja');
});
test('vista de Lotes usa state para etiqueta/filtros y evita mezclar campaña contradictoria',()=>{
 const u=unit({kind:'stubble',crop:{id:'soy',name:'Soja'},source:'declaration',observed_on:'2026-10-06',conflict:true});
 const rows=buildLotRows([{id:'lot',name:'T2',enabled:true,area_ha:1}],{lot:{units:[u]}});
 assert.deepEqual(rows[0].stateLabels,['Rastrojo de Soja']);assert.equal(rows[0].productiveConflict,true);assert.deepEqual(rows[0].campaigns,[]);
 assert.equal(filterLotRows(rows,{crop:'Soja'}).length,1);assert.deepEqual(rows[0].observations,['Confirmado el 06/10/2026']);
});
test('componente compartido tiene indicador discreto y layout flexible para mobile',()=>{
 const source=fs.readFileSync(new URL('../src/features/lots/components/ProductiveStateLabel.jsx',import.meta.url),'utf8');
 assert.match(source,/overflowWrap:'anywhere'/);assert.match(source,/whiteSpace:'normal'/);assert.match(source,/stateLabel\(unit\)/);assert.match(source,/observedLabel/);
 assert.equal(conflictMessage,'Estado confirmado con historial pendiente de revisar');
});

test('componente real renderiza estados y confirmación con texto accesible',async()=>{
 const {createServer}=await import('vite'),React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 const server=await createServer({root:new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {default:Label}=await server.ssrLoadModule('/src/features/lots/components/ProductiveStateLabel.jsx');
  const html=renderToStaticMarkup(React.createElement(Label,{unit:unit({kind:'stubble',crop:{id:'soy',name:'Soja'},source:'declaration',observed_on:'2026-10-06',conflict:true}),details:true}));
  assert.ok(html.includes('Rastrojo de Soja'));assert.ok(html.includes(conflictMessage));assert.ok(html.includes('Confirmado el 06/10/2026'));
  for(const technical of ['assignment','fingerprint','conflict graph','sembrado'])assert.ok(!html.includes(technical));
  assert.ok(html.includes('overflow-wrap:anywhere'));
 }finally{await server.close();}
});
