const express = require('express');
const {
    createCompanyInvitation,
} = require('../controllers/adminCompanyController');
const validate = require('../middleware/validate');
const schema = require('../validations/adminCompany.schema');

const router = express.Router();

router.post('/', validate(schema.createCompanyInvitation), createCompanyInvitation);

module.exports = router;
