// Single read resolver. Declarations never participate in operational write validation.
const stock=require('./stock');
const {cycleBalance}=require('./harvestAreas');
const {productiveStateSql}=require('./productiveStateLegacy');
const signature=x=>x.kind+':'+(x.crop?.id||'');
const cropOf=x=>x.crop_id?{id:x.crop_id,name:x.crop_name}:null;
const empty=()=>({kind:'unknown',crop:null,source:'derived',observed_on:null,effective_date:null,quality:'insufficient',conflict:false,conflicts:[],evidence_ids:[]});
function resolveUnit(unit,date,cycles=[],declarations=[]) {
  const conflicts=[],events=[],supersededStarts=[];
  const applicable=cycles.filter(c=>c.lot_id===unit.lot_id && (c.sub_lot_id===null || c.sub_lot_id===unit.sub_lot_id));
  const uncertain=cycles.filter(c=>c.lot_id===unit.lot_id && c.sub_lot_id!==null && c.sub_lot_id!==unit.sub_lot_id && c.start_date<=date && (!c.end_date||c.end_date>=date));
  for(const c of uncertain)conflicts.push({type:'coverage_requires_review',assignment_id:c.id,crop_id:c.crop_id,crop_name:c.crop_name});
  for(const c of applicable) {
    if(c.start_date>date)continue;
    const start={kind:'growing_crop',crop:cropOf(c),effective_date:c.start_date,evidence_ids:[c.id],trusted:true};
    const harvests=(c.harvests||[]).filter(h=>h.enabled&&h.harvest_date<=date);
    const closed=c.end_date && c.end_date<date;
    if(!closed){
      events.push(start);
      // A partial real harvest is a dated fact, but never proof of full stubble.
      for(const h of harvests)events.push({kind:'growing_crop',crop:cropOf(c),effective_date:h.harvest_date,evidence_ids:[c.id,h.id],trusted:true});
    }else{
      const balance=cycleBalance(c.area_ha,harvests);
      const full=c.harvest_closure_source==='automatic' && balance.remaining===0 && balance.endDate===c.end_date && !(c.closures||[]).length;
      let end;
      if(full) end={kind:'stubble',crop:cropOf(c),effective_date:balance.endDate,evidence_ids:[c.id,...harvests.map(h=>h.id)],trusted:true};
      else {
        const closure=(c.closures||[]).filter(x=>x.finalized_date<=date).sort((a,b)=>a.finalized_date.localeCompare(b.finalized_date)).at(-1);
        end={kind:'unknown',crop:null,effective_date:closure?.finalized_date||c.end_date,
          evidence_ids:[c.id,...(closure?[closure.id]:[])],trusted:Boolean(closure)};
      }
      // After the inclusive end day, a same-date closure supersedes this cycle's
      // start. It is a transition, not two competing facts (including for declarations).
      // Keep earlier starts: trusted facts still establish declaration precedence.
      if(start.effective_date!==end.effective_date)events.push(start);
      else supersededStarts.push(start);
      events.push(end);
    }
  }
  const active=applicable.filter(c=>c.start_date<=date&&(!c.end_date||c.end_date>=date));
  if(active.length>1)for(const c of active)conflicts.push({type:'overlapping_cycles',assignment_id:c.id,crop_id:c.crop_id,crop_name:c.crop_name});
  const dated=declarations.filter(d=>d.observed_on<=date&&d.lot_id===unit.lot_id);
  const covers=d=>d.sub_lot_id===unit.sub_lot_id&&d.layout_id===unit.layout_id&&(d.coverage_key!==undefined&&unit.coverage_key!==undefined?d.coverage_key===unit.coverage_key:stock.fingerprint(d.coverage)===stock.fingerprint(unit.coverage));
  const candidates=dated.filter(covers);
  const leaves=candidates.filter(d=>!candidates.some(n=>n.supersedes_id===d.id));
  for(const d of dated.filter(d=>!covers(d)&&(d.sub_lot_id===unit.sub_lot_id||d.layout_id!==unit.layout_id)))
    conflicts.push({type:'declaration_coverage_changed',declaration_id:d.id});
  leaves.sort((a,b)=>b.observed_on.localeCompare(a.observed_on)||a.id.localeCompare(b.id));
  const latest=leaves[0],ties=latest?leaves.filter(d=>d.observed_on===latest.observed_on):[];
  const sorted=events.sort((a,b)=>b.effective_date.localeCompare(a.effective_date)||signature(a).localeCompare(signature(b)));
  const latestFact=sorted[0];
  let state=latestFact?{...empty(),...latestFact,quality:latestFact.kind==='unknown'?'insufficient':'evidenced'}:empty();
  if(latest){
    // Superseded starts still prove that a cycle began after a declaration,
    // but cannot compete with its closure as the resolved state or a conflict.
    const later=[...sorted,...supersededStarts].filter(e=>e.trusted&&e.effective_date>latest.observed_on)
      .sort((a,b)=>b.effective_date.localeCompare(a.effective_date))[0];
    if(!later){
      const declared={kind:latest.kind,crop:cropOf(latest)};
      state={...empty(),...declared,source:'declaration',observed_on:latest.observed_on,effective_date:null,quality:'confirmed',evidence_ids:[latest.id]};
      if(new Set(ties.map(d=>signature({kind:d.kind,crop:cropOf(d)}))).size>1){
        state={...state,kind:'unknown',crop:null,quality:'ambiguous',evidence_ids:ties.map(d=>d.id)};
        conflicts.push({type:'incompatible_declarations',declaration_ids:ties.map(d=>d.id)});
      }
      for(const e of sorted.filter(e=>e.effective_date===latest.observed_on&&signature(e)!==signature(declared)))
        conflicts.push({type:'same_day_fact_conflict',evidence_ids:e.evidence_ids});
    } else { const boundary=sorted.find(e=>e.effective_date>=later.effective_date)||later; state={...empty(),...boundary,quality:boundary.kind==='unknown'?'insufficient':'evidenced'}; }
  }
  for(const c of active)if(state.kind!=='growing_crop'||state.crop?.id!==c.crop_id)
    conflicts.push({type:'open_cycle_conflict',assignment_id:c.id,crop_id:c.crop_id,crop_name:c.crop_name});
  const sameDate=state.source==='derived'?sorted.filter(e=>e.effective_date===state.effective_date&&e.trusted):[];
  if(new Set(sameDate.map(signature)).size>1){ conflicts.push({type:'incompatible_facts',evidence_ids:sameDate.flatMap(e=>e.evidence_ids)}); state={...state,kind:'unknown',crop:null,quality:'ambiguous'}; }
  if(uncertain.length&&state.source==='derived')state={...empty(),evidence_ids:state.evidence_ids};
  delete state.trusted;
  state.conflicts=conflicts;state.conflict=conflicts.length>0;
  return state;
}
async function readUnits(client,companyId,lotId) {
  return (await client.query(`WITH base AS (
    SELECT l.*,ll.id AS layout_id FROM public.lots l LEFT JOIN public.lot_layouts ll
      ON ll.lot_id=l.id AND ll.company_id=l.company_id AND ll.status='active'
    WHERE l.company_id=$1 AND COALESCE(l.enabled,true)=true AND ($2::uuid IS NULL OR l.id=$2)
  ) SELECT l.id AS lot_id,l.name AS lot_name,l.enabled AS lot_enabled,sl.id AS sub_lot_id,l.layout_id,
    CASE WHEN sl.id IS NULL THEN 'whole_lot' ELSE 'sub_lots' END AS mode,
    COALESCE(sl.name,l.name) AS name,COALESCE(sl.area_ha,l.area_ha,NULLIF(l.area,0)::numeric) AS area_ha,
    cov.value AS coverage,cov.value::text AS coverage_key
  FROM base l LEFT JOIN public.sub_lots sl ON sl.layout_id=l.layout_id AND sl.lot_id=l.id
    AND sl.company_id=$1 AND sl.enabled=true
  CROSS JOIN LATERAL (SELECT jsonb_build_object('lot_id',l.id,'sub_lot_id',sl.id,'layout_id',l.layout_id,
    'geom',CASE WHEN sl.id IS NULL THEN to_jsonb(l)->'geom' ELSE to_jsonb(sl)->'geom' END,
    'area_ha',CASE WHEN sl.id IS NULL THEN l.area_ha ELSE sl.area_ha END) AS value) cov
  ORDER BY l.name,sl.sort_order,sl.id`,[companyId,lotId||null])).rows;
}
async function getStates(client,{companyId,lotId,date,includeLegacy=true,additionalDeclarations=[]}) {
  if(!date)date=(await client.query("SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text AS day")).rows[0].day;
  stock.calendarDate(date);
  const units=await readUnits(client,companyId,lotId);
  const lotIds=[...new Set(units.map(u=>u.lot_id))];
  const cycles=(await client.query(`SELECT to_jsonb(ca)||jsonb_build_object('crop_name',cr.name,
    'harvests',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',h.id,'harvest_date',h.harvest_date,
      'enabled',h.enabled,'harvested_area_ha',hc.harvested_area_ha)),'[]')
      FROM public.harvest_crop_assignments hc JOIN public.harvest_records h ON h.id=hc.harvest_id
      WHERE hc.crop_assignment_id=ca.id AND h.company_id=ca.company_id AND h.lot_id=ca.lot_id AND h.crop_id=ca.crop_id AND h.campaign_id=ca.campaign_id),
    'closures',(SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]') FROM public.harvest_cycle_closures x
      WHERE x.crop_assignment_id=ca.id AND x.company_id=ca.company_id)) AS value
    FROM public.crop_assignments ca JOIN public.crops cr ON cr.id=ca.crop_id AND cr.company_id=ca.company_id JOIN public.campaigns cp ON cp.id=ca.campaign_id AND cp.company_id=ca.company_id
    WHERE ca.company_id=$1 AND ca.lot_id=ANY($2::uuid[])`,[companyId,lotIds])).rows.map(r=>r.value);
  const declarations=(await client.query(`SELECT to_jsonb(d)||jsonb_build_object('crop_name',c.name,'coverage_key',d.coverage::text) AS value
    FROM public.productive_state_declarations d LEFT JOIN public.crops c ON c.id=d.crop_id AND c.company_id=d.company_id
    WHERE d.company_id=$1 AND d.lot_id=ANY($2::uuid[])`,[companyId,lotIds])).rows.map(r=>r.value).concat(additionalDeclarations);
  let legacy=[];
  // Compatibility projection only; state is always resolved above by the same data loader and pure resolver.
  if(includeLegacy)legacy=(await client.query(productiveStateSql(lotId?'AND l.id = $3':''),lotId?[companyId,date,lotId]:[companyId,date])).rows;
  const grouped=new Map();
  for(const unit of units){
    if(!grouped.has(unit.lot_id))grouped.set(unit.lot_id,{lot_id:unit.lot_id,lot_name:unit.lot_name,mode:unit.mode,date,units:[]});
    const old=legacy.find(r=>r.lot_id===unit.lot_id&&r.sub_lot_id===unit.sub_lot_id);
    grouped.get(unit.lot_id).units.push({...unit,state:resolveUnit(unit,date,cycles,declarations),
      current_crop:old?.current_crop||null,previous_crops:old?.previous_crops||[]});
  }
  return {date,data:[...grouped.values()]};
}
module.exports={resolveUnit,readUnits,getStates};
