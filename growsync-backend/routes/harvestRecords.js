const express = require('express');
const router = express.Router();

const harvestRecordsController = require('../controllers/harvestRecords');
const checkJwt = require('../middleware/checkJwt');
const userData = require('../middleware/userData');

router.get(
  '/stats/filters',
  checkJwt,
  userData,
  harvestRecordsController.getHarvestStatsFilters
);

router.get(
  '/stats/summary',
  checkJwt,
  userData,
  harvestRecordsController.getHarvestSummary
);

router.get(
  '/stats/by-crop',
  checkJwt,
  userData,
  harvestRecordsController.getHarvestStatsByCrop
);

router.get(
  '/stats/by-campaign',
  checkJwt,
  userData,
  harvestRecordsController.getHarvestStatsByCampaign
);

router.get(
  '/',
  checkJwt,
  userData,
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