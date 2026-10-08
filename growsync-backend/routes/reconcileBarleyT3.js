const express=require('express');
const requirePermission=require('../middleware/requirePermission');
const service=require('../services/reconcileBarleyT3');
// Parent history router is behind checkJwt, userData and requireTenant.
module.exports=pool=>{
  const router=express.Router();
  router.use(requirePermission('history.import'),requirePermission('planning.edit'));
  for(const operation of ['prepare','confirm'])router.post('/'+operation,async(req,res,next)=>{
    try{
      const body=req.body,allowed=operation==='prepare'?[]:['fingerprint','confirmed'];
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))
        throw Object.assign(new Error('Payload inválido para el caso de soporte fijo.'),{status:400});
      res.set('Cache-Control','no-store');
      const result=await service[operation](pool,{companyId:req.user.company_id,actorId:req.user.id,
        fingerprint:body.fingerprint,confirmed:body.confirmed,key:req.get('Idempotency-Key')});
      res.status(operation==='confirm'&&!result.replayed?201:200).json(result);
    }catch(error){next(error);}
  });
  return router;
};
