const express = require('express');
const router = express.Router();

// IMPORTACION DE CONTROLADORES EN /controllers/auth
    const registerUser = require('../controllers/auth/registerUser');
    const loginUser = require("../controllers/auth/loginUser");

// Las rutas son puntos de entrada al servidor, y nos sirven para establecer respuestas a las solicitudes HTTP
// Al mismo tiempo, nos mueve a crear codigo de una forma mas limpia y modular

// DEFINICION DE RUTAS PARA /register Y /login
router.post('/register', registerUser);
router.post("/login", loginUser);

// Se exporta el router para que pueda ser usado en index.js
module.exports = router;