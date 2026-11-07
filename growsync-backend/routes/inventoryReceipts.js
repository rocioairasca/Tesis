const service=require('../services/inventoryReceipts');
const checkRole=require('../middleware/checkRole');
const requirePermission=require('../middleware/requirePermission');
const {PERMISSIONS}=require('../constants/permissions');
module.exports=pool=>{
  const router=require('express').Router();
  router.post('/',checkRole(2),requirePermission(PERMISSIONS.INVENTORY_EDIT),async(req,res,next)=>{
    try {res.json(await service.create(pool,{user:req.user,body:req.body,key:req.get('Idempotency-Key')}));}
    catch(e){if(e instanceof require('zod').ZodError)e.status=400;next(e);}
  });
  return router;
};
