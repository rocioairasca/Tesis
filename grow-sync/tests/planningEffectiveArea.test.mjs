import {test} from 'node:test';
import assert from 'node:assert/strict';
import {effectiveArea,selectionAreaLabel,partialAreaAllowed} from '../src/features/planning/effectiveArea.mjs';
test('effective fallback preserves historical and completed surfaces and Argentine display',()=>{
 assert.equal(effectiveArea({area_ha:101.3,effective_area_ha:10}),10);
 assert.equal(effectiveArea({area_ha:'70.97',effective_area_ha:null}),70.97);
 assert.equal(selectionAreaLabel({area_ha:101.3,effective_area_ha:10}),'10 ha trabajadas de 101,3 ha');
 assert.equal(selectionAreaLabel({area_ha:101.3}),'101,3 ha');
 assert.equal(partialAreaAllowed('siembra'),false);
 for(const activity of ['fumigacion','fertilizacion','riego','mantenimiento','otro'])assert.equal(partialAreaAllowed(activity),true);
});
test('surface form renders compact full-width controls and functional language',async()=>{
 const {createServer}=await import('vite'),React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 const {fileURLToPath}=await import('node:url');
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
 try {
  const {default:Fields}=await server.ssrLoadModule('/src/features/planning/components/EffectiveAreaFields.jsx');
  for(const completed of [false,true]){
   const html=renderToStaticMarkup(React.createElement(Fields,{activity:'fumigacion',completed,selections:[{key:'test',name:'Lote Santos',area_ha:101.3,effective_area_ha:10}]}));
   assert.match(html,/Lote Santos/);assert.match(html,/Superficie a trabajar/);assert.match(html,/101,3/);assert.match(html,/width:100%/);
   if(completed)assert.match(html,/disabled/);else assert.match(html,/Podés indicar una superficie menor sin crear una división/);
  }
 }finally{await server.close();}
});
