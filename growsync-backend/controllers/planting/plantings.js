const db = require('../../db/connection');

// OBTENER TODAS LAS SIEMBRAS ACTIVAS
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

// CREAR NUEVA SIEMBRA
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

// ACTUALIZAR SIEMBRA
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

// DESHABILITAR SIEMBRA (Soft Delete)
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

// HABILITAR SIEMBRA
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

module.exports = {
  listPlantings,
  createPlanting,
  updatePlanting,
  disablePlanting,
  enablePlanting
};
