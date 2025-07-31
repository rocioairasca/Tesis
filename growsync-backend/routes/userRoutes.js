const express = require('express');
const router = express.Router();

// IMPORTACION DE MIDDLEWARES EN /middleware
const checkJwt = require('../middleware/checkJwt');
const userData = require('../middleware/userData');
const checkRole = require('../middleware/checkRole');

// CONEXION A LA BASE DE DATOS (Supabase)
const supabase = require('../db/supabaseClient');

// IMPORTACION DE CONTROLADORES EN /controllers/auth
const updateRole = require('../controllers/users/updateRole'); 

/**
 * 📌 GetAllUsers
 * Devuelve todos los usuarios (solo Admin rol 3)
 */
router.get('/', checkJwt, userData, checkRole(3), async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('*');

    if (error) {
      console.error('Error al obtener usuarios desde Supabase:', error);
      return res.status(500).json({ message: 'Error al obtener usuarios' });
    }

    res.json(data);
  } catch (error) {
    console.error('Error inesperado al obtener usuarios:', error);
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
});

/**
 * 📌 UpdateUserRole
 * Modifica el rol de un usuario (solo Admin rol 3)
 */
router.put('/:id/role', checkJwt, userData, checkRole(3), updateRole);

/**
 * 📌 GetUserByEmail
 * Devuelve un usuario que coincida con el email proporcionado
 */
router.get('/email/:email', async (req, res) => {
  const { email } = req.params;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single(); // .single() porque esperamos solo un resultado

    if (error && error.code === 'PGRST116') { // No encontrado
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    if (error) {
      console.error('Error al obtener usuario por email:', error);
      return res.status(500).json({ message: 'Error del servidor' });
    }

    res.json(data);
  } catch (error) {
    console.error('Error inesperado al obtener usuario por email:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Exportar router
module.exports = router;
