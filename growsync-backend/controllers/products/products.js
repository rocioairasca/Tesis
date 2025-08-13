// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require('../../db/supabaseClient');

/**
 * LISTAR PRODUCTOS (habilitados por defecto)
 * Soporta: ?q=&category=&page=&pageSize=&includeDisabled=
 * Devuelve: { data, page, pageSize, total }
 */
const listProducts = async (req, res) => {
  try {
    const {
      q,
      category,                 // 'semillas' | 'agroquimicos' | 'fertilizantes' | 'combustible'
      page = 1,
      pageSize = 50,
      includeDisabled = false,
    } = req.query;

    const limit  = Math.min(Math.max(Number(pageSize) || 50, 1), 1000);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const columns = [
      'id','name','category','unit',
      'price','cost',
      'total_quantity','available_quantity',
      'expiration_date','acquisition_date',
      'enabled','created_at'
    ].join(',');

    let query = supabase
      .from('products')
      .select(columns, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (!includeDisabled) query = query.eq('enabled', true);
    if (category)         query = query.eq('category', category);
    if (q && q.trim().length >= 2) query = query.ilike('name', `%${q.trim()}%`);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error al listar productos:', error);
      return res.status(500).json({ error: 'DbError', message: 'Error al listar productos' });
    }

    return res.json({
      data: data || [],
      page: Number(page),
      pageSize: limit,
      total: count ?? (data?.length || 0),
    });
  } catch (err) {
    console.error('Error inesperado al listar productos:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Error al listar productos' });
  }
};

/**
 * CREAR PRODUCTO
 * Body esperado
 *  { name, category, unit, expiration_date?, cost?, price?, total_quantity?, available_quantity?, acquisition_date? }
 */
const addProduct = async (req, res) => {
  try {
    const {
      name,
      category,               
      unit,
      expiration_date,
      cost,
      price,
      total_quantity,
      available_quantity,
      acquisition_date,
    } = req.body;

    // Regla de negocio simple: available ≤ total si ambos vienen
    if (
      total_quantity != null &&
      available_quantity != null &&
      Number(available_quantity) > Number(total_quantity)
    ) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'available_quantity no puede superar total_quantity',
      });
    }

    const { data, error } = await supabase
      .from('products')
      .insert([{
        name,
        category,
        unit,
        expiration_date,
        cost,
        price,
        total_quantity,
        available_quantity,
        acquisition_date,
      }])
      .select('id,name,category,unit,price,cost,total_quantity,available_quantity,expiration_date,acquisition_date,enabled,created_at')
      .single();

    if (error) {
      console.error('Error al crear producto:', error);
      return res.status(500).json({ error: 'DbError', message: 'Error al crear producto' });
    }

    return res.status(201).json({ product: data });
  } catch (err) {
    console.error('Error inesperado al crear producto:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Error al crear producto' });
  }
};

/**
 * EDITAR PRODUCTO
 * PUT parcial: solo actualiza campos presentes en el body
 * 404 si no existe
 */
const editProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // Armamos el objeto de update solo con campos definidos
    const allowed = [
      'name','category','unit','expiration_date',
      'cost','price','total_quantity','available_quantity','acquisition_date',
      'enabled' 
    ];
    const updateData = {};
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        updateData[k] = req.body[k];
      }
    }

    // Chequeo de negocio: available ≤ total si ambos vienen
    if (
      updateData.total_quantity != null &&
      updateData.available_quantity != null &&
      Number(updateData.available_quantity) > Number(updateData.total_quantity)
    ) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'available_quantity no puede superar total_quantity',
      });
    }

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', id)
      .select('id,name,category,unit,price,cost,total_quantity,available_quantity,expiration_date,acquisition_date,enabled,created_at')
      .maybeSingle();

    if (error) {
      console.error('Error al editar producto:', error);
      return res.status(500).json({ error: 'DbError', message: 'Error al editar producto' });
    }
    if (!data) {
      return res.status(404).json({ error: 'NotFound', message: 'Producto no encontrado' });
    }

    return res.json({ product: data });
  } catch (err) {
    console.error('Error inesperado al editar producto:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Error al editar producto' });
  }
};

/**
 * DESHABILITAR PRODUCTO (soft delete)
 * Solo cambia enabled=false si esta true. 404 si no existe o ya esta deshabilitado.
 */
const disableProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('products')
      .update({ enabled: false })
      .eq('id', id)
      .eq('enabled', true)
      .select('id,enabled')
      .maybeSingle();

    if (error) {
      console.error('Error al deshabilitar producto:', error);
      return res.status(500).json({ error: 'DbError', message: 'Error al deshabilitar producto' });
    }
    if (!data) {
      return res.status(404).json({ error: 'NotFound', message: 'Producto no encontrado o ya deshabilitado' });
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Error inesperado al deshabilitar producto:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Error al deshabilitar producto' });
  }
};

// EXPORTAMOS LAS FUNCIONES
module.exports = {
  listProducts,
  addProduct,
  editProduct,
  disableProduct
};
