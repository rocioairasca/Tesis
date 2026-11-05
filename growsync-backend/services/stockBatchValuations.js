const { z } = require('zod');
const stock = require('./stock');
const { getEffectivePermissions, PERMISSIONS } = require('../constants/permissions');

const uuid = z.string().uuid();
const money = z.string().regex(/^\d{1,14}(\.\d{1,6})?$/, 'Ingresá un importe con hasta seis decimales.')
  .transform(value => stock.amount(stock.decimal(value)));
const optionalText = max => z.string().trim().max(max).transform(value => value || null).nullable().optional();
const date = z.string().refine(value => {
  try { stock.calendarDate(value); return true; } catch { return false; }
}, 'Fecha inválida.').nullable().optional();
const bodySchema = z.object({
  status: z.enum(['pending','confirmed']),
  supersedes_id: uuid.nullable(),
  currency: z.enum(['USD','ARS']).nullable().optional(),
  unit_cost_original: money.nullable().optional(),
  invoice_total_original: money.nullable().optional(),
  invoice_date: date,
  supplier_name: optionalText(500),
  invoice_reference: optionalText(500),
  payment_date: date,
  provenance: z.enum(['manual','legacy_review']).default('manual'),
  reason: optionalText(2000),
}).strict();

function parseBody(body) {
  let parsed;
  try { parsed = bodySchema.parse(body); }
  catch (error) { error.status = 400; throw error; }
  const data = Object.fromEntries(Object.entries(parsed).map(([key,value]) => [key,value ?? null]));
  for (const key of ['currency','unit_cost_original','invoice_total_original','invoice_date','supplier_name','invoice_reference','payment_date','reason']) {
    data[key] ??= null;
  }
  if ((data.unit_cost_original !== null || data.invoice_total_original !== null) && !data.currency)
    throw stock.fail('Los importes requieren moneda.',400);
  if (data.status === 'confirmed' && (data.currency !== 'USD' || data.unit_cost_original === null))
    throw stock.fail('Para confirmar ingresá un costo unitario en USD. ARS permanece pendiente en esta etapa.',400);
  if (data.supersedes_id && !data.reason) throw stock.fail('Indicá el motivo de la nueva revisión.',400);
  data.unit_cost_usd = data.status === 'confirmed' ? data.unit_cost_original : null;
  return data;
}
function context({user,productId,batchId}) {
  try { return {companyId:uuid.parse(user?.company_id),actorId:uuid.parse(user?.id),
    productId:uuid.parse(productId),batchId:uuid.parse(batchId)}; }
  catch(error) { error.status=400; throw error; }
}
async function batch(client,ctx,user,lock=false) {
  const {rows}=await client.query(`SELECT b.id,b.unit,b.initial_quantity,p.enabled AS product_enabled
    FROM stock_batches b JOIN products p ON p.id=b.product_id AND p.company_id=b.company_id
    WHERE b.company_id=$1 AND b.product_id=$2 AND b.id=$3 ${lock?'FOR UPDATE OF b':''}`,
    [ctx.companyId,ctx.productId,ctx.batchId]);
  if(!rows.length) throw stock.fail('Partida no encontrada.',404);
  const permissions=getEffectivePermissions(user);
  if(!rows[0].product_enabled && !permissions.includes('all') && !permissions.includes(PERMISSIONS.INVENTORY_VIEW_DISABLED))
    throw stock.fail('No tenés permiso para ver productos deshabilitados.',403);
  const {product_enabled,...result}=rows[0];
  return result;
}
const currentRow = async(client,ctx)=>(await client.query(
  'SELECT * FROM stock_batch_valuations WHERE company_id=$1 AND batch_id=$2 ORDER BY revision DESC LIMIT 1',
  [ctx.companyId,ctx.batchId])).rows[0] || null;
// Explicit projection keeps idempotency internals out of responses.
function publicRow(row) {
  if(!row) return null;
  const {idempotency_key,request_hash,...result}=row;
  return result;
}
async function current(pool,args) {
  const ctx=context(args),physical=await batch(pool,ctx,args.user);
  const row=await currentRow(pool,ctx);
  return {batch:physical,status:row?.status || 'pending',current:publicRow(row)};
}
async function history(pool,args) {
  const ctx=context(args);
  await batch(pool,ctx,args.user);
  let page,pageSize;
  try {
    page=z.coerce.number().int().min(1).default(1).parse(args.page);
    pageSize=z.coerce.number().int().min(1).max(100).default(25).parse(args.pageSize);
  } catch(error) { error.status=400; throw error; }
  const {rows}=await pool.query('SELECT * FROM stock_batch_valuations WHERE company_id=$1 AND batch_id=$2 ORDER BY revision DESC LIMIT $3 OFFSET $4',
    [ctx.companyId,ctx.batchId,pageSize,(page-1)*pageSize]);
  return {data:rows.map(publicRow),page,pageSize};
}
async function create(pool,args) {
  const ctx=context(args),data=parseBody(args.body);
  if(typeof args.key!=='string' || !args.key.trim() || args.key.length>200)
    throw stock.fail('Idempotency-Key es obligatorio (máximo 200 caracteres).',400);
  const hash=stock.fingerprint({...ctx,data});
  return stock.transaction(pool,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`valuation:${ctx.companyId}:${args.key}`]);
    await batch(client,ctx,args.user,true);
    const actor=await client.query('SELECT id FROM users WHERE company_id=$1 AND id=$2 AND enabled=true',[ctx.companyId,ctx.actorId]);
    if(!actor.rows.length) throw stock.fail('Usuario no disponible en la empresa.',403);
    const replay=await client.query('SELECT * FROM stock_batch_valuations WHERE company_id=$1 AND idempotency_key=$2',[ctx.companyId,args.key]);
    if(replay.rows.length) {
      if(replay.rows[0].request_hash!==hash) throw stock.fail('La clave de idempotencia corresponde a otra operación.');
      return {valuation:publicRow(replay.rows[0]),replayed:true};
    }
    const previous=await currentRow(client,ctx);
    if((previous?.id || null)!==data.supersedes_id)
      throw stock.fail('La valorización cambió. Actualizá la partida antes de crear otra revisión.');
    const columns=['company_id','batch_id','revision','created_by','idempotency_key','request_hash',...Object.keys(data)];
    const values=[ctx.companyId,ctx.batchId,(previous?.revision || 0)+1,ctx.actorId,args.key,hash,...Object.values(data)];
    const {rows}=await client.query(`INSERT INTO stock_batch_valuations (${columns.join(',')})
      VALUES (${values.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,values);
    return {valuation:publicRow(rows[0]),replayed:false};
  });
}
module.exports={parseBody,current,history,create};
