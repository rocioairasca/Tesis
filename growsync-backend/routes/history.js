const router=require('express').Router();
const {pool}=require('../db/supabaseClient');
const requirePermission=require('../middleware/requirePermission');
const {importHistory,authorize}=require('../services/historicalImport');
const stock=require('../services/stock');
router.use(requirePermission('history.import'));
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
    const date=req.body.inventory_control_start_date;
    if(date!==null) stock.calendarDate(date);
    const result=await stock.transaction(pool,async client=>{
      await authorize(client,req.user.company_id,req.user.id);
      const {rows}=await client.query('SELECT id,inventory_control_start_date::text FROM companies WHERE id=$1 FOR UPDATE',[req.user.company_id]);
      if(rows[0].inventory_control_start_date!=null && rows[0].inventory_control_start_date!==date) throw stock.fail('La fecha de inicio ya fue establecida; requiere revisión antes de cambiarla.');
      await client.query('UPDATE companies SET inventory_control_start_date=$2 WHERE id=$1',[req.user.company_id,date]);
      await client.query(`INSERT INTO historical_events(company_id,actor_id,entity_table,entity_id,before_data,after_data)
        VALUES($1,$2,'companies',$1,$3::jsonb,$4::jsonb)`,[req.user.company_id,req.user.id,JSON.stringify({inventory_control_start_date:rows[0].inventory_control_start_date}),JSON.stringify({inventory_control_start_date:date})]);
      return {inventory_control_start_date:date};
    });res.json(result);
  }catch(e){next(e);}
});
module.exports=router;
