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
const requirePermission = require('../middleware/requirePermission');
const requireDisabledRead = require('../middleware/requireDisabledRead');
const { PERMISSIONS } = require('../constants/permissions');
const schema    = require('../validations/usage.schema');

// Functional permissions follow the shared catalog; custom permissions override role defaults.

// Listado de RDU deshabilitados
router.get('/disabled',
  validate(schema.listQuery),
  requirePermission(PERMISSIONS.USAGE_VIEW_DISABLED),
  listDisabledUsages
);

// Restaurar un RDU (enabled=true)
router.put('/enable/:id',
  validate(schema.idParam),
  requirePermission(PERMISSIONS.USAGE_ENABLE),
  enableUsage
);

// ── CRUD PRINCIPAL ────────────────────────────────────────────────────────────
// Listar RDU (enabled=true por defecto; filtros/paginado)
router.get('/',
  validate(schema.listQuery),
  requirePermission(PERMISSIONS.USAGE_VIEW),
  requireDisabledRead(PERMISSIONS.USAGE_VIEW_DISABLED, q => Boolean(q.includeDisabled)),
  listUsages
);

// Crear RDU
router.post('/',
  validate(schema.createBody),
  requirePermission(PERMISSIONS.USAGE_CREATE),
  createUsage
);

// Editar RDU
router.put('/:id',
  validate(schema.updateBody),
  requirePermission(PERMISSIONS.USAGE_EDIT),
  editUsage
);

// “Eliminar” RDU (soft delete → enabled=false)
router.delete('/:id',
  validate(schema.idParam),
  requirePermission(PERMISSIONS.USAGE_DISABLE),
  disableUsage
);

module.exports = router;

