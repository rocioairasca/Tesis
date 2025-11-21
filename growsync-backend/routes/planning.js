/**
 * Ruta: Planificación
 * Ubicación: routes/planning.js
 * Descripción:
 *  Define los endpoints para la gestión de actividades planificadas.
 *  Utiliza el controlador `controllers/planning.js`.
 */
const router = require('express').Router();
const ctrl = require('../controllers/planning');
const validate = require('../middleware/validate');
const checkRole = require('../middleware/checkRole');
const schema = require('../validations/planning.schema');

/**
 * Roles (referencia):
 *  0 = Empleado (logueado)
 *  1 = Supervisor
 *  2 = Dueño
 *  3 = Admin
 *
 * Notas:
 * - List/Detail requieren estar logueado (checkRole(0)).
 * - Crear/Editar requieren Supervisor+ (checkRole(1)).
 * - "Eliminar" NO borra: hace soft delete (enabled=false) y/o status='cancelado' en el controller.
 */

// ----------------------------------------------------------------------------
// RUTAS ESPECÍFICAS (Deshabilitados)
// ----------------------------------------------------------------------------

// Listado de planificaciones DESHABILITADAS (enabled=false)
router.get('/disabled',
  validate(schema.listQuery),
  checkRole(0),
  ctrl.listDisabled
);

// Restaurar (habilitar) una planificacion deshabilitada
router.put('/enable/:id',
  validate(schema.idParam),
  checkRole(2),   // Dueño+ 
  ctrl.enable
);

// ----------------------------------------------------------------------------
// CRUD PRINCIPAL
// ----------------------------------------------------------------------------

// Listar planificaciones (filtros y paginado)
router.get('/',
  validate(schema.listQuery),
  checkRole(0),
  ctrl.list
);

// OBTENER una planificacion por ID
router.get('/:id',
  validate(schema.idParam),
  checkRole(0),
  ctrl.getOne
);

// CREAR planificacion
router.post('/',
  validate(schema.createSchema),
  checkRole(1), // Supervisor+
  ctrl.create
);

// EDITAR planificacion (parcial)
router.patch('/:id',
  validate(schema.updateSchema),
  checkRole(1), // Supervisor+
  ctrl.update
);

// "ELIMINAR" planificacion (soft delete / ocultar)
// En el controller: no se borra, se marca enabled=false y/o status='cancelado'
router.delete('/:id',
  validate(schema.idParam),
  checkRole(2), // Dueño+
  ctrl.remove
);

module.exports = router;

