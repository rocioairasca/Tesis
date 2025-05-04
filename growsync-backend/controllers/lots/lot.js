// IMPORTACION DE POOL DE BD
const db = require('../../db/connection.js');

// DECLARAMOS FUNCIONES PARA OBTENER, CREAR, EDITAR, DESHABILITAR Y CONTAR LOTES

// LISTAR LOTES - Obtiene de la BD todos los lotes habilitados, ordenados por ID
const listLots = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM lots WHERE enabled = TRUE ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Error al listar lotes', error });
  }
};

// CREAR LOTE - Obtiene informacion del front para crear una nueva entrada en la BD con informacion del lote
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

// EDITAR LOTE - Se vale del ID para editar los datos de la entrada de la BD que coincida con dicha ID
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

// DESHABILITAR LOTE - Se vale de la ID para cambiar el valor "enabled" de la entrada correspondiente a dicho ID
const softDeleteLot = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('UPDATE lots SET enabled = FALSE WHERE id = $1', [id]);
    res.status(200).json({ message: 'Lote deshabilitado exitosamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al deshabilitar lote', error });
  }
};

// CONTAR LOTES HABILITADOS - Funciona similar a LISTAR LOTES, pero en vez de devolvernos las entradas, nos devuelve la cantidad de entradas encontradas
const countEnabledLots = async (req, res) => {
  try {
    const result = await db.query('SELECT COUNT(*) FROM lots WHERE enabled = TRUE');
    const count = result.rows[0].count;
    res.json({ total: parseInt(count, 10) });
  } catch (error) {
    res.status(500).json({ message: 'Error al contar lotes', error });
  }
};

// EXPORTAMOS LAS FUNCIONES PARA SER USADAS EN UNA RUTA (routes/lot.js)
module.exports = {
  listLots,
  addLot,
  editLot,
  softDeleteLot,
  countEnabledLots
};
