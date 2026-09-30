const {randomUUID}=require('node:crypto');
const stock=require('./stock');
const impact=require('./inventoryImpact');
const {normalizeQuantity}=require('./inventoryConversion');
async function createManualUsage(pool,{companyId,actorId,key,body}){
  impact.assertModeUnchanged({},body);
  const requestData={type:'manual-usage',actorId,body};
  return stock.transaction(pool,async client=>{
    const existing=await stock.replay(client,companyId,key,stock.fingerprint(requestData));
    if(existing) return {ok:true,id:existing[0].usage_id,replayed:true};
    const lots=[...new Set(body.lot_ids||[])];
    const {rows}=await client.query('SELECT id FROM lots WHERE company_id=$1 AND id=ANY($2::uuid[])',[companyId,lots]);
    if(!lots.length || rows.length!==lots.length) throw stock.fail('Lotes no disponibles en esta empresa.',400);
    if(body.user_id){
      const {rows:users}=await client.query('SELECT id FROM users WHERE company_id=$1 AND id=$2 AND enabled=true',[companyId,body.user_id]);
      if(!users.length) throw stock.fail('Responsable no disponible en esta empresa.',400);
    }
    stock.calendarDate(body.date);
    const {rows:crops}=await client.query(`SELECT DISTINCT crop_id FROM crop_assignments WHERE company_id=$1 AND lot_id=ANY($2::uuid[])
      AND sub_lot_id IS NULL AND start_date<=$3::date AND (end_date IS NULL OR end_date>=$3::date)`,[companyId,lots,body.date]);
    const product=await stock.lockProduct(client,companyId,body.product_id);
    const conversion=normalizeQuantity({quantity:body.amount_used,inputUnit:body.unit,productUnit:product.unit});
    body={...body,amount_used:conversion.normalized_quantity,unit:product.unit};
    const id=randomUUID();
    await client.query(`INSERT INTO usage_records
      (id,company_id,product_id,amount_used,unit,date,total_area,previous_crop,current_crop,user_id,created_by,crop_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,companyId,body.product_id,body.amount_used,body.unit,body.date,
      body.total_area??null,body.previous_crop??null,body.current_crop??null,body.user_id||actorId,actorId,crops.length===1?crops[0].crop_id:null]);
    for(const lotId of lots) await client.query('INSERT INTO usage_lots(usage_id,lot_id) VALUES ($1,$2)',[id,lotId]);
    await stock.consumeStock(client,{companyId,productId:body.product_id,actorId,key,quantity:body.amount_used,unit:body.unit,usageId:id,requestData});
    return {ok:true,id};
  });
}
async function disableManualUsage(pool,{companyId,actorId,usageId}){
  return stock.transaction(pool,async client=>{
    const {rows}=await client.query('SELECT * FROM usage_records WHERE company_id=$1 AND id=$2 FOR UPDATE',[companyId,usageId]);
    const usage=rows[0];
    if(!usage) throw stock.fail('Uso no encontrado.',404);
    if(impact.isHistorical(usage)) throw stock.fail('Usá el servicio de corrección histórica, sin stock.');
    if(usage.source_planning_id) throw stock.fail('El uso automático requiere reversión integral de Planning.');
    if(!usage.enabled) return {ok:true,id:usageId,replayed:true};
    const {rows:operations}=await client.query(`SELECT DISTINCT operation_id FROM stock_movements
      WHERE company_id=$1 AND product_id=$2 AND usage_id=$3 AND movement_type='consumption'`,[companyId,usage.product_id,usageId]);
    if(operations.length!==1) throw stock.fail('Uso legacy o ambiguo: requiere conciliación antes de revertir.');
    await stock.reverseStock(client,{companyId,productId:usage.product_id,actorId,originalOperationId:operations[0].operation_id,key:`disable-usage:${usageId}`});
    await client.query('UPDATE usage_records SET enabled=false WHERE company_id=$1 AND id=$2',[companyId,usageId]);
    return {ok:true,id:usageId};
  });
}
module.exports={createManualUsage,disableManualUsage};
