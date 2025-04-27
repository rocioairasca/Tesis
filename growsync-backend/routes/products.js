const express = require('express');
const { listProducts, addProduct, editProduct, disableProduct } = require('../controllers/products/products');
const { listDisabledProducts, enableProduct } = require('../controllers/products/products.disabled');

const router = express.Router();

// /api/products
router.get('/', listProducts);
router.post('/', addProduct);
router.put('/:id', editProduct);
router.delete('/:id', disableProduct);

router.get('/disabled', listDisabledProducts);
router.put('/enable/:id', enableProduct);

module.exports = router;
