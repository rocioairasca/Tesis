const express = require ('express');
const router = express.Router();

const publicController = require('../controllers/publicController.js');

router.post('/register-company', publicController.registerCompany);

module.exports = router;