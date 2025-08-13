const router = require('express').Router();
const { getStats } = require('../controllers/stats');

const validate  = require('../middleware/validate');
const checkRole = require('../middleware/checkRole');
const schema    = require('../validations/stats.schema');

/**
 * Roles
 *  0 = Empleado (logueado)
 *  1 = Supervisor
 *  2 = Dueño
 *  3 = Admin
 *
 */

// GET /api/stats?from=&to=&range=&groupBy=&includeDisabled=0/1
router.get('/',
  validate(schema.listQuery),
  checkRole(0),
  getStats
);

module.exports = router;
