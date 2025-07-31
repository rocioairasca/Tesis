// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require('../db/supabaseClient');

// DECLARAMOS UNA FUNCIÓN getStats - Realiza conteos con los datos almacenados en la BD
const getStats = async (req, res) => {
  try {
    // Hacemos todas las consultas en paralelo
    const [users, products, lots, usages] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('enabled', true),
      supabase.from('lots').select('id', { count: 'exact', head: true }).eq('enabled', true),
      supabase.from('usage_records').select('id', { count: 'exact', head: true }).eq('enabled', true)
    ]);

    // Verificamos errores
    if (users.error || products.error || lots.error || usages.error) {
      console.error("Error al obtener estadísticas:", {
        users: users.error,
        products: products.error,
        lots: lots.error,
        usages: usages.error
      });
      return res.status(500).json({ message: 'Error al obtener estadísticas' });
    }

    // Respondemos con los conteos
    res.json({
      users: users.count || 0,
      products: products.count || 0,
      lots: lots.count || 0,
      usages: usages.count || 0
    });

  } catch (error) {
    console.error("Error inesperado al obtener estadísticas:", error);
    res.status(500).json({ message: 'Error al obtener estadísticas', error });
  }
};

// EXPORTAMOS LAS FUNCIONES
module.exports = { getStats };
