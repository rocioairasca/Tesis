// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require('../../db/supabaseClient');

// LISTAR PRODUCTOS - Obtiene todos los productos habilitados
const listProducts = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('enabled', true)
      .order('id', { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al listar productos', error });
  }
};

// CREAR PRODUCTO
const addProduct = async (req, res) => {
  try {
    const { name, type, total_quantity, available_quantity, unit, price, acquisition_date } = req.body;

    const { data, error } = await supabase
      .from('products')
      .insert([{
        name,
        type,
        total_quantity,
        available_quantity,
        unit,
        price,
        acquisition_date
      }])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear producto', error });
  }
};

// EDITAR PRODUCTO
const editProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, total_quantity, available_quantity, unit, price, acquisition_date } = req.body;

    const { data, error } = await supabase
      .from('products')
      .update({
        name,
        type,
        total_quantity,
        available_quantity,
        unit,
        price,
        acquisition_date
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al editar producto', error });
  }
};

// DESHABILITAR PRODUCTO
const disableProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('products')
      .update({ enabled: false })
      .eq('id', id);

    if (error) throw error;

    res.status(200).json({ message: 'Producto deshabilitado exitosamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al deshabilitar producto', error });
  }
};

// EXPORTAMOS LAS FUNCIONES
module.exports = {
  listProducts,
  addProduct,
  editProduct,
  disableProduct
};
