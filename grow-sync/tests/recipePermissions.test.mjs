import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const read=p=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8');
const asModule=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const catalogUrl=asModule(read('constants/permissions.jsx'));
const catalog=await import(catalogUrl);
const {getEffectivePermissions,hasPermission}=await import(asModule(read('utils/permissions.jsx').replace('"../constants/permissions"',JSON.stringify(catalogUrl))));
const backend=createRequire(import.meta.url)('../../growsync-backend/constants/permissions.js');
const actions=['view','create','edit','disable','enable','view_disabled'];

test('frontend and backend catalogs/defaults/effective permissions agree, including legacy custom permissions',()=>{
 assert.deepEqual(catalog.PERMISSIONS,backend.PERMISSIONS);
 for(const role of [0,1,2,3]){
  assert.deepEqual([...catalog.ROLE_PERMISSIONS[role]].sort(),[...backend.ROLE_PERMISSIONS[role]].sort());
  for(const custom_permissions of [null,[],['all'],['planning.create','recipes.view'],...actions.flatMap(a=>[['recipes.'+a],['usage.'+a]])]){
   const user={role,custom_permissions};
   assert.deepEqual([...getEffectivePermissions(user)].sort(),[...backend.getEffectivePermissions(user)].sort());
  }
 }
});

test('recipes grants no usage permissions, while each legacy usage action grants only its recipe equivalent',()=>{
 const recipeUser={role:3,custom_permissions:actions.map(a=>'recipes.'+a)};
 for(const action of actions){
  assert.equal(hasPermission(recipeUser,'recipes.'+action),true);
  assert.equal(hasPermission(recipeUser,'usage.'+action),false);
  const custom_permissions=Object.freeze(['usage.'+action]),legacy={role:0,custom_permissions};
  assert.deepEqual(getEffectivePermissions(legacy),['usage.'+action,'recipes.'+action]);
  assert.equal(hasPermission(legacy,'recipes.'+action),true);
 }
 assert.deepEqual(getEffectivePermissions(null),[]);
 assert.equal(hasPermission({role:3,custom_permissions:[]},'recipes.view'),false);
});
