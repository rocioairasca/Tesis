const express = require('express');
const { listLots, addLot, editLot, softDeleteLot, countEnabledLots } = require('../controllers/lots/lot.js');
const { listDisabledLots, enableLot } = require('../controllers/lots/lot.disabled.js');

const router = express.Router();

// /api/lots
router.get('/', listLots);
router.post('/', addLot);
router.put('/:id', editLot);
router.delete('/:id', softDeleteLot);
router.get('/count/enabled', countEnabledLots);

router.get('/disabled', listDisabledLots);
router.put('/enable/:id', enableLot);

module.exports = router;
