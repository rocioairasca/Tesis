const {randomUUID}=require('node:crypto');
const {getEffectivePermissions}=require('../constants/permissions');
const {sameUnit}=require('./inventoryUnits');
const schema=require('../validations/receipts.schema');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const has=(user,permission)=>getEffectivePermissions(user).some(p=>p==='all'||p==='receipts.'+permission);
function context(user){
 if(!user?.id||!user?.company_id)throw fail('Sesión o empresa no disponible.',403);
 return {companyId:schema.id(user.company_id),actorId:schema.id(user.id),review:has(user,'review'),capture:has(user,'capture'),economics:has(user,'view_economics')};
}
async function transaction(pool,fn){
 if(!pool)throw fail('El servicio no está disponible.',503);
 const client=await pool.connect();
 try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
// Explicit operational projection: never SELECT *, never join economics.
const fields=['id','company_id','created_by','status','supplier_name','supplier_tax_id','document_number','document_type',
 'source_filename','source_mime_type','source_storage_key','notes','submitted_at','reviewed_at','reviewed_by',
 'rejected_at','rejected_by','rejection_reason','created_at','updated_at'];
const projection=`SELECT ${fields.map(f=>'r.'+f).join(',')},r.document_date::text AS document_date,
 (SELECT COALESCE(NULLIF(trim(u.full_name),''),u.email) FROM users u WHERE u.id=r.created_by AND u.company_id=r.company_id) AS created_by_name,
 (SELECT count(*)::int FROM receipt_submission_lines l WHERE l.receipt_id=r.id AND l.company_id=r.company_id) AS line_count
 FROM receipt_submissions r`;
async function actor(client,ctx){
 const result=await client.query('SELECT id FROM users WHERE company_id=$1 AND id=$2 AND enabled=true',[ctx.companyId,ctx.actorId]);
 if(!result.rows.length)throw fail('Usuario no disponible.',403);
}
async function header(client,ctx,receiptId,lock=false,own=false){
 if(!ctx.capture&&!ctx.review)throw fail('No tenés permiso para consultar remitos.',403);
 const params=[ctx.companyId,schema.id(receiptId)];
 const owner=own||!ctx.review; if(owner)params.push(ctx.actorId);
 const row=(await client.query(projection+' WHERE r.company_id=$1 AND r.id=$2'+(owner?' AND r.created_by=$3':'')+(lock?' FOR UPDATE OF r':''),params)).rows[0];
 if(!row)throw fail('No encontramos el remito.',404);return row;
}
function editable(row,ctx){
 if(ctx.review&&['draft','pending_validation'].includes(row.status))return;
 if(ctx.capture&&row.created_by===ctx.actorId&&row.status==='draft')return;
 throw fail('Este remito ya no admite cambios.',409);
}
async function warnings(client,ctx,row){
 if(!row.document_number||(!row.supplier_tax_id&&!row.supplier_name))return [];
 const params=[ctx.companyId,row.id,row.document_number,row.supplier_tax_id?.trim()||null,row.supplier_name?.trim()||null];
 const result=await client.query(`SELECT id FROM receipt_submissions WHERE company_id=$1 AND id<>$2 AND status<>'rejected'
 AND lower(trim(document_number))=lower(trim($3)) AND
 ((NULLIF(trim(supplier_tax_id),'') IS NOT NULL AND $4::text IS NOT NULL AND lower(trim(supplier_tax_id))=lower(trim($4)))
 OR ((NULLIF(trim(supplier_tax_id),'') IS NULL OR $4::text IS NULL) AND $5::text IS NOT NULL AND lower(trim(supplier_name))=lower(trim($5)))) LIMIT 1`,params);
 // Do not disclose another employee's document ID or contents.
 return result.rows.length?[{code:'possible_duplicate',message:'Existe otro remito no rechazado con este proveedor y número. Revisalo antes de continuar.'}]:[];
}
async function operationalDetail(client,ctx,row){
 const lines=(await client.query(`SELECT id,receipt_id,line_number,raw_description,quantity::text AS quantity,unit,presentation,supplier_batch,
 expiration_date::text AS expiration_date,matched_product_id,match_status,created_at,updated_at
 FROM receipt_submission_lines WHERE company_id=$1 AND receipt_id=$2 ORDER BY line_number,id`,[ctx.companyId,row.id])).rows;
 return {...row,lines,warnings:await warnings(client,ctx,row)};
}
async function detail({pool},{user,id}){
 const ctx=context(user),row=await header(pool,ctx,id),result=await operationalDetail(pool,ctx,row);
 // Review is not sufficient: the additional explicit economic permission is required.
 if(ctx.review&&ctx.economics){
  const economic=(await pool.query(`SELECT currency,subtotal::text AS subtotal,discounts::text AS discounts,taxes::text AS taxes,total::text AS total
   FROM receipt_submission_economics WHERE company_id=$1 AND receipt_id=$2`,[ctx.companyId,id])).rows[0];
  if(economic)result.economics=economic;
 }
 return result;
}
async function list({pool},{user,mine,filters}){
 const ctx=context(user),f=schema.parse(schema.query,filters||{});
 if(mine?!ctx.capture:!ctx.review)throw fail('No tenés permiso para consultar esta bandeja.',403);
 const params=[ctx.companyId],where=['r.company_id=$1'];
 if(mine){params.push(ctx.actorId);where.push('r.created_by=$'+params.length);}
 for(const key of ['status','document_date','supplier_name'])if(f[key]){
  params.push(f[key]);where.push(key==='supplier_name'?`strpos(lower(coalesce(r.supplier_name,'')),lower($${params.length}))>0`:`r.${key}=$${params.length}`);
 }
 const conditions=where.join(' AND '),total=(await pool.query('SELECT count(*)::int AS total FROM receipt_submissions r WHERE '+conditions,params)).rows[0].total;
 params.push(f.pageSize,(f.page-1)*f.pageSize);
 const data=(await pool.query(projection+' WHERE '+conditions+` ORDER BY r.created_at DESC,r.id DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params)).rows;
 return {data,total_count:total,page:f.page,pageSize:f.pageSize};
}
async function create({pool},{user,body}){
 const ctx=context(user),data=schema.parse(schema.metadata,body);
 if(!ctx.capture)throw fail('No tenés permiso para cargar remitos.',403);
 return transaction(pool,async c=>{
  await actor(c,ctx);const id=randomUUID(),keys=Object.keys(data);
  await c.query(`INSERT INTO receipt_submissions(id,company_id,created_by${keys.length?','+keys.join(','):''}) VALUES($1,$2,$3${keys.map((_,i)=>',$'+(i+4)).join('')})`,[id,ctx.companyId,ctx.actorId,...keys.map(k=>data[k])]);
  return operationalDetail(c,ctx,await header(c,ctx,id));
 });
}
async function mutate({pool},{user,id,body},action){
 const ctx=context(user);
 const data=schema.parse({patch:schema.metadata,lines:schema.lines,submit:schema.empty,reject:schema.reject}[action],body||{});
 if(action==='submit'&&!ctx.capture||action==='reject'&&!ctx.review)throw fail('No tenés permiso para realizar esta acción.',403);
 return transaction(pool,async c=>{
  await actor(c,ctx);const row=await header(c,ctx,id,true,action==='submit');
  if(['patch','lines'].includes(action))editable(row,ctx);
  if(action==='submit'){
   if(row.status!=='draft')throw fail('Solo se pueden enviar borradores.',409);
   if(!row.line_count)throw fail('Agregá al menos una línea antes de enviar.');
   await c.query("UPDATE receipt_submissions SET status='pending_validation',submitted_at=now(),updated_at=now() WHERE company_id=$1 AND id=$2",[ctx.companyId,id]);
  }else if(action==='reject'){
   if(row.status!=='pending_validation')throw fail('Solo se pueden rechazar remitos pendientes.',409);
   await c.query("UPDATE receipt_submissions SET status='rejected',rejection_reason=$3,rejected_by=$4,rejected_at=now(),reviewed_by=$4,reviewed_at=now(),updated_at=now() WHERE company_id=$1 AND id=$2",[ctx.companyId,id,data.reason,ctx.actorId]);
  }else{
   if(action==='patch'){
    const keys=Object.keys(data);
    if(keys.length)await c.query('UPDATE receipt_submissions SET '+keys.map((k,i)=>k+'=$'+(i+3)).join(',')+' WHERE company_id=$1 AND id=$2',[ctx.companyId,id,...keys.map(k=>data[k])]);
   }else{
    // Validate every match before deleting anything, within the same locked transaction.
    for(const line of data.lines)if(line.matched_product_id){
     const product=(await c.query('SELECT id,unit FROM products WHERE company_id=$1 AND id=$2 AND enabled=true FOR SHARE',[ctx.companyId,line.matched_product_id])).rows[0];
     if(!product||!sameUnit(product.unit,line.unit))throw fail('Producto o unidad no disponible para esta empresa.');
    }
    await c.query('DELETE FROM receipt_submission_lines WHERE company_id=$1 AND receipt_id=$2',[ctx.companyId,id]);
    for(const [index,line] of data.lines.entries())await c.query(`INSERT INTO receipt_submission_lines(company_id,receipt_id,line_number,raw_description,quantity,unit,presentation,supplier_batch,expiration_date,matched_product_id,match_status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[ctx.companyId,id,index+1,line.raw_description,line.quantity??null,line.unit??null,line.presentation??null,line.supplier_batch??null,line.expiration_date??null,line.matched_product_id??null,line.matched_product_id?'proposed':'unmatched']);
   }
   await c.query(`UPDATE receipt_submissions SET updated_at=now()${ctx.review?',reviewed_at=now(),reviewed_by=$3':''} WHERE company_id=$1 AND id=$2`,[ctx.companyId,id,...(ctx.review?[ctx.actorId]:[])]);
  }
  return operationalDetail(c,ctx,await header(c,ctx,id));
 });
}
async function products({pool},{user,search=''}){
 const ctx=context(user);if(!ctx.capture&&!ctx.review)throw fail('No tenés permiso.',403);
 const q=schema.parse(require('zod').z.string().trim().max(200),search);
 return (await pool.query("SELECT id,name,unit FROM products WHERE company_id=$1 AND enabled=true AND strpos(lower(name),lower($2))>0 ORDER BY name,id LIMIT 50",[ctx.companyId,q])).rows;
}
module.exports={context,has,fail,transaction,header,operationalDetail,detail,list,create,mutate,products};
