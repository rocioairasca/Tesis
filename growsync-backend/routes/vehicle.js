/**
 * Ruta: Vehículos
 * Ubicación: routes/vehicle.js
 * Descripción:
 *  Define los endpoints para la gestión de maquinaria y vehículos.
 *  Utiliza el controlador `controllers/vehicle.js`.
 */
const router = require('express').Router();
const ctrl = require('../controllers/vehicle');
const validate = require('../middleware/validate');
const checkRole = require('../middleware/checkRole');
const schema = require('../validations/vehicle.schema');

/**
 * Roles (referencia)
 *  0 = Empleado (logueado)
 *  1 = Supervisor
 *  2 = Dueño
 *  3 = Admin
 *
 * Notas:
 * - GET requieren login (checkRole(0)).
 * - POST/PATCH requieren Dueño+ (checkRole(2)).
 * - DELETE NO borra: debe hacer soft delete (enabled=false) en el controller.
 *   → Mantengo Dueño+ para coherencia con planificacion
 */

// ----------------------------------------------------------------------------
// RUTAS ESPECÍFICAS (Deshabilitados)
// ----------------------------------------------------------------------------

// Listar deshabilitados
router.get('/disabled',
  validate(schema.listQuery),
  checkRole(0),
  ctrl.listDisabled);

// Habilitar (restaurar)
router.put('/enable/:id',
  validate(schema.idParam),
  checkRole(2),
  ctrl.enable);

// ----------------------------------------------------------------------------
// CRUD PRINCIPAL
// ----------------------------------------------------------------------------

// Listar (habilitados)
router.get('/',
  validate(schema.listQuery),
  checkRole(0),
  ctrl.list);

// Detalle
router.get('/:id',
  validate(schema.idParam),
  checkRole(0),
  ctrl.getOne);

// Crear
router.post('/',
  validate(schema.createSchema),
  checkRole(2),
  ctrl.create);

// Actualizar
router.patch('/:id',
  validate(schema.updateSchema),
  checkRole(2),
  ctrl.update);

// Deshabilitar (Soft Delete)
router.delete('/:id',
  validate(schema.idParam),
  checkRole(3),
  ctrl.remove);

module.exports = router;



