const express=require('express'),permission=require('../middleware/requirePermission'),service=require('../services/productiveStateDeclarations');
module.exports=pool=>{
 const router=express.Router();router.use(permission('history.import'),permission('planning.edit'));
 for(const op of ['prepare','confirm'])router.post('/'+op,async(req,res,next)=>{try{
  const body=req.body,allowed=op==='prepare'?['declarations']:['declarations','fingerprint','confirmed'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))return res.status(400).json({message:'Payload inválido.'});
  const result=await service[op](pool,{companyId:req.user.company_id,actorId:req.user.id,declarations:body.declarations,
   fingerprint:body.fingerprint,confirmed:body.confirmed,key:req.get('Idempotency-Key')});
  res.set('Cache-Control','no-store');res.status(op==='confirm'&&!result.replayed?201:200).json(result);
 }catch(e){next(e);}});return router;
};
