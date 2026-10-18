import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {canExecutePlanning,completionEndpoint,primaryExecutionAction,executionDeniedMessage} from '../src/features/planning/planningExecution.mjs';
const own={id:'p',responsible_user:'me',company_id:'company',enabled:true,status:'pendiente',activity_type:'riego'},caps={canEdit:false,canExecute:true,userId:'me',companyId:'company'};
test('execute-only actions stay limited to own enabled nonhistorical tasks',()=>{
 assert.equal(primaryExecutionAction(own,caps).label,'Iniciar tarea');assert.equal(primaryExecutionAction({...own,status:'en_progreso'},caps).label,'Completar tarea');
 for(const patch of [{responsible_user:'other'},{company_id:'foreign'},{enabled:false},{status:'cancelado'},{status:'completado'},{inventory_impact_mode:'HISTORICAL_NO_STOCK'}])assert.equal(primaryExecutionAction({...own,...patch},caps),null);
 assert.equal(primaryExecutionAction(own,{...caps,canExecute:false}),null);
 assert.equal(primaryExecutionAction({...own,responsible_user:'other'},{...caps,canEdit:true}).label,'Iniciar trabajo');
 assert.equal(canExecutePlanning({...own,responsible_user:'other'},{...caps,canEdit:true,canExecute:false}),true);
});
test('one completion routing rule covers every activity without accidental fallback',()=>{
 assert.equal(completionEndpoint('siembra'),'complete-sowing');
 for(const activity of ['fumigacion','fertilizacion'])assert.equal(completionEndpoint(activity),'complete-work');
 for(const activity of ['riego','mantenimiento','otro','cosecha'])assert.equal(completionEndpoint(activity),'complete-activity');
 assert.equal(completionEndpoint('unknown'),null);assert.match(executionDeniedMessage,/reasignada/);
});
test('permission editor exposes execute after edit and warns without silently adding view',()=>{
 const source=readFileSync(new URL('../src/components/users/UserTable.jsx',import.meta.url),'utf8');
 assert.match(source,/PLANNING_EDIT,\s*PERMISSIONS.PLANNING_EXECUTE,/);assert.match(source,/Ejecutar tareas asignadas/);assert.match(source,/agregá también “Ver planificaciones”/);
 const frontend=readFileSync(new URL('../src/constants/permissions.jsx',import.meta.url),'utf8');
 assert.match(frontend,/PLANNING_EXECUTE: "planning.execute"/);assert.equal((frontend.match(/PERMISSIONS.PLANNING_EXECUTE,/g)||[]).length,3);
});
