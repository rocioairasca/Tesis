// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require('../../db/supabaseClient');

// DECLARAMOS UNA FUNCIÓN getAllUsers - Obtiene de la BD todos los usuarios
const getAllUsers = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, username, email, role');

    if (error) {
      console.error('Error al obtener usuarios desde Supabase:', error);
      return res.status(500).json({ message: 'Error al obtener usuarios', error });
    }

    res.status(200).json(data);
  } catch (error) {
    console.error('Error inesperado al obtener usuarios:', error);
    res.status(500).json({ message: 'Error al obtener usuarios', error });
  }
};

// EXPORTAMOS LA FUNCIÓN
module.exports = getAllUsers;

