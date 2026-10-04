import {historicalAdoptionMessage,historicalAdoptionError} from '../src/features/planning/historicalAdoptionCopy.js';
import {formatCalendarDate} from '../src/utils/calendarDate.js';
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
  assert.match(modal,/Esta planificación se conservará tal como está y quedará identificada como un registro histórico. Las existencias del inventario no se modificarán./);
  assert.match(view,/onAdopted=[\s\S]*?await fetchPlanning\(\)/);
  assert.match(view,/isEditingHistorical \? "Corrección de antecedente"/);
});
test('bloqueos mantienen su causa con lenguaje funcional',()=>{
  for(const [input,expected] of [
    ['Tiene movimientos de inventario vinculados. No se puede adoptar.','Esta planificación ya modificó el inventario y no puede marcarse como histórica.'],
    ['Relaciones, empresa, productos, cantidades o fechas inconsistentes; requiere revisión.','Encontramos datos relacionados que necesitan revisión antes de continuar.'],
    ['La fecha debe ser anterior al inicio del inventario.','Solo pueden marcarse como históricas las actividades realizadas antes del inicio del control de inventario.'],
    ['Tiene cosechas o cierres de ciclo vinculados; requiere revisión histórica integral.','Esta planificación tiene una cosecha relacionada y necesita una revisión antes de poder marcarse como histórica.'],
  ])assert.equal(historicalAdoptionMessage(input),expected);
  assert.match(historicalAdoptionMessage('Una relación cambiaría durante la adopción. Operación cancelada.'),/No se realizó el cambio/);
  assert.match(historicalAdoptionMessage('El inventario cambió. Adopción cancelada.'),/podría modificar las existencias/);
  assert.doesNotMatch(historicalAdoptionMessage('SQL stock_movements usage_id=ab123 persisted=false'),/SQL|stock_movements|usage_id|persisted/);
  assert.match(historicalAdoptionMessage('SQL stock_movements usage_id=ab123 persisted=false'),/problema.*revisión/);
});
test('errores de permisos, conexión y reintentos no exponen términos internos',()=>{
  assert.match(historicalAdoptionError({response:{status:403,data:{message:'No tenés permisos para adoptar antecedentes.'}}}),/No tenés permiso para marcar/);
  assert.match(historicalAdoptionError({response:{status:409,data:{message:'La clave ya corresponde a otra operación.'}}}),/Cerrá esta ventana/);
  assert.match(historicalAdoptionError({request:{},message:'Network Error'}),/Verificá tu conexión/);
  assert.match(historicalAdoptionError({response:{status:500,data:{message:'SQL constraint'}}}),/Intentá nuevamente/);
});
test('modal usa fechas DD/MM/YYYY, evita IDs visibles y conserva las acciones compartidas',()=>{
  assert.equal(formatCalendarDate('2026-09-22'),'22/09/2026');
  assert.equal(formatCalendarDate('2026-09-24'),'24/09/2026');
  assert.equal(formatCalendarDate(null,'Sin configurar'),'Sin configurar');
  const read=name=>fs.readFileSync(new URL('../src/features/planning/'+name,import.meta.url),'utf8');
  const modal=read('components/AdoptExistingModal.jsx'),view=read('Planning.jsx');
  assert.match(modal,/formatCalendarDate\(item.effective_date/);
  assert.match(modal,/formatCalendarDate\(preview.inventory_control_start_date/);
  assert.doesNotMatch(modal,/\|\|r\.(lot_id|product_id)|Usos vinculados:|Completions:|Ciclos:|Sin completion|Se conservarán las relaciones/);
  assert.match(view,/label:'Marcar como registro histórico'/);
  assert.match(modal,/title="Marcar como registro histórico"/);
  assert.match(modal,/okText="Marcar como histórica"/);
});