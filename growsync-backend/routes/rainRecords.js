const express = require('express');
const router = express.Router();

const rainRecordsController = require('../controllers/rainRecords');
const validate = require('../middleware/validate');
const checkRole = require('../middleware/checkRole');
const requirePermission = require('../middleware/requirePermission');
const { PERMISSIONS } = require('../constants/permissions');
const schema = require('../validations/rainRecords.schema');

router.get(
  '/stats/monthly',
  checkRole(0),
  requirePermission(PERMISSIONS.RAIN_RECORDS_VIEW),
  rainRecordsController.getMonthlyRainStats
);

router.post(
  '/sync-today',
  validate(schema.syncTodayBody),
  checkRole(0),
  requirePermission(PERMISSIONS.RAIN_RECORDS_CREATE),
  rainRecordsController.syncTodayRain
);

router.get(
  '/',
  validate(schema.listQuery),
  checkRole(0),
  requirePermission(PERMISSIONS.RAIN_RECORDS_VIEW),
  rainRecordsController.listRainRecords
);

router.get(
  '/disabled',
  validate(schema.listQuery),
  checkRole(0),
  requirePermission(PERMISSIONS.RAIN_RECORDS_VIEW_DISABLED),
  (req, _res, next) => {
    req.query.onlyDisabled = true;
    next();
  },
  rainRecordsController.listRainRecords
);

router.get(
  '/:id',
  validate(schema.idParam),
  checkRole(0),
  requirePermission(PERMISSIONS.RAIN_RECORDS_VIEW),
  rainRecordsController.getRainRecordById
);

router.post(
  '/',
  validate(schema.createBody),
  checkRole(0),
  requirePermission(PERMISSIONS.RAIN_RECORDS_CREATE),
  rainRecordsController.createRainRecord
);

router.put(
  '/:id',
  validate(schema.updateBody),
  checkRole(0),
  requirePermission(PERMISSIONS.RAIN_RECORDS_EDIT),
  rainRecordsController.updateRainRecord
);

router.patch(
  '/:id/disable',
  validate(schema.idParam),
  checkRole(0),
  requirePermission(PERMISSIONS.RAIN_RECORDS_DISABLE),
  rainRecordsController.disableRainRecord
);

router.patch(
  '/:id/enable',
  validate(schema.idParam),
  checkRole(0),
  requirePermission(PERMISSIONS.RAIN_RECORDS_ENABLE),
  rainRecordsController.enableRainRecord
);

module.exports = router;
