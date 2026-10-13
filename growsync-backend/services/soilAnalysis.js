const {randomUUID}=require('node:crypto');
const {metadata,query,parse}=require('../validations/soilAnalysis.schema');
const {z}=require('zod');
const BUCKET='soil-reports',MAX_BYTES=10*1024*1024;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const id=value=>parse(z.string().uuid(),value);
function validateFile(file){
 if(!file||!Buffer.isBuffer(file.buffer)||file.buffer.length===0)throw fail('Seleccioná un archivo PDF no vacío.');
 if(file.buffer.length>MAX_BYTES||file.size>MAX_BYTES)throw fail('El PDF no puede superar 10 MB.',413);
 if(file.mimetype!=='application/pdf'||file.buffer.subarray(0,5).toString('ascii')!=='%PDF-')throw fail('El archivo debe ser un PDF válido.');
 return {filename:String(file.originalname||'informe.pdf').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g,'').slice(0,255)||'informe.pdf',size:file.buffer.length};
}
async function privateBucket(storage){
 if(!storage)throw fail('La carga de documentos no está disponible. Contactá al administrador.',503);
 const {data,error}=await storage.getBucket(BUCKET);
 if(error||data?.public!==false)throw fail('La carga de documentos no está disponible. Contactá al administrador.',503);
 return storage.from(BUCKET);
}
async function validateReferences(client,companyId,samples,lock=false){
 for(const sample of samples){
  const lot=(await client.query('SELECT id FROM lots WHERE id=$1 AND company_id=$2'+(lock?' FOR SHARE':''),[sample.lot_id,companyId])).rows[0];
  if(!lot)throw fail('Uno de los lotes no pertenece a tu empresa.');
  if(sample.sub_lot_id&&!(await client.query("SELECT sl.id FROM sub_lots sl JOIN lot_layouts ll ON ll.id=sl.layout_id AND ll.company_id=sl.company_id AND ll.lot_id=sl.lot_id WHERE sl.id=$1 AND sl.lot_id=$2 AND sl.company_id=$3 AND ll.status IN ('active','locked','archived')"+(lock?' FOR SHARE OF sl,ll':''),[sample.sub_lot_id,sample.lot_id,companyId])).rows.length)throw fail('La división no corresponde al lote o todavía está en edición. Elegí una división vigente o histórica.');
 }
}
async function transaction(pool,fn){const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
async function saveSamples(client,companyId,reportId,samples){
 for(const sample of samples){
  const sampleId=randomUUID();await client.query(`INSERT INTO soil_samples(id,report_id,company_id,lot_id,sub_lot_id,sample_date,depth_from_cm,depth_to_cm,sample_name,position_description,sampled_by,notes)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[sampleId,reportId,companyId,sample.lot_id,sample.sub_lot_id??null,sample.sample_date,sample.depth_from_cm??null,sample.depth_to_cm??null,sample.sample_name??null,sample.position_description??null,sample.sampled_by??null,sample.notes??null]);
  for(const result of sample.results)await client.query(`INSERT INTO soil_sample_results(sample_id,company_id,parameter_name,method,unit,raw_value,numeric_value,result_status,sort_order)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[sampleId,companyId,result.parameter_name,result.method??null,result.unit??null,result.raw_value,result.numeric_value??null,result.result_status,result.sort_order]);
 }
}
const projection=`SELECT r.id,r.company_id,r.report_number,r.laboratory,r.received_date,r.original_filename,r.mime_type,r.file_size,r.notes,r.enabled,r.created_by,r.created_at,r.updated_at,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'report_id',s.report_id,'lot_id',s.lot_id,'lot_name',l.name,'sub_lot_id',s.sub_lot_id,'sub_lot_name',sl.name,
  'sample_date',s.sample_date,'depth_from_cm',s.depth_from_cm::text,'depth_to_cm',s.depth_to_cm::text,'sample_name',s.sample_name,'position_description',s.position_description,'sampled_by',s.sampled_by,'notes',s.notes,
  'results',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'parameter_name',v.parameter_name,'method',v.method,'unit',v.unit,'raw_value',v.raw_value,'numeric_value',v.numeric_value::text,'result_status',v.result_status,'sort_order',v.sort_order) ORDER BY v.sort_order,v.id)
   FROM soil_sample_results v WHERE v.sample_id=s.id AND v.company_id=r.company_id),'[]'::jsonb)) ORDER BY s.sample_date DESC,s.id)
  FROM soil_samples s JOIN lots l ON l.id=s.lot_id AND l.company_id=r.company_id LEFT JOIN sub_lots sl ON sl.id=s.sub_lot_id AND sl.company_id=r.company_id
  WHERE s.report_id=r.id AND s.company_id=r.company_id),'[]'::jsonb) AS samples FROM soil_reports r`;
async function read(client,companyId,reportId,includeDisabled=false,lock=false){
 const row=(await client.query(projection+' WHERE r.id=$2 AND r.company_id=$1'+(lock?' FOR UPDATE OF r':''),[companyId,id(reportId)])).rows[0];
 if(!row||(!row.enabled&&!includeDisabled))throw fail('No encontramos el análisis solicitado.',404);return row;
}
async function create({pool,storage,logger=console},{companyId,actorId,body,file}){
 const data=parse(metadata,body),pdf=validateFile(file);await validateReferences(pool,companyId,data.samples);
 const reportId=randomUUID(),storagePath=companyId+'/'+reportId+'/report.pdf',bucket=await privateBucket(storage);let attempted=false;
 try{
  attempted=true;const upload=await bucket.upload(storagePath,file.buffer,{contentType:'application/pdf',upsert:false});
  if(upload.error)throw fail('No pudimos guardar el PDF. Intentá nuevamente.',503);
  return await transaction(pool,async client=>{
   await validateReferences(client,companyId,data.samples,true);
   await client.query(`INSERT INTO soil_reports(id,company_id,report_number,laboratory,received_date,storage_bucket,storage_path,original_filename,mime_type,file_size,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'application/pdf',$9,$10,$11)`,[reportId,companyId,data.report_number??null,data.laboratory??null,data.received_date??null,BUCKET,storagePath,pdf.filename,pdf.size,data.notes??null,actorId]);
   await saveSamples(client,companyId,reportId,data.samples);return read(client,companyId,reportId);
  });
 }catch(error){
  if(attempted)try{const cleanup=await bucket.remove([storagePath]);if(cleanup.error)throw cleanup.error;}catch(cleanupError){logger.error('No se pudo limpiar el PDF de un informe fallido',{reportId,message:cleanupError.message});}
  throw error;
 }
}
async function update({pool},{companyId,reportId,body,includeDisabled=false}){
 const data=parse(metadata,body);
 return transaction(pool,async client=>{
  await read(client,companyId,reportId,includeDisabled,true);await validateReferences(client,companyId,data.samples,true);
  await client.query('UPDATE soil_reports SET report_number=$3,laboratory=$4,received_date=$5,notes=$6 WHERE id=$2 AND company_id=$1',[companyId,reportId,data.report_number??null,data.laboratory??null,data.received_date??null,data.notes??null]);
  // Full metadata replacement is atomic. The immutable PDF is never touched.
  await client.query('DELETE FROM soil_samples WHERE report_id=$2 AND company_id=$1',[companyId,reportId]);await saveSamples(client,companyId,reportId,data.samples);return read(client,companyId,reportId,includeDisabled);
 });
}
async function list({pool},{companyId,filters={},includeDisabled=false}){
 const f=parse(query,filters),enabled=f.enabled??(f.includeDisabled==='true'?'all':'true');
 if(enabled!=='true'&&!includeDisabled)throw fail('No tenés permiso para ver análisis deshabilitados.',403);
 const params=[companyId],conditions=['s.company_id=$1'];
 for(const [key,sql] of [['lot_id','s.lot_id='],['sub_lot_id','s.sub_lot_id='],['from','s.sample_date>='],['to','s.sample_date<=']])if(f[key]){params.push(f[key]);conditions.push(sql+'$'+params.length);}
 const match='s.report_id=r.id AND '+conditions.join(' AND ');
 return (await pool.query(projection+` WHERE r.company_id=$1 ${enabled==='all'?'':enabled==='true'?'AND r.enabled=true':'AND r.enabled=false'}
  AND EXISTS(SELECT 1 FROM soil_samples s WHERE ${match}) ORDER BY (SELECT max(s.sample_date) FROM soil_samples s WHERE ${match}) DESC,r.created_at DESC,r.id`,params)).rows;
}
async function toggle({pool},{companyId,reportId,enabled}){
 const row=(await pool.query('UPDATE soil_reports SET enabled=$3 WHERE id=$2 AND company_id=$1 RETURNING id,enabled',[companyId,id(reportId),enabled])).rows[0];
 if(!row)throw fail('No encontramos el análisis solicitado.',404);return row;
}
async function fileUrl({pool,storage},{companyId,reportId,includeDisabled=false}){
 await read(pool,companyId,reportId,includeDisabled);
 const report=(await pool.query('SELECT storage_bucket,storage_path,original_filename FROM soil_reports WHERE id=$2 AND company_id=$1',[companyId,reportId])).rows[0];
 const bucket=await privateBucket(storage),result=await bucket.createSignedUrl(report.storage_path,300);
 if(result.error||!result.data?.signedUrl)throw fail('No pudimos abrir el PDF. Intentá nuevamente.',503);
 return {url:result.data.signedUrl,expires_at:new Date(Date.now()+300000).toISOString(),filename:report.original_filename};
}
async function lotContext({pool},{companyId,lotId}){
 const lots=(await pool.query('SELECT id,name,enabled FROM lots WHERE company_id=$1 ORDER BY name,id',[companyId])).rows;
 const lot=lots.find(l=>l.id===id(lotId));if(!lot)throw fail('No encontramos el lote.',404);
 const subLots=(await pool.query("SELECT sl.id,sl.lot_id,sl.name,sl.enabled FROM sub_lots sl JOIN lot_layouts ll ON ll.id=sl.layout_id AND ll.company_id=sl.company_id AND ll.lot_id=sl.lot_id WHERE sl.company_id=$1 AND ll.status IN ('active','locked','archived') ORDER BY sl.name,sl.id",[companyId])).rows;
 return {lot,lots:lots.map(l=>({...l,sub_lots:subLots.filter(s=>s.lot_id===l.id)}))};
}
module.exports={BUCKET,MAX_BYTES,validateFile,create,update,list,read,toggle,fileUrl,lotContext};
