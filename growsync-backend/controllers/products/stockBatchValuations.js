const service = require('../../services/stockBatchValuations');
module.exports = pool => {
  const handle = fn => async(req,res,next) => {
    try { await fn(req,res); } catch(error) { next(error); }
  };
  const args = req => ({user:req.user,productId:req.params.id,batchId:req.params.batchId});
  return {
    current:handle(async(req,res)=>res.json(await service.current(pool,args(req)))),
    history:handle(async(req,res)=>res.json(await service.history(pool,{...args(req),page:req.query.page,pageSize:req.query.pageSize}))),
    create:handle(async(req,res)=>{
      const result=await service.create(pool,{...args(req),body:req.body,key:req.get('Idempotency-Key')});
      res.status(result.replayed?200:201).json(result);
    }),
  };
};
