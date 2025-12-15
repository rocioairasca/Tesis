const { pool } = require('../db/supabaseClient');
const { parsePage, parsePageSize } = require('../utils/pagination');
const { createNotification } = require('./notifications');

/**
 * Controlador: Planificación
 * Ubicación: controllers/planning.js
 * Descripción:
 *  Maneja la gestión de planificaciones (actividades agrícolas).
 * Opciones: includeDisabled, includeCanceled
 */

/**
 * LISTAR PLANIFICACIONES (habilitadas por defecto)
 */
exports.list = async (req, res, next) => {
  try {
    const {
      from, to, type, status, responsible, lotId, search,
      includeDisabled = false, includeCanceled = false,
      page = 1, pageSize = 20
    } = req.query;

    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });
    }

    // Build WHERE dinámico
    let p = [company_id];
    const w = [`p.company_id = $1`];

    // Soft delete / cancelados (por defecto se ocultan)
    if (!includeDisabled) w.push(`p.enabled IS TRUE`);
    if (!includeCanceled) w.push(`p.status <> 'cancelado'`);

    if (from && to) {
      p.push(from, to);
      w.push(`p.date_range && tstzrange($${p.length - 1}, $${p.length}, '[]')`);
    }

    if (type) {
      p.push(type);
      w.push(`p.activity_type = $${p.length}`);
    }

    // Filtro por estado usa el estado "efectivo" (derivado en_demora si pasa end_at)
    if (status) {
      p.push(status);
      w.push(`(
        CASE
          WHEN p.status NOT IN ('completado','cancelado') AND now() > p.end_at
          THEN 'en_demora'
          ELSE p.status
        END
      ) = $${p.length}`);
    }

    if (responsible) {
      p.push(responsible);
      w.push(`p.responsible_user = $${p.length}`);
    }

    if (lotId) {
      p.push(lotId);
      w.push(`EXISTS (
        SELECT 1
        FROM planning_lots pl
        WHERE pl.planning_id = p.id AND pl.lot_id = $${p.length}
      )`);
    }

    if (search) {
      p.push(`%${search}%`);
      w.push(`(p.title ILIKE $${p.length} OR p.description ILIKE $${p.length})`);
    }

    const whereSql = w.length ? `WHERE ${w.join(' AND ')}` : '';

    const limit = parsePageSize(pageSize, 20, 1000);
    const offset = (parsePage(page, 1) - 1) * limit;

    // 1) COUNT total (sin LIMIT/OFFSET)
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM planning p
      JOIN users u ON u.id = p.responsible_user
      ${whereSql};
    `;
    const { rows: countRows } = await pool.query(countSql, p.slice());
    const total = countRows?.[0]?.total ?? 0;

    // 2) DATA con LIMIT/OFFSET
    p.push(limit, offset);
    const dataSql = `
      WITH base AS (
        SELECT p.*,
               CASE
                 WHEN p.status NOT IN ('completado','cancelado') AND now() > p.end_at
                 THEN 'en_demora' ELSE p.status
               END AS status_effective,
               u.name AS responsible_name
        FROM planning p
        JOIN users u ON u.id = p.responsible_user
        ${whereSql}
        ORDER BY p.start_at DESC
        LIMIT $${p.length - 1} OFFSET $${p.length}
      )
      SELECT b.*,
             COALESCE((
               SELECT json_agg(json_build_object('id', l.id, 'name', l.name))
               FROM planning_lots pl
               JOIN lots l ON l.id = pl.lot_id
               WHERE pl.planning_id = b.id
             ), '[]') AS lots,
             COALESCE((
               SELECT json_agg(json_build_object('product_id', pr.id, 'name', pr.name, 'amount', pp.amount, 'unit', pp.unit))
               FROM planning_products pp
               JOIN products pr ON pr.id = pp.product_id
               WHERE pp.planning_id = b.id
             ), '[]') AS products
      FROM base b;
    `;
    const { rows } = await pool.query(dataSql, p);

    return res.json({
      data: rows,
      page: Number(page),
      pageSize: limit,
      total,
    });
  } catch (e) {
    next(e);
  }
};

/**
 * OBTENER UNA PLANIFICACIÓN POR ID
 * Incluye lotes y productos asociados
 */
exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });
    }

    const sql = `
      WITH base AS (
        SELECT p.*,
               CASE
                 WHEN p.status NOT IN ('completado','cancelado') AND now() > p.end_at
                 THEN 'en_demora' ELSE p.status
               END AS status_effective,
               u.name AS responsible_name
        FROM planning p
        JOIN users u ON u.id = p.responsible_user
        WHERE p.id = $1 AND p.company_id = $2
        LIMIT 1
      )
      SELECT b.*,
             COALESCE((
               SELECT json_agg(json_build_object('id', l.id, 'name', l.name))
               FROM planning_lots pl
               JOIN lots l ON l.id = pl.lot_id
               WHERE pl.planning_id = b.id
             ), '[]') AS lots,
             COALESCE((
               SELECT json_agg(json_build_object('product_id', pr.id, 'name', pr.name, 'amount', pp.amount, 'unit', pp.unit))
               FROM planning_products pp
               JOIN products pr ON pr.id = pp.product_id
               WHERE pp.planning_id = b.id
             ), '[]') AS products
      FROM base b;
    `;

    const { rows } = await pool.query(sql, [id, company_id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.json(rows[0]);
  } catch (e) {
    next(e);
  }
};

/**
 * CREAR PLANIFICACIÓN
 * Valida conflictos de fechas en lotes y vehículo.
 * Inserta lotes/productos relacionados.
 */
exports.create = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      title,
      description,
      activity_type,
      start_at,
      end_at,
      responsible_user,
      status = 'pendiente',
      vehicle_id,
      lot_ids = [],
      products = [],
      created_by, // opcional, si no va el user de req
    } = req.body;

    const { company_id, id: userId } = req.user;
    if (!company_id) {
      client.release();
      return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });
    }

    const creator = created_by || userId || null;

    await client.query('BEGIN');

    // Revalidar conflictos de lotes
    if (Array.isArray(lot_ids) && lot_ids.length && start_at && end_at) {
      const q = `
        SELECT DISTINCT pl.lot_id
        FROM planning p
        JOIN planning_lots pl ON pl.planning_id = p.id
        WHERE pl.lot_id = ANY($1::uuid[])
          AND p.status <> 'cancelado'
          AND p.date_range && tstzrange($2::timestamptz, $3::timestamptz, '[]')
          AND p.company_id = $4;
      `;
      const { rows } = await client.query(q, [lot_ids, start_at, end_at, company_id]);
      if (rows.length) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({
          error: 'Conflicto de fechas en lotes',
          lot_ids_conflict: rows.map(r => r.lot_id),
        });
      }
    }

    // Revalidar conflictos de vehículo
    if (vehicle_id && start_at && end_at) {
      const q = `
        SELECT 1
        FROM planning p
        WHERE p.vehicle_id = $1
          AND p.status <> 'cancelado'
          AND p.date_range && tstzrange($2::timestamptz, $3::timestamptz, '[]')
          AND p.company_id = $4
        LIMIT 1;
      `;
      const { rows } = await client.query(q, [vehicle_id, start_at, end_at, company_id]);
      if (rows.length) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({ error: 'Vehículo ya asignado en ese rango' });
      }
    }

    // Insert planning
    const insertSql = `
      INSERT INTO planning(
        title, description, activity_type, start_at, end_at,
        responsible_user, status, vehicle_id, created_by, company_id
      ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id;
    `;
    const { rows: newPlan } = await client.query(insertSql, [
      title,
      description ?? null,
      activity_type,
      start_at,
      end_at,
      responsible_user,
      status,
      vehicle_id ?? null,
      creator,
      company_id,
    ]);
    const id = newPlan[0].id;

    // Insert lotes
    if (Array.isArray(lot_ids) && lot_ids.length) {
      const values = lot_ids.map((_, i) => `($1, $${i + 2})`).join(',');
      await client.query(
        `INSERT INTO planning_lots(planning_id, lot_id) VALUES ${values}`,
        [id, ...lot_ids]
      );
    }

    // Insert productos
    if (Array.isArray(products) && products.length) {
      const tuples = products
        .map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`)
        .join(',');
      const params = [id];
      products.forEach(p => {
        params.push(p.product_id, p.amount ?? null, p.unit ?? null);
      });
      await client.query(
        `INSERT INTO planning_products(planning_id, product_id, amount, unit) VALUES ${tuples}`,
        params
      );
    }

    await client.query('COMMIT');

    // [NOTIFICACIÓN] Nueva asignación
    if (responsible_user) {
      createNotification(
        responsible_user,
        'planning_assigned',
        'low',
        'Nueva planificación asignada',
        `Se te ha asignado la planificación: ${title}`,
        { planning_id: id, activity_type },
        company_id
      ).catch(err => console.error('Error enviando notificación:', err));
    }

    client.release();
    return res.status(201).json({ id });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    client.release();
    next(e);
  }
};

/**
 * ACTUALIZAR PLANIFICACIÓN
 * Revalida conflictos si cambian fechas/lotes/vehículo.
 * Actualiza relaciones (borra y reinserta lotes/productos).
 */
exports.update = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      title, description, activity_type, start_at, end_at,
      responsible_user, status, vehicle_id, lot_ids, products
    } = req.body;

    const { company_id } = req.user;
    if (!company_id) {
      client.release();
      return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });
    }

    await client.query('BEGIN');

    // Verificar que la planificación pertenezca a la compañía
    const checkSql = 'SELECT id FROM planning WHERE id = $1 AND company_id = $2';
    const { rows: checkRows } = await client.query(checkSql, [id, company_id]);
    if (checkRows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'Not found' });
    }

    // Revalidar conflictos si cambian fecha/lotes/vehículo
    if (Array.isArray(lot_ids) && start_at && end_at) {
      const q = `
        SELECT DISTINCT pl.lot_id
        FROM planning p
        JOIN planning_lots pl ON pl.planning_id = p.id
        WHERE pl.lot_id = ANY($1::uuid[])
          AND p.status <> 'cancelado'
          AND p.date_range && tstzrange($2::timestamptz, $3::timestamptz, '[]')
          AND p.id <> $4
          AND p.company_id = $5;
      `;
      const { rows } = await client.query(q, [lot_ids, start_at, end_at, id, company_id]);
      if (rows.length) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({
          error: 'Conflicto de fechas en lotes',
          lot_ids_conflict: rows.map(r => r.lot_id),
        });
      }
    }

    if (vehicle_id && start_at && end_at) {
      const q = `
        SELECT 1
        FROM planning p
        WHERE p.vehicle_id = $1
          AND p.status <> 'cancelado'
          AND p.date_range && tstzrange($2::timestamptz, $3::timestamptz, '[]')
          AND p.id <> $4
          AND p.company_id = $5
        LIMIT 1;
      `;
      const { rows } = await client.query(q, [vehicle_id, start_at, end_at, id, company_id]);
      if (rows.length) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({ error: 'Vehículo ya asignado en ese rango' });
      }
    }

    // Update parcial
    const sets = [];
    const vals = [];
    const push = (v, k) => {
      vals.push(v);
      sets.push(`${k} = $${vals.length}`);
    };

    if (title !== undefined) push(title, 'title');
    if (description !== undefined) push(description, 'description');
    if (activity_type !== undefined) push(activity_type, 'activity_type');
    if (start_at !== undefined) push(start_at, 'start_at');
    if (end_at !== undefined) push(end_at, 'end_at');
    if (responsible_user !== undefined) push(responsible_user, 'responsible_user');
    if (status !== undefined) push(status, 'status');
    if (vehicle_id !== undefined) push(vehicle_id, 'vehicle_id');

    if (sets.length > 0) {
      vals.push(id, company_id);
      const updateSql = `
        UPDATE planning
        SET ${sets.join(', ')}
        WHERE id = $${vals.length - 1} AND company_id = $${vals.length};
      `;
      await client.query(updateSql, vals);
    }

    // Lotes
    if (Array.isArray(lot_ids)) {
      await client.query('DELETE FROM planning_lots WHERE planning_id = $1', [id]);
      if (lot_ids.length) {
        const values = lot_ids.map((_, i) => `($1, $${i + 2})`).join(',');
        await client.query(
          `INSERT INTO planning_lots(planning_id, lot_id) VALUES ${values}`,
          [id, ...lot_ids]
        );
      }
    }

    // Productos
    if (Array.isArray(products)) {
      await client.query('DELETE FROM planning_products WHERE planning_id = $1', [id]);
      if (products.length) {
        const tuples = products
          .map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`)
          .join(',');
        const params = [id];
        products.forEach(p => {
          params.push(p.product_id, p.amount ?? null, p.unit ?? null);
        });
        await client.query(
          `INSERT INTO planning_products(planning_id, product_id, amount, unit) VALUES ${tuples}`,
          params
        );
      }
    }

    await client.query('COMMIT');

    // [NOTIFICACIÓN] Cambio de estado
    if (status) {
      let targetUser = responsible_user;
      if (!targetUser) {
        const { rows: current } = await client.query(
          'SELECT responsible_user, title FROM planning WHERE id = $1',
          [id]
        );
        targetUser = current[0]?.responsible_user;
      }

      if (targetUser) {
        createNotification(
          targetUser,
          'state_change',
          'low',
          'Cambio de estado en planificación',
          `La planificación ha cambiado a estado: ${status}`,
          { planning_id: id, new_status: status },
          company_id
        ).catch(err => console.error('Error enviando notificación:', err));
      }
    }

    client.release();
    res.json({ ok: true });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    client.release();
    next(e);
  }
};

/**
 * DESHABILITAR PLANIFICACIÓN (Soft Delete)
 * Oculta la planificación y (si no está completada) la marca como cancelada.
 */
exports.remove = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    if (!company_id) {
      client.release();
      return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });
    }

    await client.query('BEGIN');

    // Verificar existencia y compañía
    const checkSql = 'SELECT id, status FROM planning WHERE id = $1 AND company_id = $2';
    const { rows: checkRows } = await client.query(checkSql, [id, company_id]);
    if (checkRows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'Not found' });
    }

    const currentStatus = checkRows[0].status;
    let newStatus = currentStatus;

    // Si no está completada, la marcamos como cancelada
    if (currentStatus !== 'completado') {
      newStatus = 'cancelado';
    }

    const updateSql = `
      UPDATE planning
      SET enabled = false, status = $1
      WHERE id = $2 AND company_id = $3;
    `;
    await client.query(updateSql, [newStatus, id, company_id]);

    await client.query('COMMIT');
    client.release();
    res.json({ ok: true });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    client.release();
    next(e);
  }
};

/**
 * LISTAR PLANIFICACIONES DESHABILITADAS
 */
exports.listDisabled = async (req, res, next) => {
  try {
    const {
      page = 1, pageSize = 20,
      status, responsible, lotId, search
    } = req.query;

    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });
    }

    let p = [company_id];
    const w = [`p.enabled IS FALSE`, `p.company_id = $1`];

    if (status) {
      p.push(status);
      w.push(`(
        CASE
          WHEN p.status NOT IN ('completado', 'cancelado') AND now() > p.end_at
          THEN 'en_demora'
          ELSE p.status
        END
      ) = $${p.length}`);
    }

    if (responsible) {
      p.push(responsible);
      w.push(`p.responsible_user = $${p.length}`);
    }

    if (lotId) {
      p.push(lotId);
      w.push(`EXISTS (
        SELECT 1
        FROM planning_lots pl
        WHERE pl.planning_id = p.id AND pl.lot_id = $${p.length}
      )`);
    }

    if (search) {
      p.push(`%${search}%`);
      w.push(`(p.title ILIKE $${p.length} OR p.description ILIKE $${p.length})`);
    }

    const whereSql = `WHERE ${w.join(' AND ')}`;
    const limit = parsePageSize(pageSize, 20, 1000);
    const offset = (parsePage(page, 1) - 1) * limit;

    // COUNT
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM planning p
      JOIN users u ON u.id = p.responsible_user
      ${whereSql};
    `;
    const { rows: countRows } = await pool.query(countSql, p.slice());
    const total = countRows?.[0]?.total ?? 0;

    // DATA
    p.push(limit, offset);
    const dataSql = `
      WITH base AS (
        SELECT p.*,
               CASE
                 WHEN p.status NOT IN ('completado', 'cancelado') AND now() > p.end_at
                 THEN 'en_demora' ELSE p.status
               END AS status_effective,
               u.name AS responsible_name
        FROM planning p
        JOIN users u ON u.id = p.responsible_user
        ${whereSql}
        ORDER BY p.start_at DESC
        LIMIT $${p.length - 1} OFFSET $${p.length}
      )
      SELECT b.*,
             COALESCE((
               SELECT json_agg(json_build_object('id', l.id, 'name', l.name))
               FROM planning_lots pl
               JOIN lots l ON l.id = pl.lot_id
               WHERE pl.planning_id = b.id
             ), '[]') AS lots,
             COALESCE((
               SELECT json_agg(json_build_object('product_id', pr.id, 'name', pr.name, 'amount', pp.amount, 'unit', pp.unit))
               FROM planning_products pp
               JOIN products pr ON pr.id = pp.product_id
               WHERE pp.planning_id = b.id
             ), '[]') AS products
      FROM base b;
    `;
    const { rows } = await pool.query(dataSql, p);

    return res.json({
      data: rows,
      page: Number(page),
      pageSize: limit,
      total,
    });
  } catch (e) {
    next(e);
  }
};

/**
 * HABILITAR PLANIFICACIÓN (Restaurar)
 */
exports.enable = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    if (!company_id) {
      return res.status(400).json({ error: 'BadRequest', message: 'Falta company_id' });
    }

    const sql = `
      UPDATE planning
      SET enabled = true
      WHERE id = $1 AND company_id = $2
      RETURNING id, status;
    `;
    const { rows } = await pool.query(sql, [id, company_id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.status(200).json({
      ok: true,
      id: rows[0].id,
      status: rows[0].status,
    });
  } catch (e) {
    next(e);
  }
};
