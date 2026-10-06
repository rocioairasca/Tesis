const express = require('express');
const requirePermission = require('../middleware/requirePermission');
const service = require('../services/reconcileSowing');
// Inject the pool so HTTP tests cannot initialize the production client.
module.exports = function reconcileSowingRouter(pool) {
  const router = express.Router();
  router.use(requirePermission('history.import'), requirePermission('planning.edit'));
  for (const operation of ['prepare','confirm']) router.post('/'+operation, async(req,res,next)=>{
    try {
      const body = req.body;
      const allowed = operation==='prepare' ? ['planning_ids'] : ['planning_ids','fingerprint','confirmed'];
      if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!allowed.includes(k)))
        return res.status(400).json({error:'BadRequest',message:'Payload de reconciliación inválido.'});
      res.set('Cache-Control','no-store');
      const result = await service[operation](pool, {
        companyId:req.user.company_id,actorId:req.user.id,planningIds:body.planning_ids,
        fingerprint:body.fingerprint,confirmed:body.confirmed,key:req.get('Idempotency-Key'),
      });
      res.status(operation==='confirm' && !result.replayed ? 201 : 200).json(result);
    } catch(error) { next(error); }
  });
  return router;
};
