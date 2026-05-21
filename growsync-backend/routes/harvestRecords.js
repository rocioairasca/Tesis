const express = require('express');
const router = express.Router();

const harvestRecordsController = require('../controllers/harvestRecords');
const checkJwt = require('../middleware/checkJwt');
const userData = require('../middleware/userData');
const checkRole = require('../middleware/checkRole');

router.get(
  '/stats/filters',
  checkJwt,
  userData,
  checkRole(1),
  harvestRecordsController.getHarvestStatsFilters
);

router.get(
  '/stats/summary',
  checkJwt,
  userData,
  checkRole(1),
  harvestRecordsController.getHarvestSummary
);

router.get(
  '/stats/by-crop',
  checkJwt,
  userData,
  checkRole(1),
  harvestRecordsController.getHarvestStatsByCrop
);

router.get(
  '/stats/by-campaign',
  checkJwt,
  userData,
  checkRole(1),
  harvestRecordsController.getHarvestStatsByCampaign
);

router.get(
  '/',
  checkJwt,
  userData,
  harvestRecordsController.listHarvestRecords
);

router.get(
  '/disabled',
  checkJwt,
  userData,
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
  harvestRecordsController.getHarvestRecordById
);

router.post(
  '/',
  checkJwt,
  userData,
  harvestRecordsController.createHarvestRecord
);

router.put(
  '/:id',
  checkJwt,
  userData,
  harvestRecordsController.updateHarvestRecord
);

router.patch(
  '/:id/disable',
  checkJwt,
  userData,
  harvestRecordsController.disableHarvestRecord
);

router.patch(
  '/:id/enable',
  checkJwt,
  userData,
  harvestRecordsController.enableHarvestRecord
);

module.exports = router;
