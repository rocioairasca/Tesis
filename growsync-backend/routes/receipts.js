const express=require('express'),multer=require('multer');
const requirePermission=require('../middleware/requirePermission');
const requireTenant=require('../middleware/requireTenant');
const service=require('../services/receipts'),documents=require('../services/receiptDocuments'),schema=require('../validations/receipts.schema');
module.exports=dependencies=>{
 const router=express.Router();
 router.use(requireTenant);
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const either=(req,res,next)=>service.has(req.user,'capture')||service.has(req.user,'review')?next():res.status(403).json({message:'No tenés permiso para consultar remitos.'});
 const permission=action=>requirePermission('receipts.'+action);
 const run=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
 const input=req=>({user:req.user,id:req.params.id,body:req.body});
 router.get('/mine',permission('capture'),run(async(req,res)=>res.json(await service.list(dependencies,{...input(req),mine:true,filters:req.query}))));
 router.get('/review',permission('review'),run(async(req,res)=>res.json(await service.list(dependencies,{...input(req),mine:false,filters:req.query}))));
 router.get('/products',either,run(async(req,res)=>res.json(await service.products(dependencies,{user:req.user,search:req.query.search}))));
 router.post('/',permission('capture'),run(async(req,res)=>res.status(201).json(await service.create(dependencies,input(req)))));
 router.get('/:id',either,run(async(req,res)=>res.json(await service.detail(dependencies,input(req)))));
 router.patch('/:id',either,run(async(req,res)=>res.json(await service.mutate(dependencies,input(req),'patch'))));
 router.put('/:id/lines',either,run(async(req,res)=>res.json(await service.mutate(dependencies,input(req),'lines'))));
 router.post('/:id/submit',permission('capture'),run(async(req,res)=>res.json(await service.mutate(dependencies,input(req),'submit'))));
 router.post('/:id/reject',permission('review'),run(async(req,res)=>res.json(await service.mutate(dependencies,input(req),'reject'))));
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:documents.MAX_BYTES,files:1,fields:0,parts:1}}).single('file');
 router.put('/:id/document',permission('capture'),(req,res,next)=>upload(req,res,error=>error?next(service.fail(error.code==='LIMIT_FILE_SIZE'?'El documento no puede superar 10 MB.':'Enviá solamente un PDF o foto.',error.code==='LIMIT_FILE_SIZE'?413:400)):next()),run(async(req,res)=>{
  schema.parse(schema.empty,req.body||{});res.json(await documents.upload(dependencies,{...input(req),file:req.file}));
 }));
 router.get('/:id/document-url',either,run(async(req,res)=>res.json(await documents.fileUrl(dependencies,input(req)))));
 return router;
};
