const { pool } = require('../../db/supabaseClient');

const EDITABLE_STATUSES = new Set(['draft']);
const TERMINAL_STATUSES = new Set(['locked', 'archived']);
const CONTAINMENT_TOLERANCE_METERS = 0.75;
const CONTAINMENT_OUTSIDE_AREA_TOLERANCE_HA = 0.0025; // 25 m2.
const COVERAGE_TOLERANCE_HA = 0.10;
const COVERAGE_TOLERANCE_PERCENT = 0.5;
const LAYOUT_IN_USE_MESSAGE = 'Esta división ya tiene información asociada y no puede eliminarse.';
const SUB_LOT_IN_USE_MESSAGE = 'Este sublote ya tiene información asociada y no puede eliminarse.';
const isDevelopment = () => process.env.NODE_ENV !== 'production';

function httpError(status, message, error = 'BadRequest', details = null) {
  const err = new Error(message);
  err.status = status;
  err.name = error;
  if (details) err.details = details;
  return err;
}

function toGeoJsonText(value, fieldName = 'geom') {
  if (!value) throw httpError(400, fieldName === 'geom' ? 'El contorno es requerido.' : `${fieldName} es requerido`);
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      throw httpError(400, fieldName === 'geom' ? 'El contorno recibido no es válido.' : `${fieldName} no es válido`);
    }
  }
  return JSON.stringify(value);
}

function parseJsonValue(value) {
  if (!value) return null;
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

function isGeometrySqlError(err) {
  return Boolean(
    err?.code
    && ['XX000', '22023', '22000'].includes(err.code)
    && /geojson|geometry|parse|polygon|linear ring/i.test(err.message || '')
  );
}

function logSubLotBatchError(err) {
  if (!isDevelopment()) return;
  console.error('[SUBLOT BATCH SAVE BACKEND ERROR]', {
    code: err.code,
    constraint: err.constraint,
    message: err.message,
    detail: err.detail,
    where: err.where,
    stack: err.stack,
  });
}

function layoutStatusLabel(status) {
  return ({
    draft: 'en edición',
    active: 'activa',
    locked: 'histórica',
    archived: 'archivada',
  })[status] || status;
}

function getCoverageTolerance(parentAreaHa, assignedAreaHa) {
  const parent = Number(parentAreaHa || 0);
  const assigned = Number(assignedAreaHa || 0);
  const missingHa = Math.max(parent - assigned, 0);
  const missingPercent = parent > 0 ? (missingHa / parent) * 100 : 0;

  return {
    missing_ha: missingHa,
    missing_percent: missingPercent,
    tolerance_ha: COVERAGE_TOLERANCE_HA,
    tolerance_percent: COVERAGE_TOLERANCE_PERCENT,
    within_tolerance:
      missingHa <= COVERAGE_TOLERANCE_HA
      || missingPercent <= COVERAGE_TOLERANCE_PERCENT,
  };
}

function nextSubLotCode(subLots = []) {
  const used = new Set(subLots.map((subLot) => String(subLot.code || '').toUpperCase()));
  for (let index = 0; index < 26; index += 1) {
    const code = String.fromCharCode(65 + index);
    if (!used.has(code)) return code;
  }
  return String(subLots.length + 1);
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
  if (!layout) throw httpError(404, 'División no encontrada', 'NotFound');
  if (!EDITABLE_STATUSES.has(layout.status)) {
    throw httpError(409, `Esta división está ${layoutStatusLabel(layout.status)}. Creá una nueva división para realizar cambios.`, 'Conflict');
  }
  return layout;
}

async function getLayoutReferenceCounts(client, layoutId, companyId) {
  const { rows } = await client.query(
    `
    WITH layout_sub_lots AS (
      SELECT id
      FROM sub_lots
      WHERE layout_id = $1
        AND company_id = $2
    ),
    refs AS (
      SELECT 'planning_lots' AS table_name, COUNT(*)::int AS count
      FROM planning_lots pl
      JOIN layout_sub_lots sl ON sl.id = pl.sub_lot_id
      UNION ALL
      SELECT 'usage_lots' AS table_name, COUNT(*)::int AS count
      FROM usage_lots ul
      JOIN layout_sub_lots sl ON sl.id = ul.sub_lot_id
      UNION ALL
      SELECT 'harvest_records' AS table_name, COUNT(*)::int AS count
      FROM harvest_records hr
      JOIN layout_sub_lots sl ON sl.id = hr.sub_lot_id
      UNION ALL
      SELECT 'crop_assignments' AS table_name, COUNT(*)::int AS count
      FROM crop_assignments ca
      JOIN layout_sub_lots sl ON sl.id = ca.sub_lot_id
    )
    SELECT table_name, count
    FROM refs
    WHERE count > 0
    ORDER BY table_name
    `,
    [layoutId, companyId]
  );

  return rows;
}

async function getSubLotReferenceCounts(client, subLotIds = [], companyId) {
  if (!subLotIds.length) return [];

  const { rows } = await client.query(
    `
    WITH target_sub_lots AS (
      SELECT id
      FROM sub_lots
      WHERE id = ANY($1::uuid[])
        AND company_id = $2
    ),
    refs AS (
      SELECT 'planning_lots' AS table_name, COUNT(*)::int AS count
      FROM planning_lots pl
      JOIN target_sub_lots sl ON sl.id = pl.sub_lot_id
      UNION ALL
      SELECT 'usage_lots' AS table_name, COUNT(*)::int AS count
      FROM usage_lots ul
      JOIN target_sub_lots sl ON sl.id = ul.sub_lot_id
      UNION ALL
      SELECT 'harvest_records' AS table_name, COUNT(*)::int AS count
      FROM harvest_records hr
      JOIN target_sub_lots sl ON sl.id = hr.sub_lot_id
      UNION ALL
      SELECT 'crop_assignments' AS table_name, COUNT(*)::int AS count
      FROM crop_assignments ca
      JOIN target_sub_lots sl ON sl.id = ca.sub_lot_id
    )
    SELECT table_name, count
    FROM refs
    WHERE count > 0
    ORDER BY table_name
    `,
    [subLotIds, companyId]
  );

  return rows;
}

async function assertLayoutCanBeDeleted(client, layout) {
  if (!layout) throw httpError(404, 'División no encontrada', 'NotFound');

  if (layout.status !== 'draft' || layout.activated_at || layout.locked_at || layout.archived_at) {
    throw httpError(409, 'Solo se pueden eliminar divisiones en edición que nunca fueron activadas.', 'Conflict');
  }

  const references = await getLayoutReferenceCounts(client, layout.id, layout.company_id);
  if (references.length) {
    throw httpError(409, LAYOUT_IN_USE_MESSAGE, 'Conflict', { references });
  }
}

async function normalizeSubLotGeometryForSave(client, lotId, layoutId, companyId, geoJsonText, ignoreSubLotId = null) {
  const geometryResult = await client.query(
    `
    WITH candidate AS (
      SELECT ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($4)), 4326)::geometry(Polygon, 4326) AS geom
    ),
    layout_scope AS (
      SELECT parent_geom_snapshot, tolerance_ha
      FROM lot_layouts
      WHERE id = $1
        AND lot_id = $2
        AND company_id = $3
      LIMIT 1
    ),
    outside AS (
      SELECT ST_Difference(candidate.geom, layout_scope.parent_geom_snapshot) AS geom
      FROM candidate
      CROSS JOIN layout_scope
    ),
    containment AS (
      SELECT
        candidate.geom AS candidate_geom,
        layout_scope.parent_geom_snapshot,
        layout_scope.tolerance_ha,
        ST_IsValid(candidate.geom) AS is_valid,
        (ST_Area(candidate.geom::geography) / 10000)::numeric AS area_ha,
        ST_Covers(layout_scope.parent_geom_snapshot, candidate.geom) AS is_strictly_contained,
        ST_Covers(
          ST_Buffer(layout_scope.parent_geom_snapshot::geography, $5::numeric)::geometry,
          candidate.geom
        ) AS is_contained_with_tolerance,
        COALESCE((ST_Area(outside.geom::geography) / 10000), 0)::numeric AS outside_area_ha,
        CASE
          WHEN ST_IsEmpty(outside.geom) THEN 0
          ELSE ST_Distance(ST_PointOnSurface(outside.geom)::geography, layout_scope.parent_geom_snapshot::geography)
        END::numeric AS outside_distance_m
      FROM candidate
      CROSS JOIN layout_scope
      CROSS JOIN outside
    ),
    normalized_source AS (
      SELECT
        *,
        CASE
          WHEN is_strictly_contained THEN candidate_geom
          WHEN is_contained_with_tolerance AND outside_area_ha <= $6::numeric
            THEN ST_Intersection(candidate_geom, parent_geom_snapshot)
          ELSE candidate_geom
        END AS geom
      FROM containment
    ),
    normalized_polygons AS (
      SELECT
        *,
        ST_CollectionExtract(ST_MakeValid(geom), 3) AS polygon_geom
      FROM normalized_source
    ),
    normalized_parts AS (
      SELECT
        (dumped).path[1] AS part_index,
        (dumped).geom::geometry(Polygon, 4326) AS geom
      FROM (
        SELECT ST_Dump(polygon_geom) AS dumped
        FROM normalized_polygons
        WHERE NOT ST_IsEmpty(polygon_geom)
      ) source
    )
    SELECT
      normalized_polygons.is_valid,
      normalized_polygons.area_ha,
      normalized_polygons.is_strictly_contained,
      normalized_polygons.is_contained_with_tolerance,
      normalized_polygons.outside_area_ha,
      normalized_polygons.outside_distance_m,
      normalized_polygons.tolerance_ha,
      COUNT(normalized_parts.geom)::int AS normalized_parts_count,
      COALESCE((SUM(ST_Area(normalized_parts.geom::geography)) / 10000), 0)::numeric AS normalized_area_ha,
      (
        SELECT ST_AsGeoJSON(np.geom)::json
        FROM normalized_parts np
        ORDER BY np.part_index
        LIMIT 1
      ) AS normalized_geom
    FROM normalized_polygons
    LEFT JOIN normalized_parts ON TRUE
    GROUP BY
      normalized_polygons.is_valid,
      normalized_polygons.area_ha,
      normalized_polygons.is_strictly_contained,
      normalized_polygons.is_contained_with_tolerance,
      normalized_polygons.outside_area_ha,
      normalized_polygons.outside_distance_m,
      normalized_polygons.tolerance_ha
    `,
    [
      layoutId,
      lotId,
      companyId,
      geoJsonText,
      CONTAINMENT_TOLERANCE_METERS,
      CONTAINMENT_OUTSIDE_AREA_TOLERANCE_HA,
    ]
  );

  const geometry = geometryResult.rows[0];
  if (!geometry) throw httpError(404, 'División no encontrada', 'NotFound');
  if (geometry.is_valid !== true) throw httpError(400, 'El contorno del sublote necesita ajustes.');
  if (Number(geometry.area_ha || 0) <= 0) throw httpError(400, 'La superficie del sublote debe ser mayor a 0');
  const outsideAreaHa = Number(geometry.outside_area_ha || 0);
  const isWithinContainmentTolerance =
    geometry.is_contained_with_tolerance === true &&
    outsideAreaHa <= CONTAINMENT_OUTSIDE_AREA_TOLERANCE_HA;

  if (!isWithinContainmentTolerance) {
    const details = {
      area_ha: Number(geometry.area_ha || 0),
      outside_area_ha: outsideAreaHa,
      outside_distance_m: Number(geometry.outside_distance_m || 0),
      containment_tolerance_meters: CONTAINMENT_TOLERANCE_METERS,
      outside_area_tolerance_ha: CONTAINMENT_OUTSIDE_AREA_TOLERANCE_HA,
      is_strictly_contained: geometry.is_strictly_contained === true,
    };

    console.warn('Sub-lot containment rejected', {
      lotId,
      layoutId,
      companyId,
      ignoreSubLotId,
      ...details,
    });

    throw httpError(400, 'Parte del sublote quedó fuera de los límites del lote. Ajustá el contorno e intentá nuevamente.', 'BadRequest', {
      ...details,
    });
  }

  if (Number(geometry.normalized_parts_count || 0) !== 1 || !geometry.normalized_geom) {
    throw httpError(400, 'El contorno del sublote necesita ajustes antes de guardarse.', 'BadRequest', {
      outside_area_ha: outsideAreaHa,
      outside_distance_m: Number(geometry.outside_distance_m || 0),
      normalized_parts_count: Number(geometry.normalized_parts_count || 0),
      containment_tolerance_meters: CONTAINMENT_TOLERANCE_METERS,
      outside_area_tolerance_ha: CONTAINMENT_OUTSIDE_AREA_TOLERANCE_HA,
    });
  }

  const normalizedGeoJsonText = JSON.stringify(geometry.normalized_geom);

  const overlapResult = await client.query(
    `
    WITH candidate AS (
      SELECT ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($4)), 4326)::geometry(Polygon, 4326) AS geom
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
    [layoutId, lotId, companyId, normalizedGeoJsonText, ignoreSubLotId]
  );

  if (overlapResult.rows.length) {
    const overlap = overlapResult.rows[0];
    throw httpError(
      409,
      `Este sublote se superpone con otro ya creado (${overlap.code}).`,
      'Conflict'
    );
  }

  return normalizedGeoJsonText;
}

function normalizeSubLotSnapshotInput(subLots = []) {
  const usedIds = new Set();
  const usedCodes = new Map();

  return subLots.map((subLot, index) => {
    const id = subLot.id || null;
    const code = String(subLot.code || '').trim();
    const name = String(subLot.name || '').trim();
    const clientId = subLot.clientId || subLot.client_id || null;
    const geom = subLot.geom;

    if (id) {
      if (usedIds.has(id)) {
        throw httpError(400, 'Hay sublotes repetidos en el borrador.', 'BadRequest', { id });
      }
      usedIds.add(id);
    }

    if (!code) {
      throw httpError(400, 'Todos los sublotes necesitan código.', 'BadRequest', { row_index: index, client_id: clientId });
    }

    if (!name) {
      throw httpError(400, `El sublote ${code} necesita nombre.`, 'BadRequest', { row_index: index, client_id: clientId });
    }

    if (!geom || geom.type !== 'Polygon' || !Array.isArray(geom.coordinates)) {
      throw httpError(
        400,
        'La geometría de uno de los sublotes no es válida.',
        'BadRequest',
        {
          row_index: index,
          id,
          client_id: clientId,
          geom_type: geom?.type || null,
        }
      );
    }

    const normalizedCode = code.toUpperCase();
    if (usedCodes.has(normalizedCode)) {
      throw httpError(400, `El código ${code} está repetido en el borrador.`);
    }
    usedCodes.set(normalizedCode, index);

    return {
      row_index: index,
      id,
      client_id: clientId,
      code,
      name,
      geom: JSON.parse(toGeoJsonText(geom)),
      sort_order: Number.isInteger(Number(subLot.sort_order)) ? Number(subLot.sort_order) : index,
      enabled: subLot.enabled !== undefined ? Boolean(subLot.enabled) : true,
    };
  });
}

async function createNormalizedSubLotSnapshotTable(client, lotId, layoutId, companyId, subLots) {
  if (!Array.isArray(subLots)) {
    throw httpError(400, 'El formato de los sublotes no es válido.');
  }

  if (isDevelopment()) {
    console.log('[SUBLOT JSONB RECORDSET INPUT]', {
      isArray: Array.isArray(subLots),
      count: subLots.length,
      jsonType: typeof subLots,
    });
  }

  await client.query('DROP TABLE IF EXISTS pg_temp.tmp_sub_lot_snapshot');
  await client.query(`
    CREATE TEMP TABLE tmp_sub_lot_snapshot (
      row_index integer PRIMARY KEY,
      id uuid,
      client_id text,
      code text NOT NULL,
      name text NOT NULL,
      sort_order integer NOT NULL,
      enabled boolean NOT NULL,
      geom geometry(Polygon, 4326),
      area_ha numeric NOT NULL,
      outside_area_ha numeric NOT NULL,
      outside_distance_m numeric NOT NULL,
      normalized_parts_count integer NOT NULL
    ) ON COMMIT DROP
  `);

  if (!subLots.length) return [];

  const recordsetInput = subLots;
  const recordsetValues = [
    layoutId,
    lotId,
    companyId,
    recordsetInput,
    CONTAINMENT_TOLERANCE_METERS,
    CONTAINMENT_OUTSIDE_AREA_TOLERANCE_HA,
  ];

  await client.query(
    `
    INSERT INTO tmp_sub_lot_snapshot (
      row_index,
      id,
      client_id,
      code,
      name,
      sort_order,
      enabled,
      geom,
      area_ha,
      outside_area_ha,
      outside_distance_m,
      normalized_parts_count
    )
    WITH input_rows AS (
      SELECT *
      FROM jsonb_to_recordset($4::jsonb) AS x(
        row_index integer,
        id uuid,
        client_id text,
        code text,
        name text,
        geom jsonb,
        sort_order integer,
        enabled boolean
      )
    ),
    layout_scope AS (
      SELECT parent_geom_snapshot, tolerance_ha
      FROM lot_layouts
      WHERE id = $1
        AND lot_id = $2
        AND company_id = $3
      LIMIT 1
    ),
    candidate AS (
      SELECT
        input_rows.*,
        ST_CollectionExtract(
          ST_MakeValid(ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON(input_rows.geom::text)), 4326)),
          3
        ) AS candidate_geom
      FROM input_rows
    ),
    candidate_parts AS (
      SELECT
        candidate.*,
        COUNT((dumped).geom)::int AS candidate_parts_count,
        COALESCE(ST_UnaryUnion(ST_Collect((dumped).geom)), candidate.candidate_geom) AS candidate_polygon_geom
      FROM candidate
      LEFT JOIN LATERAL ST_Dump(candidate.candidate_geom) AS dumped ON TRUE
      GROUP BY
        candidate.row_index,
        candidate.id,
        candidate.client_id,
        candidate.code,
        candidate.name,
        candidate.geom,
        candidate.sort_order,
        candidate.enabled,
        candidate.candidate_geom
    ),
    outside AS (
      SELECT
        candidate_parts.*,
        layout_scope.parent_geom_snapshot,
        layout_scope.tolerance_ha,
        ST_Difference(candidate_parts.candidate_polygon_geom, layout_scope.parent_geom_snapshot) AS outside_geom
      FROM candidate_parts
      CROSS JOIN layout_scope
    ),
    normalized_source AS (
      SELECT
        *,
        CASE
          WHEN ST_Covers(parent_geom_snapshot, candidate_polygon_geom) THEN candidate_polygon_geom
          WHEN ST_Covers(
            ST_Buffer(parent_geom_snapshot::geography, $5::numeric)::geometry,
            candidate_polygon_geom
          )
          AND COALESCE((ST_Area(outside_geom::geography) / 10000), 0) <= $6::numeric
            THEN ST_Intersection(candidate_polygon_geom, parent_geom_snapshot)
          ELSE candidate_polygon_geom
        END AS normalized_source_geom
      FROM outside
    ),
    normalized_polygons AS (
      SELECT
        *,
        ST_CollectionExtract(ST_MakeValid(normalized_source_geom), 3) AS normalized_polygon_geom,
        COALESCE((ST_Area(outside_geom::geography) / 10000), 0)::numeric AS outside_area_ha,
        CASE
          WHEN ST_IsEmpty(outside_geom) THEN 0
          ELSE ST_Distance(ST_PointOnSurface(outside_geom)::geography, parent_geom_snapshot::geography)
        END::numeric AS outside_distance_m
      FROM normalized_source
    ),
    normalized_parts AS (
      SELECT
        normalized_polygons.row_index,
        (dumped).path[1] AS part_index,
        (dumped).geom::geometry(Polygon, 4326) AS geom
      FROM normalized_polygons
      CROSS JOIN LATERAL ST_Dump(normalized_polygons.normalized_polygon_geom) AS dumped
      WHERE NOT ST_IsEmpty(normalized_polygons.normalized_polygon_geom)
    ),
    normalized AS (
      SELECT
        normalized_polygons.row_index,
        normalized_polygons.id,
        normalized_polygons.client_id,
        normalized_polygons.code,
        normalized_polygons.name,
        normalized_polygons.sort_order,
        normalized_polygons.enabled,
        normalized_polygons.outside_area_ha,
        normalized_polygons.outside_distance_m,
        COUNT(normalized_parts.geom)::int AS normalized_parts_count,
        COALESCE((SUM(ST_Area(normalized_parts.geom::geography)) / 10000), 0)::numeric AS area_ha,
        (
          SELECT np.geom
          FROM normalized_parts np
          WHERE np.row_index = normalized_polygons.row_index
          ORDER BY np.part_index
          LIMIT 1
        ) AS geom
      FROM normalized_polygons
      LEFT JOIN normalized_parts
        ON normalized_parts.row_index = normalized_polygons.row_index
      GROUP BY
        normalized_polygons.row_index,
        normalized_polygons.id,
        normalized_polygons.client_id,
        normalized_polygons.code,
        normalized_polygons.name,
        normalized_polygons.sort_order,
        normalized_polygons.enabled,
        normalized_polygons.outside_area_ha,
        normalized_polygons.outside_distance_m
    )
    SELECT
      row_index,
      id,
      client_id,
      code,
      name,
      sort_order,
      enabled,
      geom,
      area_ha,
      outside_area_ha,
      outside_distance_m,
      normalized_parts_count
    FROM normalized
    `,
    recordsetValues
  );

  const { rows } = await client.query(`
    SELECT
      row_index,
      id,
      client_id,
      code,
      name,
      sort_order,
      enabled,
      area_ha,
      outside_area_ha,
      outside_distance_m,
      normalized_parts_count,
      ST_AsGeoJSON(geom)::json AS geom
    FROM tmp_sub_lot_snapshot
    ORDER BY row_index
  `);

  rows.forEach((row) => {
    if (Number(row.area_ha || 0) <= 0) {
      throw httpError(400, `La superficie de ${row.name || row.code} debe ser mayor a 0.`);
    }

    if (Number(row.outside_area_ha || 0) > CONTAINMENT_OUTSIDE_AREA_TOLERANCE_HA) {
      throw httpError(
        400,
        `Parte de ${row.name || row.code} quedó fuera de los límites del lote. Ajustá el contorno e intentá nuevamente.`,
        'BadRequest',
        {
          row_index: row.row_index,
          id: row.id,
          client_id: row.client_id,
          outside_area_ha: Number(row.outside_area_ha || 0),
          outside_distance_m: Number(row.outside_distance_m || 0),
          containment_tolerance_meters: CONTAINMENT_TOLERANCE_METERS,
          outside_area_tolerance_ha: CONTAINMENT_OUTSIDE_AREA_TOLERANCE_HA,
        }
      );
    }

    if (Number(row.normalized_parts_count || 0) !== 1 || !row.geom) {
      throw httpError(
        400,
        `El contorno de ${row.name || row.code} necesita ajustes antes de guardarse.`,
        'BadRequest',
        {
          row_index: row.row_index,
          id: row.id,
          client_id: row.client_id,
          normalized_parts_count: Number(row.normalized_parts_count || 0),
        }
      );
    }
  });

  const overlapResult = await client.query(`
    SELECT
      a.id AS sub_lot_a_id,
      b.id AS sub_lot_b_id,
      a.client_id AS sub_lot_a_client_id,
      b.client_id AS sub_lot_b_client_id,
      a.code AS sub_lot_a_code,
      b.code AS sub_lot_b_code,
      (ST_Area(ST_Intersection(a.geom, b.geom)::geography) / 10000)::numeric AS intersection_area_ha
    FROM tmp_sub_lot_snapshot a
    JOIN tmp_sub_lot_snapshot b
      ON b.row_index > a.row_index
    JOIN lot_layouts ll
      ON ll.id = $1
     AND ll.lot_id = $2
     AND ll.company_id = $3
    WHERE a.enabled = TRUE
      AND b.enabled = TRUE
      AND ST_Intersects(a.geom, b.geom)
      AND (ST_Area(ST_Intersection(a.geom, b.geom)::geography) / 10000) > ll.tolerance_ha
    ORDER BY intersection_area_ha DESC
    LIMIT 1
  `, [layoutId, lotId, companyId]);

  if (overlapResult.rows.length) {
    const overlap = overlapResult.rows[0];
    throw httpError(
      409,
      `Hay sublotes que se superponen (${overlap.sub_lot_a_code} y ${overlap.sub_lot_b_code}).`,
      'Conflict',
      {
        sub_lot_a_id: overlap.sub_lot_a_id,
        sub_lot_b_id: overlap.sub_lot_b_id,
        sub_lot_a_client_id: overlap.sub_lot_a_client_id,
        sub_lot_b_client_id: overlap.sub_lot_b_client_id,
        intersection_area_ha: Number(overlap.intersection_area_ha || 0),
      }
    );
  }

  return rows;
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
  if (!layout) throw httpError(404, 'División no encontrada', 'NotFound');

  const summaryResult = await client.query(
    `
    WITH scoped_sub_lots AS (
      SELECT
        sl.*,
        ll.parent_geom_snapshot
      FROM sub_lots sl
      JOIN lot_layouts ll ON ll.id = sl.layout_id
      WHERE sl.layout_id = $3
        AND sl.enabled = TRUE
    ),
    outside AS (
      SELECT
        id,
        ST_Difference(geom, parent_geom_snapshot) AS geom,
        parent_geom_snapshot
      FROM scoped_sub_lots
    )
    SELECT
      COUNT(*)::int AS sub_lots_count,
      COALESCE(SUM(scoped_sub_lots.area_ha), 0)::numeric AS sum_area_ha,
      COALESCE((ST_Area(ST_UnaryUnion(ST_Collect(scoped_sub_lots.geom))::geography) / 10000), 0)::numeric AS union_area_ha,
      bool_and(ST_IsValid(scoped_sub_lots.geom)) AS all_valid,
      bool_and(
        ST_Covers(
          ST_Buffer(scoped_sub_lots.parent_geom_snapshot::geography, $4::numeric)::geometry,
          scoped_sub_lots.geom
        )
        AND COALESCE((ST_Area(outside.geom::geography) / 10000), 0) <= $5::numeric
      ) AS all_contained,
      bool_and(scoped_sub_lots.lot_id = $1 AND scoped_sub_lots.company_id = $2 AND scoped_sub_lots.layout_id = $3) AS all_same_scope,
      COALESCE(SUM(ST_Area(outside.geom::geography) / 10000), 0)::numeric AS outside_area_ha,
      COALESCE(MAX(
        CASE
          WHEN ST_IsEmpty(outside.geom) THEN 0
          ELSE ST_Distance(ST_PointOnSurface(outside.geom)::geography, outside.parent_geom_snapshot::geography)
        END
      ), 0)::numeric AS outside_distance_m
    FROM scoped_sub_lots
    LEFT JOIN outside ON outside.id = scoped_sub_lots.id
    `,
    [lotId, companyId, layoutId, CONTAINMENT_TOLERANCE_METERS, CONTAINMENT_OUTSIDE_AREA_TOLERANCE_HA]
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
      message: 'Esta división representa el lote completo.',
      parent_area_ha: parentAreaHa,
      assigned_area_ha: parentAreaHa,
      missing_area_ha: 0,
      excess_area_ha: 0,
      coverage_percent: 100,
      within_tolerance: true,
      summary: {
        sub_lots_count: 0,
        parent_area_ha: parentAreaHa,
        assigned_area_ha: parentAreaHa,
        missing_area_ha: 0,
        excess_area_ha: 0,
        coverage_percent: 100,
        within_tolerance: true,
        tolerance_ha: toleranceHa,
        coverage_tolerance_ha: COVERAGE_TOLERANCE_HA,
        coverage_tolerance_percent: COVERAGE_TOLERANCE_PERCENT,
        coverage_missing_ha: 0,
        coverage_missing_percent: 0,
        coverage_within_tolerance: true,
      },
      issues,
    };
  }

  if (summary.all_valid !== true) {
    issues.push({ code: 'invalid_geometry', message: 'Hay un sublote con un contorno que necesita ajustes.' });
  }

  if (summary.all_contained !== true) {
    issues.push({
      code: 'not_contained',
      message: 'Parte de un sublote quedó fuera de los límites del lote.',
      outside_area_ha: Number(summary.outside_area_ha || 0),
      outside_distance_m: Number(summary.outside_distance_m || 0),
      containment_tolerance_meters: CONTAINMENT_TOLERANCE_METERS,
      outside_area_tolerance_ha: CONTAINMENT_OUTSIDE_AREA_TOLERANCE_HA,
    });
  }

  if (summary.all_same_scope !== true) {
    issues.push({ code: 'scope_mismatch', message: 'Hay un sublote que no corresponde a este lote.' });
  }

  for (const row of overlapResult.rows) {
    issues.push({
      code: 'overlap',
      message: 'Hay sublotes que se superponen.',
      sub_lot_a_id: row.sub_lot_a_id,
      sub_lot_b_id: row.sub_lot_b_id,
      sub_lot_a_code: row.sub_lot_a_code,
      sub_lot_b_code: row.sub_lot_b_code,
      intersection_area_ha: Number(row.intersection_area_ha || 0),
    });
  }

  const sumDeltaHa = Math.abs(sumAreaHa - parentAreaHa);
  const sumTolerance = getCoverageTolerance(parentAreaHa, sumAreaHa);
  const sumExcessHa = Math.max(sumAreaHa - parentAreaHa, 0);
  if (!sumTolerance.within_tolerance && sumAreaHa < parentAreaHa) {
    issues.push({
      code: 'area_sum_mismatch',
      message: 'La suma de superficies no coincide con la superficie total del lote.',
      delta_ha: sumDeltaHa,
      missing_ha: sumTolerance.missing_ha,
      missing_percent: sumTolerance.missing_percent,
      coverage_tolerance_ha: COVERAGE_TOLERANCE_HA,
      coverage_tolerance_percent: COVERAGE_TOLERANCE_PERCENT,
    });
  }

  const coverageDeltaHa = Math.abs(unionAreaHa - parentAreaHa);
  const coverageTolerance = getCoverageTolerance(parentAreaHa, unionAreaHa);
  const coverageExcessHa = Math.max(unionAreaHa - parentAreaHa, 0);
  if (!coverageTolerance.within_tolerance && unionAreaHa < parentAreaHa) {
    issues.push({
      code: 'coverage_mismatch',
      message: 'Todavía queda superficie del lote sin asignar.',
      delta_ha: coverageDeltaHa,
      missing_ha: coverageTolerance.missing_ha,
      missing_percent: coverageTolerance.missing_percent,
      coverage_tolerance_ha: COVERAGE_TOLERANCE_HA,
      coverage_tolerance_percent: COVERAGE_TOLERANCE_PERCENT,
    });
  }

  if (sumExcessHa > toleranceHa || coverageExcessHa > toleranceHa) {
    issues.push({
      code: 'coverage_excess',
      message: 'La superficie asignada excede la superficie total del lote.',
      excess_ha: Math.max(sumExcessHa, coverageExcessHa),
      sum_excess_ha: sumExcessHa,
      coverage_excess_ha: coverageExcessHa,
      tolerance_ha: toleranceHa,
    });
  }

  return {
    valid: issues.length === 0,
    mode: 'subdivided',
    parent_area_ha: parentAreaHa,
    assigned_area_ha: unionAreaHa,
    missing_area_ha: coverageTolerance.missing_ha,
    excess_area_ha: coverageExcessHa,
    coverage_percent: parentAreaHa > 0 ? (unionAreaHa / parentAreaHa) * 100 : 0,
    within_tolerance: coverageTolerance.within_tolerance,
    summary: {
      sub_lots_count: subLotsCount,
      parent_area_ha: parentAreaHa,
      assigned_area_ha: unionAreaHa,
      missing_area_ha: coverageTolerance.missing_ha,
      excess_area_ha: coverageExcessHa,
      coverage_percent: parentAreaHa > 0 ? (unionAreaHa / parentAreaHa) * 100 : 0,
      within_tolerance: coverageTolerance.within_tolerance,
      sum_area_ha: sumAreaHa,
      union_area_ha: unionAreaHa,
      tolerance_ha: toleranceHa,
      coverage_tolerance_ha: COVERAGE_TOLERANCE_HA,
      coverage_tolerance_percent: COVERAGE_TOLERANCE_PERCENT,
      sum_delta_ha: sumDeltaHa,
      coverage_delta_ha: coverageDeltaHa,
      coverage_missing_ha: coverageTolerance.missing_ha,
      coverage_missing_percent: coverageTolerance.missing_percent,
      coverage_within_tolerance: coverageTolerance.within_tolerance,
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
    if (!lot.enabled) throw httpError(400, 'No se puede crear una división para un lote deshabilitado.');
    if (!lot.geom) throw httpError(400, 'Este lote todavía no tiene un contorno listo para editar divisiones.');

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

    if (!layout) return res.status(404).json({ error: 'NotFound', message: 'División no encontrada' });
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
    if (!current) return res.status(404).json({ error: 'NotFound', message: 'División no encontrada' });

    if (TERMINAL_STATUSES.has(current.status)) {
      return res.status(409).json({ error: 'Conflict', message: `Esta división está ${layoutStatusLabel(current.status)}. Creá una nueva división para realizar cambios.` });
    }

    if (status && status === 'active') {
      return res.status(400).json({ error: 'BadRequest', message: 'Usá la acción de activar división.' });
    }

    if (current.status !== 'draft') {
      const requestedKeys = Object.keys(req.body);
      const onlyStatusTransition = requestedKeys.length === 1
        && requestedKeys[0] === 'status'
        && ['locked', 'archived'].includes(status);

      if (!onlyStatusTransition) {
        return res.status(409).json({ error: 'Conflict', message: `Esta división está ${layoutStatusLabel(current.status)}. Creá una nueva división para realizar cambios.` });
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

exports.deleteLayout = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { company_id } = req.user;
    const { lotId, layoutId } = req.params;

    await client.query('BEGIN');

    const lot = await getLot(client, lotId, company_id);
    if (!lot) throw httpError(404, 'Lote no encontrado', 'NotFound');

    const { rows } = await client.query(
      `
      SELECT
        id,
        lot_id,
        company_id,
        version,
        status,
        activated_at,
        locked_at,
        archived_at
      FROM lot_layouts
      WHERE id = $1
        AND lot_id = $2
        AND company_id = $3
      FOR UPDATE
      `,
      [layoutId, lotId, company_id]
    );

    const layout = rows[0] || null;
    await assertLayoutCanBeDeleted(client, layout);

    await client.query(
      `
      SELECT id
      FROM sub_lots
      WHERE layout_id = $1
        AND lot_id = $2
        AND company_id = $3
      FOR UPDATE
      `,
      [layoutId, lotId, company_id]
    );

    await client.query(
      `
      DELETE FROM sub_lots
      WHERE layout_id = $1
        AND lot_id = $2
        AND company_id = $3
      `,
      [layoutId, lotId, company_id]
    );

    const deleteResult = await client.query(
      `
      DELETE FROM lot_layouts
      WHERE id = $1
        AND lot_id = $2
        AND company_id = $3
      RETURNING id, version
      `,
      [layoutId, lotId, company_id]
    );

    if (!deleteResult.rows.length) {
      throw httpError(404, 'División no encontrada', 'NotFound');
    }

    await client.query('COMMIT');
    return res.json({
      ok: true,
      id: deleteResult.rows[0].id,
      version: deleteResult.rows[0].version,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}

    if (err.code === '23503') {
      return next(httpError(409, LAYOUT_IN_USE_MESSAGE, 'Conflict'));
    }

    return next(err);
  } finally {
    client.release();
  }
};

exports.createSubLot = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { lotId, layoutId } = req.params;
    const { code, name, geom, sort_order = 0, enabled = true } = req.body;

    await assertEditableLayout(pool, lotId, layoutId, company_id);
    const geoJsonText = toGeoJsonText(geom);
    const normalizedGeoJsonText = await normalizeSubLotGeometryForSave(pool, lotId, layoutId, company_id, geoJsonText);

    const { rows } = await pool.query(
      `
      INSERT INTO sub_lots (layout_id, lot_id, company_id, code, name, geom, sort_order, enabled)
      VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($6)), 4326), $7, $8)
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
      [layoutId, lotId, company_id, code, name, normalizedGeoJsonText, sort_order, enabled]
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
      const normalizedGeoJsonText = await normalizeSubLotGeometryForSave(pool, lotId, layoutId, company_id, geoJsonText, subLotId);
      values.push(normalizedGeoJsonText);
      updates.push(`geom = ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($${values.length})), 4326)`);
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

exports.replaceSubLots = async (req, res, next) => {
  const client = await pool.connect();

  const { company_id } = req.user;
  const { lotId, layoutId } = req.params;

  try {
    const requestedSubLots = req.body.subLots;
    if (!Array.isArray(requestedSubLots)) {
      throw httpError(400, 'El formato de los sublotes no es válido.');
    }

    const subLots = normalizeSubLotSnapshotInput(requestedSubLots);

    if (isDevelopment()) {
      console.log('[SUBLOT BATCH SAVE BACKEND]', {
        lotId,
        layoutId,
        companyId: company_id,
        subLotsCount: subLots.length,
        subLots: subLots.map((subLot) => ({
          id: subLot.id,
          clientId: subLot.client_id,
          client_id: subLot.client_id,
          code: subLot.code,
          name: subLot.name,
          geomType: subLot.geom?.type,
          sort_order: subLot.sort_order,
          enabled: subLot.enabled,
        })),
      });
    }

    await client.query('BEGIN');

    await assertEditableLayout(client, lotId, layoutId, company_id);

    const { rows: existingRows } = await client.query(
      `
      SELECT id
      FROM sub_lots
      WHERE layout_id = $1
        AND lot_id = $2
        AND company_id = $3
      FOR UPDATE
      `,
      [layoutId, lotId, company_id]
    );

    const existingIds = new Set(existingRows.map((row) => row.id));
    const submittedExistingIds = subLots
      .map((subLot) => subLot.id)
      .filter(Boolean);

    const unknownIds = submittedExistingIds.filter((id) => !existingIds.has(id));
    if (unknownIds.length) {
      throw httpError(
        404,
        'Uno de los sublotes del borrador ya no existe en esta división.',
        'NotFound',
        { ids: unknownIds }
      );
    }

    await createNormalizedSubLotSnapshotTable(client, lotId, layoutId, company_id, subLots);

    const deletedExistingIds = existingRows
      .map((row) => row.id)
      .filter((id) => !submittedExistingIds.includes(id));
    const deleteReferences = await getSubLotReferenceCounts(client, deletedExistingIds, company_id);
    if (deleteReferences.length) {
      throw httpError(409, SUB_LOT_IN_USE_MESSAGE, 'Conflict', {
        sub_lot_ids: deletedExistingIds,
        references: deleteReferences,
      });
    }

    if (submittedExistingIds.length) {
      await client.query(
        `
        DELETE FROM sub_lots
        WHERE layout_id = $1
          AND lot_id = $2
          AND company_id = $3
          AND id <> ALL($4::uuid[])
        `,
        [layoutId, lotId, company_id, submittedExistingIds]
      );
    } else {
      await client.query(
        `
        DELETE FROM sub_lots
        WHERE layout_id = $1
          AND lot_id = $2
          AND company_id = $3
        `,
        [layoutId, lotId, company_id]
      );
    }

    await client.query(
      `
      UPDATE sub_lots sl
      SET code = snapshot.code,
          name = snapshot.name,
          geom = snapshot.geom,
          sort_order = snapshot.sort_order,
          enabled = snapshot.enabled
      FROM tmp_sub_lot_snapshot snapshot
      WHERE snapshot.id IS NOT NULL
        AND sl.id = snapshot.id
        AND sl.layout_id = $1
        AND sl.lot_id = $2
        AND sl.company_id = $3
      `,
      [layoutId, lotId, company_id]
    );

    await client.query(
      `
      INSERT INTO sub_lots (layout_id, lot_id, company_id, code, name, geom, sort_order, enabled)
      SELECT
        $1,
        $2,
        $3,
        code,
        name,
        geom,
        sort_order,
        enabled
      FROM tmp_sub_lot_snapshot
      WHERE id IS NULL
      ORDER BY row_index
      `,
      [layoutId, lotId, company_id]
    );

    const validation = await validateLayoutById(client, lotId, layoutId, company_id);
    const layout = await getLayout(client, lotId, layoutId, company_id);

    await client.query('COMMIT');
    return res.json({ layout, validation });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    logSubLotBatchError(err);

    if (err.code === '23503') {
      return next(httpError(409, SUB_LOT_IN_USE_MESSAGE, 'Conflict'));
    }

    if (err.code === '23505' && /sub_lots.*code|layout.*code|unique/i.test(err.constraint || err.detail || err.message || '')) {
      return next(httpError(409, 'Ya existe un sublote con ese código en esta división.', 'Conflict'));
    }

    if (err.code === '22P02') {
      return next(httpError(400, 'Uno de los identificadores del snapshot no es válido.'));
    }

    if (isGeometrySqlError(err)) {
      return next(httpError(400, 'La geometría de uno de los sublotes no es válida.'));
    }

    return next(err);
  } finally {
    client.release();
  }
};

exports.fillRemainingSubLot = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { company_id } = req.user;
    const { lotId, layoutId } = req.params;

    await client.query('BEGIN');

    const { rows: scopeRows } = await client.query(
      `
      SELECT
        ll.id,
        ll.status,
        ll.lot_id,
        ll.company_id,
        ll.parent_geom_snapshot,
        l.name AS lot_name
      FROM lot_layouts ll
      JOIN lots l ON l.id = ll.lot_id
      WHERE ll.id = $1
        AND ll.lot_id = $2
        AND ll.company_id = $3
      FOR UPDATE OF ll
      `,
      [layoutId, lotId, company_id]
    );

    const layout = scopeRows[0];
    if (!layout) throw httpError(404, 'División no encontrada', 'NotFound');
    if (!EDITABLE_STATUSES.has(layout.status)) {
      throw httpError(409, `Esta división está ${layoutStatusLabel(layout.status)}. Creá una nueva división para realizar cambios.`, 'Conflict');
    }

    const { rows: subLotRows } = await client.query(
      `
      SELECT id, code, sort_order, enabled
      FROM sub_lots
      WHERE layout_id = $1
        AND lot_id = $2
        AND company_id = $3
      ORDER BY sort_order, code
      `,
      [layoutId, lotId, company_id]
    );

    const enabledSubLotRows = subLotRows.filter((subLot) => subLot.enabled);
    if (!enabledSubLotRows.length) {
      throw httpError(400, 'Dibujá al menos un sublote antes de completar la superficie restante.');
    }

    const remainingResult = await client.query(
      `
      WITH existing_union AS (
        SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom
        FROM sub_lots
        WHERE layout_id = $1
          AND lot_id = $2
          AND company_id = $3
          AND enabled = TRUE
      ),
      remaining_raw AS (
        SELECT ST_Difference(
          ll.parent_geom_snapshot,
          COALESCE(existing_union.geom, ST_SetSRID('GEOMETRYCOLLECTION EMPTY'::geometry, 4326))
        ) AS geom
        FROM lot_layouts ll
        CROSS JOIN existing_union
        WHERE ll.id = $1
          AND ll.lot_id = $2
          AND ll.company_id = $3
      ),
      remaining_polygons AS (
        SELECT ST_CollectionExtract(ST_MakeValid(geom), 3) AS geom
        FROM remaining_raw
      ),
      regions AS (
        SELECT
          (dumped).path[1] AS region_index,
          (dumped).geom::geometry(Polygon, 4326) AS geom
        FROM (
          SELECT ST_Dump(geom) AS dumped
          FROM remaining_polygons
          WHERE NOT ST_IsEmpty(geom)
        ) dump_source
      )
      SELECT
        COUNT(*)::int AS regions_count,
        COALESCE(SUM(ST_Area(geom::geography) / 10000), 0)::numeric AS remaining_area_ha,
        COALESCE(json_agg(
          json_build_object(
            'index', region_index,
            'area_ha', ROUND((ST_Area(geom::geography) / 10000)::numeric, 4),
            'geom', ST_AsGeoJSON(geom)::json
          )
          ORDER BY region_index
        ) FILTER (WHERE geom IS NOT NULL), '[]'::json) AS regions
      FROM regions
      `,
      [layoutId, lotId, company_id]
    );

    const remaining = remainingResult.rows[0];
    const regionsCount = Number(remaining?.regions_count || 0);
    const remainingAreaHa = Number(remaining?.remaining_area_ha || 0);
    const regions = Array.isArray(remaining?.regions) ? remaining.regions : [];

    if (regionsCount === 0 || remainingAreaHa <= 0) {
      throw httpError(400, 'No queda superficie sin asignar para crear otro sublote.');
    }

    if (regionsCount > 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'MultipleRemainingRegions',
        message: 'La superficie sin asignar está separada en varias zonas. Revisala antes de crear sublotes automáticamente.',
        regions_count: regionsCount,
        remaining_area_ha: remainingAreaHa,
        regions,
      });
    }

    const code = nextSubLotCode(subLotRows);
    const sortOrder = subLotRows.reduce((max, subLot) => Math.max(max, Number(subLot.sort_order || 0)), -1) + 1;

    const { rows } = await client.query(
      `
      WITH existing_union AS (
        SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom
        FROM sub_lots
        WHERE layout_id = $1
          AND lot_id = $2
          AND company_id = $3
          AND enabled = TRUE
      ),
      remaining AS (
        SELECT (ST_Dump(ST_CollectionExtract(ST_MakeValid(ST_Difference(
          ll.parent_geom_snapshot,
          COALESCE(existing_union.geom, ST_SetSRID('GEOMETRYCOLLECTION EMPTY'::geometry, 4326))
        )), 3))).geom::geometry(Polygon, 4326) AS geom
        FROM lot_layouts ll
        CROSS JOIN existing_union
        WHERE ll.id = $1
          AND ll.lot_id = $2
          AND ll.company_id = $3
      )
      INSERT INTO sub_lots (layout_id, lot_id, company_id, code, name, geom, sort_order, enabled)
      SELECT
        $1,
        $2,
        $3,
        $4,
        $5,
        geom,
        $6,
        TRUE
      FROM remaining
      WHERE ST_IsValid(geom)
        AND (ST_Area(geom::geography) / 10000) > 0
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
      [layoutId, lotId, company_id, code, `${layout.lot_name}-${code}`, sortOrder]
    );

    if (!rows.length) {
      throw httpError(400, 'No se pudo crear un sublote con la superficie sin asignar.');
    }

    await client.query('COMMIT');
    return res.status(201).json({
      sub_lot: mapSubLot(rows[0]),
      remaining: {
        regions_count: regionsCount,
        area_ha: remainingAreaHa,
      },
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
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
    if (!layout) throw httpError(404, 'División no encontrada', 'NotFound');
    if (layout.status !== 'draft') {
      throw httpError(409, `Sólo se pueden usar divisiones que estén en edición. Esta división está ${layoutStatusLabel(layout.status)}.`, 'Conflict');
    }

    const validation = await validateLayoutById(client, lotId, layoutId, company_id);
    if (!validation.valid) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'LayoutValidationError',
        message: 'La división todavía necesita ajustes antes de usarse.',
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
      throw httpError(409, 'No se pudo activar la división porque ya no está en edición.', 'Conflict');
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
