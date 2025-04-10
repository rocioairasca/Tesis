const pool = require("../db/connection");

const userData = async (req, res, next) => {
  try {
    const auth0_id = req.auth.sub; // auth0|xxxxxx

    const userDb = await pool.query('SELECT * FROM users WHERE auth0_id = $1', [auth0_id]);

    if (userDb.rowCount === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado en base de datos' });
    }

    req.user = {
      id: userDb.rows[0].id,
      email: userDb.rows[0].email,
      role: userDb.rows[0].role
    };

    next();

  } catch (error) {
    console.error("Error en userData middleware:", error);
    res.status(500).json({ message: "Error al obtener datos de usuario" });
  }
};

module.exports = userData;
