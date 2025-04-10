const express = require('express');
const router = express.Router();
const checkJwt = require('../middleware/checkJwt');
const userData = require('../middleware/userData');
const verifyAdmin = require('../middleware/verifyAdmin');
const getAllUsers = require('../controllers/users/getAllUsers');
const updateRole = require('../controllers/users/updateRole');

// Ver todos los usuarios (Solo Admin)
router.get('/users', checkJwt, userData, verifyAdmin, getAllUsers);

// Cambiar rol a un usuario (Solo Admin)
router.put('/users/:id/role', checkJwt, userData, verifyAdmin, updateRole);

module.exports = router;
