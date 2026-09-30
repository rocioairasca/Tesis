const {z}=require('zod');
const {pool}=require('../../db/supabaseClient');
const stock=require('../../services/stock');
const {getEffectivePermissions,PERMISSIONS}=require('../../constants/permissions');
const uuid=z.string().uuid();
const money=z.coerce.number().finite().nonnegative().nullable().optional();
const receipt=z.object({quantity:z.union([z.string(),z.number()]),unit:require('../../services/inventoryUnits').inputUnitSchema.optional(),
  unit_price_unit:require('../../services/inventoryUnits').unitSchema.optional(),
  received_date:z.string().nullable().optional(),expiration_date:z.string().nullable().optional(),
  expiration_year:z.number().int().min(2000).max(2100).nullable().optional(),
  expiration_month:z.number().int().min(1).max(12).nullable().optional(),
  origin:z.enum(['purchase','adjustment','return']),unit_price:money,currency:z.enum(['ARS','USD']).nullable().optional(),
  exchange_rate:z.coerce.number().finite().positive().nullable().optional(),total_original:money,total_ars:money,
  supplier:z.string().max(500).nullable().optional(),reference:z.string().max(500).nullable().optional(),notes:z.string().max(2000).nullable().optional()}).strict()
  .refine(body=>!['purchase','return'].includes(body.origin)||body.received_date!=null,
    {path:['received_date'],message:'La fecha de ingreso es obligatoria para compras y devoluciones.'});
const guard=req=>{
  const companyId=uuid.parse(req.user?.company_id),productId=uuid.parse(req.params.id);
  if(!stock.isEnabled(companyId)) throw stock.fail('El modelo de partidas todavía no está activado para esta empresa.');
  return {companyId,productId};
};
const handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e instanceof z.ZodError)e.status=400;next(e);}};
const registerReceipt=handle(async(req,res)=>{
  const ctx=guard(req),body=receipt.parse(req.body);
  if(body.origin==='adjustment') throw stock.fail('Usá Ajustar stock e indicá un motivo.',400);
  if([body.unit_price,body.total_original,body.total_ars].some(x=>x!=null)&&!body.currency) throw stock.fail('Los importes requieren moneda.',400);
  if(body.currency==='USD' && !body.exchange_rate) throw stock.fail('USD requiere tipo de cambio.',400);
  const movements=await stock.transaction(pool,c=>stock.receiveStock(c,{...body,...ctx,actorId:req.user.id,key:req.get('Idempotency-Key')}));
  res.status(200).json({movements});
});
const list=table=>handle(async(req,res)=>{
  const ctx=guard(req),page=z.coerce.number().int().min(1).default(1).parse(req.query.page),size=z.coerce.number().int().min(1).max(200).default(50).parse(req.query.pageSize);
  const {rows:products}=await pool.query('SELECT id,enabled FROM products WHERE company_id=$1 AND id=$2',[ctx.companyId,ctx.productId]);
  if(!products.length) throw stock.fail('Producto no encontrado.',404);
  const permissions=getEffectivePermissions(req.user);
  if(!products[0].enabled && !permissions.includes('all') && !permissions.includes(PERMISSIONS.INVENTORY_VIEW_DISABLED)) throw stock.fail('No tenés permiso para ver productos deshabilitados.',403);
  // table is a server-owned constant, never user input.
  const query = table === 'stock_movements'
    ? `SELECT m.*,b.reference AS batch_reference,b.received_date AS batch_received_date,b.origin AS batch_origin,b.supplier AS batch_supplier
       FROM stock_movements m JOIN stock_batches b ON b.id=m.batch_id AND b.company_id=m.company_id AND b.product_id=m.product_id
       WHERE m.company_id=$1 AND m.product_id=$2 ORDER BY m.occurred_at DESC,m.id DESC LIMIT $3 OFFSET $4`
    : `SELECT * FROM stock_batches WHERE company_id=$1 AND product_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`;
  const {rows}=await pool.query(query,[ctx.companyId,ctx.productId,size,(page-1)*size]);
  res.json({data:rows,page,pageSize:size});
});
const adjustment=z.object({direction:z.enum(['in','out']),quantity:z.union([z.string(),z.number()]),unit:require('../../services/inventoryUnits').inputUnitSchema.optional(),reason:z.string().trim().min(1).max(500),notes:z.string().max(2000).nullable().optional()}).strict();
const registerAdjustment=handle(async(req,res)=>{
  const ctx=guard(req),body=adjustment.parse(req.body);
  const result=await stock.transaction(pool,async c=>{
    const movements=await stock.adjustStock(c,{...body,...ctx,actorId:req.user.id,key:req.get('Idempotency-Key')});
    const {rows}=await c.query('SELECT * FROM products WHERE company_id=$1 AND id=$2',[ctx.companyId,ctx.productId]);
    return {movements,product:(await stock.decorate(c,ctx.companyId,rows))[0]};
  });
  res.json(result);
});
module.exports={registerReceipt,registerAdjustment,listBatches:list('stock_batches'),listMovements:list('stock_movements')};
