// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require("../../db/supabaseClient");

// LISTAR RDUs HABILITADOS (incluyendo lotes asociados)
const listUsages = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("usage_records")
      .select(`
        *,
        usage_lots ( lot_id ),
        users:user_id ( full_name, nickname, email )
      `)
      .eq("enabled", true)
      .order("date", { ascending: false });

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
    const {
      product_id,
      amount_used,
      unit,
      lot_ids,
      total_area,
      previous_crop,
      current_crop,
      user_id,
      date
    } = req.body;

    // 1️⃣ Insertar nuevo registro en usage_records
    const { data: usage, error: insertError } = await supabase
      .from("usage_records")
      .insert([{
        product_id,
        amount_used,
        unit,
        total_area,
        previous_crop,
        current_crop,
        user_id,
        date
      }])
      .select("id")
      .single();

    if (insertError) throw insertError;

    const usageId = usage.id;

    // 2️⃣ Insertar relaciones en usage_lots
    const safeLotIds = Array.isArray(lot_ids) ? lot_ids : JSON.parse(lot_ids || '[]');
    if (safeLotIds.length > 0) {
      const usageLotsData = safeLotIds.map(lot_id => ({
        usage_id: usageId,
        lot_id
      }));
      const { error: usageLotsError } = await supabase
        .from("usage_lots")
        .insert(usageLotsData);
      if (usageLotsError) throw usageLotsError;
    }

    // 3️⃣ Descontar stock manualmente
    const { data: product, error: fetchError } = await supabase
      .from("products")
      .select("available_quantity")
      .eq("id", product_id)
      .single();

    if (fetchError) throw fetchError;

    const newQty = (product?.available_quantity || 0) - Number(amount_used);

    const { error: updateError } = await supabase
      .from("products")
      .update({ available_quantity: newQty })
      .eq("id", product_id);

    if (updateError) throw updateError;

    res.status(201).json({ message: "Registro de uso creado exitosamente." });
  } catch (error) {
    console.error("Error al crear registro de uso:", error);
    res.status(500).json({ message: "Error al crear registro de uso", error });
  }
};

// EDITAR UN RDU
const editUsage = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      product_id,
      amount_used,
      unit,
      lot_ids,
      total_area,
      previous_crop,
      current_crop,
      user_id,
      date
    } = req.body;

    // 1️⃣ Actualizar usage_records
    const { error: updateUsageError } = await supabase
      .from("usage_records")
      .update({
        product_id,
        amount_used,
        unit,
        total_area,
        previous_crop,
        current_crop,
        user_id,
        date
      })
      .eq("id", id);

    if (updateUsageError) throw updateUsageError;

    // 2️⃣ Actualizar usage_lots
    await supabase.from("usage_lots").delete().eq("usage_id", id);

    const safeLotIds = Array.isArray(lot_ids) ? lot_ids : JSON.parse(lot_ids || '[]');
    if (safeLotIds.length > 0) {
      const usageLotsData = safeLotIds.map(lot_id => ({
        usage_id: id,
        lot_id
      }));
      const { error: usageLotsError } = await supabase
        .from("usage_lots")
        .insert(usageLotsData);
      if (usageLotsError) throw usageLotsError;
    }

    res.status(200).json({ message: "Registro de uso actualizado exitosamente." });
  } catch (error) {
    console.error("Error al actualizar registro de uso:", error);
    res.status(500).json({ message: "Error al actualizar registro de uso", error });
  }
};

// DESHABILITAR UN RDU
const disableUsage = async (req, res) => {
  const { id } = req.params;
  try {
    // 1️⃣ Obtener el registro
    const { data: usage, error: fetchError } = await supabase
      .from("usage_records")
      .select("product_id, amount_used")
      .eq("id", id)
      .single();

    if (fetchError) throw fetchError;
    if (!usage) return res.status(404).json({ message: "Registro de uso no encontrado" });

    // 2️⃣ Reintegrar stock (opcional)
    const { error: reintegrateError } = await supabase
      .from("products")
      .update({
        available_quantity: supabase.rpc("increment_stock", { qty: usage.amount_used })
      })
      .eq("id", usage.product_id);

    if (reintegrateError) throw reintegrateError;

    // 3️⃣ Marcar como deshabilitado
    const { error: disableError } = await supabase
      .from("usage_records")
      .update({ enabled: false })
      .eq("id", id);

    if (disableError) throw disableError;

    res.status(200).json({ message: "Registro de uso deshabilitado exitosamente." });
  } catch (error) {
    console.error("Error al deshabilitar registro de uso:", error);
    res.status(500).json({ message: "Error al deshabilitar registro de uso", error });
  }
};

// LISTAR RDUs DESHABILITADOS
const listDisabledUsages = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("usage_records")
      .select("*")
      .eq("enabled", false)
      .order("date", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error("Error al listar registros de uso deshabilitados:", error);
    res.status(500).json({ message: "Error al listar registros de uso deshabilitados", error });
  }
};

// HABILITAR UN RDU
const enableUsage = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from("usage_records")
      .update({ enabled: true })
      .eq("id", id);

    if (error) throw error;

    res.status(200).json({ message: "Registro de uso habilitado exitosamente." });
  } catch (error) {
    console.error("Error al habilitar registro de uso:", error);
    res.status(500).json({ message: "Error al habilitar registro de uso", error });
  }
};

module.exports = {
  listUsages,
  createUsage,
  editUsage,
  disableUsage,
  listDisabledUsages,
  enableUsage
};
