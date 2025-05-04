// IMPORTACION DE POOL DE BD
const pool = require('../../db/connection');

// DECLARAMOS UNA FUNCION getAllUsers - Obtiene de la BD todos los usuarios
const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, email, role FROM users');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
};

// EXPORTAMOS LA FUNCION PARA SER USADA (por ahora, en ningun lado)
module.exports = getAllUsers;
