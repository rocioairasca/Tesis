const {assertSameUnit,sameUnit} = require('./inventoryUnits');
const { randomUUID, createHash } = require('node:crypto');
const { localToday } = require('./harvestRegistration');
const {normalizeQuantity}=require('./inventoryConversion');
const {expirationFields,effectiveExpirationSql}=require('./inventoryExpiration');

// Inventory V1 is standard for every authenticated company. Keep this adapter
// while legacy callers are retired; authorization and SQL tenant guards remain
// the responsibility of their existing middleware/services.
const isEnabled = companyId => Boolean(companyId);
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const SCALE = 1000000n;
function decimal(value) {
  const text = String(value);
  if (!/^-?\d{1,14}(\.\d{1,6})?$/.test(text)) throw fail('Cantidad inválida: máximo 6 decimales.', 400);
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  return (BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'))) * (text.startsWith('-') ? -1n : 1n);
}
const amount = value => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / SCALE}.${String((value < 0n ? -value : value) % SCALE).padStart(6, '0')}`;
function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw fail('Fecha calendario inválida.', 400);
  return value;
}
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
const fingerprint = data => createHash('sha256').update(JSON.stringify(stable(data))).digest('hex');
function context({ companyId, productId, actorId, key }) {
  if (!companyId || !productId || !actorId) throw fail('Empresa, producto y usuario son obligatorios.', 400);
  if (typeof key !== 'string' || !key.trim() || key.length > 200) throw fail('Idempotency-Key es obligatorio (máximo 200 caracteres).', 400);
}
async function transaction(pool, fn) {
  if (!pool) throw fail('Conexión SQL no disponible.', 503);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
// All *Stock methods accept the SAME client as the surrounding Usage/Planning
// transaction. They never commit. Product locks serialize receipts/consumptions/
// reversals; operation locks also serialize retries spanning different products.
async function replay(client, companyId, key, hash) {
  if (!companyId || !key) throw fail('Empresa e idempotencia obligatorias.', 400);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`stock:${companyId}:${key}`]);
  const { rows } = await client.query('SELECT * FROM stock_movements WHERE company_id=$1 AND idempotency_key=$2 ORDER BY id', [companyId, key]);
  if (!rows.length) return null;
  if (rows.some(row => row.request_hash !== hash)) throw fail('La clave de idempotencia ya corresponde a otra operación.');
  return rows;
}
async function lockProduct(client, companyId, productId, unit, allowDisabled = false) {
  const { rows } = await client.query('SELECT * FROM products WHERE company_id=$1 AND id=$2 FOR UPDATE', [companyId, productId]);
  const p = rows[0];
  if (!p || (!allowDisabled && !p.enabled)) throw fail('Producto no disponible.', 404);
  assertSameUnit(p.unit,unit);
  return p;
}
async function assertActor(client, companyId, actorId) {
  const { rows } = await client.query('SELECT id FROM users WHERE company_id=$1 AND id=$2 AND enabled=true', [companyId, actorId]);
  if (!rows.length) throw fail('Usuario no disponible en la empresa.', 403);
}
async function movement(client, x) {
  const { rows } = await client.query(`INSERT INTO stock_movements
    (company_id,product_id,batch_id,movement_type,quantity,unit,usage_id,operation_id,
     reversed_movement_id,idempotency_key,request_hash,occurred_at,created_by,notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,now()),$13,$14) RETURNING *`,
  [x.companyId,x.productId,x.batchId,x.type,x.quantity,x.unit,x.usageId || null,x.operationId,
    x.reversedId || null,x.key,x.hash,x.occurredAt || null,x.actorId,x.notes || null]);
  return rows[0];
}
async function consumeStock(client, x) {
  context(x);
  await require('./inventoryImpact').assertStockUsage(client,x.companyId,x.usageId);
  const quantity = decimal(x.quantity);
  if (quantity <= 0n) throw fail('El consumo debe ser positivo.', 400);
  const hash = fingerprint(x.requestData || { type: 'consumption', productId:x.productId, quantity:amount(quantity), unit:x.unit, usageId:x.usageId, actorId:x.actorId });
  const previous = await replay(client, x.companyId, x.key, hash);
  if (previous) return previous;
  await assertActor(client, x.companyId, x.actorId);
  const product = await lockProduct(client, x.companyId, x.productId, x.unit);
  if (!x.usageId) throw fail('El consumo requiere un registro de uso.', 400);
  const { rows: usage } = await client.query('SELECT id FROM usage_records WHERE company_id=$1 AND product_id=$2 AND id=$3 AND enabled=true', [x.companyId,x.productId,x.usageId]);
  if (!usage.length) throw fail('Uso no disponible en esta empresa/producto.', 404);
  const { rows: batches } = await client.query(`SELECT * FROM stock_batches
    WHERE company_id=$1 AND product_id=$2 AND enabled=true AND available_quantity>0
      AND (${effectiveExpirationSql} IS NULL OR ${effectiveExpirationSql} >= $3::date)
    ORDER BY ${effectiveExpirationSql} ASC NULLS LAST, received_date ASC NULLS LAST, id ASC FOR UPDATE`,
  [x.companyId,x.productId,localToday()]);
  if (batches.reduce((sum,b) => sum+decimal(b.available_quantity),0n) < quantity) throw fail('Stock utilizable insuficiente.');
  let remaining = quantity;
  const operationId = randomUUID(), result = [];
  for (const batch of batches) {
    if (!remaining) break;
    if (!sameUnit(batch.unit,product.unit)) throw fail('Unidad de partida incompatible.',400);
    const take = remaining < decimal(batch.available_quantity) ? remaining : decimal(batch.available_quantity);
    const { rows } = await client.query(`UPDATE stock_batches SET available_quantity=available_quantity-$1,updated_at=now()
      WHERE id=$2 AND company_id=$3 AND product_id=$4 AND available_quantity >= $1 RETURNING id`, [amount(take),batch.id,x.companyId,x.productId]);
    if (!rows.length) throw fail('El saldo cambió; reintentá la operación.');
    result.push(await movement(client,{...x,batchId:batch.id,type:'consumption',quantity:amount(-take),unit:product.unit,hash,operationId}));
    remaining -= take;
  }
  return result;
}
async function reverseStock(client, x) {
  context(x);
  if (!x.originalOperationId) throw fail('Operación original obligatoria.',400);
  const hash=fingerprint({type:'reversal',productId:x.productId,originalOperationId:x.originalOperationId,actorId:x.actorId});
  const previous=await replay(client,x.companyId,x.key,hash);
  if (previous) return previous;
  await assertActor(client,x.companyId,x.actorId);
  await lockProduct(client,x.companyId,x.productId,null,true);
  const {rows:originals}=await client.query(`SELECT * FROM stock_movements
    WHERE company_id=$1 AND product_id=$2 AND operation_id=$3 AND movement_type='consumption' ORDER BY batch_id FOR UPDATE`,[x.companyId,x.productId,x.originalOperationId]);
  if (!originals.length) throw fail('Consumo original no encontrado.',404);
  const {rows:reversed}=await client.query('SELECT id FROM stock_movements WHERE company_id=$1 AND reversed_movement_id=ANY($2::uuid[])',[x.companyId,originals.map(m=>m.id)]);
  if (reversed.length) throw fail('El consumo ya fue revertido.');
  const operationId=randomUUID(),result=[];
  for(const original of originals){
    await require('./inventoryImpact').assertStockUsage(client,x.companyId,original.usage_id);
    const quantity=amount(-decimal(original.quantity));
    const {rows}=await client.query(`UPDATE stock_batches SET available_quantity=available_quantity+$1,updated_at=now()
      WHERE company_id=$2 AND product_id=$3 AND id=$4 RETURNING id`,[quantity,x.companyId,x.productId,original.batch_id]);
    if(!rows.length) throw fail('Partida original no encontrada.',404);
    result.push(await movement(client,{...x,batchId:original.batch_id,usageId:original.usage_id,unit:original.unit,type:'reversal',quantity,operationId,hash,reversedId:original.id}));
  }
  return result;
}
async function receiveStock(client,x){
  context(x);
  let qty=decimal(x.quantity);
  if(qty<=0n) throw fail('El ingreso debe ser positivo.',400);
  if(['purchase','return'].includes(x.origin) && x.received_date==null) throw fail('La fecha de ingreso es obligatoria para compras y devoluciones.',400);
  const received=x.received_date==null ? null : calendarDate(x.received_date);
  if(received!==null && received>localToday()) throw fail('El ingreso no puede tener fecha futura.',400);
  const expiry=expirationFields(x);
  if(!['purchase','adjustment','return','legacy'].includes(x.origin)) throw fail('Origen inválido.',400);
  if(x.origin==='legacy' && x.approvedLegacy !== true) throw fail('Apertura legacy requiere aprobación explícita.');
  const hash=fingerprint({type:'receipt',...x,received_date:received,quantity:amount(qty),key:undefined});
  const previous=await replay(client,x.companyId,x.key,hash);
  if(previous) return previous;
  await assertActor(client,x.companyId,x.actorId);
  // Match STOCK_INITIAL's lock order: company gate before product, then batch.
  // The INSERT trigger also guards SQL writers; taking it here avoids an API
  // receipt holding the product while an opening holds the company gate.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`stock-initial:${x.companyId}`]);
  const product=await lockProduct(client,x.companyId,x.productId);
  const conversion=normalizeQuantity({quantity:x.quantity,inputUnit:x.unit,productUnit:product.unit});
  // Prices always refer to the stored base unit. Require explicit denomination
  // when quantity conversion could otherwise make a per-input-unit price ambiguous.
  if(x.unit_price_unit!=null) assertSameUnit(product.unit,x.unit_price_unit);
  if(conversion.converted && x.unit_price!=null && x.unit_price_unit==null) throw fail('unit_price se refiere a la unidad base; indicá unit_price_unit con esa unidad.',400);
  qty=decimal(conversion.normalized_quantity);
  const auditNotes=conversion.converted?`${x.notes?x.notes+'\n':''}Entrada: ${conversion.entered_quantity} ${conversion.entered_unit} → ${conversion.normalized_quantity} ${product.unit}`:x.notes;
  const {rows}=await client.query(`INSERT INTO stock_batches
    (company_id,product_id,initial_quantity,available_quantity,unit,received_date,expiration_date,
     expiration_year,expiration_month,
     unit_price,currency,exchange_rate,total_original,total_ars,supplier,reference,notes,origin,created_by)
    VALUES ($1,$2,$3,$3,$4,$5,$6,$17,$18,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
  [x.companyId,x.productId,amount(qty),product.unit,received,expiry.expiration_date,x.unit_price??null,
    x.currency??null,x.exchange_rate??null,x.total_original??null,x.total_ars??null,x.supplier??null,x.reference??null,x.notes??null,x.origin,x.actorId,
    expiry.expiration_year,expiry.expiration_month]);
  return [await movement(client,{...x,notes:auditNotes,batchId:rows[0].id,type:x.origin==='legacy'?'opening':x.origin==='adjustment'?'adjustment_in':'receipt',quantity:amount(qty),unit:product.unit,operationId:randomUUID(),hash})];
}
async function adjustStock(client, x) {
  context(x);
  if (!isEnabled(x.companyId)) throw fail('Los ajustes todavía no están disponibles.');
  let qty = decimal(x.quantity);
  if (qty <= 0n) throw fail('La cantidad debe ser mayor a cero.',400);
  if (!['in','out'].includes(x.direction)) throw fail('Tipo de ajuste inválido.',400);
  if (typeof x.reason !== 'string' || !x.reason.trim() || x.reason.length > 500) throw fail('El motivo es obligatorio (máximo 500 caracteres).',400);
  if (x.notes != null && (typeof x.notes !== 'string' || x.notes.length > 2000)) throw fail('Observación inválida.',400);
  const reason=x.reason.trim(), observation=x.notes?.trim() || null;
  const notes=`Motivo: ${reason}${observation ? `\nObservación: ${observation}` : ''}`;
  // notes is the existing human-readable audit field; no unrelated field is repurposed.
  const normalized={companyId:x.companyId,productId:x.productId,actorId:x.actorId,key:x.key,quantity:amount(qty),unit:x.unit,reason,notes};
  if(x.direction==='in') return receiveStock(client,{...normalized,origin:'adjustment',received_date:null,expiration_date:null});
  const hash=fingerprint({...normalized,type:'adjustment_out',key:undefined});
  const previous=await replay(client,x.companyId,x.key,hash);
  if(previous) return previous;
  await assertActor(client,x.companyId,x.actorId);
  const product=await lockProduct(client,x.companyId,x.productId);
  const conversion=normalizeQuantity({quantity:x.quantity,inputUnit:x.unit,productUnit:product.unit});
  qty=decimal(conversion.normalized_quantity);
  if(conversion.converted)normalized.notes+=`\nEntrada: ${conversion.entered_quantity} ${conversion.entered_unit} → ${conversion.normalized_quantity} ${product.unit}`;
  const {rows:batches}=await client.query(`SELECT * FROM stock_batches
    WHERE company_id=$1 AND product_id=$2 AND enabled=true AND available_quantity>0
    ORDER BY ${effectiveExpirationSql} ASC NULLS LAST,received_date ASC NULLS LAST,id ASC FOR UPDATE`,[x.companyId,x.productId]);
  if(batches.reduce((sum,b)=>sum+decimal(b.available_quantity),0n)<qty) throw fail('No hay stock suficiente para realizar este ajuste.');
  let remaining=qty;const operationId=randomUUID(),result=[];
  for(const batch of batches){
    if(!remaining) break;
    if(!sameUnit(batch.unit,product.unit)) throw fail('Unidad de partida incompatible.',400);
    const take=remaining<decimal(batch.available_quantity)?remaining:decimal(batch.available_quantity);
    const {rows}=await client.query(`UPDATE stock_batches SET available_quantity=available_quantity-$1,updated_at=now()
      WHERE id=$2 AND company_id=$3 AND product_id=$4 AND available_quantity >= $1 RETURNING id`,[amount(take),batch.id,x.companyId,x.productId]);
    if(!rows.length) throw fail('El saldo cambió; reintentá la operación.');
    result.push(await movement(client,{...normalized,batchId:batch.id,type:'adjustment_out',quantity:amount(-take),unit:product.unit,hash,operationId}));
    remaining-=take;
  }
  return result;
}
async function disableStockProduct(client,companyId,productId){
  await lockProduct(client,companyId,productId);
  // Include disabled batches too: unresolved physical stock must not be hidden.
  const {rows}=await client.query('SELECT id FROM stock_batches WHERE company_id=$1 AND product_id=$2 AND available_quantity>0 FOR UPDATE',[companyId,productId]);
  if(rows.length) throw fail('Para deshabilitar este producto, primero ajustá su stock o resolvé las existencias pendientes.');
  await client.query('UPDATE products SET enabled=false WHERE company_id=$1 AND id=$2',[companyId,productId]);
  return {ok:true,id:productId};
}
async function balances(client, companyId, ids){
  if(!companyId) throw fail('Empresa obligatoria.',400);
  if(!ids.length) return new Map();
  const {rows}=await client.query(`WITH batches AS (
      SELECT *,${effectiveExpirationSql} AS effective_expiration_date
      FROM stock_batches WHERE company_id=$1 AND product_id=ANY($2::uuid[]) AND enabled=true
    ), totals AS (
      SELECT product_id,COALESCE(sum(initial_quantity),0) AS total_quantity,COALESCE(sum(available_quantity),0) AS on_hand,
        COALESCE(sum(available_quantity) FILTER (WHERE effective_expiration_date IS NULL OR effective_expiration_date >= $3::date),0) AS available_quantity
      FROM batches GROUP BY product_id
    )
    SELECT t.*,usable.expiration_date,usable.expiration_year,usable.expiration_month,usable.effective_expiration_date,
      upcoming.expiration_date AS next_expiration_date,upcoming.expiration_year AS next_expiration_year,
      upcoming.expiration_month AS next_expiration_month,upcoming.effective_expiration_date AS next_effective_expiration_date
    FROM totals t
    LEFT JOIN LATERAL (
      SELECT expiration_date,expiration_year,expiration_month,effective_expiration_date FROM batches
      WHERE product_id=t.product_id AND available_quantity>0 AND effective_expiration_date >= $3::date
      ORDER BY effective_expiration_date ASC,received_date ASC NULLS LAST,id ASC LIMIT 1
    ) usable ON true
    LEFT JOIN LATERAL (
      SELECT expiration_date,expiration_year,expiration_month,effective_expiration_date FROM batches
      WHERE product_id=t.product_id AND available_quantity>0 AND effective_expiration_date IS NOT NULL
      ORDER BY effective_expiration_date ASC,received_date ASC NULLS LAST,id ASC LIMIT 1
    ) upcoming ON true`,[companyId,ids,localToday()]);
  return new Map(rows.map(r=>[r.product_id,r]));
}
async function decorate(client,companyId,products){
  if(!isEnabled(companyId)) return products.map(p=>({...p,stock_model:'legacy'}));
  const byId=await balances(client,companyId,products.map(p=>p.id));
  return products.map(p=>({...p,legacy_available_quantity:p.available_quantity,legacy_total_quantity:p.total_quantity,stock_model:'batches',
    total_quantity:byId.get(p.id)?.total_quantity||'0',
    available_quantity:byId.get(p.id)?.available_quantity||'0',on_hand_quantity:byId.get(p.id)?.on_hand||'0',
    expiration_date:byId.get(p.id)?.expiration_date||null,
    expiration_year:byId.get(p.id)?.expiration_year??null,
    expiration_month:byId.get(p.id)?.expiration_month??null,
    effective_expiration_date:byId.get(p.id)?.effective_expiration_date||null,
    next_expiration_date:byId.get(p.id)?.next_expiration_date||null,
    next_expiration_year:byId.get(p.id)?.next_expiration_year??null,
    next_expiration_month:byId.get(p.id)?.next_expiration_month??null,
    next_effective_expiration_date:byId.get(p.id)?.next_effective_expiration_date||null}));
}
const isLowStock=p=>Number(p.available_quantity||0)<=Number(p.minimum_stock??5);
module.exports={isEnabled,fail,decimal,amount,calendarDate,fingerprint,transaction,replay,lockProduct,consumeStock,reverseStock,receiveStock,adjustStock,disableStockProduct,balances,decorate,isLowStock};
