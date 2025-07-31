// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require('../db/supabaseClient');

// LISTAR VEHICULOS - Obtiene todos los vehículos habilitados
const listVehicles = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('enabled', true)
      .order('id', { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al listar vehículos', error });
  }
};

// CREAR VEHÍCULO
const addVehicle = async (req, res) => {
  try {
    const { marca, modelo, tipo, anio, patente } = req.body;

    const { data, error } = await supabase
      .from('vehicles')
      .insert([{ marca, modelo, tipo, anio, patente }])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear vehículo', error });
  }
};

// EDITAR VEHÍCULO
const editVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { marca, modelo, tipo, anio, patente } = req.body;

    const { data, error } = await supabase
      .from('vehicles')
      .update({ marca, modelo, tipo, anio, patente })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al editar vehículo', error });
  }
};

// DESHABILITAR VEHÍCULO
const disableVehicle = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('vehicles')
      .update({ enabled: false })
      .eq('id', id);

    if (error) throw error;

    res.status(200).json({ message: 'Vehículo deshabilitado exitosamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al deshabilitar vehículo', error });
  }
};

// LISTAR VEHÍCULOS DESHABILITADOS
const listDisabledVehicles = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('enabled', false)
      .order('id', { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al listar vehículos deshabilitados', error });
  }
};

// HABILITAR VEHÍCULO
const enableVehicle = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('vehicles')
      .update({ enabled: true })
      .eq('id', id);

    if (error) throw error;

    res.status(200).json({ message: 'Vehículo habilitado exitosamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al habilitar vehículo', error });
  }
};

// EXPORTAMOS LAS FUNCIONES
module.exports = {
  listVehicles,
  addVehicle,
  editVehicle,
  disableVehicle,
  listDisabledVehicles,
  enableVehicle
};
