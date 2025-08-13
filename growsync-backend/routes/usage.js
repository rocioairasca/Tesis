const router = require('express').Router();

const {
  listUsages,
  createUsage,
  editUsage,
  disableUsage,       // soft delete: enabled=false
  listDisabledUsages, // enabled=false
  enableUsage,        // restore: enabled=true
} = require('../controllers/usage/usage');

const validate  = require('../middleware/validate');
const checkRole = require('../middleware/checkRole');
const schema    = require('../validations/usage.schema');

/**
 * Roles
 *  0 = Empleado (logueado)
 *  1 = Supervisor
 *  2 = Dueño
 *  3 = Admin
 *
 * Criterio:
 * - Listar requiere login (0).
 * - Crear/Editar/Deshabilitar/Restaurar: Supervisor+ (1)
 */

// Listado de RDU deshabilitados
router.get('/disabled',
  validate(schema.listQuery),
  checkRole(0),
  listDisabledUsages
);

// Restaurar un RDU (enabled=true)
router.put('/enable/:id',
  validate(schema.idParam),
  checkRole(1),
  enableUsage
);

// ── CRUD PRINCIPAL ────────────────────────────────────────────────────────────
// Listar RDU (enabled=true por defecto; filtros/paginado)
router.get('/',
  validate(schema.listQuery),
  checkRole(0),
  listUsages
);

// Crear RDU
router.post('/',
  validate(schema.createBody),
  checkRole(1),
  createUsage
);

// Editar RDU
router.put('/:id',
  validate(schema.updateBody),
  checkRole(1),
  editUsage
);

// “Eliminar” RDU (soft delete → enabled=false)
router.delete('/:id',
  validate(schema.idParam),
  checkRole(1),
  disableUsage
);

module.exports = router;

