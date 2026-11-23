const { pool } = require('../db/supabaseClient');
const service = require('../services/harvestResults');

// Productive results only. Empresa and actor come from the authenticated session, never from the query.
exports.getHarvestResults = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store').json(await service.results(pool, { user: req.user, query: req.query }));
  } catch (error) {
    next(error);
  }
};
