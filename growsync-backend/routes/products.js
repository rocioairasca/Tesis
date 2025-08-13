const router = require('express').Router();

const {
  listProducts,
  addProduct,
  editProduct,
  disableProduct, // ← soft delete: enabled=false
} = require('../controllers/products/products');

const {
  listDisabledProducts,
  enableProduct,    // ← restore: enabled=true
} = require('../controllers/products/products.disabled');

const validate  = require('../middleware/validate');
const checkRole = require('../middleware/checkRole');
const schema    = require('../validations/products.schema');

/**
 * Roles
 *  0 = Empleado (logueado)
 *  1 = Supervisor
 *  2 = Dueño
 *  3 = Admin
 *
 * Criterio:
 * - GET requieren login (0).
 * - Crear/Editar/Deshabilitar/Restaurar requieren Dueño+ (2).
 */

// Listado de deshabilitados
router.get('/disabled',
  checkRole(0),
  listDisabledProducts
);

// Restaurar (enabled=true)
router.put('/enable/:id',
  validate(schema.idParam),
  checkRole(2),
  enableProduct
);

// ── CRUD PRINCIPAL ────────────────────────────────────────────────────────────
// Listar (enabled=true por defecto; soporta filtros/paginado)
router.get('/',
  validate(schema.listQuery),
  checkRole(0),
  listProducts
);

// Crear
router.post('/',
  validate(schema.createBody),
  checkRole(2),
  addProduct
);

// Editar (parcial)
router.put('/:id',
  validate(schema.updateBody),
  checkRole(2),
  editProduct
);

// “Eliminar” (soft delete → enabled=false)
router.delete('/:id',
  validate(schema.idParam),
  checkRole(2),
  disableProduct
);

module.exports = router;
