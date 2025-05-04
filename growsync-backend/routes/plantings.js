const express = require('express');
const router = express.Router();

// IMPORTACION DE CONTROLADORES EN /controllers/planting
    const { 
        listPlantings,
        createPlanting,
        updatePlanting,
        disablePlanting,
        enablePlanting 
    } = require("../controllers/planting/plantings.js");

// Las rutas son puntos de entrada al servidor, y nos sirven para establecer respuestas a las solicitudes HTTP
// Al mismo tiempo, nos mueve a crear codigo de una forma mas limpia y modular

// DEFINICION DE RUTAS PARA EL MANEJO DE SIEMBRAS HABILITADAS
router.get('/', listPlantings);
router.post('/', createPlanting);
router.put('/:id', updatePlanting);

// DEFINICION DE RUTAS PARA EL MANEJO DE SIEMBRAS DESHABILITADAS
router.delete('/:id', disablePlanting);
router.put('/enable/:id', enablePlanting);

// Se exporta el router para que pueda ser usado en index.js
module.exports = router;
