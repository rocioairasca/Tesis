import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {tokens,cssVariables} from '../src/theme/tokens.js';

test('tokens conservan identidad, separan estados y definen espaciado',()=>{
  assert.equal(tokens.brand.primary,'#437118');assert.equal(tokens.brand.navigation,'#1D2A62');
  assert.equal(tokens.brand.accent,'#87AECE');assert.equal(tokens.brand.lime,'#AFD06E');assert.equal(tokens.brand.warm,'#F5F3D8');
  assert.notEqual(tokens.success,tokens.brand.primary);assert.equal(cssVariables['--gs-space-32'],'32px');
  assert.equal(tokens.radius.control,8);assert.equal(tokens.radius.card,12);
});
test('navegación renderizada conserva rutas y aplica permisos en ambos tamaños',async()=>{
  const {createServer}=await import('vite');
  const React=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
  const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
  const oldStorage=globalThis.localStorage;
  try{
    const {MemoryRouter}=await server.ssrLoadModule('/node_modules/react-router-dom/dist/index.mjs');
    const {default:Sidebar}=await server.ssrLoadModule('/src/layout/Sidebar.jsx');
    const {default:Bottom}=await server.ssrLoadModule('/src/components/NavbarBottom.jsx');
    const render=(component,props)=>renderToStaticMarkup(React.createElement(MemoryRouter,{initialEntries:['/planificaciones']},React.createElement(component,props)));
    for(const restricted of [false,true]){
      globalThis.localStorage={getItem:()=>JSON.stringify({role:3,...(restricted?{custom_permissions:['inventory.view']}: {})})};
      for(const collapsed of [false,true]){
        const html=render(Sidebar,{collapsed,onCollapse:()=>{}});
        assert.ok(html.includes('href="/inventario"'));assert.ok(html.includes('href="/dashboard"'));
        assert.equal(html.includes('href="/planificaciones"'),!restricted);
        assert.equal(html.includes('href="/usage"'),!restricted);
        assert.ok(html.includes(collapsed?'Expandir menú':'Colapsar menú'));
      }
      const mobile=render(Bottom,{});
      assert.ok(mobile.includes('Inicio'));assert.ok(mobile.includes('Inventario'));
      assert.equal(mobile.includes('aria-label="Planificaciones"'),!restricted);
      assert.equal(mobile.includes('aria-label="Lotes"'),!restricted);
      assert.equal(mobile.includes('aria-label="Más opciones"'),!restricted);
    }
  }finally{globalThis.localStorage=oldStorage;await server.close();}
});
