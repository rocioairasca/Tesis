import {test} from 'node:test';import assert from 'node:assert/strict';
import {notificationTarget} from '../src/utils/notificationTarget.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('all planning events use one safe exact target, older notifications keep list fallback',()=>{
 for(const type of ['planning_assigned','planning_unassigned','planning_updated','planning_cancelled','planning_completed','planning_upcoming','state_change']){
  assert.equal(notificationTarget({type,data:{planning_id:id}}),'/planificaciones?planningId='+id);
  assert.equal(notificationTarget({type}),'/planificaciones');
  assert.equal(notificationTarget({type,data:{planning_id:'../../usuarios?admin=true'}}),'/planificaciones');
 }
 assert.equal(notificationTarget({type:'low_stock'}),'/inventario');assert.equal(notificationTarget({type:'new_user'}),'/usuarios');assert.equal(notificationTarget({type:'unknown'}),null);
});
