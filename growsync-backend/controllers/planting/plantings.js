// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require('../../db/supabaseClient');

// LISTAR SIEMBRAS - Obtiene todas las siembras habilitadas, ordenadas por fecha de siembra descendente
const listPlantings = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('plantings')
      .select('*')
      .eq('active', true)
      .order('planting_date', { ascending: false });

    if (error) {
      console.error("Error al listar siembras:", error);
      return res.status(500).json({ message: "Error al listar siembras", error });
    }

    res.json(data);
  } catch (error) {
    console.error("Error inesperado al listar siembras:", error);
    res.status(500).json({ message: "Error al listar siembras", error });
  }
};

// CREAR SIEMBRA
const createPlanting = async (req, res) => {
  const { lot_id, planting_date, crop, seed_variety, density, total_seeds, notes } = req.body;
  try {
    const { error } = await supabase
      .from('plantings')
      .insert([{
        lot_id,
        planting_date,
        crop,
        seed_variety,
        density,
        total_seeds,
        notes
      }]);

    if (error) {
      console.error("Error al crear siembra:", error);
      return res.status(500).json({ message: "Error al crear siembra", error });
    }

    res.status(201).json({ message: "Siembra creada exitosamente." });
  } catch (error) {
    console.error("Error inesperado al crear siembra:", error);
    res.status(500).json({ message: "Error al crear siembra", error });
  }
};

// EDITAR SIEMBRA
const updatePlanting = async (req, res) => {
  const { id } = req.params;
  const { lot_id, planting_date, crop, seed_variety, density, total_seeds, notes } = req.body;
  try {
    const { error } = await supabase
      .from('plantings')
      .update({
        lot_id,
        planting_date,
        crop,
        seed_variety,
        density,
        total_seeds,
        notes,
        updated_at: new Date()
      })
      .eq('id', id);

    if (error) {
      console.error("Error al actualizar siembra:", error);
      return res.status(500).json({ message: "Error al actualizar siembra", error });
    }

    res.status(200).json({ message: "Siembra actualizada exitosamente." });
  } catch (error) {
    console.error("Error inesperado al actualizar siembra:", error);
    res.status(500).json({ message: "Error al actualizar siembra", error });
  }
};

// DESHABILITAR SIEMBRA
const disablePlanting = async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('plantings')
      .update({
        active: false,
        updated_at: new Date()
      })
      .eq('id', id);

    if (error) {
      console.error("Error al deshabilitar siembra:", error);
      return res.status(500).json({ message: "Error al deshabilitar siembra", error });
    }

    res.status(200).json({ message: "Siembra deshabilitada exitosamente." });
  } catch (error) {
    console.error("Error inesperado al deshabilitar siembra:", error);
    res.status(500).json({ message: "Error al deshabilitar siembra", error });
  }
};

// HABILITAR SIEMBRA
const enablePlanting = async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('plantings')
      .update({
        active: true,
        updated_at: new Date()
      })
      .eq('id', id);

    if (error) {
      console.error("Error al habilitar siembra:", error);
      return res.status(500).json({ message: "Error al habilitar siembra", error });
    }

    res.status(200).json({ message: "Siembra habilitada exitosamente." });
  } catch (error) {
    console.error("Error inesperado al habilitar siembra:", error);
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
