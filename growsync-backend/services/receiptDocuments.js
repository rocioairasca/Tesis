const {randomUUID}=require('node:crypto');
const receipts=require('./receipts');
const BUCKET='receipt-submissions',MAX_BYTES=10*1024*1024;
async function privateBucket(storage){
 if(!storage)throw receipts.fail('La carga de documentos no está disponible. Podés guardar el borrador manualmente.',503);
 const {data,error}=await storage.getBucket(BUCKET);
 if(error||data?.public!==false)throw receipts.fail('La carga de documentos no está disponible. Podés guardar el borrador manualmente.',503);
 return storage.from(BUCKET);
}
function validate(file){
 if(!file?.buffer?.length)throw receipts.fail('Seleccioná un PDF o una foto JPG/PNG.');
 if(file.buffer.length>MAX_BYTES)throw receipts.fail('El documento no puede superar 10 MB.',413);
 const b=file.buffer,type=file.mimetype;
 const valid=type==='application/pdf'?b.subarray(0,5).toString('ascii')==='%PDF-':type==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:false;
 if(!valid)throw receipts.fail('El contenido no corresponde a un PDF o una foto JPG/PNG.');
 return {filename:String(file.originalname||'documento').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g,'').slice(0,255)||'documento',type};
}
async function upload({pool,storage,logger=console},{user,id,file}){
 const ctx=receipts.context(user),meta=validate(file);
 if(!ctx.capture)throw receipts.fail('No tenés permiso para cargar documentos.',403);
 let bucket,key,oldKey,attempted=false;
 try{
  const result=await receipts.transaction(pool,async c=>{
   const row=await receipts.header(c,ctx,id,true,true);
   if(row.status!=='draft')throw receipts.fail('Solo se pueden adjuntar documentos a un borrador propio.',409);
   bucket=await privateBucket(storage);key=ctx.companyId+'/'+id+'/'+randomUUID();oldKey=row.source_storage_key;attempted=true;
   const response=await bucket.upload(key,file.buffer,{contentType:meta.type,upsert:false});
   if(response.error)throw receipts.fail('No pudimos guardar el documento. Intentá nuevamente.',503);
   await c.query('UPDATE receipt_submissions SET source_filename=$3,source_mime_type=$4,source_storage_key=$5,updated_at=now() WHERE company_id=$1 AND id=$2',[ctx.companyId,id,meta.filename,meta.type,key]);
   return receipts.operationalDetail(c,ctx,await receipts.header(c,ctx,id));
  });
  if(oldKey)try{const r=await bucket.remove([oldKey]);if(r.error)throw r.error;}catch{logger.error('No se pudo limpiar un documento reemplazado de Remitos.');}
  return result;
 }catch(error){
  if(attempted)try{const r=await bucket.remove([key]);if(r.error)throw r.error;}catch{logger.error('No se pudo limpiar un documento fallido de Remitos.');}
  throw error;
 }
}
async function fileUrl({pool,storage},{user,id}){
 const ctx=receipts.context(user),row=await receipts.header(pool,ctx,id);
 if(!row.source_storage_key||!row.source_storage_key.startsWith(ctx.companyId+'/'+id+'/'))throw receipts.fail('El remito no tiene documento adjunto.',404);
 const bucket=await privateBucket(storage),result=await bucket.createSignedUrl(row.source_storage_key,60,{download:row.source_filename});
 if(result.error||!result.data?.signedUrl)throw receipts.fail('No pudimos abrir el documento.',503);
 return {url:result.data.signedUrl,filename:row.source_filename,expires_at:new Date(Date.now()+60000).toISOString()};
}
module.exports={BUCKET,MAX_BYTES,upload,fileUrl};
