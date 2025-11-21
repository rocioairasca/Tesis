/**
 * Controlador: Productos Deshabilitados
 * Ubicación: controllers/products/products.disabled.js
 * Descripción:
 *  Maneja las operaciones relacionadas con productos deshabilitados (soft-deleted).
 *  Permite listarlos y restaurarlos (habilitarlos nuevamente).
 * 
 * Mejoras de Código (Refactorización):
 *  - Estandarización de manejo de errores con `next(err)`.
 *  - Documentación clara de la funcionalidad.
 */
const supabase = require('../../db/supabaseClient');

/**
 * LISTAR PRODUCTOS DESHABILITADOS
 * Soporta: ?q=&category=&page=&pageSize=
 * Devuelve: { data, page, pageSize, total }
 */
const listDisabledProducts = async (req, res, next) => {
  try {
    const {
      q,
      category,              // 'semillas' | 'agroquimicos' | 'fertilizantes' | 'combustible'
      page = 1,
      pageSize = 50,
    } = req.query;

    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 1000);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    // Columnas explicitas
    const columns = [
      'id', 'name', 'category', 'unit',
      'price', 'cost',
      'total_quantity', 'available_quantity',
      'expiration_date', 'acquisition_date',
      'enabled', 'created_at'
    ].join(',');

    let query = supabase
      .from('products')
      .select(columns, { count: 'exact' })
      .eq('enabled', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) query = query.eq('category', category);
    if (q && q.trim().length >= 2) {
      // Busqueda simple por nombre
      query = query.ilike('name', `%${q.trim()}%`);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    return res.json({
      data: data || [],
      page: Number(page),
      pageSize: limit,
      total: count ?? (data?.length || 0),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * HABILITAR PRODUCTO (soft-restore)
 * Cambia enabled=false -> true.
 * Si no existe o ya esta habilitado, devuelve 404.
 */
const enableProduct = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('products')
      .update({ enabled: true })
      .eq('id', id)
      .eq('enabled', false)
      .select('id,name,enabled')
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'NotFound', message: 'Producto no encontrado o ya habilitado' });
    }

    return res.status(200).json({
      message: 'Producto habilitado exitosamente',
      product: data,
    });
  } catch (err) {
    next(err);
  }
};

// EXPORTAMOS LAS FUNCIONES PARA SER USADAS EN UNA RUTA (routes/products.js)
module.exports = {
  listDisabledProducts,
  enableProduct
};

