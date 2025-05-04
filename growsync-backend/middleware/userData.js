// IMPORTACION DEL POOL DE CONEXION A LA BD
const pool = require("../db/connection");

// DEFINIMOS Y CONFIGURAMOS EL MIDDLEWARE userData
// Este se vale del sub, que es un ID unico que Auth0, que nos sirve para identificarlo en nuestra BD, y nos devuelve informacion local del usuario
const userData = async (req, res, next) => {
  try {
    const { sub } = req.auth;

    const userDb = await pool.query('SELECT * FROM users WHERE auth0_id = $1', [sub]);

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

// EXPORTAMOS EL MIDDLEWARE PARA PODER USARLO EN EL PROYECTO
module.exports = userData;
