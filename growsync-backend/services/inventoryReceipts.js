const {z}=require('zod');
const {randomUUID}=require('node:crypto');
const stock=require('./stock');
const {getEffectivePermissions,PERMISSIONS}=require('../constants/permissions');
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
const optionalText=max=>z.string().trim().max(max).nullable().optional();
const schema=z.object({
  received_date:z.string(),supplier:optionalText(500),document_type:optionalText(100),
  reference:optionalText(500),notes:optionalText(2000),
  items:z.array(z.object({
    product_id:uuid,quantity:z.union([z.string(),z.number()]),
    unit:require('./inventoryUnits').inputUnitSchema.optional(),
    expiration_date:z.string().nullable().optional(),
    expiration_year:z.number().int().min(2000).max(2100).nullable().optional(),
    expiration_month:z.number().int().min(1).max(12).nullable().optional(),
  }).strict()).min(1).max(100),
}).strict();
function parse(body) {
  let result;
  try {result=schema.parse(body);} catch(e) {if(e instanceof z.ZodError)e.status=400;throw e;}
  if(new Set(result.items.map(i=>i.product_id)).size!==result.items.length)
    throw stock.fail('No se puede repetir un producto en el mismo ingreso.',400);
  result.received_date=stock.calendarDate(result.received_date);
  result.items=result.items.map(item=>{
    const quantity=stock.decimal(item.quantity);
    if(quantity<=0n)throw stock.fail('El ingreso debe ser positivo.',400);
    return {...item,quantity:stock.amount(quantity)};
  });
  return result;
}
async function result(client,receipt) {
  const {rows:movements}=await client.query(`SELECT m.* FROM stock_movements m
    JOIN stock_batches b ON b.id=m.batch_id AND b.company_id=m.company_id AND b.product_id=m.product_id
    WHERE b.company_id=$1 AND b.inventory_receipt_id=$2 AND m.movement_type='receipt'
    ORDER BY m.product_id,m.id`,[receipt.company_id,receipt.id]);
  return {receipt,movements};
}
async function create(pool,{user,body,key}) {
  const permissions=getEffectivePermissions(user);
  if(!Number.isFinite(Number(user?.role)) || Number(user.role)<2 ||
    (!permissions.includes('all')&&!permissions.includes(PERMISSIONS.INVENTORY_EDIT)))
    throw stock.fail('No tenés permiso para registrar ingresos.',403);
  const companyId=uuid.parse(user?.company_id),actorId=uuid.parse(user?.id),data=parse(body);
  if(typeof key!=='string'||!key.trim()||key.length>200)
    throw stock.fail('Idempotency-Key es obligatorio (máximo 200 caracteres).',400);
  const hash=stock.fingerprint({actorId,...data});
  return stock.transaction(pool,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`inventory-receipt:${companyId}:${key}`]);
    const actor=await client.query('SELECT id FROM users WHERE company_id=$1 AND id=$2 AND enabled=true',[companyId,actorId]);
    if(!actor.rows.length)throw stock.fail('Usuario no disponible en la empresa.',403);
    const previous=await client.query('SELECT * FROM inventory_receipts WHERE company_id=$1 AND idempotency_key=$2',[companyId,key]);
    if(previous.rows.length) {
      if(previous.rows[0].request_hash!==hash)throw stock.fail('La clave de idempotencia ya corresponde a otra operación.');
      return result(client,previous.rows[0]);
    }
    const id=randomUUID();
    const {rows}=await client.query(`INSERT INTO inventory_receipts
      (id,company_id,received_date,supplier,document_type,reference,notes,created_by,idempotency_key,request_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id,companyId,data.received_date,data.supplier??null,data.document_type??null,data.reference??null,data.notes??null,actorId,key,hash]);
    // One connection/transaction, existing stock rules and lock order. No valuation is
    // manufactured: missing price retains the current pending-valuation behavior.
    for(const item of [...data.items].sort((a,b)=>a.product_id.localeCompare(b.product_id))) {
      const {product_id:productId,...fields}=item;
      const movements=await stock.receiveStock(client,{...fields,companyId,productId,actorId,
        key:`receipt:${id}:${productId}`,origin:'purchase',received_date:data.received_date,
        supplier:data.supplier??null,reference:data.reference??null,notes:data.notes??null});
      await client.query(`UPDATE stock_batches SET inventory_receipt_id=$1
        WHERE company_id=$2 AND product_id=$3 AND id=$4`,[id,companyId,productId,movements[0].batch_id]);
    }
    return result(client,rows[0]);
  });
}
module.exports={create,parse};
