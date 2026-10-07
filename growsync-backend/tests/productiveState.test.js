const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolveUnit}=require('../services/productiveState');

const unit={lot_id:'lot-2',sub_lot_id:null,layout_id:null,coverage_key:'whole'};
const cycle={id:'5636c381-fe9b-448c-8268-6e3e24047b4f',lot_id:unit.lot_id,sub_lot_id:null,
  crop_id:'corn',crop_name:'Maíz',start_date:'2026-07-17',end_date:'2026-07-17',
  area_ha:68.29,harvest_closure_source:'legacy',closures:[],
  harvests:[{id:'harvest',enabled:true,harvest_date:'2026-07-17',harvested_area_ha:68.29}]};
const declaration={id:'declaration',lot_id:unit.lot_id,sub_lot_id:null,layout_id:null,
  coverage_key:unit.coverage_key,kind:'fallow',crop_id:null,observed_on:'2026-07-17'};
const resolve=(c,date='2026-10-07',declarations=[])=>resolveUnit(unit,date,[c],declarations);
const noArtificialConflict=state=>assert.ok(!state.conflicts.some(c=>c.type==='incompatible_facts'));

test('same-day legacy cycle resolves unknown after closure, even with a full harvest',()=>{
  const state=resolve(cycle);
  assert.equal(state.kind,'unknown');assert.equal(state.quality,'insufficient');
  assert.equal(state.crop,null);assert.equal(state.effective_date,cycle.end_date);
  assert.deepEqual(state.evidence_ids,[cycle.id]);assert.equal(state.conflict,false);
});

test('same-day automatic complete closure resolves stubble without incompatible facts',()=>{
  const state=resolve({...cycle,harvest_closure_source:'automatic'});
  assert.equal(state.kind,'stubble');assert.equal(state.quality,'evidenced');
  assert.equal(state.crop.id,'corn');assert.equal(state.effective_date,cycle.end_date);
  assert.deepEqual(state.evidence_ids,[cycle.id,'harvest']);
  noArtificialConflict(state);assert.equal(state.conflict,false);
});

for(const source of ['legacy','automatic'])test(source+' same-day cycle remains growing on its inclusive end day',()=>{
  const state=resolve({...cycle,harvest_closure_source:source},cycle.end_date);
  assert.equal(state.kind,'growing_crop');assert.equal(state.quality,'evidenced');
  noArtificialConflict(state);
});

test('normal open cycle resolves growing_crop',()=>{
  const state=resolve({...cycle,end_date:null,harvests:[]});
  assert.equal(state.kind,'growing_crop');assert.equal(state.quality,'evidenced');
  assert.deepEqual(state.evidence_ids,[cycle.id]);
});

test('legacy multi-day cycle stays growing through end day and unknown afterwards',()=>{
  const c={...cycle,start_date:'2026-07-01'};
  for(const date of [c.start_date,'2026-07-10',c.end_date])assert.equal(resolve(c,date).kind,'growing_crop');
  const state=resolve(c,'2026-07-18');
  assert.equal(state.kind,'unknown');assert.equal(state.quality,'insufficient');
});

test('automatic closure still requires complete, enabled harvests and matching closure date',()=>{
  for(const patch of [
    {harvests:[]},
    {harvests:[{...cycle.harvests[0],harvested_area_ha:10}]},
    {harvests:[{...cycle.harvests[0],enabled:false}]},
    {end_date:'2026-07-18'},
  ]){
    const state=resolve({...cycle,harvest_closure_source:'automatic',...patch});
    assert.equal(state.kind,'unknown');assert.equal(state.quality,'insufficient');
  }
});

test('declarations retain same-day and later precedence over closed cycles',()=>{
  for(const source of ['legacy','automatic'])for(const observed_on of [cycle.end_date,'2026-10-06']){
    const state=resolve({...cycle,harvest_closure_source:source},'2026-10-07',[{...declaration,observed_on}]);
    assert.equal(state.kind,'fallow');assert.equal(state.source,'declaration');
    assert.equal(state.quality,'confirmed');noArtificialConflict(state);
    assert.equal(state.conflicts.some(c=>c.type==='same_day_fact_conflict'),observed_on===cycle.end_date);
  }
});

test('a later cycle start still supersedes an earlier declaration after same-day closure',()=>{
  const d={...declaration,observed_on:'2026-07-16'};
  const automatic=resolve({...cycle,harvest_closure_source:'automatic'},'2026-10-07',[d]);
  assert.equal(automatic.kind,'stubble');assert.equal(automatic.source,'derived');noArtificialConflict(automatic);
  const legacy=resolve(cycle,'2026-10-07',[d]);
  assert.equal(legacy.kind,'unknown');assert.equal(legacy.source,'derived');assert.equal(legacy.quality,'insufficient');
});

test('same-date incompatible facts from different assignments still produce ambiguity',()=>{
  const other={...cycle,id:'other',crop_id:'wheat',crop_name:'Trigo',end_date:null,harvests:[]};
  for(const cycles of [[{...cycle,harvest_closure_source:'automatic'},other],[other,{...cycle,harvest_closure_source:'automatic'}]]){
    const state=resolveUnit(unit,'2026-10-07',cycles);
    assert.equal(state.kind,'unknown');assert.equal(state.quality,'ambiguous');
    assert.ok(state.conflicts.some(c=>c.type==='incompatible_facts'));
  }
});
