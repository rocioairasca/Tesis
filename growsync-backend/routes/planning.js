/**
 * Ruta: Planificación
 * Ubicación: routes/planning.js
 * Descripción:
 *  Define los endpoints para la gestión de actividades planificadas.
 *  Utiliza el controlador `controllers/planning.js`.
 */
const router = require('express').Router();
const {rejectModeInput,historical,blockHistorical}=require('../middleware/historicalOperations');
router.use(rejectModeInput);
const ctrl = require('../controllers/planning');
const validate = require('../middleware/validate');
const checkRole = require('../middleware/checkRole');
const requirePermission = require('../middleware/requirePermission');
const requireDisabledRead = require('../middleware/requireDisabledRead');
const { PERMISSIONS } = require('../constants/permissions');
const schema = require('../validations/planning.schema');

// Functional permissions follow the shared catalog; custom permissions override role defaults.

// ----------------------------------------------------------------------------
// RUTAS ESPECÍFICAS (Deshabilitados)
// ----------------------------------------------------------------------------

// Listado de planificaciones DESHABILITADAS (enabled=false)
router.get('/disabled',
  validate(schema.listQuery),
  requirePermission(PERMISSIONS.PLANNING_VIEW_DISABLED),
  ctrl.listDisabled
);

// Restaurar (habilitar) una planificacion deshabilitada
router.put('/enable/:id',
  validate(schema.idParam),
  requirePermission(PERMISSIONS.PLANNING_EDIT),
  requirePermission(PERMISSIONS.PLANNING_ENABLE),
  historical('planning',true),
  ctrl.enable
);

// ----------------------------------------------------------------------------
// CRUD PRINCIPAL
// ----------------------------------------------------------------------------

// Listar planificaciones (filtros y paginado)
router.get('/',
  validate(schema.listQuery),
  requirePermission(PERMISSIONS.PLANNING_VIEW),
  requireDisabledRead(PERMISSIONS.PLANNING_VIEW_DISABLED, q => Boolean(q.includeDisabled)),
  ctrl.list
);

// Crear una planificación y registrarla como realizada en una sola transacción
router.post('/register-completed',
  validate(schema.registerCompletedSchema),
  requirePermission(PERMISSIONS.PLANNING_CREATE),
  requirePermission(PERMISSIONS.PLANNING_EDIT),
  ctrl.registerCompleted
);

// Completar siembra y registrar estado productivo
router.post('/:id/complete-sowing',
  validate(schema.completeSowingSchema),
  requirePermission(PERMISSIONS.PLANNING_EDIT),
  blockHistorical('planning'),
  ctrl.completeSowing
);

// Completar trabajo con consumos reales de productos
router.post('/:id/complete-work',
  validate(schema.completeWorkSchema),
  requirePermission(PERMISSIONS.PLANNING_EDIT),
  blockHistorical('planning'),
  ctrl.completeWork
);

// OBTENER una planificacion por ID
router.get('/:id',
  validate(schema.idParam),
  requirePermission(PERMISSIONS.PLANNING_VIEW),
  ctrl.getOne
);

// CREAR planificacion
router.post('/',
  validate(schema.createSchema),
  requirePermission(PERMISSIONS.PLANNING_CREATE),
  ctrl.create
);

// EDITAR planificacion (parcial)
router.patch('/:id',
  requirePermission(PERMISSIONS.PLANNING_EDIT),
  historical('planning'),
  validate(schema.updateSchema),
  ctrl.update
);

// "ELIMINAR" planificacion (soft delete / ocultar)
// En el controller: no se borra, se marca enabled=false y/o status='cancelado'
router.delete('/:id',
  validate(schema.idParam),
  requirePermission(PERMISSIONS.PLANNING_EDIT),
  requirePermission(PERMISSIONS.PLANNING_DISABLE),
  historical('planning',false),
  ctrl.remove
);

module.exports = router;

