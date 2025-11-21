/**
 * Ruta: Usuarios
 * Ubicación: routes/userRoutes.js
 * Descripción:
 *  Define los endpoints para la gestión de usuarios.
 *  Incluye listado, actualización de roles y búsqueda por email.
 * 
 * Mejoras de Código (Refactorización):
 *  - Implementación de manejo de errores centralizado con `next(err)`.
 *  - Documentación clara de roles y permisos.
 */
const router = require('express').Router();

const checkJwt = require('../middleware/checkJwt');
const userData = require('../middleware/userData');
const checkRole = require('../middleware/checkRole');
const validate = require('../middleware/validate');
const schema = require('../validations/users.schema');

const supabase = require('../db/supabaseClient');
const updateRole = require('../controllers/users/updateRole');

/**
 * Roles:
 *  0 = Empleado (logueado)
 *  1 = Supervisor
 *  2 = Dueño
 *  3 = Admin
 *
 * Notas:
 * - Protegemos TODAS las rutas con token (checkJwt) + carga de usuario (userData).
 * - Listado completo y cambio de rol: Admin (3).
 * - Buscar por email:
 *    - Admin (3) puede ver cualquiera.
 *    - Usuarios con rol < 3 solo pueden ver SU PROPIO email.
 */

// ----------------------------------------------------------------------------
// LISTAR usuarios (paginado) — Admin
// GET /api/users?Page=&pageSize=&includeDisabled=0/1&q=
// ----------------------------------------------------------------------------
router.get('/',
  checkJwt, userData, checkRole(3),
  validate(schema.listQuery),
  async (req, res, next) => {
    try {
      const {
        page = 1,
        pageSize = 50,
        includeDisabled = false,
        q,
      } = req.query;

      const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 1000);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
      const rangeFrom = offset;
      const rangeTo = offset + limit - 1;

      // Selección explicita (evita exponer columnas sensibles si existiesen)
      const columns = 'id,email,full_name,role,enabled,created_at,auth0_id';

      let query = supabase
        .from('users')
        .select(columns, { count: 'exact' })
        .order('created_at', { ascending: false });

      if (!includeDisabled) query = query.eq('enabled', true);
      if (q && q.trim().length >= 2) {
        // Busqueda por email (ilike para no diferenciar mayusculas/minusculas)
        query = query.ilike('email', `%${q}%`);
      }

      // Rango de paginado
      query = query.range(rangeFrom, rangeTo);

      const { data, error, count } = await query;

      if (error) throw error;

      return res.json({
        data,
        page: Number(page),
        pageSize: limit,
        total: count ?? data?.length ?? 0,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ----------------------------------------------------------------------------
/** Actualizar rol — Admin
 * PUT /api/users/:id/role  { role: 0|1|2|3 }
 */
router.put('/:id/role',
  checkJwt, userData, checkRole(3),
  validate(schema.updateRole),
  updateRole
);

// ----------------------------------------------------------------------------
/** Obtener usuario por email
 * GET /api/users/email/:email
 * - Admin puede ver cualquiera.
 * - Usuarios con rol < 3 solo pueden ver su propio email.
 */
router.get('/email/:email',
  checkJwt, userData,
  validate(schema.emailParam),
  async (req, res, next) => {
    const { email } = req.params;

    try {
      // Self-access si no es admin
      if (req.user.role < 3 && req.user.email !== email) {
        return res.status(403).json({ message: 'Acceso denegado' });
      }

      const { data, error } = await supabase
        .from('users')
        .select('id,email,full_name,role,enabled,created_at,auth0_id')
        .eq('email', email)
        .maybeSingle();

      if (error) {
        // PGRST116 = no encontrado (shape puede variar según SDK)
        if (error.code === 'PGRST116') {
          return res.status(404).json({ message: 'Usuario no encontrado' });
        }
        throw error;
      }

      if (!data) {
        return res.status(404).json({ message: 'Usuario no encontrado' });
      }

      return res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

