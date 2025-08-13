const router = require('express').Router();
const {
  listLots,
  addLot,
  editLot,
  softDeleteLot,
  countEnabledLots,
} = require('../controllers/lots/lot.js');

const {
  listDisabledLots,
  enableLot,
} = require('../controllers/lots/lot.disabled.js');

const validate = require('../middleware/validate');
const checkRole = require('../middleware/checkRole');
const schema = require('../validations/lots.schema'); 

/**
 * Roles
 *  0 = Empleado (logueado)
 *  1 = Supervisor
 *  2 = Dueño
 *  3 = Admin
 *
 * Notas:
 * - GET list/disabled/count requieren login (0).
 * - Crear/Editar/Soft delete/Enable requieren Dueño+ (2).
 */

// Contadores (enabled)
router.get('/count/enabled',
  checkRole(0),
  countEnabledLots
);

// Listado de deshabilitados (enabled=false)
router.get('/disabled',
  checkRole(0),
  listDisabledLots
);

// Habilitar (soft-restore) un lote
router.put('/enable/:id',
  validate(schema.idParam),
  checkRole(2),
  enableLot
);

// ── CRUD PRINCIPAL ────────────────────────────────────────────────────────────
// Listado (enabled=true por defecto)
router.get('/',
  validate(schema.listQuery),
  checkRole(0),
  listLots
);

// Crear lote
router.post('/',
  validate(schema.createBody),
  checkRole(2),
  addLot
);

// Editar lote 
router.put('/:id',
  validate(schema.updateBody),
  checkRole(2),
  editLot
);

// Soft delete (enabled=false)
router.delete('/:id',
  validate(schema.idParam),
  checkRole(2),
  softDeleteLot
);

module.exports = router;

