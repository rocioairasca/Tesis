const express=require('express');
const service=require('../services/economicExecution');
module.exports=pool=>{
 const router=express.Router({mergeParams:true});
 const run=fn=>async(req,res,next)=>{
   try{res.set('Cache-Control','no-store').json(await fn(req));}catch(e){next(e);}
 };
 const args=req=>({user:req.user,planningId:req.params.id});
 router.get('/',run(req=>service.current(pool,args(req))));
 router.get('/history',run(req=>service.history(pool,{...args(req),page:req.query.page})));
 router.post('/revisions',run(req=>service.revise(pool,{...args(req),key:req.get('Idempotency-Key'),body:req.body})));
 return router;
};
