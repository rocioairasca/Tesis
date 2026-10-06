const {pool}=require('../../db/supabaseClient');
const stock=require('../../services/stock');
const {getStates}=require('../../services/productiveState');
async function read(req){return stock.transaction(pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  return getStates(client,{companyId:req.user.company_id,lotId:req.params.lotId,date:req.query.date});
});}
exports.getLotProductiveState=async(req,res,next)=>{
  try{const result=await read(req);if(!result.data.length)return res.status(404).json({error:'NotFound',message:'Lote no encontrado'});
    res.json(result.data[0]);}catch(error){next(error);}
};
exports.listLotProductiveStates=async(req,res,next)=>{try{res.json(await read(req));}catch(error){next(error);}};
