import test from 'node:test';
import assert from 'node:assert/strict';
import { rainSummary, rainPeriod, formatRain } from '../src/features/rainRecords/rainPresentation.mjs';
const now = new Date('2026-06-23T12:00:00Z');
const rows = [{month:'2025-12',rain_mm:'10'},{month:'2026-05',rain_mm:'2.5'},{month:'2026-06',rain_mm:'59'}];
test('resumen utiliza acumulados completos y separa años',()=>assert.deepEqual(rainSummary(rows,now),{month:59,year:61.5}));
test('períodos cruzan años, completan meses y distinguen ausencia de registro',()=>{
 const result=rainPeriod(rows,'12',now);assert.equal(result.length,12);assert.equal(result[0].month,'2025-07');assert.equal(result.at(-1).month,'2026-06');assert.equal(result[0].recorded,false);assert.equal(result[5].rain_mm,10);assert.equal(rainPeriod(rows,'year',now).length,6);
});
test('vacío y formato argentino sin ceros artificiales',()=>{assert.deepEqual(rainSummary([],now),{month:0,year:0});assert.equal(formatRain(59),'59');assert.equal(formatRain(2.5),'2,5');});
