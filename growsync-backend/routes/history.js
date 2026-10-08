const router=require('express').Router();
const {pool}=require('../db/supabaseClient');
const requirePermission=require('../middleware/requirePermission');
const {importHistory}=require('../services/historicalImport');
router.use(requirePermission('history.import'));
router.use('/reconcile-sowing', require('./reconcileSowing')(pool));
router.use('/reconcile-barley-t3', require('./reconcileBarleyT3')(pool));
router.use('/productive-state-declarations', require('./productiveStateDeclarations')(pool));
router.get('/stock-initial/status',async(req,res,next)=>{
  try {
    res.set('Cache-Control','no-store');
    res.json(await require('../services/stockInitialStatus')(pool,{companyId:req.user.company_id,actorId:req.user.id}));
  } catch(e){next(e);}
});
router.post('/stock-initial/prepare',async(req,res,next)=>{
  try { res.json(await require('../services/stockInitialPlan').prepare(pool,{companyId:req.user.company_id,actorId:req.user.id,date:req.body.date,entries:req.body.entries})); }
  catch(e){next(e);}
});
router.post('/stock-initial/confirm',async(req,res,next)=>{
  try {
    const result=await require('../services/stockInitialPlan').confirm(pool,{companyId:req.user.company_id,actorId:req.user.id,
      date:req.body.date,entries:req.body.entries,key:req.get('Idempotency-Key'),
      confirmed:req.body.confirmed,previewHash:req.body.preview_hash});
    res.status(result.replayed?200:201).json(result);
  }catch(e){next(e);}
});
router.post('/imports',async(req,res,next)=>{
  try {
    const result=await importHistory(pool,{companyId:req.user.company_id,actorId:req.user.id,
      key:req.get('Idempotency-Key'),source:req.body.source,confirmedNoStock:req.body.confirmed_no_stock,records:req.body.records});
    res.status(result.replayed?200:201).json(result);
  }catch(e){next(e);}
});
router.put('/inventory-control-start',async(req,res,next)=>{
  try{
    const result=await require('../services/inventoryControlStart')(pool,{
      companyId:req.user.company_id,actorId:req.user.id,date:req.body.inventory_control_start_date
    });res.json(result);
  }catch(e){next(e);}
});
// Mounted behind checkJwt + userData + requireTenant in index.js.
router.post('/adopt-existing/prepare',requirePermission('planning.edit'),async(req,res,next)=>{
  try {
    res.set('Cache-Control','no-store');
    res.json(await require('../services/historicalAdoption').prepare(pool,{
      companyId:req.user.company_id,actorId:req.user.id,planningIds:req.body.planning_ids
    }));
  } catch(e){next(e);}
});
router.post('/adopt-existing/confirm',requirePermission('planning.edit'),async(req,res,next)=>{
  try {
    const result=await require('../services/historicalAdoption').confirm(pool,{
      companyId:req.user.company_id,actorId:req.user.id,planningIds:req.body.planning_ids,
      key:req.get('Idempotency-Key'),confirmed:req.body.confirmed_no_stock
    });
    res.status(result.conflict?409:200).json(result);
  } catch(e){next(e);}
});
router.get('/planning/:id/product-options',requirePermission('planning.edit'),async(req,res,next)=>{
  try {
    res.set('Cache-Control','no-store');
    res.json(await require('../services/historicalPlanningProduct').listProducts(pool,{
      companyId:req.user.company_id,actorId:req.user.id,planningId:req.params.id
    }));
  } catch(e){next(e);}
});
router.post('/planning/:id/products',requirePermission('planning.edit'),async(req,res,next)=>{
  try {
    const result=await require('../services/historicalPlanningProduct').addProduct(pool,{
      companyId:req.user.company_id,actorId:req.user.id,planningId:req.params.id,body:req.body
    });
    res.status(result.replayed?200:201).json(result);
  } catch(e){next(e);}
});
module.exports=router;
