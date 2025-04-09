const express = require('express');
const router = express.Router();
const registerUser = require('../controllers/auth/registerUser');
const loginUser = require("../controllers/auth/loginUser");

router.post('/register', registerUser);
router.post("/login", loginUser);

module.exports = router;