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

const layouts = require('../controllers/lots/layouts.js');
const productiveState = require('../controllers/lots/productiveState.js');

const validate = require('../middleware/validate');
const checkRole = require('../middleware/checkRole');
const requireAnyPermission = require('../middleware/requireAnyPermission');
const { PERMISSIONS } = require('../constants/permissions');
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

router.get('/productive-states',
  validate(schema.productiveStateQuery),
  requireAnyPermission(
    PERMISSIONS.LOTS_VIEW,
    PERMISSIONS.PLANNING_VIEW,
    PERMISSIONS.HARVEST_VIEW,
    PERMISSIONS.HARVEST_CREATE,
    PERMISSIONS.HARVEST_EDIT
  ),
  productiveState.listLotProductiveStates
);

// Listado de deshabilitados (enabled=false)
router.get('/disabled',
  validate(schema.listQuery),
  checkRole(0),
  listDisabledLots
);

// Habilitar (soft-restore) un lote
router.put('/enable/:id',
  validate(schema.idParam),
  checkRole(2),
  enableLot
);

// Layouts versionados y sublotes
router.get('/:lotId/layouts',
  validate(schema.lotIdParam),
  checkRole(0),
  layouts.listLayouts
);

router.get('/:lotId/productive-state',
  validate(schema.productiveStateParam),
  requireAnyPermission(
    PERMISSIONS.LOTS_VIEW,
    PERMISSIONS.PLANNING_VIEW,
    PERMISSIONS.HARVEST_VIEW,
    PERMISSIONS.HARVEST_CREATE,
    PERMISSIONS.HARVEST_EDIT
  ),
  productiveState.getLotProductiveState
);

router.post('/:lotId/layouts',
  validate(schema.createLayoutBody),
  checkRole(2),
  layouts.createLayout
);

router.get('/:lotId/layouts/:layoutId',
  validate(schema.layoutParam),
  checkRole(0),
  layouts.getLayout
);

router.put('/:lotId/layouts/:layoutId',
  validate(schema.updateLayoutBody),
  checkRole(2),
  layouts.updateLayout
);

router.post('/:lotId/layouts/:layoutId/sub-lots',
  validate(schema.createSubLotBody),
  checkRole(2),
  layouts.createSubLot
);

router.put('/:lotId/layouts/:layoutId/sub-lots/:subLotId',
  validate(schema.updateSubLotBody),
  checkRole(2),
  layouts.updateSubLot
);

router.delete('/:lotId/layouts/:layoutId/sub-lots/:subLotId',
  validate(schema.subLotParam),
  checkRole(2),
  layouts.deleteSubLot
);

router.post('/:lotId/layouts/:layoutId/fill-remaining',
  validate(schema.layoutParam),
  checkRole(2),
  layouts.fillRemainingSubLot
);

router.post('/:lotId/layouts/:layoutId/validate',
  validate(schema.layoutParam),
  checkRole(2),
  layouts.validateLayout
);

router.post('/:lotId/layouts/:layoutId/activate',
  validate(schema.layoutParam),
  checkRole(2),
  layouts.activateLayout
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

