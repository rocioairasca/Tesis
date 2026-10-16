const express=require('express'),multer=require('multer');
const requirePermission=require('../middleware/requirePermission');
const {getEffectivePermissions}=require('../constants/permissions');
const service=require('../services/soilAnalysis');
const extraction=require('../services/soilAnalysisExtraction');
module.exports=dependencies=>{
 const router=express.Router();
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:service.MAX_BYTES,files:1,fields:1,fieldSize:2*1024*1024,parts:2}}).single('file');
 const input=req=>({companyId:req.user.company_id,actorId:req.user.id,reportId:req.params.id,body:req.body,
  includeDisabled:getEffectivePermissions(req.user).some(p=>p==='all'||p==='soil_analysis.view_disabled')});
 const run=fn=>async(req,res,next)=>{try{res.set('Cache-Control','no-store');await fn(req,res);}catch(error){next(error);}};
 const permission=action=>requirePermission('soil_analysis.'+action);
 router.get(['/lot-context','/lot-context/:lotId'],permission('view'),run(async(req,res)=>res.json(await service.lotContext(dependencies,{...input(req),lotId:req.params.lotId}))));
 router.get('/',permission('view'),run(async(req,res)=>res.json(await service.list(dependencies,{...input(req),filters:req.query}))));
 router.get('/:id/file-url',permission('view'),run(async(req,res)=>res.json(await service.fileUrl(dependencies,input(req)))));
 router.get('/:id',permission('view'),run(async(req,res)=>res.json(await service.read(dependencies.pool,req.user.company_id,req.params.id,input(req).includeDisabled))));
 const acceptFile=(req,res,next)=>upload(req,res,error=>{
  if(error)return next(Object.assign(new Error(error.code==='LIMIT_FILE_SIZE'?'El PDF no puede superar 10 MB.':'Enviá un único PDF y los datos del informe.'),{status:error.code==='LIMIT_FILE_SIZE'?413:400}));next();
 });
 router.post('/extract',permission('create'),acceptFile,run(async(req,res)=>{
  service.validateFile(req.file);
  if(Object.keys(req.body||{}).length)throw Object.assign(new Error('Enviá únicamente el PDF para analizar.'),{status:400});
  const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
  try{const data=await (dependencies.extractor||extraction.extract)({file:req.file,signal:controller.signal});if(!controller.signal.aborted)res.json(data);}
  finally{res.removeListener('close',abort);}
 }));
 router.post('/',permission('create'),acceptFile,run(async(req,res)=>{
  let body;try{body=JSON.parse(req.body?.metadata);}catch{throw Object.assign(new Error('Revisá los datos del informe.'),{status:400});}
  res.status(201).json(await service.create(dependencies,{...input(req),body,file:req.file}));
 }));
 router.put('/:id',permission('edit'),run(async(req,res)=>res.json(await service.update(dependencies,input(req)))));
 router.delete('/:id',permission('disable'),run(async(req,res)=>res.json(await service.toggle(dependencies,{...input(req),enabled:false}))));
 router.post('/:id/enable',permission('enable'),run(async(req,res)=>res.json(await service.toggle(dependencies,{...input(req),enabled:true}))));
 return router;
};
