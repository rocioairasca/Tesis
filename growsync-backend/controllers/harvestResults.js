const { pool } = require('../db/supabaseClient');
const service = require('../services/harvestResults');

// Empresa and actor come from the authenticated session, never from the query. Economic data is only included by the
// service when the user has the existing economic read permissions (planning.view + inventory.view).
const run = fn => async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store').json(await fn(pool, { user: req.user, query: req.query }));
  } catch (error) {
    next(error);
  }
};

exports.getHarvestResults = run(service.results);
exports.getHarvestResultDetail = run(service.detail);

// Completeness declarations (FIN-01C): append-only, idempotent writes (Idempotency-Key).
const completeness = require('../services/economicCompleteness');
exports.getCompleteness = run(completeness.current);
exports.declareCompleteness = async (req, res, next) => {
  try {
    const out = await completeness.declare(pool, { user: req.user, key: req.get('Idempotency-Key'), body: req.body });
    res.set('Cache-Control', 'no-store').status(out.replayed ? 200 : 201).json(out);
  } catch (error) {
    next(error);
  }
};
