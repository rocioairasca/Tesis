const express = require('express');
const router = express.Router();

// IMPORTACION DE CONTROLADORES EN /controllers/products
    const { 
        listProducts, 
        addProduct, 
        editProduct, 
        disableProduct 
    } = require('../controllers/products/products');

    const { 
        listDisabledProducts, 
        enableProduct 
    } = require('../controllers/products/products.disabled');

// Las rutas son puntos de entrada al servidor, y nos sirven para establecer respuestas a las solicitudes HTTP
// Al mismo tiempo, nos mueve a crear codigo de una forma mas limpia y modular

// DEFINICION DE RUTAS PARA EL MANEJO DE PRODUCTOS HABILITADOS
router.get('/', listProducts);
router.post('/', addProduct);
router.put('/:id', editProduct);
router.delete('/:id', disableProduct);

// DEFINICION DE RUTAS PARA EL MANEJO DE PRODUCTOS DESHABILITADOS
router.get('/disabled', listDisabledProducts);
router.put('/enable/:id', enableProduct);

// Se exporta el router para que pueda ser usado en index.js
module.exports = router;
