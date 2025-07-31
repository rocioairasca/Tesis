// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require('../../db/supabaseClient');

// LISTAR LOTES DESHABILITADOS - Obtiene todos los lotes deshabilitados, ordenados por ID
const listDisabledLots = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lots')
      .select('*')
      .eq('enabled', false)
      .order('id', { ascending: true });

    if (error) {
      console.error("Error al listar lotes deshabilitados:", error);
      return res.status(500).json({ message: 'Error al listar lotes deshabilitados', error });
    }

    res.json(data);
  } catch (error) {
    console.error("Error inesperado al listar lotes deshabilitados:", error);
    res.status(500).json({ message: 'Error al listar lotes deshabilitados', error });
  }
};

// HABILITAR LOTES - Cambia "enabled" a TRUE para un lote específico
const enableLot = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('lots')
      .update({ enabled: true })
      .eq('id', id);

    if (error) {
      console.error("Error al habilitar lote:", error);
      return res.status(500).json({ message: 'Error al habilitar lote', error });
    }

    res.status(200).json({ message: 'Lote habilitado exitosamente.' });
  } catch (error) {
    console.error("Error inesperado al habilitar lote:", error);
    res.status(500).json({ message: 'Error al habilitar lote', error });
  }
};

// EXPORTAMOS LAS FUNCIONES PARA SER USADAS EN UNA RUTA (routes/lot.js)
module.exports = {
  listDisabledLots,
  enableLot
};
