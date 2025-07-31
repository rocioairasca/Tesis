// IMPORTACION DE CLIENTE SUPABASE
const supabase = require("../db/supabaseClient");

// DEFINIMOS Y CONFIGURAMOS EL MIDDLEWARE userData
// Este se vale del sub, que es un ID único que Auth0 nos da, que usamos para buscar al usuario en nuestra BD
const userData = async (req, res, next) => {
  try {
    const { sub } = req.auth;

    // Consultar usuario en Supabase
    const { data: userDb, error } = await supabase
      .from('users')
      .select('*')
      .eq('auth0_id', sub)
      .single(); // Esperamos un único resultado

    if (error && error.code === 'PGRST116') { // No encontrado
      return res.status(404).json({ message: 'Usuario no encontrado en base de datos' });
    }
    if (error) {
      console.error("Error al obtener usuario en Supabase:", error);
      return res.status(500).json({ message: "Error al obtener datos de usuario" });
    }

    // Guardar datos del usuario en req.user
    req.user = {
      id: userDb.id,
      email: userDb.email,
      role: userDb.role
    };

    next();

  } catch (error) {
    console.error("Error en userData middleware:", error);
    res.status(500).json({ message: "Error al obtener datos de usuario" });
  }
};

// EXPORTAMOS EL MIDDLEWARE PARA PODER USARLO EN EL PROYECTO
module.exports = userData;
