const router = require('express').Router();

const {
  listProducts,
  addProduct,
  editProduct,
  addStockToProduct,
  disableProduct,
} = require('../controllers/products/products');

const {
  listDisabledProducts,
  enableProduct,    
} = require('../controllers/products/products.disabled');

const validate  = require('../middleware/validate');
const checkRole = require('../middleware/checkRole');
const schema    = require('../validations/products.schema');

const requirePermission = require("../middleware/requirePermission");
const { PERMISSIONS } = require("../constants/permissions");

/**
   * Roles
   *  0 = Empleado
   *  1 = Supervisor
   *  2 = Dueño
   *  3 = Admin
   *
   * Criterio:
   * - checkRole sigue validando jerarquia minima
   * - requirePermission valida permisos especificos
*/

// ─────────────────────────────────────────────────────────────
// LISTADO DE DESHABILITADOS
// ─────────────────────────────────────────────────────────────
router.get('/disabled',
  checkRole(0),
  requirePermission(PERMISSIONS.INVENTORY_VIEW_DISABLED),
  listDisabledProducts
);

// ─────────────────────────────────────────────────────────────
// RESTAURAR PRODUCTO
// ─────────────────────────────────────────────────────────────
router.put('/enable/:id',
  validate(schema.idParam),
  checkRole(2),
  requirePermission(PERMISSIONS.INVENTORY_ENABLE),
  enableProduct
);

// ─────────────────────────────────────────────────────────────
// LISTAR PRODUCTOS
// ─────────────────────────────────────────────────────────────
router.get('/',
  validate(schema.listQuery),
  checkRole(0),
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  listProducts
);

// ─────────────────────────────────────────────────────────────
// CREAR PRODUCTO
// ─────────────────────────────────────────────────────────────
router.post('/',
  validate(schema.createBody),
  checkRole(2),
  requirePermission(PERMISSIONS.INVENTORY_CREATE),
  addProduct
);

// ─────────────────────────────────────────────────────────────
// AGREGAR STOCK
// ─────────────────────────────────────────────────────────────
router.patch('/:id/add-stock',
  validate(schema.addStockBody),
  checkRole(2),
  requirePermission(PERMISSIONS.INVENTORY_EDIT),
  addStockToProduct
);

// ─────────────────────────────────────────────────────────────
// EDITAR PRODUCTO
// ─────────────────────────────────────────────────────────────
router.put('/:id',
  validate(schema.updateBody),
  checkRole(2),
  requirePermission(PERMISSIONS.INVENTORY_UPDATE),
  editProduct
);

// ─────────────────────────────────────────────────────────────
// DESHABILITAR PRODUCTO
// ─────────────────────────────────────────────────────────────
router.delete('/:id',
  validate(schema.idParam),
  checkRole(2),
  requirePermission(PERMISSIONS.INVENTORY_DISABLE),
  disableProduct
);

module.exports = router;
