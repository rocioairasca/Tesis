// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require('../../db/supabaseClient');

// LISTAR LOTES - Obtiene todos los lotes habilitados, ordenados por ID
const listLots = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lots')
      .select('*')
      .eq('enabled', true)
      .order('id', { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al listar lotes', error });
  }
};

// CREAR LOTE
const addLot = async (req, res) => {
  try {
    const { name, area, location } = req.body;

    const { data, error } = await supabase
      .from('lots')
      .insert([{ name, area, location }])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear lote', error });
  }
};

// EDITAR LOTE
const editLot = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, area, location } = req.body;

    const { data, error } = await supabase
      .from('lots')
      .update({ name, area, location })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al editar lote', error });
  }
};

// DESHABILITAR LOTE
const softDeleteLot = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('lots')
      .update({ enabled: false })
      .eq('id', id);

    if (error) throw error;

    res.status(200).json({ message: 'Lote deshabilitado exitosamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al deshabilitar lote', error });
  }
};

// CONTAR LOTES HABILITADOS
const countEnabledLots = async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('lots')
      .select('id', { count: 'exact', head: true })
      .eq('enabled', true);

    if (error) throw error;

    res.json({ total: count || 0 });
  } catch (error) {
    res.status(500).json({ message: 'Error al contar lotes', error });
  }
};

// EXPORTAMOS LAS FUNCIONES
module.exports = {
  listLots,
  addLot,
  editLot,
  softDeleteLot,
  countEnabledLots
};
