const express = require('express');
const router = express.Router();

// IMPORTACION DE CONTROLADORES EN /controllers/usage
  const {
    listUsages,
    createUsage,
    editUsage,
    disableUsage,
    listDisabledUsages,
    enableUsage
  } = require('../controllers/usage/usage');

// Las rutas son puntos de entrada al servidor, y nos sirven para establecer respuestas a las solicitudes HTTP
// Al mismo tiempo, nos mueve a crear codigo de una forma mas limpia y modular

// DEFINICION DE RUTAS PARA EL MANEJO DE RDU HABILITADOS
router.get('/', listUsages);
router.post('/', createUsage);
router.put('/:id', editUsage);
router.delete('/:id', disableUsage);

// DEFINICION DE RUTAS PARA EL MANEJO DE RDU DESHABILITADOS
router.get('/disabled', listDisabledUsages);
router.put('/enable/:id', enableUsage);

// Se exporta el router para que pueda ser usado en index.js
module.exports = router;
