const impact=require('../services/inventoryImpact');
const mutation=require('../services/historicalMutation');
const {pool}=require('../db/supabaseClient');
// Installed before legacy validators, which otherwise strip provenance fields.
const rejectModeInput=(req,res,next)=>{
  if(req.body && ('inventory_impact_mode' in req.body || 'historical_import_id' in req.body))
    return res.status(400).json({message:'El modo se define mediante la importación administrativa de antecedentes.'});
  next();
};
const historical=(table,enabled)=>async(req,res,next)=>{
  try {
    const result=await mutation.mutate(pool,{companyId:req.user.company_id,actorId:req.user.id,table,id:req.params.id,
      body:enabled===undefined?req.body||{}:{},enabled});
    if(result) return res.json(result);
    next();
  }catch(e){next(e);}
};
const blockHistorical=(table,param='id')=>async(req,res,next)=>{
  try {
    if(!['planning','crop_assignments'].includes(table)) throw new Error('Unsupported guard');
    const {rows}=await pool.query(`SELECT * FROM ${table} WHERE company_id=$1 AND id=$2`,[req.user.company_id,req.params[param]]);
    if(rows.some(impact.isHistorical)) throw impact.fail('Este antecedente requiere el flujo administrativo histórico; no se recalculan ciclos ni consumos.');
    next();
  }catch(e){next(e);}
};
module.exports={rejectModeInput,historical,blockHistorical};
