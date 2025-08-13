const { pool } = require('../db/supabaseClient');
const { parsePage, parsePageSize } = require('../utils/pagination');

// LISTAR (oculta enabled=false y status='cancelado' por defecto; incluye total para paginado)
exports.list = async (req, res, next) => {
  try {
    const {
      from, to, type, status, responsible, lotId, search,
      includeDisabled = false, includeCanceled = false,
      page = 1, pageSize = 20
    } = req.query;

    // Build WHERE dinamico
    let p = [];
    const w = [];

    // Soft delete / cancelados (por defecto se ocultan)
    if (!includeDisabled) w.push(`p.enabled IS TRUE`);
    if (!includeCanceled) w.push(`p.status <> 'cancelado'`);

    if (from && to) {
      p.push(from, to);
      w.push(`p.date_range && tstzrange($${p.length - 1}, $${p.length}, '[]')`);
    }
    if (type) { p.push(type); w.push(`p.activity_type = $${p.length}`); }

    // Filtro por estado usa el estado "efectivo" (derivado en_demora si paso end_at)
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

    if (responsible) { p.push(responsible); w.push(`p.responsible_user = $${p.length}`); }
    if (lotId) { p.push(lotId); w.push(`EXISTS (
      SELECT 1 FROM planning_lots pl WHERE pl.planning_id = p.id AND pl.lot_id = $${p.length}
    )`); }
    if (search) { p.push(`%${search}%`); w.push(`(p.title ILIKE $${p.length} OR p.description ILIKE $${p.length})`); }

    const whereSql = w.length ? `WHERE ${w.join(' AND ')}` : '';

    const limit  = parsePageSize(pageSize, 20, 1000);
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

exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT p.*,
             CASE WHEN p.status NOT IN ('completado','cancelado') AND now() > p.end_at
                  THEN 'en_demora' ELSE p.status END AS status_effective,
             u.name AS responsible_name,
             COALESCE((SELECT json_agg(json_build_object('id', l.id, 'name', l.name))
                       FROM planning_lots pl JOIN lots l ON l.id = pl.lot_id
                       WHERE pl.planning_id = p.id), '[]') AS lots,
             COALESCE((SELECT json_agg(json_build_object('product_id', pr.id, 'name', pr.name, 'amount', pp.amount, 'unit', pp.unit))
                       FROM planning_products pp JOIN products pr ON pr.id = pp.product_id
                       WHERE pp.planning_id = p.id), '[]') AS products
      FROM planning p
      JOIN users u ON u.id = p.responsible_user
      WHERE p.id = $1
      LIMIT 1;
    `;
    const { rows } = await pool.query(sql, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
};

exports.create = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      title, description, activity_type, start_at, end_at,
      responsible_user, status, vehicle_id, lot_ids = [],
      products = [], created_by
    } = req.body;

    await client.query('BEGIN');

    // Conflicto por lotes
    if (lot_ids.length) {
      const q = `
        SELECT DISTINCT pl.lot_id
        FROM planning p
        JOIN planning_lots pl ON pl.planning_id = p.id
        WHERE pl.lot_id = ANY($1::uuid[])
          AND p.status <> 'cancelado'
          AND p.date_range && tstzrange($2::timestamptz, $3::timestamptz, '[]');
      `;
      const { rows } = await client.query(q, [lot_ids, start_at, end_at]);
      if (rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Conflicto de fechas en lotes', lot_ids_conflict: rows.map(r => r.lot_id) });
      }
    }

    // (Opcional) Conflicto por vehículo
    if (vehicle_id) {
      const q = `
        SELECT 1 FROM planning p
        WHERE p.vehicle_id = $1
          AND p.status <> 'cancelado'
          AND p.date_range && tstzrange($2::timestamptz, $3::timestamptz, '[]')
        LIMIT 1;
      `;
      const { rows } = await client.query(q, [vehicle_id, start_at, end_at]);
      if (rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Vehículo ya asignado en ese rango' });
      }
    }

    const ins = `
      INSERT INTO planning
      (title, description, activity_type, start_at, end_at, responsible_user, status, vehicle_id, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id;
    `;
    const { rows } = await client.query(ins, [
      title, description || null, activity_type, start_at, end_at,
      responsible_user, status, vehicle_id || null, created_by || null
    ]);
    const id = rows[0].id;

    if (lot_ids.length) {
      const values = lot_ids.map((_, i) => `($1,$${i+2})`).join(',');
      await client.query(`INSERT INTO planning_lots (planning_id, lot_id) VALUES ${values}`, [id, ...lot_ids]);
    }

    if (products.length) {
      const tuples = products.map((_, i) => `($1,$${i*3+2},$${i*3+3},$${i*3+4})`).join(',');
      const params = [id];
      products.forEach(p => params.push(p.product_id, p.amount ?? null, p.unit ?? null));
      await client.query(`INSERT INTO planning_products (planning_id, product_id, amount, unit) VALUES ${tuples}`, params);
    }

    await client.query('COMMIT');
    res.status(201).json({ id });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
};

exports.update = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      title, description, activity_type, start_at, end_at,
      responsible_user, status, vehicle_id, lot_ids, products
    } = req.body;

    await client.query('BEGIN');

    // Revalidar conflictos si cambian fecha/lotes/vehículo
    if (Array.isArray(lot_ids) && start_at && end_at) {
      const q = `
        SELECT DISTINCT pl.lot_id
        FROM planning p
        JOIN planning_lots pl ON pl.planning_id = p.id
        WHERE pl.lot_id = ANY($1::uuid[])
          AND p.status <> 'cancelado'
          AND p.date_range && tstzrange($2::timestamptz,$3::timestamptz,'[]')
          AND p.id <> $4;
      `;
      const { rows } = await client.query(q, [lot_ids, start_at, end_at, id]);
      if (rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Conflicto de fechas en lotes', lot_ids_conflict: rows.map(r => r.lot_id) });
      }
    }
    if (vehicle_id && start_at && end_at) {
      const q = `
        SELECT 1 FROM planning p
        WHERE p.vehicle_id = $1
          AND p.status <> 'cancelado'
          AND p.date_range && tstzrange($2::timestamptz,$3::timestamptz,'[]')
          AND p.id <> $4
        LIMIT 1;
      `;
      const { rows } = await client.query(q, [vehicle_id, start_at, end_at, id]);
      if (rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Vehículo ya asignado en ese rango' });
      }
    }

    // Update parcial
    const sets = []; const vals = [];
    const push = (v, k) => { vals.push(v); sets.push(`${k} = $${vals.length}`); };
    if (title !== undefined) push(title, 'title');
    if (description !== undefined) push(description, 'description');
    if (activity_type !== undefined) push(activity_type, 'activity_type');
    if (start_at !== undefined) push(start_at, 'start_at');
    if (end_at !== undefined) push(end_at, 'end_at');
    if (responsible_user !== undefined) push(responsible_user, 'responsible_user');
    if (status !== undefined) push(status, 'status');
    if (vehicle_id !== undefined) push(vehicle_id, 'vehicle_id');

    if (sets.length) {
      vals.push(id);
      await client.query(`UPDATE planning SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    }

    if (Array.isArray(lot_ids)) {
      await client.query('DELETE FROM planning_lots WHERE planning_id = $1', [id]);
      if (lot_ids.length) {
        const values = lot_ids.map((_, i) => `($1,$${i+2})`).join(',');
        await client.query(`INSERT INTO planning_lots (planning_id, lot_id) VALUES ${values}`, [id, ...lot_ids]);
      }
    }

    if (Array.isArray(products)) {
      await client.query('DELETE FROM planning_products WHERE planning_id = $1', [id]);
      if (products.length) {
        const tuples = products.map((_, i) => `($1,$${i*3+2},$${i*3+3},$${i*3+4})`).join(',');
        const params = [id];
        products.forEach(p => params.push(p.product_id, p.amount ?? null, p.unit ?? null));
        await client.query(`INSERT INTO planning_products (planning_id, product_id, amount, unit) VALUES ${tuples}`, params);
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
};

// Soft delete: oculta la planificacion y (si no esta completada) la marca como cancelada
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;

    const sql = `
      UPDATE planning
      SET
        enabled   = FALSE,
        status    = CASE WHEN status <> 'completado' THEN 'cancelado' ELSE status END,
        updated_at = now()
      WHERE id = $1 AND enabled = TRUE
      RETURNING id, status, enabled;
    `;
    const { rows } = await pool.query(sql, [id]);

    if (!rows[0]) {
      return res.status(404).json({ error: 'NotFound', message: 'Planificación no encontrada o ya deshabilitada' });
    }

    return res.json({ ok: true, id: rows[0].id, status: rows[0].status });
  } catch (e) {
    next(e);
  }
};

// LISTAR DESHABILITADAS (enabled=false), con paginado y total
exports.listDisabled = async (req, res, next) => {
  try {
    const {
      from, to, type, status, responsible, lotId, search,
      page = 1, pageSize = 20
    } = req.query;

    let p = [];
    const w = [`p.enabled IS FALSE`]; // solo deshabilitadas

    if (from && to) {
      p.push(from, to);
      w.push(`p.date_range && tstzrange($${p.length - 1}, $${p.length}, '[]')`);
    }
    if (type)      { p.push(type);      w.push(`p.activity_type = $${p.length}`); }
    if (status)    {
      p.push(status);
      w.push(`(
        CASE
          WHEN p.status NOT IN ('completado','cancelado') AND now() > p.end_at
          THEN 'en_demora'
          ELSE p.status
        END
      ) = $${p.length}`);
    }
    if (responsible){ p.push(responsible); w.push(`p.responsible_user = $${p.length}`); }
    if (lotId)     { p.push(lotId);     w.push(`EXISTS (
      SELECT 1 FROM planning_lots pl WHERE pl.planning_id = p.id AND pl.lot_id = $${p.length}
    )`); }
    if (search)    { p.push(`%${search}%`); w.push(`(p.title ILIKE $${p.length} OR p.description ILIKE $${p.length})`); }

    const whereSql = `WHERE ${w.join(' AND ')}`;
    const limit  = parsePageSize(pageSize, 20, 1000);
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

// HABILITAR (restore) una planificacion: solo cambia enabled=false -> true
exports.enable = async (req, res, next) => {
  try {
    const { id } = req.params;

    const sql = `
      UPDATE planning
      SET enabled = TRUE,
          updated_at = now()
      WHERE id = $1 AND enabled = FALSE
      RETURNING id, status, enabled;
    `;
    const { rows } = await pool.query(sql, [id]);

    if (!rows[0]) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Planificación no encontrada o ya habilitada',
      });
    }

    return res.status(200).json({
      ok: true,
      id: rows[0].id,
      status: rows[0].status,   // seguirá siendo 'cancelado' si asi estaba
    });
  } catch (e) {
    next(e);
  }
};