const express = require('express');
const router = express.Router();

// IMPORTACION DE CONTROLADORES EN /controllers/vehicles
    const { 
        listVehicles,
        addVehicle,
        editVehicle,
        disableVehicle,
        listDisabledVehicles,
        enableVehicle
    } = require('../controllers/vehicles');

// Las rutas son puntos de entrada al servidor, y nos sirven para establecer respuestas a las solicitudes HTTP
// Al mismo tiempo, nos mueve a crear codigo de una forma mas limpia y modular

// DEFINICION DE RUTAS PARA EL MANEJO DE VEHICULOS HABILITADOS
router.get('/', listVehicles);
router.post('/', addVehicle);
router.put('/:id', editVehicle);
router.delete('/:id', disableVehicle);
router.get('/disabled', listDisabledVehicles);
router.put('/enable/:id', enableVehicle);

// Se exporta el router para que pueda ser usado en index.js
module.exports = router;
