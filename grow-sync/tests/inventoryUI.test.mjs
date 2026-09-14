import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReceipt, canAdjust, adjustmentPreview, similarProducts, identityPayload, receiptPreview, validateReceipt, receivedLabel, expirationLabel, stockQuantity, lowStock } from '../src/features/inventory/inventoryModel.mjs';

const purchase = { product_id: 'example', quantity: '2.5', received_date: '2020-09-13', currency: 'ARS', unit_price: '10.2' };
test('identidad excluye saldo, precio y fechas incluso si llegan al formulario', () => {
  assert.deepEqual(identityPayload({ name: 'Producto de prueba', category: 'semillas', unit: 'kg', quantity: 10, total_quantity: 10, available_quantity: 10, price: 20, received_date: '2020-01-01', expiration_date: '2030-01-01' }), { name: 'Producto de prueba', category: 'semillas', unit: 'kg' });
});
test('compra requiere cantidad positiva y fecha; vencimiento opcional', () => {
  assert.doesNotThrow(() => validateReceipt(purchase, true));
  for (const quantity of [null, undefined, 0, -1, 'NaN', '1.0000001']) assert.throws(() => validateReceipt({ ...purchase, quantity }, true));
  for (const received_date of [null, undefined, '', '2026-02-30']) assert.throws(() => validateReceipt({ ...purchase, received_date }, true));
  assert.throws(() => validateReceipt({ ...purchase, expiration_date: 'invalid' }, true));
});
test('USD requiere cambio positivo, ARS no lo requiere', () => {
  assert.doesNotThrow(() => validateReceipt(purchase, true));
  for (const exchange_rate of [null, undefined, 0, -1]) assert.throws(() => validateReceipt({ ...purchase, currency: 'USD', exchange_rate }, true));
  assert.doesNotThrow(() => validateReceipt({ ...purchase, currency: 'USD', exchange_rate: '1200' }, true));
});
test('preview calcula saldo, total original y ARS con decimales exactos', () => {
  assert.deepEqual(receiptPreview(purchase, '0.1'), { after: '2.600000', total_original: '25.500000', total_ars: '25.500000' });
  assert.equal(receiptPreview({ ...purchase, currency: 'USD', exchange_rate: '1200' }, '0').total_ars, '30600.000000');
  assert.equal(receiptPreview({ quantity: '0.2' }, '0.1').after, '0.300000');
  assert.equal(receiptPreview({ quantity: 1 }, 0).total_original, null);
});
test('fechas calendario y fechas no registradas', () => {
  assert.equal(receivedLabel('2026-09-13'), '13/09/2026');
  assert.equal(receivedLabel(null), 'Fecha no registrada');
  assert.equal(expirationLabel(null), 'Sin vencimiento registrado');
});
test('receipt requiere activación explícita y permiso', () => {
  assert.equal(canReceipt(true, true), true);
  for (const enabled of [false, undefined, null, 'true']) assert.equal(canReceipt(enabled, true), false);
  assert.equal(canReceipt(true, false), false);
});
test('modo compatible conserva saldo y umbral; partidas usan saldo físico sin mezclar consumible', () => {
  const p = { available_quantity: 3, on_hand_quantity: 12, minimum_stock: null };
  assert.equal(stockQuantity(p, false), 3); assert.equal(stockQuantity(p, true), 12);
  assert.equal(lowStock(p, false), true); assert.equal(lowStock(p, true), false);
  assert.equal(lowStock({ ...p, minimum_stock: 15 }, true), true);
  assert.doesNotThrow(() => validateReceipt({ product_id: 'example', quantity: 2 }, false));
});
test('ajustes requieren activación y permiso; preview exacto y validaciones',()=>{
  assert.equal(canAdjust(true,true),true);assert.equal(canAdjust(false,true),false);assert.equal(canAdjust(true,false),false);
  const body={direction:'in',quantity:'0.2',reason:'Diferencia de inventario'};
  assert.equal(adjustmentPreview(body,'0.1').after,'0.300000');
  assert.equal(adjustmentPreview({...body,direction:'out'},'0.3').after,'0.100000');
  assert.throws(()=>adjustmentPreview({...body,direction:'out'},'0.1'),/stock suficiente/);
  assert.throws(()=>adjustmentPreview({...body,reason:''},'1'),/motivo/);
  assert.throws(()=>adjustmentPreview({...body,reason:'Otro',reason_detail:'  '},'1'),/motivo/);
  assert.equal(adjustmentPreview({...body,reason:'Otro',reason_detail:' Conteo físico '},'1').reason,'Conteo físico');
});
test('similares normalizan espacios y mayúsculas, contienen en ambos sentidos y limitan a cinco',()=>{
  const products=[{id:'1',name:'  Producto   Azul  '},{id:'2',name:'Producto'},{id:'3',name:'Producto Azul Concentrado'},...Array.from({length:8},(_,i)=>({id:String(i+4),name:`Producto Azul ${i}`}))];
  const matches=similarProducts(products,'PRODUCTO AZUL');
  assert.equal(matches.length,5);assert.equal(matches[0].id,'1');assert.ok(matches.some(p=>p.id==='2'));assert.ok(matches.some(p=>p.id==='3'));
  assert.deepEqual(similarProducts(products,''),[]);
});

test('formulario renderizado contiene sólo identidad en ambos modos; permisos efectivos', async () => {
  const { createServer } = await import('vite');
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { default: Identity } = await server.ssrLoadModule('/src/features/inventory/components/ProductIdentityForm.jsx');
    for (const enabled of [true, false]) {
      const html = renderToStaticMarkup(React.createElement(Identity, { enabled }));
      for (const label of ['Nombre comercial', 'Categoría', 'Unidad base', 'Stock mínimo', 'Observaciones']) assert.ok(html.includes(label));
      for (const name of ['quantity', 'available_quantity', 'total_quantity', 'received_date', 'expiration_date', 'price', 'supplier']) assert.ok(!html.includes(`id="${name}"`));
    }
    for (const locked of [false,true]) {
      const html=renderToStaticMarkup(React.createElement(Identity,{editing:{unit_locked:locked,unit_history_verified:true}}));
      const unitInput=html.match(/<input[^>]*id="unit"[^>]*>/)?.[0];
      assert.ok(unitInput);
      assert.equal(unitInput.includes('disabled'),locked);
      assert.equal(html.includes('este producto ya posee historial de stock'),locked);
    }
    const { hasPermission } = await server.ssrLoadModule('/src/utils/permissions.jsx');
    for (const action of ['create', 'edit', 'disable', 'enable', 'view_disabled']) {
      assert.equal(hasPermission({ role: 2, custom_permissions: ['inventory.view'] }, `inventory.${action}`), false);
      assert.equal(hasPermission({ role: 2, custom_permissions: [`inventory.${action}`] }, `inventory.${action}`), true);
    }
    const {default:Similar}=await server.ssrLoadModule('/src/features/inventory/components/SimilarProducts.jsx');
    const p={id:'test-product',name:'Producto',category:'semillas',unit:'kg',enabled:true};
    let selected;
    const props={matches:[p],name:' producto ',canEdit:true,onUse:()=>{},onReceipt:value=>{selected=value;}};
    assert.ok(renderToStaticMarkup(React.createElement(Similar,props)).includes('Ya existe un producto con este nombre.'));
    const walk=node=>{
      if(!node||typeof node!=='object')return;
      if(Array.isArray(node)){node.forEach(walk);return;}
      if(node.props?.children==='Registrar ingreso')node.props.onClick();
      walk(node.props?.children);walk(node.props?.description);
    };
    walk(Similar(props));assert.equal(selected.id,p.id);
    const disabled=renderToStaticMarkup(React.createElement(Similar,{...props,matches:[{...p,enabled:false}]}));
    assert.ok(disabled.includes('Deshabilitado'));assert.ok(!disabled.includes('Registrar ingreso'));
  } finally { await server.close(); }
});
