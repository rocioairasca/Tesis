import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { saveInitialDraft, readInitialDraft, clearInitialDrafts, changeInitialDraftDate } from '../src/features/inventory/stockInitialDraft.mjs';

const storage = () => {
  const result = {};
  Object.defineProperties(result, {
    getItem: { value: key => result[key] ?? null },
    setItem: { value: (key, value) => { result[key] = value; } },
    removeItem: { value: key => { delete result[key]; } },
  });
  return result;
};
test('borrador: edición, recuperación, fecha/empresa y eliminación explícita', () => {
  const device = storage();
  const rows = Array.from({ length: 40 }, (_, i) => ({ product_id: String(i), quantity: i ? '250' : '', unit: 'cc',
    expiration_period: i ? dayjs('2027-01-01') : null }));
  assert.equal(saveInitialDraft('a', '2026-09-24', rows, device), true);
  const recovered = readInitialDraft('a', '2026-09-24', device);
  assert.equal(recovered.length, 40);
  assert.equal(recovered[0].quantity, '');
  assert.equal(recovered[1].expiration_period.format('MM/YYYY'), '01/2027');
  assert.equal(recovered[1].unit, 'cc');
  assert.equal(readInitialDraft('b', '2026-09-24', device), null);
  assert.equal(readInitialDraft('a', '2026-09-25', device), null);
  recovered[1].quantity = '350';
  saveInitialDraft('a', '2026-09-24', recovered, device);
  assert.equal(readInitialDraft('a', '2026-09-24', device)[1].quantity, '350');
  assert.equal(readInitialDraft('a', '2026-09-24', device)[2].quantity, '250');
  saveInitialDraft('a', '2026-09-25', rows, device);
  saveInitialDraft('b', '2026-09-24', rows, device);
  clearInitialDrafts('a', '2026-09-24', device);
  assert.equal(readInitialDraft('a', '2026-09-24', device), null);
  assert.equal(readInitialDraft('a', '2026-09-25', device).length, 40);
  clearInitialDrafts('a', undefined, device);
  assert.equal(readInitialDraft('a', '2026-09-25', device), null);
  assert.equal(readInitialDraft('b', '2026-09-24', device).length, 40);
});
test('borrador: datos corruptos y almacenamiento no disponible no rompen el formulario', () => {
  const device = storage();
  saveInitialDraft('a', 'date', [{ product_id: 'p', unit: 'L', quantity: '' }], device);
  device[Object.keys(device)[0]] = '{';
  assert.equal(readInitialDraft('a', 'date', device), null);
  assert.equal(saveInitialDraft('a', 'date', [], null), false);
  assert.equal(readInitialDraft('a', 'date', null), null);
  assert.doesNotThrow(() => clearInitialDrafts('a', undefined, null));
});

test('borrador: vaciar una cantidad con null conserva las 40 filas y sus datos', () => {
  const device = storage();
  const rows = Array.from({ length: 40 }, (_, i) => ({
    product_id: `product-${i}`, quantity: `${i + 1}.25`, unit: 'cc',
    expiration_period: dayjs('2027-08-01'),
  }));
  const originalQuantities = rows.map(row => row.quantity);
  const emptyIndex = 17;
  rows[emptyIndex].quantity = null;
  assert.equal(saveInitialDraft('a', '2026-09-24', rows, device), true);
  const saved = JSON.parse(device[Object.keys(device)[0]]).entries[emptyIndex];
  assert.deepEqual(saved, { product_id: 'product-17', quantity: null, unit: 'cc', expiration_month: 8, expiration_year: 2027 });
  const recovered = readInitialDraft('a', '2026-09-24', device);
  assert.ok(recovered);
  assert.equal(recovered.length, 40);
  recovered.forEach((row, i) => {
    assert.equal(row.quantity, i === emptyIndex ? null : originalQuantities[i]);
    assert.equal(row.product_id, rows[i].product_id);
    assert.equal(row.unit, rows[i].unit);
    assert.equal(row.expiration_period.month() + 1, 8);
    assert.equal(row.expiration_period.year(), 2027);
  });
});

test('borrador: aceptar null no admite cantidades con estructuras inválidas', () => {
  for (const quantity of [true, false, {}, [], ['1'], { value: '1' }, undefined]) {
    const device = storage();
    saveInitialDraft('a', '2026-09-24', [{ product_id: 'p', unit: 'L', quantity }], device);
    assert.equal(readInitialDraft('a', '2026-09-24', device), null);
  }
});


test('cambiar fecha migra 40 filas completas y elimina solo la clave anterior tras éxito', async () => {
  const device = storage();
  const rows = Array.from({length:40}, (_,i) => ({product_id:String(i),quantity:i===17?null:String(i+1),unit:'kg',expiration_period:dayjs('2027-08-01')}));
  saveInitialDraft('a','2026-01-01',rows,device);
  saveInitialDraft('b','2026-01-01',rows,device);
  await changeInitialDraftDate({company:'a',previousDate:'2026-01-01',date:'2026-02-01',rows,storage:device,setDate:async date => {
    assert.equal(date,'2026-02-01');
    assert.equal(readInitialDraft('a',date,device).length,40);
    assert.equal(readInitialDraft('a','2026-01-01',device).length,40);
  }});
  assert.equal(readInitialDraft('a','2026-01-01',device),null);
  assert.deepEqual(readInitialDraft('a','2026-02-01',device),rows);
  assert.equal(readInitialDraft('b','2026-01-01',device).length,40);
});

test('cambio de fecha: fallo de almacenamiento no llama API; rechazo y timeout conservan carga y permiten reintentar', async () => {
  const device=storage(), rows=[{product_id:'p',quantity:'',unit:'L',expiration_period:null}];
  saveInitialDraft('a','old',rows,device);
  const args={company:'a',previousDate:'old',date:'new',rows,storage:device};
  let calls=0;
  await assert.rejects(changeInitialDraftDate({...args,storage:null,setDate:async()=>{calls++;}}), /guardar/);
  assert.equal(calls,0);
  await assert.rejects(changeInitialDraftDate({...args,setDate:async()=>{throw Object.assign(new Error('blocked'),{response:{status:409}});}}),/blocked/);
  assert.deepEqual(readInitialDraft('a','old',device),rows);
  assert.equal(readInitialDraft('a','new',device),null);
  await assert.rejects(changeInitialDraftDate({...args,setDate:async()=>{throw new Error('timeout');}}),/timeout/);
  assert.deepEqual(readInitialDraft('a','old',device),rows);
  assert.deepEqual(readInitialDraft('a','new',device),rows);
  await changeInitialDraftDate({...args,setDate:async()=>{}});
  assert.equal(readInitialDraft('a','old',device),null);
});

test('cambio de fecha no sobrescribe otro borrador distinto',async()=>{
  const device=storage(),rows=[{product_id:'p',quantity:'1',unit:'L'}];
  saveInitialDraft('a','new',[{...rows[0],quantity:'9'}],device);
  await assert.rejects(changeInitialDraftDate({company:'a',previousDate:'old',date:'new',rows,storage:device,setDate:async()=>assert.fail('No debe llamar API')}),/Ya existe/);
  assert.equal(readInitialDraft('a','new',device)[0].quantity,'9');
});
