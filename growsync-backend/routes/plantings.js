const express = require('express');
const { 
    listPlantings,
    createPlanting,
    updatePlanting,
    disablePlanting,
    enablePlanting 
} = require("../controllers/planting/plantings.js");

const router = express.Router();

// Rutas básicas
router.get('/', listPlantings);
router.post('/', createPlanting);
router.put('/:id', updatePlanting);

router.delete('/:id', disablePlanting);
router.put('/enable/:id', enablePlanting);

module.exports = router;
