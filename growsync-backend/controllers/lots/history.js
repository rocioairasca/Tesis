const { pool } = require('../../db/supabaseClient');

const toDateKey = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const normalizeLocationLabel = (event) => (
  event.sub_lot_name || event.lot_name || 'Lote'
);

const assertLotScope = async (client, companyId, lotId, subLotId = null) => {
  const { rows } = await client.query(
    `
    SELECT
      l.id AS lot_id,
      l.name AS lot_name,
      sl.id AS sub_lot_id
    FROM lots l
    LEFT JOIN sub_lots sl
      ON sl.id = $3::uuid
     AND sl.lot_id = l.id
     AND sl.company_id = l.company_id
     AND COALESCE(sl.enabled, TRUE) IS TRUE
    WHERE l.id = $2
      AND l.company_id = $1
      AND COALESCE(l.enabled, TRUE) IS TRUE
    LIMIT 1;
    `,
    [companyId, lotId, subLotId]
  );

  if (!rows.length) {
    const err = new Error('Lote no encontrado');
    err.status = 404;
    throw err;
  }

  if (subLotId && !rows[0].sub_lot_id) {
    const err = new Error('Sublote no encontrado para este lote');
    err.status = 404;
    throw err;
  }

  return rows[0];
};

const fetchPlanningEvents = async (client, companyId, lotId, subLotId = null) => {
  const { rows } = await client.query(
    `
    SELECT
      p.id,
      'planning'::text AS type,
      COALESCE(p.effective_date, p.start_at::date, p.created_at::date)::text AS event_date,
      p.activity_type,
      p.title,
      p.description,
      p.registered_retroactively,
      p.created_at,
      p.start_at,
      p.end_at,
      p.effective_date,
      c.id AS crop_id,
      c.name AS crop,
      cp.id AS campaign_id,
      cp.name AS campaign,
      COALESCE(ROUND(SUM(pl.area_ha)::numeric, 4), 0) AS area_ha,
      CASE
        WHEN COUNT(*) = 1 THEN (array_agg(pl.lot_id))[1]
        ELSE $2::uuid
      END AS lot_id,
      MAX(l.name) AS lot_name,
      CASE
        WHEN COUNT(*) = 1 THEN (array_agg(pl.sub_lot_id))[1]
        ELSE NULL::uuid
      END AS sub_lot_id,
      CASE
        WHEN COUNT(*) = 1 THEN MAX(sl.name)
        WHEN COUNT(*) > 1 THEN 'Varias superficies'
        ELSE NULL
      END AS sub_lot_name,
      json_agg(
        json_build_object(
          'lot_id', pl.lot_id,
          'lot_name', l.name,
          'sub_lot_id', pl.sub_lot_id,
          'sub_lot_name', sl.name,
          'area_ha', pl.area_ha
        )
        ORDER BY l.name, sl.sort_order NULLS FIRST, sl.code NULLS FIRST, sl.name ASC
      ) AS locations,
      COALESCE(products.products, '[]'::jsonb) AS products
    FROM planning p
    JOIN planning_lots pl
      ON pl.planning_id = p.id
    JOIN lots l
      ON l.id = pl.lot_id
     AND l.company_id = p.company_id
    LEFT JOIN sub_lots sl
      ON sl.id = pl.sub_lot_id
     AND sl.company_id = p.company_id
    LEFT JOIN crops c
      ON c.id = p.crop_id
     AND c.company_id = p.company_id
    LEFT JOIN campaigns cp
      ON cp.id = p.campaign_id
     AND cp.company_id = p.company_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', pr.id,
          'name', pr.name,
          'amount', COALESCE(ppc.actual_amount, pp.amount),
          'unit', COALESCE(pp.unit, pr.unit)
        )
        ORDER BY pr.name ASC
      ) AS products
      FROM planning_products pp
      JOIN products pr
        ON pr.id = pp.product_id
       AND pr.company_id = p.company_id
      LEFT JOIN planning_product_completions ppc
        ON ppc.planning_product_id = pp.id
       AND ppc.planning_id = p.id
      WHERE pp.planning_id = p.id
    ) products ON TRUE
    WHERE p.company_id = $1
      AND p.status = 'completado'
      AND COALESCE(p.enabled, TRUE) IS TRUE
      AND pl.lot_id = $2
      AND ($3::uuid IS NULL OR pl.sub_lot_id = $3::uuid OR pl.sub_lot_id IS NULL)
    GROUP BY
      p.id, c.id, c.name, cp.id, cp.name, products.products;
    `,
    [companyId, lotId, subLotId]
  );

  return rows.map((row) => ({
    id: `planning:${row.id}`,
    source_id: row.id,
    type: row.type,
    event_date: toDateKey(row.event_date),
    activity_type: row.activity_type,
    title: row.title,
    description: row.description,
    crop_id: row.crop_id || null,
    crop: row.crop || null,
    campaign_id: row.campaign_id || null,
    campaign: row.campaign || null,
    lot_id: row.lot_id,
    lot_name: row.lot_name,
    sub_lot_id: row.sub_lot_id || null,
    sub_lot_name: row.sub_lot_name || null,
    location_label: normalizeLocationLabel(row),
    area_ha: row.area_ha,
    products: asArray(row.products).filter(product => Number(product.amount || 0) > 0),
    details: {
      start_at: row.start_at,
      end_at: row.end_at,
      effective_date: toDateKey(row.effective_date),
      locations: asArray(row.locations),
    },
    registered_retroactively: row.registered_retroactively === true,
    created_at: row.created_at,
  }));
};

const fetchManualUsageEvents = async (client, companyId, lotId, subLotId = null) => {
  const { rows } = await client.query(
    `
    SELECT
      ur.id,
      'manual_usage'::text AS type,
      ur.date::text AS event_date,
      ur.amount_used,
      ur.unit,
      ur.total_area,
      ur.current_crop,
      ur.previous_crop,
      ur.created_at,
      pr.id AS product_id,
      pr.name AS product_name,
      c.id AS crop_id,
      c.name AS crop,
      CASE
        WHEN COUNT(*) = 1 THEN (array_agg(ul.lot_id))[1]
        ELSE $2::uuid
      END AS lot_id,
      MAX(l.name) AS lot_name,
      CASE
        WHEN COUNT(*) = 1 THEN (array_agg(ul.sub_lot_id))[1]
        ELSE NULL::uuid
      END AS sub_lot_id,
      CASE
        WHEN COUNT(*) = 1 THEN MAX(sl.name)
        WHEN COUNT(*) > 1 THEN 'Varias superficies'
        ELSE NULL
      END AS sub_lot_name,
      json_agg(
        json_build_object(
          'lot_id', ul.lot_id,
          'lot_name', l.name,
          'sub_lot_id', ul.sub_lot_id,
          'sub_lot_name', sl.name
        )
        ORDER BY l.name, sl.sort_order NULLS FIRST, sl.code NULLS FIRST, sl.name ASC
      ) AS locations
    FROM usage_records ur
    JOIN usage_lots ul
      ON ul.usage_id = ur.id
    JOIN lots l
      ON l.id = ul.lot_id
     AND l.company_id = ur.company_id
    LEFT JOIN sub_lots sl
      ON sl.id = ul.sub_lot_id
     AND sl.company_id = ur.company_id
    JOIN products pr
      ON pr.id = ur.product_id
     AND pr.company_id = ur.company_id
    LEFT JOIN crops c
      ON c.id = ur.crop_id
     AND c.company_id = ur.company_id
    WHERE ur.company_id = $1
      AND COALESCE(ur.enabled, TRUE) IS TRUE
      AND ur.source_planning_id IS NULL
      AND ul.lot_id = $2
      AND ($3::uuid IS NULL OR ul.sub_lot_id = $3::uuid OR ul.sub_lot_id IS NULL)
    GROUP BY ur.id, pr.id, pr.name, c.id, c.name;
    `,
    [companyId, lotId, subLotId]
  );

  return rows.map((row) => ({
    id: `manual_usage:${row.id}`,
    source_id: row.id,
    type: row.type,
    event_date: toDateKey(row.event_date),
    activity_type: 'uso_producto',
    title: 'Uso de producto',
    crop_id: row.crop_id || null,
    crop: row.crop || row.current_crop || null,
    campaign_id: null,
    campaign: null,
    lot_id: row.lot_id,
    lot_name: row.lot_name,
    sub_lot_id: row.sub_lot_id || null,
    sub_lot_name: row.sub_lot_name || null,
    location_label: normalizeLocationLabel(row),
    area_ha: row.total_area,
    products: [{
      product_id: row.product_id,
      name: row.product_name,
      amount: row.amount_used,
      unit: row.unit,
    }],
    details: {
      previous_crop: row.previous_crop || null,
      current_crop: row.current_crop || null,
      locations: asArray(row.locations),
    },
    registered_retroactively: false,
    created_at: row.created_at,
  }));
};

const fetchManualCropAssignmentEvents = async (client, companyId, lotId, subLotId = null) => {
  const { rows } = await client.query(
    `
    SELECT
      ca.id,
      'crop_cycle'::text AS type,
      ca.start_date::text AS event_date,
      ca.campaign_id,
      cp.name AS campaign,
      ca.lot_id,
      l.name AS lot_name,
      ca.sub_lot_id,
      sl.name AS sub_lot_name,
      ca.crop_id,
      c.name AS crop,
      ca.start_date,
      ca.end_date,
      ca.area_ha,
      ca.created_at
    FROM crop_assignments ca
    JOIN lots l
      ON l.id = ca.lot_id
     AND l.company_id = ca.company_id
    LEFT JOIN sub_lots sl
      ON sl.id = ca.sub_lot_id
     AND sl.company_id = ca.company_id
    JOIN crops c
      ON c.id = ca.crop_id
     AND c.company_id = ca.company_id
    JOIN campaigns cp
      ON cp.id = ca.campaign_id
     AND cp.company_id = ca.company_id
    WHERE ca.company_id = $1
      AND ca.source_planning_id IS NULL
      AND ca.lot_id = $2
      AND ($3::uuid IS NULL OR ca.sub_lot_id = $3::uuid OR ca.sub_lot_id IS NULL)
    `,
    [companyId, lotId, subLotId]
  );

  return rows.map((row) => ({
    id: `crop_cycle:${row.id}`,
    source_id: row.id,
    type: row.type,
    event_date: toDateKey(row.event_date),
    activity_type: 'ciclo_cultivo',
    title: 'Ciclo de cultivo',
    crop_id: row.crop_id,
    crop: row.crop,
    campaign_id: row.campaign_id,
    campaign: row.campaign,
    lot_id: row.lot_id,
    lot_name: row.lot_name,
    sub_lot_id: row.sub_lot_id || null,
    sub_lot_name: row.sub_lot_name || null,
    location_label: normalizeLocationLabel(row),
    area_ha: row.area_ha,
    products: [],
    details: {
      start_date: toDateKey(row.start_date),
      end_date: toDateKey(row.end_date),
    },
    registered_retroactively: false,
    created_at: row.created_at,
  }));
};

const fetchHarvestEvents = async (client, companyId, lotId, subLotId = null) => {
  const { rows } = await client.query(
    `
    SELECT
      hr.id,
      'harvest'::text AS type,
      hr.harvest_date::text AS event_date,
      hr.lot_id,
      l.name AS lot_name,
      hr.sub_lot_id,
      sl.name AS sub_lot_name,
      hr.crop_id,
      COALESCE(c.name, hr.crop) AS crop,
      hr.campaign_id,
      COALESCE(cp.name, hr.campaign) AS campaign,
      hr.production_kg,
      hr.harvested_area_ha,
      hr.yield_kg_ha,
      hr.notes,
      hr.created_at
    FROM harvest_records hr
    JOIN lots l
      ON l.id = hr.lot_id
     AND l.company_id = hr.company_id
    LEFT JOIN sub_lots sl
      ON sl.id = hr.sub_lot_id
     AND sl.company_id = hr.company_id
    LEFT JOIN crops c
      ON c.id = hr.crop_id
     AND c.company_id = hr.company_id
    LEFT JOIN campaigns cp
      ON cp.id = hr.campaign_id
     AND cp.company_id = hr.company_id
    WHERE hr.company_id = $1
      AND COALESCE(hr.enabled, TRUE) IS TRUE
      AND hr.lot_id = $2
      AND ($3::uuid IS NULL OR hr.sub_lot_id = $3::uuid OR hr.sub_lot_id IS NULL)
    `,
    [companyId, lotId, subLotId]
  );

  return rows.map((row) => ({
    id: `harvest:${row.id}`,
    source_id: row.id,
    type: row.type,
    event_date: toDateKey(row.event_date),
    activity_type: 'cosecha',
    title: 'Cosecha',
    crop_id: row.crop_id || null,
    crop: row.crop || null,
    campaign_id: row.campaign_id || null,
    campaign: row.campaign || null,
    lot_id: row.lot_id,
    lot_name: row.lot_name,
    sub_lot_id: row.sub_lot_id || null,
    sub_lot_name: row.sub_lot_name || null,
    location_label: normalizeLocationLabel(row),
    area_ha: row.harvested_area_ha,
    products: [],
    details: {
      production_kg: row.production_kg,
      harvested_area_ha: row.harvested_area_ha,
      yield_kg_ha: row.yield_kg_ha,
      notes: row.notes || null,
    },
    registered_retroactively: false,
    created_at: row.created_at,
  }));
};

exports.getLotHistory = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { company_id } = req.user;
    const { lotId } = req.params;
    const { subLotId = null } = req.query;

    if (!company_id) {
      return res.status(400).json({ message: 'No pudimos identificar tu empresa. Cerrá sesión e ingresá nuevamente.' });
    }

    await assertLotScope(client, company_id, lotId, subLotId);

    const planningEvents = await fetchPlanningEvents(client, company_id, lotId, subLotId);
    const manualUsageEvents = await fetchManualUsageEvents(client, company_id, lotId, subLotId);
    const cropCycleEvents = await fetchManualCropAssignmentEvents(client, company_id, lotId, subLotId);
    const harvestEvents = await fetchHarvestEvents(client, company_id, lotId, subLotId);

    const events = [
      ...planningEvents,
      ...manualUsageEvents,
      ...cropCycleEvents,
      ...harvestEvents,
    ].sort((a, b) => {
      const dateDiff = String(b.event_date || '').localeCompare(String(a.event_date || ''));
      if (dateDiff) return dateDiff;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });

    return res.json({ data: events });
  } catch (err) {
    console.error('Error obteniendo historial del lote:', err);
    next(err);
  } finally {
    client.release();
  }
};
