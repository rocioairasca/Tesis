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

// Primero las específicas
router.get('/disabled',
  validate(schema.listQuery),
  checkRole(0),
  ctrl.listDisabled);

router.put('/enable/:id',
  validate(schema.idParam),
  checkRole(2),
  ctrl.enable);

// Luego las generales
router.get('/',
  validate(schema.listQuery),
  checkRole(0),
  ctrl.list);

router.get('/:id',
  validate(schema.idParam),
  checkRole(0),
  ctrl.getOne);

router.post('/',
  validate(schema.createSchema),
  checkRole(2),
  ctrl.create);

router.patch('/:id',
  validate(schema.updateSchema),
  checkRole(2),
  ctrl.update);

router.delete('/:id',
  validate(schema.idParam),
  checkRole(3),
  ctrl.remove);

module.exports = router;


