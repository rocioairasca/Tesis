const db = require('../../db/connection.js');

// LISTAR LOTES DESHABILITADOS
const listDisabledLots = async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM lots WHERE enabled = FALSE ORDER BY id');
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ message: 'Error al listar lotes deshabilitados', error });
    }
};

// HABILITAR LOTES
const enableLot = async (req, res) => {
    try {
      const { id } = req.params;
      await db.query('UPDATE lots SET enabled = TRUE WHERE id = $1', [id]);
      res.status(200).json({ message: 'Lote habilitado exitosamente.' });
    } catch (error) {
      res.status(500).json({ message: 'Error al habilitar lote', error });
    }
};

module.exports = {
    listDisabledLots,
    enableLot
};