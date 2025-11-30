/**
 * Controlador: Vehículos (Maquinaria)
 * Ubicación: controllers/vehicle.js
 * Descripción:
 *  Maneja el CRUD de vehículos y maquinaria.
 *  Incluye listado con filtros, creación, edición, y soft-delete.
 * 
 * Nota:
 *  - Ya implementa manejo de errores con `next(e)`.
 */
const { pool } = require('../db/supabaseClient');
const { parsePage, parsePageSize } = require('../utils/pagination');
const { createNotification } = require('./notifications');

const SELECT_COLUMNS = `
  id, name, type, brand, model, plate, capacity, notes, status,
  responsible_user, created_by, enabled, created_at, updated_at
`;

/**
 * LISTAR VEHICULOS
 * Soporta: ?q=&type=&status=&includeDisabled=&page=&pageSize=
 */
exports.list = async (req, res, next) => {
  try {
    const {
      q, type, status,
      includeDisabled = 'false',
      page = 1, pageSize = 50,
    } = req.query;

    const { company_id } = req.user;
    if (!company_id) return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });

    const p = [company_id];
    const w = [`company_id = $1`]; // $1 is always company_id

    const incDisabled = includeDisabled === '1' || String(includeDisabled).toLowerCase() === 'true';
    if (!incDisabled) w.push(`enabled IS TRUE`);

    if (q) { p.push(`%${q}%`); w.push(`(name ILIKE $${p.length} OR brand ILIKE $${p.length} OR model ILIKE $${p.length} OR plate ILIKE $${p.length})`); }
    if (type) { p.push(type); w.push(`type = $${p.length}`); }
    if (status) { p.push(status); w.push(`status = $${p.length}`); }

    const whereSql = `WHERE ${w.join(' AND ')}`;
    const limit = parsePageSize(pageSize, 50, 500);
    const offset = (parsePage(page, 1) - 1) * limit;

    // total
    const countSql = `SELECT COUNT(*)::int AS total FROM vehicles ${whereSql}`;
    const { rows: countRows } = await pool.query(countSql, p.slice());
    const total = countRows?.[0]?.total ?? 0;

    // data
    p.push(limit, offset);
    const dataSql = `
      SELECT ${SELECT_COLUMNS} FROM vehicles
      ${whereSql}
      ORDER BY name ASC
      LIMIT $${p.length - 1} OFFSET $${p.length}
    `;
    const { rows } = await pool.query(dataSql, p);

    res.json({ data: rows, page: Number(page), pageSize: limit, total });
  } catch (e) { next(e); }
};

/**
 * OBTENER UN VEHICULO
 */
exports.getOne = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });

    const { rows } = await pool.query(
      `SELECT ${SELECT_COLUMNS} FROM vehicles WHERE id = $1 AND company_id = $2`,
      [req.params.id, company_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'NotFound', message: 'Vehículo no encontrado' });
    res.json(rows[0]);
  } catch (e) { next(e); }
};

/**
 * CREAR VEHICULO
 */
exports.create = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });

    const {
      name, type = 'otro', brand, model, plate, capacity, notes,
      status = 'activo', responsible_user, created_by
    } = req.body;

    const sql = `
      INSERT INTO vehicles (name, type, brand, model, plate, capacity, notes, status, responsible_user, created_by, company_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING ${SELECT_COLUMNS};
    `;
    const { rows } = await pool.query(sql, [
      name, type, brand || null, model || null, plate || null,
      capacity || null, notes || null, status, responsible_user || null, created_by || null, company_id
    ]);
    res.status(201).json({ vehicle: rows[0] });
  } catch (e) { next(e); }
};

/**
 * ACTUALIZAR VEHICULO
 */
exports.update = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });

    const { id } = req.params;
    const allowed = ['name', 'type', 'brand', 'model', 'plate', 'capacity', 'notes', 'status', 'responsible_user', 'enabled'];
    const sets = []; const vals = [];
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        vals.push(req.body[k] ?? null);
        sets.push(`${k} = $${vals.length}`);
      }
    }

    // Siempre pisamos updated_at
    const setSql = sets.length ? `${sets.join(', ')}, updated_at = now()` : `updated_at = now()`;

    vals.push(id);
    const idIdx = vals.length;

    vals.push(company_id);
    const companyIdx = vals.length;

    const { rows } = await pool.query(
      `UPDATE vehicles SET ${setSql} WHERE id = $${idIdx} AND company_id = $${companyIdx} RETURNING ${SELECT_COLUMNS}`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'NotFound', message: 'Vehículo no encontrado' });

    // [NOTIFICACIÓN] Cambio de estado
    if (req.body.status && rows[0].responsible_user) {
      createNotification(
        rows[0].responsible_user,
        'vehicle_status',
        'medium',
        'Estado de vehículo actualizado',
        `El vehículo ${rows[0].name} ahora está: ${rows[0].status}`,
        { vehicle_id: rows[0].id, new_status: rows[0].status }
      ).catch(err => console.error('Error enviando notificación vehículo:', err));
    }

    res.json({ vehicle: rows[0] });
  } catch (e) { next(e); }
};

/**
 * DESHABILITAR VEHICULO (Soft Delete)
 */
exports.remove = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });

    const { rows } = await pool.query(
      `UPDATE vehicles
       SET enabled = FALSE, updated_at = now()
       WHERE id = $1 AND company_id = $2 AND enabled = TRUE
       RETURNING id, enabled`,
      [req.params.id, company_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'NotFound', message: 'Vehículo no encontrado o ya deshabilitado' });
    res.json({ ok: true, id: rows[0].id });
  } catch (e) { next(e); }
};

/**
 * LISTAR VEHICULOS DESHABILITADOS
 */
exports.listDisabled = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });

    const { q, type, status, page = 1, pageSize = 50 } = req.query;
    const p = [company_id];
    const w = [`company_id = $1`, `enabled IS FALSE`];

    if (q) { p.push(`%${q}%`); w.push(`(name ILIKE $${p.length} OR brand ILIKE $${p.length} OR model ILIKE $${p.length} OR plate ILIKE $${p.length})`); }
    if (type) { p.push(type); w.push(`type = $${p.length}`); }
    if (status) { p.push(status); w.push(`status = $${p.length}`); }

    const whereSql = `WHERE ${w.join(' AND ')}`;
    const limit = parsePageSize(pageSize, 50, 500);
    const offset = (parsePage(page, 1) - 1) * limit;

    // total
    const countSql = `SELECT COUNT(*)::int AS total FROM vehicles ${whereSql}`;
    const { rows: countRows } = await pool.query(countSql, p.slice());
    const total = countRows?.[0]?.total ?? 0;

    // data
    p.push(limit, offset);
    const dataSql = `
      SELECT ${SELECT_COLUMNS} FROM vehicles
      ${whereSql}
      ORDER BY name ASC
      LIMIT $${p.length - 1} OFFSET $${p.length}
    `;
    const { rows } = await pool.query(dataSql, p);

    res.json({ data: rows, page: Number(page), pageSize: limit, total });
  } catch (e) { next(e); }
};

/**
 * HABILITAR VEHICULO (Restaurar)
 */
exports.enable = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    if (!company_id) return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });

    const { rows } = await pool.query(
      `UPDATE vehicles
       SET enabled = TRUE, updated_at = now()
       WHERE id = $1 AND company_id = $2 AND enabled = FALSE
       RETURNING id, enabled`,
      [req.params.id, company_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'NotFound', message: 'Vehículo no encontrado o ya habilitado' });
    res.json({ ok: true, id: rows[0].id });
  } catch (e) { next(e); }
};

