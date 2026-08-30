const { pool } = require('../../db/supabaseClient');

const EDITABLE_STATUSES = new Set(['draft']);
const TERMINAL_STATUSES = new Set(['locked', 'archived']);

function httpError(status, message, error = 'BadRequest') {
  const err = new Error(message);
  err.status = status;
  err.name = error;
  return err;
}

function toGeoJsonText(value, fieldName = 'geom') {
  if (!value) throw httpError(400, `${fieldName} es requerido`);
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      throw httpError(400, `${fieldName} debe ser GeoJSON valido`);
    }
  }
  return JSON.stringify(value);
}

function parseJsonValue(value) {
  if (!value) return null;
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

function mapLayout(row) {
  if (!row) return row;
  return {
    ...row,
    parent_geom_snapshot: parseJsonValue(row.parent_geom_snapshot),
    sub_lots: Array.isArray(row.sub_lots)
      ? row.sub_lots.map(mapSubLot)
      : row.sub_lots,
  };
}

function mapSubLot(row) {
  if (!row) return row;
  return {
    ...row,
    geom: parseJsonValue(row.geom),
  };
}

async function getLot(client, lotId, companyId) {
  const { rows } = await client.query(
    `
    SELECT id, company_id, name, enabled, geom, area_ha, location, area
    FROM lots
    WHERE id = $1
      AND company_id = $2
    LIMIT 1
    `,
    [lotId, companyId]
  );

  return rows[0] || null;
}

async function getLayout(client, lotId, layoutId, companyId) {
  const { rows } = await client.query(
    `
    SELECT
      ll.id,
      ll.lot_id,
      ll.company_id,
      ll.version,
      ll.name,
      ll.status,
      ST_AsGeoJSON(ll.parent_geom_snapshot)::json AS parent_geom_snapshot,
      ll.parent_area_ha_snapshot,
      ll.tolerance_ha,
      ll.created_by,
      ll.created_at,
      ll.updated_at,
      ll.activated_at,
      ll.locked_at,
      ll.archived_at,
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'id', sl.id,
            'layout_id', sl.layout_id,
            'lot_id', sl.lot_id,
            'company_id', sl.company_id,
            'code', sl.code,
            'name', sl.name,
            'geom', ST_AsGeoJSON(sl.geom)::json,
            'area_ha', sl.area_ha,
            'sort_order', sl.sort_order,
            'enabled', sl.enabled,
            'created_at', sl.created_at,
            'updated_at', sl.updated_at
          )
          ORDER BY sl.sort_order, sl.code
        )
        FROM sub_lots sl
        WHERE sl.layout_id = ll.id
          AND sl.company_id = ll.company_id
      ), '[]') AS sub_lots
    FROM lot_layouts ll
    WHERE ll.id = $1
      AND ll.lot_id = $2
      AND ll.company_id = $3
    LIMIT 1
    `,
    [layoutId, lotId, companyId]
  );

  return mapLayout(rows[0] || null);
}

async function assertEditableLayout(client, lotId, layoutId, companyId) {
  const layout = await getLayout(client, lotId, layoutId, companyId);
  if (!layout) throw httpError(404, 'Layout no encontrado', 'NotFound');
  if (!EDITABLE_STATUSES.has(layout.status)) {
    throw httpError(409, `El layout en estado ${layout.status} no puede modificarse`, 'Conflict');
  }
  return layout;
}

async function assertSubLotGeometryCanBeSaved(client, lotId, layoutId, companyId, geoJsonText, ignoreSubLotId = null) {
  const geometryResult = await client.query(
    `
    WITH candidate AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)::geometry(Polygon, 4326) AS geom
    ),
    layout_scope AS (
      SELECT parent_geom_snapshot, tolerance_ha
      FROM lot_layouts
      WHERE id = $1
        AND lot_id = $2
        AND company_id = $3
      LIMIT 1
    )
    SELECT
      ST_IsValid(candidate.geom) AS is_valid,
      (ST_Area(candidate.geom::geography) / 10000)::numeric AS area_ha,
      ST_Covers(layout_scope.parent_geom_snapshot, candidate.geom) AS is_contained,
      layout_scope.tolerance_ha AS tolerance_ha
    FROM candidate
    CROSS JOIN layout_scope
    `,
    [layoutId, lotId, companyId, geoJsonText]
  );

  const geometry = geometryResult.rows[0];
  if (!geometry) throw httpError(404, 'Layout no encontrado', 'NotFound');
  if (geometry.is_valid !== true) throw httpError(400, 'La geometria del sublote no es valida');
  if (Number(geometry.area_ha || 0) <= 0) throw httpError(400, 'La superficie del sublote debe ser mayor a 0');
  if (geometry.is_contained !== true) {
    throw httpError(400, 'El sublote debe estar completamente contenido dentro del lote padre');
  }

  const overlapResult = await client.query(
    `
    WITH candidate AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)::geometry(Polygon, 4326) AS geom
    )
    SELECT
      sl.id,
      sl.code,
      (ST_Area(ST_Intersection(sl.geom, candidate.geom)::geography) / 10000)::numeric AS intersection_area_ha
    FROM sub_lots sl
    CROSS JOIN candidate
    JOIN lot_layouts ll ON ll.id = sl.layout_id
    WHERE sl.layout_id = $1
      AND sl.lot_id = $2
      AND sl.company_id = $3
      AND sl.enabled = TRUE
      AND ($5::uuid IS NULL OR sl.id <> $5::uuid)
      AND ST_Intersects(sl.geom, candidate.geom)
      AND (ST_Area(ST_Intersection(sl.geom, candidate.geom)::geography) / 10000) > ll.tolerance_ha
    ORDER BY intersection_area_ha DESC
    LIMIT 1
    `,
    [layoutId, lotId, companyId, geoJsonText, ignoreSubLotId]
  );

  if (overlapResult.rows.length) {
    const overlap = overlapResult.rows[0];
    throw httpError(
      409,
      `El sublote se superpone con ${overlap.code} en ${Number(overlap.intersection_area_ha || 0).toFixed(4)} ha`,
      'Conflict'
    );
  }
}

async function validateLayoutById(client, lotId, layoutId, companyId) {
  const layoutResult = await client.query(
    `
    SELECT id, lot_id, company_id, status, tolerance_ha, parent_geom_snapshot, parent_area_ha_snapshot
    FROM lot_layouts
    WHERE id = $1
      AND lot_id = $2
      AND company_id = $3
    LIMIT 1
    `,
    [layoutId, lotId, companyId]
  );

  const layout = layoutResult.rows[0];
  if (!layout) throw httpError(404, 'Layout no encontrado', 'NotFound');

  const summaryResult = await client.query(
    `
    SELECT
      COUNT(*)::int AS sub_lots_count,
      COALESCE(SUM(area_ha), 0)::numeric AS sum_area_ha,
      COALESCE((ST_Area(ST_UnaryUnion(ST_Collect(geom))::geography) / 10000), 0)::numeric AS union_area_ha,
      bool_and(ST_IsValid(geom)) AS all_valid,
      bool_and(ST_Covers((
        SELECT parent_geom_snapshot
        FROM lot_layouts
        WHERE id = $3 AND lot_id = $1 AND company_id = $2
      ), geom)) AS all_contained,
      bool_and(lot_id = $1 AND company_id = $2 AND layout_id = $3) AS all_same_scope
    FROM sub_lots
    WHERE layout_id = $3
      AND enabled = TRUE
    `,
    [lotId, companyId, layoutId]
  );

  const summary = summaryResult.rows[0];
  const subLotsCount = Number(summary?.sub_lots_count || 0);
  const toleranceHa = Number(layout.tolerance_ha || 0);
  const parentAreaHa = Number(layout.parent_area_ha_snapshot || 0);
  const sumAreaHa = Number(summary?.sum_area_ha || 0);
  const unionAreaHa = Number(summary?.union_area_ha || 0);

  const overlapResult = await client.query(
    `
    SELECT
      a.id AS sub_lot_a_id,
      b.id AS sub_lot_b_id,
      a.code AS sub_lot_a_code,
      b.code AS sub_lot_b_code,
      (ST_Area(ST_Intersection(a.geom, b.geom)::geography) / 10000)::numeric AS intersection_area_ha
    FROM sub_lots a
    JOIN sub_lots b
      ON b.layout_id = a.layout_id
     AND b.id > a.id
    WHERE a.layout_id = $1
      AND a.enabled = TRUE
      AND b.enabled = TRUE
      AND ST_Intersects(a.geom, b.geom)
      AND (ST_Area(ST_Intersection(a.geom, b.geom)::geography) / 10000) > $2::numeric
    ORDER BY intersection_area_ha DESC
    `,
    [layoutId, toleranceHa]
  );

  const issues = [];

  if (subLotsCount === 0) {
    return {
      valid: true,
      mode: 'full_lot',
      message: 'Layout sin sublotes: representa el lote completo sin division real.',
      summary: {
        sub_lots_count: 0,
        parent_area_ha: parentAreaHa,
        tolerance_ha: toleranceHa,
      },
      issues,
    };
  }

  if (summary.all_valid !== true) {
    issues.push({ code: 'invalid_geometry', message: 'Uno o mas sublotes tienen geometria invalida' });
  }

  if (summary.all_contained !== true) {
    issues.push({ code: 'not_contained', message: 'Uno o mas sublotes no estan completamente contenidos en el lote padre' });
  }

  if (summary.all_same_scope !== true) {
    issues.push({ code: 'scope_mismatch', message: 'Hay sublotes fuera del mismo lote/layout/empresa' });
  }

  for (const row of overlapResult.rows) {
    issues.push({
      code: 'overlap',
      message: 'Dos sublotes se superponen con area real mayor a la tolerancia',
      sub_lot_a_id: row.sub_lot_a_id,
      sub_lot_b_id: row.sub_lot_b_id,
      sub_lot_a_code: row.sub_lot_a_code,
      sub_lot_b_code: row.sub_lot_b_code,
      intersection_area_ha: Number(row.intersection_area_ha || 0),
    });
  }

  const sumDeltaHa = Math.abs(sumAreaHa - parentAreaHa);
  if (sumDeltaHa > toleranceHa) {
    issues.push({
      code: 'area_sum_mismatch',
      message: 'La suma de superficies de sublotes no representa el 100% del lote padre dentro de la tolerancia',
      delta_ha: sumDeltaHa,
    });
  }

  const coverageDeltaHa = Math.abs(unionAreaHa - parentAreaHa);
  if (coverageDeltaHa > toleranceHa) {
    issues.push({
      code: 'coverage_mismatch',
      message: 'La union de sublotes no cubre el lote padre dentro de la tolerancia',
      delta_ha: coverageDeltaHa,
    });
  }

  return {
    valid: issues.length === 0,
    mode: 'subdivided',
    summary: {
      sub_lots_count: subLotsCount,
      parent_area_ha: parentAreaHa,
      sum_area_ha: sumAreaHa,
      union_area_ha: unionAreaHa,
      tolerance_ha: toleranceHa,
      sum_delta_ha: sumDeltaHa,
      coverage_delta_ha: coverageDeltaHa,
    },
    issues,
  };
}

exports.listLayouts = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { lotId } = req.params;

    const lot = await getLot(pool, lotId, company_id);
    if (!lot) return res.status(404).json({ error: 'NotFound', message: 'Lote no encontrado' });

    const { rows } = await pool.query(
      `
      SELECT
        id,
        lot_id,
        company_id,
        version,
        name,
        status,
        ST_AsGeoJSON(parent_geom_snapshot)::json AS parent_geom_snapshot,
        parent_area_ha_snapshot,
        tolerance_ha,
        created_by,
        created_at,
        updated_at,
        activated_at,
        locked_at,
        archived_at
      FROM lot_layouts
      WHERE lot_id = $1
        AND company_id = $2
      ORDER BY version DESC
      `,
      [lotId, company_id]
    );

    return res.json({ data: rows.map(mapLayout) });
  } catch (err) {
    next(err);
  }
};

exports.createLayout = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { company_id, id: userId } = req.user;
    const { lotId } = req.params;
    const { name, tolerance_ha } = req.body;

    await client.query('BEGIN');

    const lot = await getLot(client, lotId, company_id);
    if (!lot) throw httpError(404, 'Lote no encontrado', 'NotFound');
    if (!lot.enabled) throw httpError(400, 'No se puede crear un layout para un lote deshabilitado');
    if (!lot.geom) throw httpError(400, 'El lote no tiene geometria normalizada');

    const { rows: versionRows } = await client.query(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM lot_layouts WHERE lot_id = $1 AND company_id = $2',
      [lotId, company_id]
    );

    const version = Number(versionRows[0]?.next_version || 1);
    const { rows } = await client.query(
      `
      INSERT INTO lot_layouts (
        lot_id,
        company_id,
        version,
        name,
        status,
        parent_geom_snapshot,
        parent_area_ha_snapshot,
        tolerance_ha,
        created_by
      )
      SELECT
        l.id,
        l.company_id,
        $3,
        $4,
        'draft',
        l.geom,
        l.area_ha,
        COALESCE($5::numeric, 0.0100),
        $6
      FROM lots l
      WHERE l.id = $1
        AND l.company_id = $2
      RETURNING
        id,
        lot_id,
        company_id,
        version,
        name,
        status,
        ST_AsGeoJSON(parent_geom_snapshot)::json AS parent_geom_snapshot,
        parent_area_ha_snapshot,
        tolerance_ha,
        created_by,
        created_at,
        updated_at,
        activated_at,
        locked_at,
        archived_at
      `,
      [lotId, company_id, version, name || null, tolerance_ha ?? null, userId || null]
    );

    await client.query('COMMIT');
    return res.status(201).json({ layout: mapLayout(rows[0]) });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

exports.getLayout = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { lotId, layoutId } = req.params;
    const layout = await getLayout(pool, lotId, layoutId, company_id);

    if (!layout) return res.status(404).json({ error: 'NotFound', message: 'Layout no encontrado' });
    return res.json({ layout });
  } catch (err) {
    next(err);
  }
};

exports.updateLayout = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { lotId, layoutId } = req.params;
    const { name, tolerance_ha, status } = req.body;

    const current = await getLayout(pool, lotId, layoutId, company_id);
    if (!current) return res.status(404).json({ error: 'NotFound', message: 'Layout no encontrado' });

    if (TERMINAL_STATUSES.has(current.status)) {
      return res.status(409).json({ error: 'Conflict', message: `El layout en estado ${current.status} no puede modificarse` });
    }

    if (status && status === 'active') {
      return res.status(400).json({ error: 'BadRequest', message: 'Usa el endpoint de activacion para activar layouts' });
    }

    if (current.status !== 'draft') {
      const requestedKeys = Object.keys(req.body);
      const onlyStatusTransition = requestedKeys.length === 1
        && requestedKeys[0] === 'status'
        && ['locked', 'archived'].includes(status);

      if (!onlyStatusTransition) {
        return res.status(409).json({ error: 'Conflict', message: `El layout en estado ${current.status} no puede modificarse` });
      }
    }

    const updates = [];
    const values = [];
    const push = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (name !== undefined) push('name', name || null);
    if (tolerance_ha !== undefined) push('tolerance_ha', tolerance_ha);
    if (status !== undefined) {
      push('status', status);
      if (status === 'archived') push('archived_at', new Date().toISOString());
      if (status === 'locked') push('locked_at', new Date().toISOString());
    }

    if (!updates.length) return res.json({ layout: current });

    values.push(layoutId, lotId, company_id);
    const { rows } = await pool.query(
      `
      UPDATE lot_layouts
      SET ${updates.join(', ')}
      WHERE id = $${values.length - 2}
        AND lot_id = $${values.length - 1}
        AND company_id = $${values.length}
      RETURNING
        id,
        lot_id,
        company_id,
        version,
        name,
        status,
        ST_AsGeoJSON(parent_geom_snapshot)::json AS parent_geom_snapshot,
        parent_area_ha_snapshot,
        tolerance_ha,
        created_by,
        created_at,
        updated_at,
        activated_at,
        locked_at,
        archived_at
      `,
      values
    );

    return res.json({ layout: mapLayout(rows[0]) });
  } catch (err) {
    next(err);
  }
};

exports.createSubLot = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { lotId, layoutId } = req.params;
    const { code, name, geom, sort_order = 0, enabled = true } = req.body;

    await assertEditableLayout(pool, lotId, layoutId, company_id);
    const geoJsonText = toGeoJsonText(geom);
    await assertSubLotGeometryCanBeSaved(pool, lotId, layoutId, company_id, geoJsonText);

    const { rows } = await pool.query(
      `
      INSERT INTO sub_lots (layout_id, lot_id, company_id, code, name, geom, sort_order, enabled)
      VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), $7, $8)
      RETURNING
        id,
        layout_id,
        lot_id,
        company_id,
        code,
        name,
        ST_AsGeoJSON(geom)::json AS geom,
        area_ha,
        sort_order,
        enabled,
        created_at,
        updated_at
      `,
      [layoutId, lotId, company_id, code, name, geoJsonText, sort_order, enabled]
    );

    return res.status(201).json({ sub_lot: mapSubLot(rows[0]) });
  } catch (err) {
    next(err);
  }
};

exports.updateSubLot = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { lotId, layoutId, subLotId } = req.params;
    const { code, name, geom, sort_order, enabled } = req.body;

    await assertEditableLayout(pool, lotId, layoutId, company_id);

    const updates = [];
    const values = [];
    const push = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (code !== undefined) push('code', code);
    if (name !== undefined) push('name', name);
    if (sort_order !== undefined) push('sort_order', sort_order);
    if (enabled !== undefined) push('enabled', enabled);
    if (geom !== undefined) {
      const geoJsonText = toGeoJsonText(geom);
      await assertSubLotGeometryCanBeSaved(pool, lotId, layoutId, company_id, geoJsonText, subLotId);
      values.push(geoJsonText);
      updates.push(`geom = ST_SetSRID(ST_GeomFromGeoJSON($${values.length}), 4326)`);
    }

    if (!updates.length) {
      const { rows } = await pool.query(
        `
        SELECT
          id,
          layout_id,
          lot_id,
          company_id,
          code,
          name,
          ST_AsGeoJSON(geom)::json AS geom,
          area_ha,
          sort_order,
          enabled,
          created_at,
          updated_at
        FROM sub_lots
        WHERE id = $1 AND layout_id = $2 AND lot_id = $3 AND company_id = $4
        LIMIT 1
        `,
        [subLotId, layoutId, lotId, company_id]
      );
      if (!rows.length) return res.status(404).json({ error: 'NotFound', message: 'Sublote no encontrado' });
      return res.json({ sub_lot: mapSubLot(rows[0]) });
    }

    values.push(subLotId, layoutId, lotId, company_id);
    const { rows } = await pool.query(
      `
      UPDATE sub_lots
      SET ${updates.join(', ')}
      WHERE id = $${values.length - 3}
        AND layout_id = $${values.length - 2}
        AND lot_id = $${values.length - 1}
        AND company_id = $${values.length}
      RETURNING
        id,
        layout_id,
        lot_id,
        company_id,
        code,
        name,
        ST_AsGeoJSON(geom)::json AS geom,
        area_ha,
        sort_order,
        enabled,
        created_at,
        updated_at
      `,
      values
    );

    if (!rows.length) return res.status(404).json({ error: 'NotFound', message: 'Sublote no encontrado' });
    return res.json({ sub_lot: mapSubLot(rows[0]) });
  } catch (err) {
    next(err);
  }
};

exports.deleteSubLot = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { lotId, layoutId, subLotId } = req.params;

    await assertEditableLayout(pool, lotId, layoutId, company_id);

    const { rows } = await pool.query(
      `
      DELETE FROM sub_lots
      WHERE id = $1
        AND layout_id = $2
        AND lot_id = $3
        AND company_id = $4
      RETURNING id
      `,
      [subLotId, layoutId, lotId, company_id]
    );

    if (!rows.length) return res.status(404).json({ error: 'NotFound', message: 'Sublote no encontrado' });
    return res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    next(err);
  }
};

exports.validateLayout = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { lotId, layoutId } = req.params;
    const result = await validateLayoutById(pool, lotId, layoutId, company_id);
    return res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.activateLayout = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { company_id } = req.user;
    const { lotId, layoutId } = req.params;

    await client.query('BEGIN');

    const lot = await getLot(client, lotId, company_id);
    if (!lot) throw httpError(404, 'Lote no encontrado', 'NotFound');

    await client.query(
      `
      SELECT id
      FROM lots
      WHERE id = $1
        AND company_id = $2
      FOR UPDATE
      `,
      [lotId, company_id]
    );

    const layout = await getLayout(client, lotId, layoutId, company_id);
    if (!layout) throw httpError(404, 'Layout no encontrado', 'NotFound');
    if (layout.status !== 'draft') {
      throw httpError(409, `Solo se pueden activar layouts en draft. Estado actual: ${layout.status}`, 'Conflict');
    }

    const validation = await validateLayoutById(client, lotId, layoutId, company_id);
    if (!validation.valid) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'LayoutValidationError',
        message: 'El layout no cumple las validaciones geograficas',
        validation,
      });
    }

    await client.query(
      `
      UPDATE lot_layouts
      SET status = 'locked',
          locked_at = COALESCE(locked_at, now())
      WHERE lot_id = $1
        AND company_id = $2
        AND status = 'active'
        AND id <> $3
      `,
      [lotId, company_id, layoutId]
    );

    const { rows } = await client.query(
      `
      UPDATE lot_layouts
      SET status = 'active',
          activated_at = COALESCE(activated_at, now()),
          locked_at = NULL,
          archived_at = NULL
      WHERE id = $1
        AND lot_id = $2
        AND company_id = $3
        AND status = 'draft'
      RETURNING
        id,
        lot_id,
        company_id,
        version,
        name,
        status,
        ST_AsGeoJSON(parent_geom_snapshot)::json AS parent_geom_snapshot,
        parent_area_ha_snapshot,
        tolerance_ha,
        created_by,
        created_at,
        updated_at,
        activated_at,
        locked_at,
        archived_at
      `,
      [layoutId, lotId, company_id]
    );

    if (!rows.length) {
      throw httpError(409, 'No se pudo activar el layout porque ya no esta en draft', 'Conflict');
    }

    await client.query('COMMIT');
    return res.json({ layout: mapLayout(rows[0]), validation });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};
