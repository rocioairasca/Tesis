const express = require('express');
const router = express.Router();
const {rejectModeInput,historical,blockHistorical}=require('../middleware/historicalOperations');
router.use(rejectModeInput);

const harvestRecordsController = require('../controllers/harvestRecords');
const checkJwt = require('../middleware/checkJwt');
const userData = require('../middleware/userData');
const requirePermission = require('../middleware/requirePermission');
const requireDisabledRead = require('../middleware/requireDisabledRead');
const requireAnyPermission = require('../middleware/requireAnyPermission');
const { PERMISSIONS } = require('../constants/permissions');

router.get('/context', checkJwt, userData,
  requireAnyPermission(PERMISSIONS.HARVEST_CREATE, PERMISSIONS.HARVEST_EDIT),
  harvestRecordsController.getHarvestContext);
router.post('/cycles/:assignmentId/finalize', checkJwt, userData,
  requireAnyPermission(PERMISSIONS.HARVEST_EDIT),
  blockHistorical('crop_assignments','assignmentId'),
  harvestRecordsController.finalizeHarvestCycle);

router.get(
  '/stats/filters',
  checkJwt,
  userData,
  requirePermission(PERMISSIONS.HARVEST_VIEW),
  harvestRecordsController.getHarvestStatsFilters
);

router.get(
  '/stats/summary',
  checkJwt,
  userData,
  requirePermission(PERMISSIONS.HARVEST_VIEW),
  harvestRecordsController.getHarvestSummary
);

router.get(
  '/stats/by-crop',
  checkJwt,
  userData,
  requirePermission(PERMISSIONS.HARVEST_VIEW),
  harvestRecordsController.getHarvestStatsByCrop
);

router.get(
  '/stats/by-campaign',
  checkJwt,
  userData,
  requirePermission(PERMISSIONS.HARVEST_VIEW),
  harvestRecordsController.getHarvestStatsByCampaign
);

router.get(
  '/',
  checkJwt,
  userData,
  requirePermission(PERMISSIONS.HARVEST_VIEW),
  requireDisabledRead(PERMISSIONS.HARVEST_VIEW_DISABLED, q => q.includeDisabled === 'true' || q.onlyDisabled === 'true'),
  harvestRecordsController.listHarvestRecords
);

router.get(
  '/disabled',
  checkJwt,
  userData,
  requirePermission(PERMISSIONS.HARVEST_VIEW_DISABLED),
  (req, _res, next) => {
    req.query.onlyDisabled = 'true';
    next();
  },
  harvestRecordsController.listHarvestRecords
);

router.get(
  '/:id',
  checkJwt,
  userData,
  requirePermission(PERMISSIONS.HARVEST_VIEW),
  harvestRecordsController.getHarvestRecordById
);

router.post(
  '/',
  checkJwt,
  userData,
  requirePermission(PERMISSIONS.HARVEST_CREATE),
  harvestRecordsController.createHarvestRecord
);

router.put(
  '/:id',
  checkJwt,
  userData,
  requirePermission(PERMISSIONS.HARVEST_EDIT),
  historical('harvest_records'),
  harvestRecordsController.updateHarvestRecord
);

router.patch(
  '/:id/disable',
  checkJwt,
  userData,
  requirePermission(PERMISSIONS.HARVEST_DISABLE),
  historical('harvest_records',false),
  harvestRecordsController.disableHarvestRecord
);

router.patch(
  '/:id/enable',
  checkJwt,
  userData,
  requirePermission(PERMISSIONS.HARVEST_ENABLE),
  historical('harvest_records',true),
  harvestRecordsController.enableHarvestRecord
);

module.exports = router;
