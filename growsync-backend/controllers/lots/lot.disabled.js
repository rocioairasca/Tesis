// IMPORTACION DE POOL DE BD
const db = require('../../db/connection.js');

// DECLARAMOS FUNCIONES PARA OBTENER Y HABILITAR

// LISTAR LOTES DESHABILITADOS - Obtiene de la BD todos los lotes deshabilitados, ordenados por ID
const listDisabledLots = async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM lots WHERE enabled = FALSE ORDER BY id');
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ message: 'Error al listar lotes deshabilitados', error });
    }
};

// HABILITAR LOTES - Se vale de la ID para cambiar el valor "enabled" de la entrada correspondiente a dicho ID
const enableLot = async (req, res) => {
    try {
      const { id } = req.params;
      await db.query('UPDATE lots SET enabled = TRUE WHERE id = $1', [id]);
      res.status(200).json({ message: 'Lote habilitado exitosamente.' });
    } catch (error) {
      res.status(500).json({ message: 'Error al habilitar lote', error });
    }
};

// EXPORTAMOS LAS FUNCIONES PARA SER USADAS EN UNA RUTA (routes/lot.js)
module.exports = {
    listDisabledLots,
    enableLot
};