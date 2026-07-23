const express = require('express');
const {
    createPaymentPreference,
    getPaymentStatus,
    getPaymentByReference,
} = require('../controllers/mercadoPagoController');

const router = express.Router();

console.log("MercadoPago routes cargadas");

router.post('/preference', (req, res, next) => {
    console.log("Entro al router MercadoPago POST /preference", req.method, req.originalUrl);
    return createPaymentPreference(req, res, next);
});
router.get('/payment/:paymentId', getPaymentStatus);
router.get('/reference/:externalReference', getPaymentByReference);

module.exports = router;
