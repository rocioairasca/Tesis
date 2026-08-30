const router = require('express').Router();

const ctrl = require('../controllers/crops');
const validate = require('../middleware/validate');
const requireAnyPermission = require('../middleware/requireAnyPermission');
const { PERMISSIONS } = require('../constants/permissions');
const schema = require('../validations/crops.schema');

router.get('/',
  requireAnyPermission(PERMISSIONS.PLANNING_VIEW, PERMISSIONS.PLANNING_CREATE, PERMISSIONS.PLANNING_EDIT),
  ctrl.list
);

router.post('/',
  requireAnyPermission(PERMISSIONS.PLANNING_CREATE, PERMISSIONS.PLANNING_EDIT),
  validate(schema.createBody),
  ctrl.create
);

router.put('/:id',
  requireAnyPermission(PERMISSIONS.PLANNING_CREATE, PERMISSIONS.PLANNING_EDIT),
  validate(schema.updateBody),
  ctrl.update
);

router.delete('/:id',
  requireAnyPermission(PERMISSIONS.PLANNING_CREATE, PERMISSIONS.PLANNING_EDIT),
  validate(schema.idParam),
  ctrl.disable
);

module.exports = router;
