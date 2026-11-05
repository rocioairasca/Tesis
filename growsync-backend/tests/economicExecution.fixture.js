const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const migrations=[
 '20261103_add_campaign_work_end_date.sql','20260914_inventory_base_units.sql','20260916_historical_no_stock.sql',
 '20261007_planning_effective_area.sql','20261008_planning_field_context.sql','20261012_recipes.sql',
 '20261012_planning_recipe_snapshots.sql','20261018_planning_assignment.sql','20261104_stock_batch_valuations.sql','20261105_economic_execution.sql'];
async function schema(db){
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
 await db.exec(fs.readFileSync(require.resolve('./historySchema.fixture.sql'),'utf8'));
 for(const f of migrations)await db.exec(fs.readFileSync(require.resolve('../migrations/'+f),'utf8'));
}
function controller(pool){
 const filename=require.resolve('../controllers/planning'),actual=createRequire(filename),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,require:name=>{
   if(name==='../db/supabaseClient')return {pool};
   if(name==='./notifications')return {createNotification:async()=>({})};
   return actual(name);
 }},{filename});
 return module.exports;
}
module.exports={schema,controller};


// Existing operational suites explicitly choose their fixture crop; no production inference.
async function install(db){
 for(const f of ['20261104_stock_batch_valuations.sql','20261105_economic_execution.sql'])
  await db.exec(fs.readFileSync(require.resolve('../migrations/'+f),'utf8'));
}
async function executionBody(db,method,body,id,crop){
 if(!['completeWork','completeSowing','completeActivity','registerCompleted'].includes(method)||body.economic)return body;
 const lots=method==='registerCompleted'?(body.lot_selections||(body.lot_ids||[]).map(lot_id=>({lot_id}))):
  (await db.query('SELECT lot_id,sub_lot_id FROM planning_lots WHERE planning_id=$1',[id])).rows;
 return {...body,economic:{targets:lots.map(l=>({lot_id:l.lot_id,sub_lot_id:l.sub_lot_id||null,beneficiary_crop_id:crop}))}};
}
module.exports.install=install;
module.exports.executionBody=executionBody;
