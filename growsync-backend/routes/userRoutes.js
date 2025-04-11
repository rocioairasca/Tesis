const express = require('express');
const router = express.Router();

const checkJwt = require('../middleware/checkJwt');
const userData = require('../middleware/userData');
const checkRole = require('../middleware/checkRole');
const pool = require('../db/connection');
const updateRole = require('../controllers/users/updateRole'); 

// Obtener todos los usuarios (solo Admin rol 3)
router.get('/', checkJwt, userData, checkRole(3), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
});

// Obtener usuario por email
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

// Modificar rol de un usuario (solo Admin rol 3)
router.put('/:id/role', checkJwt, userData, checkRole(3), updateRole);

module.exports = router;
