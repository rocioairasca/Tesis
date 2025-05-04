const express = require('express');
const router = express.Router();

// IMPORTACION DE CONTROLADORES EN /controllers/lots
    const { 
        listLots, 
        addLot, 
        editLot, 
        softDeleteLot, 
        countEnabledLots 
    } = require('../controllers/lots/lot.js');

    const { 
        listDisabledLots, 
        enableLot 
    } = require('../controllers/lots/lot.disabled.js');


// Las rutas son puntos de entrada al servidor, y nos sirven para establecer respuestas a las solicitudes HTTP
// Al mismo tiempo, nos mueve a crear codigo de una forma mas limpia y modular

// DEFINICION DE RUTAS PARA EL MANEJO DE LOTES HABILITADOS
router.get('/', listLots);
router.post('/', addLot);
router.put('/:id', editLot);
router.delete('/:id', softDeleteLot);
router.get('/count/enabled', countEnabledLots);

// DEFINICION DE RUTAS PARA EL MANEJO DE LOTES DESHABILITADOS
router.get('/disabled', listDisabledLots);
router.put('/enable/:id', enableLot);

// Se exporta el router para que pueda ser usado en index.js
module.exports = router;
