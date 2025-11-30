/**
 * Controlador: Productos (CRUD Principal)
 * Ubicación: controllers/products/products.js
 * Descripción:
 *  Maneja las operaciones principales de productos: listar, crear, editar y deshabilitar.
 *  Implementa validaciones de negocio (ej: cantidad disponible <= total).
 * 
 * Mejoras de Código (Refactorización):
 *  - Estandarización de manejo de errores con `next(err)`.
 *  - Documentación detallada de cada función.
 */
const supabase = require('../../db/supabaseClient');
const { createNotification } = require('../notifications');

/**
 * LISTAR PRODUCTOS (habilitados por defecto)
 * Soporta: ?q=&category=&page=&pageSize=&includeDisabled=
 * Devuelve: { data, page, pageSize, total }
 */
const listProducts = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Usuario no asignado a una empresa' });
    }

    const {
      q,
      category,                 // 'semillas' | 'agroquimicos' | 'fertilizantes' | 'combustible'
      page = 1,
      pageSize = 50,
      includeDisabled = false,
    } = req.query;

    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 1000);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

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
      .eq('company_id', company_id) // Multi-tenancy filter
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (!includeDisabled) query = query.eq('enabled', true);
    if (category) query = query.eq('category', category);
    if (q && q.trim().length >= 2) query = query.ilike('name', `%${q.trim()}%`);

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
 * CREAR PRODUCTO
 * Body esperado
 *  { name, category, unit, expiration_date?, cost?, price?, total_quantity?, available_quantity?, acquisition_date? }
 */
const addProduct = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Usuario no asignado a una empresa' });
    }

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
        company_id, // Multi-tenancy injection
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

    if (error) throw error;

    return res.status(201).json({ product: data });
  } catch (err) {
    next(err);
  }
};

/**
 * EDITAR PRODUCTO
 * PUT parcial: solo actualiza campos presentes en el body
 * 404 si no existe
 */
const editProduct = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Usuario no asignado a una empresa' });
    }

    const { id } = req.params;

    // Armamos el objeto de update solo con campos definidos
    const allowed = [
      'name', 'category', 'unit', 'expiration_date',
      'cost', 'price', 'total_quantity', 'available_quantity', 'acquisition_date',
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
      .eq('company_id', company_id) // Security check: only own products
      .select('id,name,category,unit,price,cost,total_quantity,available_quantity,expiration_date,acquisition_date,enabled,created_at')
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'NotFound', message: 'Producto no encontrado' });
    }

    // [NOTIFICACIÓN] Low Stock (si se actualizó available_quantity)
    if (updateData.available_quantity !== undefined) {
      const newQty = Number(updateData.available_quantity);
      // Si el nuevo stock es <= 5, notificamos.
      // Nota: Aquí no verificamos el "anterior" para evitar doble fetch, 
      // asumimos que si lo editan a un valor bajo es relevante saberlo.
      if (newQty <= 5) {
        try {
          const { data: recipients } = await supabase
            .from('users')
            .select('id')
            .eq('company_id', company_id) // Only notify company users
            .in('role', [1, 2, 3])
            .eq('enabled', true);

          if (recipients && recipients.length > 0) {
            for (const user of recipients) {
              createNotification(
                user.id,
                'low_stock',
                'high',
                'Stock Bajo (Edición Manual)',
                `El producto "${data.name}" ha sido actualizado a stock bajo (${newQty} ${data.unit}).`,
                { product_id: data.id, current_stock: newQty },
                company_id // Pass company_id
              ).catch(e => console.error('Error enviando notif low_stock manual:', e));
            }
          }
        } catch (notifErr) {
          console.error('Error procesando notif low_stock manual:', notifErr);
        }
      }
    }

    return res.json({ product: data });
  } catch (err) {
    next(err);
  }
};

/**
 * DESHABILITAR PRODUCTO (soft delete)
 * Solo cambia enabled=false si esta true. 404 si no existe o ya esta deshabilitado.
 */
const disableProduct = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Usuario no asignado a una empresa' });
    }

    const { id } = req.params;

    const { data, error } = await supabase
      .from('products')
      .update({ enabled: false })
      .eq('id', id)
      .eq('company_id', company_id) // Security check
      .eq('enabled', true)
      .select('id,enabled')
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'NotFound', message: 'Producto no encontrado o ya deshabilitado' });
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    next(err);
  }
};

// EXPORTAMOS LAS FUNCIONES
module.exports = {
  listProducts,
  addProduct,
  editProduct,
  disableProduct
};

