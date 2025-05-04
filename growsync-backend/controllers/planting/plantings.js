// IMPORTACION DE POOL DE BD
const db = require('../../db/connection');

// DECLARAMOS FUNCIONES PARA OBTENER, CREAR, EDITAR, DESHABILITAR Y HABILITAR SIEMBRAS

// LISTAR SIEMBRAS - Obtiene de la BD todas las siembras habilitadas, ordenadas por ID
const listPlantings = async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM plantings WHERE active = TRUE ORDER BY planting_date DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al listar siembras", error });
  }
};

// CREAR SIEMBRA - Obtiene informacion del front para crear una nueva entrada en la BD con informacion de la siembra
const createPlanting = async (req, res) => {
  const { lot_id, planting_date, crop, seed_variety, density, total_seeds, notes } = req.body;
  try {
    await db.query(
      `INSERT INTO plantings (lot_id, planting_date, crop, seed_variety, density, total_seeds, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [lot_id, planting_date, crop, seed_variety, density, total_seeds, notes]
    );
    res.status(201).json({ message: "Siembra creada exitosamente." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al crear siembra", error });
  }
};

// EDITAR SIEMBRA - Se vale del ID para editar los datos de la entrada de la BD que coincida con dicha ID
const updatePlanting = async (req, res) => {
  const { id } = req.params;
  const { lot_id, planting_date, crop, seed_variety, density, total_seeds, notes } = req.body;
  try {
    await db.query(
      `UPDATE plantings
       SET lot_id = $1, planting_date = $2, crop = $3, seed_variety = $4, density = $5, total_seeds = $6, notes = $7, updated_at = NOW()
       WHERE id = $8`,
      [lot_id, planting_date, crop, seed_variety, density, total_seeds, notes, id]
    );
    res.status(200).json({ message: "Siembra actualizada exitosamente." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al actualizar siembra", error });
  }
};

// DESHABILITAR SIEMBRA - Se vale de la ID para cambiar el valor "enabled" de la entrada correspondiente a dicho ID
const disablePlanting = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(
      `UPDATE plantings
       SET active = FALSE, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
    res.status(200).json({ message: "Siembra deshabilitada exitosamente." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al deshabilitar siembra", error });
  }
};

// HABILITAR SIEMBRA - Se vale de la ID para cambiar el valor "enabled" de la entrada correspondiente a dicho ID
const enablePlanting = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(
      `UPDATE plantings
       SET active = TRUE, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
    res.status(200).json({ message: "Siembra habilitada exitosamente." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al habilitar siembra", error });
  }
};

// EXPORTAMOS LAS FUNCIONES PARA SER USADAS EN UNA RUTA (routes/plantings.js)
module.exports = {
  listPlantings,
  createPlanting,
  updatePlanting,
  disablePlanting,
  enablePlanting
};
