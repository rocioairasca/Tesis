const db = require('../../db/connection.js');

// LISTAR LOTES
const listLots = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM lots WHERE enabled = TRUE ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Error al listar lotes', error });
  }
};

// CREAR LOTE
const addLot = async (req, res) => {
  try {
    const { name, area, location } = req.body;
    const result = await db.query(
      'INSERT INTO lots (name, area, location) VALUES ($1, $2, $3) RETURNING *',
      [name, area, location]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear lote', error });
  }
};

// EDITAR LOTE
const editLot = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, area, location } = req.body;
    const result = await db.query(
      'UPDATE lots SET name = $1, area = $2, location = $3 WHERE id = $4 RETURNING *',
      [name, area, location, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error al editar lote', error });
  }
};

// DESHABILITAR LOTE
const softDeleteLot = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('UPDATE lots SET enabled = FALSE WHERE id = $1', [id]);
    res.status(200).json({ message: 'Lote deshabilitado exitosamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al deshabilitar lote', error });
  }
};

module.exports = {
  listLots,
  addLot,
  editLot,
  softDeleteLot
};
