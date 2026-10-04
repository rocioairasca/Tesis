const {protectPlanning,planningGraph,planningMembership}=require('./historicalPlanningGuard');
const stock=require('./stock');
const {isHistorical,assertModeUnchanged,fail}=require('./inventoryImpact');
const {authorize,validateReferences}=require('./historicalImport');
const FIELDS={
  planning:['title','description','start_at','end_at','effective_date','responsible_user'],
  usage_records:['date','amount_used','total_area','previous_crop','current_crop','user_id'],
  harvest_records:['notes'],
};
async function event(client,companyId,actorId,table,id,before,after){
  // Bind serialized JSON as text so postgres.js does not encode it a second time.
  await client.query(`INSERT INTO historical_events(company_id,actor_id,entity_table,entity_id,before_data,after_data)
    VALUES($1,$2,$3,$4,$5::text::jsonb,$6::text::jsonb)`,[companyId,actorId,table,id,JSON.stringify(before),JSON.stringify(after)]);
}
// Returns null for ordinary operations. Historical edits are atomic and never call inventory/cycle services.
async function mutate(pool,{companyId,actorId,table,id,body={},enabled}){
  if (!FIELDS[table]) throw fail('Entidad histórica no editable.',400);
  return stock.transaction(pool,async client=>{
    const {rows}=await client.query(`SELECT * FROM ${table} WHERE company_id=$1 AND id=$2 FOR UPDATE`,[companyId,id]);
    const current=rows[0];
    if (!current) return null;
    assertModeUnchanged(current,body);
    if (!isHistorical(current)) return null;
    await authorize(client,companyId,actorId);
    const verifyProtected=table==='planning'?await protectPlanning(client,companyId,actorId,typeof enabled==='boolean'?(enabled?'planning.enable':'planning.disable'):'planning.edit'):null;
    const beforeGraph=table==='planning'?await planningGraph(client,id):null;
    let linkedCycles=false,beforeMembership;
    const before={...current};
    if(table==='planning'){
      before.products=(await client.query('SELECT * FROM planning_products WHERE planning_id=$1',[id])).rows;
      before.usages=(await client.query('SELECT * FROM usage_records WHERE company_id=$1 AND source_planning_id=$2',[companyId,id])).rows;
      before.lots=(await client.query('SELECT * FROM planning_lots WHERE planning_id=$1',[id])).rows;
    }else if(table==='usage_records') before.lots=(await client.query('SELECT * FROM usage_lots WHERE usage_id=$1',[id])).rows;
    const special=table==='planning'?['products','lot_selections']:table==='usage_records'?['lot_selections']:[];
    const allowed=[...FIELDS[table],...special,'inventory_impact_mode'];
    if(Object.keys(body).some(k=>!allowed.includes(k))) throw fail('Campo no editable en este antecedente. Conservá sus relaciones originales.',400);
    if (table==='usage_records' && current.source_planning_id) throw fail('Corregí el uso desde su Planning histórico.');
    const changes={};
    for(const key of FIELDS[table]) if(body[key]!==undefined) changes[key]=body[key];
    if(typeof enabled==='boolean') changes.enabled=enabled;
    if(changes.amount_used!==undefined && stock.decimal(changes.amount_used)<=0n) throw fail('Cantidad inválida.',400);
    if(changes.date!==undefined) stock.calendarDate(changes.date);
    if(changes.effective_date!==undefined) stock.calendarDate(changes.effective_date);
    const next={...current,...changes};
    if(table==='planning') {
      if(!Number.isFinite(Date.parse(next.start_at)) || !Number.isFinite(Date.parse(next.end_at)) || Date.parse(next.start_at)>Date.parse(next.end_at)) throw fail('Período inválido.',400);
      const {rows:assignments}=await client.query('SELECT id FROM crop_assignments WHERE company_id=$1 AND source_planning_id=$2',[companyId,id]);
      linkedCycles=assignments.length>0;
      if(linkedCycles){
        beforeMembership=await planningMembership(client,id);
        // Identical date submissions are no-ops; actual temporal changes still require integral review.
        for(const key of ['start_at','end_at','effective_date'])if(body[key]!==undefined){
          const equal=key==='effective_date'?String(body[key])===(current[key] instanceof Date?current[key].toISOString().slice(0,10):String(current[key]).slice(0,10)):Date.parse(body[key])===Date.parse(current[key]);
          if(!equal)throw fail('Esta actividad tiene un cultivo vinculado. Cambiar sus fechas requiere una revisión integral.',409);
          delete changes[key];
        }
        if(body.lot_selections!==undefined){
          const identity=rows=>rows.map(r=>String(r.lot_id).toLowerCase()+':'+String(r.sub_lot_id||'').toLowerCase()).sort();
          if(!Array.isArray(body.lot_selections) || body.lot_selections.some(r=>!r || typeof r!=='object') ||
            JSON.stringify(identity(body.lot_selections))!==JSON.stringify(identity(before.lots)))
            throw fail('Esta actividad tiene un cultivo vinculado. No se pueden cambiar sus lotes o subdivisiones desde esta corrección.',409);
        }
      }
    }
    await validateReferences(client,table,next,companyId);
    if(body.lot_selections!==undefined){
      if(!Array.isArray(body.lot_selections)||!body.lot_selections.length) throw fail('Superficies requeridas.',400);
      const keys=new Set();
      const child=table==='planning'?'planning_lots':'usage_lots', parent=table==='planning'?'planning_id':'usage_id';
      for(const selection of body.lot_selections){
        if(Object.keys(selection).some(k=>!['lot_id','sub_lot_id','area_ha'].includes(k))) throw fail('Superficie inválida.',400);
        const key=selection.lot_id+':'+(selection.sub_lot_id||'');
        if(keys.has(key)) throw fail('Superficie duplicada.',400);keys.add(key);
        if(selection.area_ha!=null && stock.decimal(selection.area_ha)<=0n) throw fail('Superficie inválida.',400);
        await validateReferences(client,child,{...selection,[parent]:id},companyId);
      }
      if(linkedCycles){
        // The worked area belongs to this activity, not to the geographic lot or structural crop cycle.
        for(const selection of body.lot_selections)await client.query(
          'UPDATE planning_lots SET area_ha=$4 WHERE planning_id=$1 AND lot_id=$2 AND sub_lot_id IS NOT DISTINCT FROM $3::uuid',
          [id,selection.lot_id,selection.sub_lot_id||null,selection.area_ha??null]);
      } else {
        await client.query(`DELETE FROM ${child} WHERE ${parent}=$1`,[id]);
        for(const s of body.lot_selections) await client.query(table==='planning'
          ? 'INSERT INTO planning_lots(planning_id,lot_id,sub_lot_id,area_ha) VALUES($1,$2,$3,$4)'
          : 'INSERT INTO usage_lots(usage_id,lot_id,sub_lot_id) VALUES($1,$2,$3)',
        table==='planning'?[id,s.lot_id,s.sub_lot_id||null,s.area_ha??null]:[id,s.lot_id,s.sub_lot_id||null]);
        if(table==='planning') {
          await client.query('DELETE FROM usage_lots WHERE usage_id IN (SELECT id FROM usage_records WHERE company_id=$1 AND source_planning_id=$2)',[companyId,id]);
          await client.query(`INSERT INTO usage_lots(usage_id,lot_id,sub_lot_id)
            SELECT u.id,pl.lot_id,pl.sub_lot_id FROM usage_records u JOIN planning_lots pl ON pl.planning_id=u.source_planning_id
            WHERE u.company_id=$1 AND u.source_planning_id=$2`,[companyId,id]);
        }
      }
    }
    if(body.products!==undefined){
      if(!Array.isArray(body.products)) throw fail('Productos inválidos.',400);
      const seen=new Set();
      for(const product of body.products){
        if(Object.keys(product).some(k=>!['planning_product_id','actual_amount','amount'].includes(k))||seen.has(product.planning_product_id)) throw fail('Corrección de producto inválida.',400);
        seen.add(product.planning_product_id);
        const {rows:pp}=await client.query(`SELECT pp.*,pc.usage_id,pc.actual_amount FROM planning_products pp LEFT JOIN planning_product_completions pc ON pc.planning_product_id=pp.id
          WHERE pp.id=$1 AND pp.planning_id=$2 FOR UPDATE OF pp`,[product.planning_product_id,id]);
        if(!pp.length||pp[0].actual_amount==null||stock.decimal(product.actual_amount)<=0n) throw fail('Se requiere un producto registrado con cantidad utilizada positiva.');
        if(pp[0].usage_id) await client.query('UPDATE usage_records SET amount_used=$2 WHERE id=$1 AND company_id=$3 AND inventory_impact_mode=\'HISTORICAL_NO_STOCK\'',[pp[0].usage_id,product.actual_amount,companyId]);
        await client.query('UPDATE planning_product_completions SET actual_amount=$2 WHERE planning_product_id=$1',[product.planning_product_id,product.actual_amount]);
        if(product.amount!==undefined){
          if(stock.decimal(product.amount)<=0n) throw fail('Cantidad planificada inválida.',400);
          await client.query('UPDATE planning_products SET amount=$2 WHERE id=$1',[product.planning_product_id,product.amount]);
        }
      }
    }
    if(Object.keys(changes).length){
      const entries=Object.entries(changes);
      await client.query(`UPDATE ${table} SET ${entries.map(([k],i)=>k+'=$'+(i+3)).join(',')} WHERE company_id=$1 AND id=$2`,[companyId,id,...entries.map(([,v])=>v)]);
    }
    if(table==='planning'){
      if(typeof enabled==='boolean') await client.query('UPDATE usage_records SET enabled=$3 WHERE company_id=$1 AND source_planning_id=$2',[companyId,id,enabled]);
      if(changes.effective_date!==undefined) await client.query('UPDATE usage_records SET date=$3 WHERE company_id=$1 AND source_planning_id=$2',[companyId,id,body.effective_date]);
    }
    if(table==='planning'){
      const afterGraph=await planningGraph(client,id);
      await client.query(`INSERT INTO historical_events(company_id,actor_id,entity_table,entity_id,before_data,after_data)
        VALUES($1,$2,'planning',$3,$4::text::jsonb,$5::text::jsonb || jsonb_build_object('request',$6::text::jsonb))`,
        [companyId,actorId,id,beforeGraph,afterGraph,JSON.stringify(body)]);
      await verifyProtected();
      if(linkedCycles && await planningMembership(client,id)!==beforeMembership)
        throw fail('No se guardó la corrección porque cambiaría los datos que vinculan esta actividad con su cultivo.',409);
    } else await event(client,companyId,actorId,table,id,before,{...next,request:body});
    return {ok:true,id,inventory_impact_mode:current.inventory_impact_mode};
  }).catch(error=>{
    if(['55P03','40P01','57014'].includes(error.code))throw fail('Hay operaciones en curso. Intentá guardar la corrección nuevamente en unos momentos.',409);
    throw error;
  });
}
module.exports={mutate};
