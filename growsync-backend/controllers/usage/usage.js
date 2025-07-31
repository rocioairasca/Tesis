// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require("../../db/supabaseClient");

// LISTAR RDUs HABILITADOS
const listUsages = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('usage_records')
      .select('*')
      .eq('enabled', true)
      .order('date', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error("Error al listar registros de uso:", error);
    res.status(500).json({ message: "Error al listar registros de uso", error });
  }
};

// CREAR UN RDU
const createUsage = async (req, res) => {
  try {
    const { product_id, amount_used, unit, lot_ids, total_area, previous_crop, current_crop, user_id, date } = req.body;

    // 1️⃣ Insertar nuevo registro
    const { error: insertError } = await supabase
      .from('usage_records')
      .insert([{
        product_id,
        amount_used,
        unit,
        lot_ids,
        total_area,
        previous_crop,
        current_crop,
        user_id,
        date
      }]);

    if (insertError) throw insertError;

    // 2️⃣ Descontar del stock
    const { error: updateError } = await supabase
      .from('products')
      .update({
        available_quantity: supabase.rpc('decrement_stock', { qty: amount_used }) // RPC opcional
      })
      .eq('id', product_id);

    if (updateError) throw updateError;

    res.status(201).json({ message: 'Registro de uso creado exitosamente.' });
  } catch (error) {
    console.error("Error al crear registro de uso:", error);
    res.status(500).json({ message: 'Error al crear registro de uso', error });
  }
};

// EDITAR UN RDU
const editUsage = async (req, res) => {
  try {
    const { id } = req.params;
    const { product_id, amount_used, unit, lot_ids, total_area, previous_crop, current_crop, user_id, date } = req.body;

    const { error } = await supabase
      .from('usage_records')
      .update({
        product_id,
        amount_used,
        unit,
        lot_ids,
        total_area,
        previous_crop,
        current_crop,
        user_id,
        date
      })
      .eq('id', id);

    if (error) throw error;

    res.status(200).json({ message: 'Registro de uso actualizado exitosamente.' });
  } catch (error) {
    console.error("Error al actualizar registro de uso:", error);
    res.status(500).json({ message: 'Error al actualizar registro de uso', error });
  }
};

// DESHABILITAR UN RDU
const disableUsage = async (req, res) => {
  const { id } = req.params;
  try {
    // 1️⃣ Obtener el registro
    const { data: usage, error: fetchError } = await supabase
      .from('usage_records')
      .select('product_id, amount_used')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;
    if (!usage) return res.status(404).json({ message: 'Registro de uso no encontrado' });

    // 2️⃣ Reintegrar stock
    const { error: reintegrateError } = await supabase
      .from('products')
      .update({
        available_quantity: supabase.rpc('increment_stock', { qty: usage.amount_used }) // RPC opcional
      })
      .eq('id', usage.product_id);

    if (reintegrateError) throw reintegrateError;

    // 3️⃣ Marcar como deshabilitado
    const { error: disableError } = await supabase
      .from('usage_records')
      .update({ enabled: false })
      .eq('id', id);

    if (disableError) throw disableError;

    res.status(200).json({ message: 'Registro de uso deshabilitado exitosamente.' });
  } catch (error) {
    console.error("Error al deshabilitar registro de uso:", error);
    res.status(500).json({ message: 'Error al deshabilitar registro de uso', error });
  }
};

// LISTAR RDUs DESHABILITADOS
const listDisabledUsages = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('usage_records')
      .select('*')
      .eq('enabled', false)
      .order('date', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error("Error al listar registros de uso deshabilitados:", error);
    res.status(500).json({ message: 'Error al listar registros de uso deshabilitados', error });
  }
};

// HABILITAR UN RDU
const enableUsage = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('usage_records')
      .update({ enabled: true })
      .eq('id', id);

    if (error) throw error;

    res.status(200).json({ message: 'Registro de uso habilitado exitosamente.' });
  } catch (error) {
    console.error("Error al habilitar registro de uso:", error);
    res.status(500).json({ message: 'Error al habilitar registro de uso', error });
  }
};

// EXPORTAMOS LAS FUNCIONES
module.exports = {
  listUsages,
  createUsage,
  editUsage,
  disableUsage,
  listDisabledUsages,
  enableUsage
};
