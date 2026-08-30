const { pool } = require('../../db/supabaseClient');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const getReferenceDate = async (date) => {
  if (date) return date;
  const { rows } = await pool.query('SELECT CURRENT_DATE::text AS today');
  return rows[0].today;
};

const assertDate = (date) => {
  if (date && !DATE_RE.test(date)) {
    const err = new Error('La fecha debe tener formato YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }
};

const productiveStateSql = (lotFilterSql = '') => `
  WITH scoped_lots AS (
    SELECT
      l.id,
      l.name,
      COALESCE(l.area_ha, NULLIF(l.area, 0)::numeric) AS area_ha,
      l.geom,
      COUNT(sl.id) FILTER (WHERE sl.id IS NOT NULL)::int AS active_sub_lots_count
    FROM lots l
    LEFT JOIN lot_layouts ll
      ON ll.lot_id = l.id
     AND ll.company_id = l.company_id
     AND ll.status = 'active'
    LEFT JOIN sub_lots sl
      ON sl.layout_id = ll.id
     AND sl.company_id = l.company_id
     AND COALESCE(sl.enabled, TRUE) IS TRUE
    WHERE l.company_id = $1
      AND COALESCE(l.enabled, TRUE) IS TRUE
      ${lotFilterSql}
    GROUP BY l.id, l.name, l.area_ha, l.area, l.geom
  ),
  units AS (
    SELECT
      l.id AS lot_id,
      l.name AS lot_name,
      'whole_lot'::text AS mode,
      NULL::uuid AS sub_lot_id,
      l.name AS unit_name,
      l.area_ha,
      l.geom,
      0::int AS sort_order
    FROM scoped_lots l
    WHERE l.active_sub_lots_count = 0

    UNION ALL

    SELECT
      l.id AS lot_id,
      l.name AS lot_name,
      'sub_lots'::text AS mode,
      sl.id AS sub_lot_id,
      sl.name AS unit_name,
      sl.area_ha,
      sl.geom,
      sl.sort_order
    FROM scoped_lots l
    JOIN lot_layouts ll
      ON ll.lot_id = l.id
     AND ll.status = 'active'
     AND ll.company_id = $1
    JOIN sub_lots sl
      ON sl.layout_id = ll.id
     AND sl.company_id = $1
     AND COALESCE(sl.enabled, TRUE) IS TRUE
    WHERE l.active_sub_lots_count > 0
  )
  SELECT
    u.lot_id,
    u.lot_name,
    u.mode,
    u.sub_lot_id,
    u.unit_name,
    u.area_ha,
    CASE WHEN current_assignment.id IS NULL THEN NULL ELSE json_build_object(
      'assignment_id', current_assignment.id,
      'lot_id', current_assignment.lot_id,
      'sub_lot_id', current_assignment.sub_lot_id,
      'crop_id', current_assignment.crop_id,
      'crop_name', current_assignment.crop_name,
      'campaign_id', current_assignment.campaign_id,
      'campaign_name', current_assignment.campaign_name,
      'campaign_status', current_assignment.campaign_status,
      'start_date', current_assignment.start_date,
      'end_date', current_assignment.end_date
    ) END AS current_crop,
    COALESCE(previous.previous_crops, '[]'::json) AS previous_crops
  FROM units u
  LEFT JOIN LATERAL (
    SELECT
      ca.id,
      ca.lot_id,
      ca.sub_lot_id,
      ca.crop_id,
      cr.name AS crop_name,
      ca.campaign_id,
      cp.name AS campaign_name,
      cp.status AS campaign_status,
      ca.start_date,
      ca.end_date
    FROM crop_assignments ca
    JOIN crops cr
      ON cr.id = ca.crop_id
     AND cr.company_id = $1
    JOIN campaigns cp
      ON cp.id = ca.campaign_id
     AND cp.company_id = $1
    JOIN lots lot_geom
      ON lot_geom.id = ca.lot_id
     AND lot_geom.company_id = $1
    LEFT JOIN sub_lots current_sl
      ON current_sl.id = ca.sub_lot_id
     AND current_sl.company_id = $1
    WHERE ca.company_id = $1
      AND ca.lot_id = u.lot_id
      AND ca.start_date <= $2::date
      AND (ca.end_date IS NULL OR ca.end_date >= $2::date)
      AND (
        (u.sub_lot_id IS NULL AND ca.sub_lot_id IS NULL)
        OR
        (
          u.sub_lot_id IS NOT NULL
          AND (
            ca.sub_lot_id = u.sub_lot_id
            OR ca.sub_lot_id IS NULL
            OR (
              u.geom IS NOT NULL
              AND COALESCE(current_sl.geom, lot_geom.geom) IS NOT NULL
              AND ST_Area(
                ST_CollectionExtract(
                  ST_Intersection(
                    ST_CollectionExtract(ST_MakeValid(u.geom), 3),
                    ST_CollectionExtract(ST_MakeValid(COALESCE(current_sl.geom, lot_geom.geom)), 3)
                  ),
                  3
                )::geography
              ) > 1
            )
          )
        )
      )
    ORDER BY
      CASE WHEN ca.sub_lot_id = u.sub_lot_id THEN 0 ELSE 1 END,
      CASE WHEN ca.sub_lot_id IS NULL THEN 1 ELSE 0 END,
      ca.start_date DESC,
      ca.created_at DESC
    LIMIT 1
  ) current_assignment ON TRUE
  LEFT JOIN LATERAL (
    WITH candidates AS (
      SELECT
        ca.id,
        ca.crop_id,
        cr.name AS crop_name,
        ca.start_date,
        ca.end_date,
        ST_CollectionExtract(ST_MakeValid(COALESCE(sl.geom, lot_geom.geom)), 3) AS assignment_geom,
        ST_Area(
          ST_CollectionExtract(
            ST_Intersection(
              ST_CollectionExtract(ST_MakeValid(u.geom), 3),
              ST_CollectionExtract(ST_MakeValid(COALESCE(sl.geom, lot_geom.geom)), 3)
            ),
            3
          )::geography
        ) AS intersection_area_m2,
        ST_Area(ST_CollectionExtract(ST_MakeValid(u.geom), 3)::geography) AS current_area_m2
      FROM crop_assignments ca
      JOIN crops cr
        ON cr.id = ca.crop_id
       AND cr.company_id = $1
      JOIN lots lot_geom
        ON lot_geom.id = ca.lot_id
       AND lot_geom.company_id = $1
      LEFT JOIN sub_lots sl
        ON sl.id = ca.sub_lot_id
       AND sl.company_id = $1
      WHERE ca.company_id = $1
        AND ca.lot_id = u.lot_id
        AND ca.end_date IS NOT NULL
        AND ca.end_date < COALESCE(current_assignment.start_date, $2::date)
        AND u.geom IS NOT NULL
        AND COALESCE(sl.geom, lot_geom.geom) IS NOT NULL
    ),
    relevant AS (
      SELECT c.*
      FROM candidates c
      WHERE c.intersection_area_m2 > 1
        AND NOT EXISTS (
          SELECT 1
          FROM candidates newer
          WHERE newer.id <> c.id
            AND newer.intersection_area_m2 > 1
            AND (
              newer.end_date > c.end_date
              OR (newer.end_date = c.end_date AND newer.start_date > c.start_date)
            )
            AND ST_Area(
              ST_CollectionExtract(
                ST_Intersection(
                  ST_CollectionExtract(
                    ST_Intersection(
                      ST_CollectionExtract(ST_MakeValid(u.geom), 3),
                      c.assignment_geom
                    ),
                    3
                  ),
                  newer.assignment_geom
                ),
                3
              )::geography
            ) > 1
        )
    ),
    grouped AS (
      SELECT
        crop_id,
        crop_name,
        SUM(intersection_area_m2) AS crop_area_m2,
        MAX(current_area_m2) AS current_area_m2
      FROM relevant
      GROUP BY crop_id, crop_name
    )
    SELECT json_agg(
      json_build_object(
        'crop_id', crop_id,
        'crop_name', crop_name,
        'percentage', ROUND(((crop_area_m2 / NULLIF(current_area_m2, 0)) * 100)::numeric, 1)
      )
      ORDER BY crop_area_m2 DESC, crop_name ASC
    ) AS previous_crops
    FROM grouped
  ) previous ON TRUE
  ORDER BY u.lot_name ASC, u.sort_order ASC NULLS LAST, u.unit_name ASC;
`;

const groupRowsByLot = (rows, date) => {
  const byLot = new Map();

  rows.forEach((row) => {
    if (!byLot.has(row.lot_id)) {
      byLot.set(row.lot_id, {
        lot_id: row.lot_id,
        lot_name: row.lot_name,
        date,
        mode: row.mode,
        units: [],
      });
    }

    byLot.get(row.lot_id).units.push({
      lot_id: row.lot_id,
      sub_lot_id: row.sub_lot_id,
      name: row.unit_name,
      area_ha: row.area_ha,
      current_crop: row.current_crop,
      previous_crops: row.previous_crops || [],
    });
  });

  return Array.from(byLot.values());
};

exports.getLotProductiveState = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { lotId } = req.params;
    const { date } = req.query;
    assertDate(date);
    const referenceDate = await getReferenceDate(date);

    const { rows } = await pool.query(
      productiveStateSql('AND l.id = $3'),
      [company_id, referenceDate, lotId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'NotFound', message: 'Lote no encontrado' });
    }

    return res.json(groupRowsByLot(rows, referenceDate)[0]);
  } catch (err) {
    next(err);
  }
};

exports.listLotProductiveStates = async (req, res, next) => {
  try {
    const { company_id } = req.user;
    const { date } = req.query;
    assertDate(date);
    const referenceDate = await getReferenceDate(date);

    const { rows } = await pool.query(
      productiveStateSql(),
      [company_id, referenceDate]
    );

    return res.json({
      date: referenceDate,
      data: groupRowsByLot(rows, referenceDate),
    });
  } catch (err) {
    next(err);
  }
};
