import test from 'node:test';
import assert from 'node:assert/strict';
import {quantityLabel,unitLabel,normalizeUnit,unitOptions} from '../src/utils/inventoryUnits.js';
test('catálogo controlado y aliases legacy sin conversión',()=>{
 assert.deepEqual(unitOptions.map(unit=>unit.value),['L','mL','kg','g','unit','bag']);
 assert.equal(normalizeUnit('litros'),'L');assert.equal(unitLabel('bolsas'),'bolsas');
 assert.equal(unitLabel('mL'),'mL');assert.equal(unitLabel('unit'),'unidades');
});
test('formato argentino conserva cantidades pequeñas y su magnitud',()=>{
 for(const [amount,unit,label] of [['130','g','130 g'],['38','litros','38 L'],['12.5','L','12,5 L'],['0.125','L','0,125 L'],['0.005','kg','0,005 kg'],['1.25','bag','1,25 bolsas'],['0.000001','mL','0,000001 mL']]) assert.equal(quantityLabel(amount,unit),label);
});
