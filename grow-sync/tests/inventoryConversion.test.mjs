import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compatibleUnitOptions, conversionPreview, normalizeQuantity, quantityInput, exceedsAvailable,
  receiptQuantityPayload, usageQuantityPayload, planningProductPayload, actualProductPayload } from '../src/utils/inventoryConversion.js';
import { receiptPreview, adjustmentPreview } from '../src/features/inventory/inventoryModel.mjs';
import inventoryConversionPlugin from '../vite/inventoryConversionPlugin.mjs';

test('selector: compatibles por base; cc solo en líquidos; legacy conserva unidad única', () => {
  for (const [base, expected] of [
    ['L', ['L','mL','cc']], ['mL', ['mL','cc','L']], ['kg', ['kg','g']], ['g', ['g','kg']],
    ['unit', ['unit']], ['bag', ['bag']], ['litros', ['L','mL','cc']], ['bolsas', ['bag']],
  ]) assert.deepEqual(compatibleUnitOptions(base).map(o => o.value), expected);
  assert.deepEqual(compatibleUnitOptions('L',false).map(o => o.value),['L']);
});

test('previews mL/cc a L y g a kg; sin preview al elegir la base', () => {
  for (const unit of ['mL','cc']) assert.equal(conversionPreview('250',unit,'L','Se registrarán'),'Se registrarán 0,25 L');
  assert.equal(conversionPreview('15','g','kg'),'Equivale a 0,015 kg');
  assert.equal(conversionPreview('250','cc','mL'),'Equivale a 250 mL');
  assert.equal(conversionPreview('2','L','L'),'');
  assert.equal(conversionPreview('2','L','litros'),'');
  assert.equal(conversionPreview('', 'cc','L'),'');
});

test('cantidades conservan seis decimales, rechazan exceso sin redondeo y comparan stock normalizado', () => {
  assert.deepEqual(quantityInput('0,001','cc','L'),{quantity:'0.001',unit:'cc'});
  assert.equal(conversionPreview('0.001','cc','L'),'Equivale a 0,000001 L');
  for (const amount of ['1.0000001','0.0000001']) assert.throws(()=>quantityInput(amount,'L','L'),/seis decimales/);
  assert.throws(()=>quantityInput('0.000001','cc','L'),/seis decimales/);
  assert.throws(()=>quantityInput('15','g','L'),/compatible/);
  assert.equal(exceedsAvailable('250','cc','L','0.3'),false);
  assert.equal(exceedsAvailable('250','mL','L','0.2'),true);
  assert.equal(exceedsAvailable('99999999999999.123456','L','L','99999999999999.123455'),true);
  assert.equal(quantityInput('99999999999999.123456','L','L').quantity,'99999999999999.123456');
});

test('Usage envía unidad alternativa y cantidad original como texto', () => {
  for (const unit of ['mL','cc']) assert.deepEqual(usageQuantityPayload({amount_used:'250',unit},{unit:'L'}),{amount_used:'250',unit});
  assert.deepEqual(usageQuantityPayload({amount_used:'15',unit:'g'},{unit:'kg'}),{amount_used:'15',unit:'g'});
  assert.deepEqual(usageQuantityPayload({amount_used:'2'},{unit:'litros'}),{amount_used:'2',unit:'L'});
});

test('Planning envía unidad elegida y completion conserva unidad planificada o alternativa, incluyendo cero', () => {
  assert.deepEqual(planningProductPayload({product_id:'p',amount:'15',unit:'g'},{unit:'kg'}),{product_id:'p',amount:'15',unit:'g'});
  const product={id:'line',amount:'0.5',unit:'L'};
  assert.deepEqual(actualProductPayload(product,{actual_amount:'250',unit:'cc'},'L'),{planning_product_id:'line',actual_amount:'250',unit:'cc'});
  assert.deepEqual(actualProductPayload(product,undefined,'L'),{planning_product_id:'line',actual_amount:'0.5',unit:'L'});
  assert.deepEqual(actualProductPayload(product,{actual_amount:'0'},'L'),{planning_product_id:'line',actual_amount:'0',unit:'L'});
});

test('Receipt envía precio por base y calcula importe con cantidad normalizada; ajustes conservan cantidad/unidad ingresadas', () => {
  const values={quantity:'500',unit:'mL',unit_price:8000,currency:'ARS'};
  assert.deepEqual(receiptQuantityPayload(values,{unit:'L'}),{quantity:'500',unit:'mL',unit_price:8000,unit_price_unit:'L'});
  assert.equal(receiptQuantityPayload({...values,unit:'cc'},{unit:'litros'}).unit_price_unit,'L');
  assert(!Object.hasOwn(receiptQuantityPayload({quantity:'500',unit:'cc'},{unit:'L'}),'unit_price_unit'));
  const normalized=normalizeQuantity({quantity:values.quantity,inputUnit:values.unit,productUnit:'L'}).normalized_quantity;
  assert.deepEqual(receiptPreview({...values,quantity:normalized},'1'),{after:'1.500000',total_original:'4000.000000',total_ars:'4000.000000'});
  assert.deepEqual(quantityInput('500','mL','L'),{quantity:'500',unit:'mL'});
  assert.equal(adjustmentPreview({quantity:normalized,direction:'out',reason:'Diferencia de inventario'},'1').after,'0.500000');
});

test('campo renderizado: selector compacto, unidad base y preview; rutas anidadas de Planning', async () => {
  const { createServer }=await import('vite');
  const React=await import('react');
  const { renderToStaticMarkup }=await import('react-dom/server');
  const { Form }=await import('antd');
  const root=fileURLToPath(new URL('..',import.meta.url));
  const server=await createServer({root,configFile:false,plugins:[inventoryConversionPlugin()],optimizeDeps:{noDiscovery:true,include:[]},
    server:{middlewareMode:true,hmr:false},appType:'custom'});
  try {
    const {default: Fields}=await server.ssrLoadModule('/src/components/QuantityUnitFields.jsx');
    for (const [unit,base,quantity,expected] of [['mL','L','250','Equivale a 0,25 L'],['cc','L','250','Equivale a 0,25 L'],['g','kg','15','Equivale a 0,015 kg']]) {
      const html=renderToStaticMarkup(React.createElement(Form,{initialValues:{quantity,unit}},React.createElement(Fields,{quantityName:'quantity',unitName:'unit',baseUnit:base})));
      assert(html.includes(expected));assert(html.includes(`Unidad base: ${base}`));
      assert(html.includes('role="combobox"'));assert(html.includes('aria-label="Cantidad"'));
    }
    const nested=renderToStaticMarkup(React.createElement(Form,{initialValues:{products:[{amount:'250',unit:'cc'}]}},
      React.createElement(Form.List,{name:'products'},fields=>fields.map(field=>React.createElement(Fields,{key:field.key,quantityName:[field.name,'amount'],unitName:[field.name,'unit'],watchPrefix:['products'],baseUnit:'L'})))));
    assert(nested.includes('Equivale a 0,25 L'));assert(nested.includes('products_0_unit'));
    const transformed=await server.transformRequest('/@fs/'+fileURLToPath(new URL('../../shared/inventoryConversion.cjs',import.meta.url)).replaceAll('\\','/'));
    assert(!transformed.code.includes('require('));assert(!transformed.code.includes('module.exports'));
  } finally {await server.close();}
});

test('Vite compila los cuatro formularios para navegador usando el conversor compartido', async () => {
  const {build}=await import('vite');
  const {default:react}=await import('@vitejs/plugin-react');
  const root=fileURLToPath(new URL('..',import.meta.url));
  const result=await build({root,configFile:false,plugins:[react(),inventoryConversionPlugin()],logLevel:'silent',
    define:{__APP_VERSION__:JSON.stringify('inventory-test')},build:{write:false,minify:false,
      rollupOptions:{input:['inventory/components/ReceiptModal.jsx','inventory/components/AdjustmentModal.jsx','usages/Usage.jsx','planning/Planning.jsx']
        .map(path=>fileURLToPath(new URL('../src/features/'+path,import.meta.url)))}}});
  assert(result.output.some(item=>item.type==='chunk'&&item.code.includes('La unidad seleccionada no es compatible')));
});
