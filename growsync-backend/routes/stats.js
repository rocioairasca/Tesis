const express = require('express');
const router = express.Router();

// IMPORTACION DE CONTROLADORES EN /controllers
    const { getStats } = require('../controllers/stats');

// DEFINICION DE RUTAS PARA OBTENER ESTADISTICAS
router.get('/', getStats);

// Se exporta el router para que pueda ser usado en index.js
module.exports = router;
