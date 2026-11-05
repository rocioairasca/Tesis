const routerFactory=require('express').Router;
const service=require('../services/planningCostEstimate');
const requirePermission=require('../middleware/requirePermission');
const {PERMISSIONS}=require('../constants/permissions');
module.exports=pool=>{
  const router=routerFactory({mergeParams:true});
  router.get('/',requirePermission(PERMISSIONS.PLANNING_VIEW),requirePermission(PERMISSIONS.INVENTORY_VIEW),
    async(req,res,next)=>{
      try {
        const result=await service.estimate(pool,{user:req.user,planningId:req.params.id});
        res.set('Cache-Control','no-store').json(result);
      } catch(error) {next(error);}
    });
  return router;
};
