const express = require('express');
const router = express.Router();

// IMPORTACION DE MIDDLEWARES EN /middleware
const checkJwt = require('../middleware/checkJwt');
const userData = require('../middleware/userData');
const checkRole = require('../middleware/checkRole');

// CONEXION A LA BASE DE DATOS
const pool = require('../db/connection');

// IMPORTACION DE CONTROLADORES EN /controllers/auth
const updateRole = require('../controllers/users/updateRole'); 

// Las rutas son puntos de entrada al servidor, y nos sirven para establecer respuestas a las solicitudes HTTP
// Al mismo tiempo, nos mueve a crear codigo de una forma mas limpia y modular

// GetAllUsers EN POSTMAN - Devuelve todos los usuarios (solo Admin rol 3)
router.get('/', checkJwt, userData, checkRole(3), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
});

// UpdateUserRole EN POSTMAN - Modifica el rol de un usuario (solo Admin rol 3)
router.put('/:id/role', checkJwt, userData, checkRole(3), updateRole);

// --- EN POSTMAN - Devuelve todos los usuarios que coincidan con el email proporcionado
router.get('/email/:email', async (req, res) => {
  const { email } = req.params;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error al obtener usuario por email:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// se exporta el router para que pueda ser usado en index.js
module.exports = router;
