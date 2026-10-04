import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canAdoptExisting,adoptionApi} from '../src/features/planning/historicalAdoption.mjs';
const row={id:'p',status:'completado',inventory_impact_mode:'NORMAL',effective_date:'2026-09-22'};
const admin={role:3},cutoff='2026-09-24';
test('solo Admin con ambos permisos efectivos y antecedente anterior al corte',()=>{
  assert.equal(canAdoptExisting(admin,row,cutoff),true);
  for(const role of [0,1,2])assert.equal(canAdoptExisting({role,custom_permissions:['all']},row,cutoff),false);
  for(const permissions of [[],['planning.edit'],['history.import']])assert.equal(canAdoptExisting({role:3,custom_permissions:permissions},row,cutoff),false);
  assert.equal(canAdoptExisting({role:3,custom_permissions:['planning.edit','history.import']},row,cutoff),true);
  for(const change of [{status:'pendiente'},{inventory_impact_mode:'HISTORICAL_NO_STOCK'},{historical_import_id:'i'},{effective_date:cutoff},{effective_date:'2026-09-25'}]){
    assert.equal(canAdoptExisting(admin,{...row,...change},cutoff),false);
  }
  assert.equal(canAdoptExisting(admin,row,null),false);
  assert.equal(canAdoptExisting(null,row,cutoff),false);
});
test('fallback end_at coincide con fecha calendario argentina del backend',()=>{
  assert.equal(canAdoptExisting(admin,{...row,effective_date:null,end_at:'2026-09-24T02:00:00Z'},cutoff),true);
  assert.equal(canAdoptExisting(admin,{...row,effective_date:null,end_at:'2026-09-24T03:00:00Z'},cutoff),false);
  assert.equal(canAdoptExisting(admin,{...row,effective_date:null,end_at:'invalid'},cutoff),false);
});
test('preview sin persistir y confirmación explícita con clave estable, sin mandar empresa o modo',async()=>{
  const calls=[],api=adoptionApi({post:async(...args)=>{calls.push(args);return {data:{ok:true}};}});
  await api.prepare(['p']);await api.confirm(['p'],'stable');await api.confirm(['p'],'stable');
  assert.deepEqual(calls[0],['/history/adopt-existing/prepare',{planning_ids:['p']}]);
  assert.deepEqual(calls[1],['/history/adopt-existing/confirm',{planning_ids:['p'],confirmed_no_stock:true},{headers:{'Idempotency-Key':'stable'}}]);
  assert.deepEqual(calls[1],calls[2]);
});
test('acción integrada en escritorio, móvil, calendario; confirmación bloqueada hasta revisar y aceptar',()=>{
  const read=name=>fs.readFileSync(new URL('../src/features/planning/'+name,import.meta.url),'utf8');
  const view=read('Planning.jsx'),modal=read('components/AdoptExistingModal.jsx');
  assert.match(view,/canAdoptExisting\(currentUser,row,adoptionCutoff\)/);
  assert.match(view,/getMonthlyMenuItems[\s\S]*?getAdoptionActions\(item\)/);
  for(const name of ['PlanningTable','PlanningListMobile'])assert.match(read(`components/${name}.jsx`),/menuItems\.push\(\.\.\.getAdoptionActions\(/);
  assert.match(modal,/!confirmed\|\|!preview\?\.can_confirm/);
  assert.match(modal,/useRef\(crypto.randomUUID\(\)\)/);
  assert.match(modal,/conflict\?\.items/);
  assert.match(modal,/Esta operación conserva el registro y lo marca como antecedente. No modificará el inventario./);
  assert.match(view,/onAdopted=[\s\S]*?await fetchPlanning\(\)/);
  assert.match(view,/isEditingHistorical \? "Corrección de antecedente"/);
});