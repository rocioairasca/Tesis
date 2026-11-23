const express = require('express');
const service = require('../services/costEntries');
// Append-only: there is no PUT/PATCH/DELETE. Company and actor always come from the authenticated session.
module.exports = pool => {
  const router = express.Router();
  const run = (fn, created) => async (req, res, next) => {
    try { const out = await fn(req); res.set('Cache-Control', 'no-store').status(created && !out.replayed ? 201 : 200).json(out); } catch (e) { next(e); }
  };
  router.get('/', run(req => service.list(pool, { user: req.user, query: req.query })));
  router.post('/', run(req => service.create(pool, { user: req.user, key: req.get('Idempotency-Key'), body: req.body }), true));
  router.get('/:id', run(req => service.get(pool, { user: req.user, id: req.params.id })));
  router.post('/:id/revisions', run(req => service.revise(pool, { user: req.user, id: req.params.id, key: req.get('Idempotency-Key'), body: req.body }), true));
  return router;
};
