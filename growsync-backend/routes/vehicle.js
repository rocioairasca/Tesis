/**
 * Ruta: Vehículos
 * Ubicación: routes/vehicle.js
 * Descripción:
 *  Define los endpoints para la gestión de maquinaria y vehículos.
 *  Utiliza el controlador `controllers/vehicle.js`.
 */
const router = require('express').Router();
const ctrl = require('../controllers/vehicle');
const fuelCtrl = require('../controllers/vehicleFuel');
const validate = require('../middleware/validate');
const checkRole = require('../middleware/checkRole');
const requirePermission = require('../middleware/requirePermission');
const requireDisabledRead = require('../middleware/requireDisabledRead');
const { PERMISSIONS } = require('../constants/permissions');
const schema = require('../validations/vehicle.schema');
const fuelSchema = require('../validations/vehicleFuel.schema');

// Functional permissions follow the shared catalog; custom permissions override role defaults.

// ----------------------------------------------------------------------------
// RUTAS ESPECÍFICAS (Deshabilitados)
// ----------------------------------------------------------------------------

// Listar deshabilitados
router.get('/disabled',
  validate(schema.listQuery),
  requirePermission(PERMISSIONS.VEHICLES_VIEW_DISABLED),
  ctrl.listDisabled);

// Habilitar (restaurar)
router.put('/enable/:id',
  validate(schema.idParam),
  requirePermission(PERMISSIONS.VEHICLES_ENABLE),
  ctrl.enable);

// ----------------------------------------------------------------------------
// CONTROL DE COMBUSTIBLE
// ----------------------------------------------------------------------------

// Historial de cargas por vehiculo
router.get('/:vehicleId/fuel-records',
  validate(fuelSchema.listByVehicle),
  checkRole(0),
  fuelCtrl.listByVehicle);

// Registrar una carga de combustible
router.post('/:vehicleId/fuel-records',
  validate(fuelSchema.createSchema),
  checkRole(1),
  fuelCtrl.create);

// Eliminar una carga registrada
router.delete('/:vehicleId/fuel-records/:recordId',
  validate(fuelSchema.recordParam),
  checkRole(1),
  fuelCtrl.remove);

// ----------------------------------------------------------------------------
// CRUD PRINCIPAL
// ----------------------------------------------------------------------------

// Listar (habilitados)
router.get('/',
  validate(schema.listQuery),
  requirePermission(PERMISSIONS.VEHICLES_VIEW),
  requireDisabledRead(PERMISSIONS.VEHICLES_VIEW_DISABLED, q => q.includeDisabled === '1' || String(q.includeDisabled).toLowerCase() === 'true'),
  ctrl.list);

// Detalle
router.get('/:id',
  validate(schema.idParam),
  requirePermission(PERMISSIONS.VEHICLES_VIEW),
  ctrl.getOne);

// Crear
router.post('/',
  validate(schema.createSchema),
  requirePermission(PERMISSIONS.VEHICLES_CREATE),
  ctrl.create);

// Actualizar
router.patch('/:id',
  validate(schema.updateSchema),
  requirePermission(PERMISSIONS.VEHICLES_EDIT),
  ctrl.update);

// Deshabilitar (Soft Delete)
router.delete('/:id',
  validate(schema.idParam),
  requirePermission(PERMISSIONS.VEHICLES_DISABLE),
  ctrl.remove);

module.exports = router;



