const pool = require('../../db/connection');

const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, email, role FROM users');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
};

module.exports = getAllUsers;
