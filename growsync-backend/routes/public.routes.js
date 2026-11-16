const express = require ('express');
const router = express.Router();

const publicController = require('../controllers/publicController.js');
const paymentsController = require('../controllers/payments.js');
const validate = require('../middleware/validate');
const { requireSimulation } = require('../services/simulatedPayments');
const paymentSchema = require('../validations/payments.schema');

router.post('/register-company', publicController.registerCompany);

router.post(
  '/payments',
  requireSimulation,
  validate(paymentSchema.createPayment),
  paymentsController.createSimulatedPayment
);

router.post(
  '/payments/:id/confirm',
  requireSimulation,
  validate(paymentSchema.idParam),
  paymentsController.confirmSimulatedPayment
);

router.get(
  '/payments/:id',
  requireSimulation,
  validate(paymentSchema.idParam),
  paymentsController.getSimulatedPaymentById
);

module.exports = router;
