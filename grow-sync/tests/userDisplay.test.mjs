import {test} from 'node:test';import assert from 'node:assert/strict';
import {userDisplayName,userInitials,userOptions} from '../src/utils/userDisplay.mjs';
import {roleLabel} from '../src/constants/roles.mjs';
test('visible identity uses trimmed full_name, then email, then Usuario, without Auth0 nickname inference',()=>{
 for(const [user,expected] of [[{full_name:' Rocío Airasca ',email:'r@test'},'Rocío Airasca'],[{full_name:' ',email:' r@test ',nickname:'Inventado'},'r@test'],[{username:'No usar'},'Usuario'],[null,'Usuario']])assert.equal(userDisplayName(user),expected);
});
test('initials use first and last name, including accents, single words and fallback email',()=>{
 for(const [user,expected] of [[{full_name:'Rocío Airasca'},'RA'],[{full_name:'María José López'},'ML'],[{full_name:' Juan '},'J'],[{full_name:' ',email:'rocio@test'},'R'],[null,'U']])assert.equal(userInitials(user),expected);
});
test('responsible options keep IDs and show names with email fallback; roles share human labels',()=>{
 assert.deepEqual(userOptions([{id:'a',full_name:' Juan Pérez ',email:'juan@test'},{id:'b',full_name:null,email:'b@test'}]),[{value:'a',label:'Juan Pérez',email:'juan@test'},{value:'b',label:'b@test',email:'b@test'}]);assert.deepEqual([0,1,2,3].map(roleLabel),['Empleado','Supervisor','Dueño','Administrador']);
});
