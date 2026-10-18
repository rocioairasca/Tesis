const express=require('express');
const requirePermission=require('../middleware/requirePermission');
const {getEffectivePermissions}=require('../constants/permissions');
const service=require('../services/recipes');
module.exports=pool=>{
  const router=express.Router();
  const input=req=>({companyId:req.user.company_id,actorId:req.user.id,id:req.params.id,body:req.body});
  const canReadDisabled=req=>getEffectivePermissions(req.user).some(p=>p==='all'||p==='recipes.view_disabled');
  const run=fn=>async(req,res,next)=>{try{res.set('Cache-Control','no-store');await fn(req,res);}catch(error){next(error);}};
  router.get('/options',requirePermission('recipes.view'),run(async(req,res)=>res.json(await service.options(pool,input(req)))));
  router.get('/',requirePermission('recipes.view'),run(async(req,res)=>{
    const enabled=req.query.enabled??'true';
    if(['false','all'].includes(enabled)&&!canReadDisabled(req))return res.status(403).json({message:'No tenés permiso para ver recetas deshabilitadas.'});
    res.json(await service.list(pool,{...input(req),enabled,search:req.query.search,activity:req.query.activity_type,cropId:req.query.crop_id}));
  }));
  router.get('/:id',requirePermission('recipes.view'),run(async(req,res)=>{
    const recipe=await service.get(pool,input(req));
    if(!recipe.enabled&&!canReadDisabled(req))return res.status(403).json({message:'No tenés permiso para ver recetas deshabilitadas.'});
    res.json(recipe);
  }));
  router.post('/',requirePermission('recipes.create'),run(async(req,res)=>res.status(201).json(await service.create(pool,input(req)))));
  router.put('/:id',requirePermission('recipes.edit'),run(async(req,res)=>res.json(await service.update(pool,input(req)))));
  router.delete('/:id',requirePermission('recipes.disable'),run(async(req,res)=>res.json(await service.disable(pool,input(req)))));
  router.post('/:id/enable',requirePermission('recipes.enable'),run(async(req,res)=>res.json(await service.enable(pool,input(req)))));
  return router;
};
