const PRODUCT_CONSUMING_ACTIVITIES = new Set(['fumigacion', 'fertilizacion', 'siembra']);

const toNum = (value, fallback = 0) => {
  const normalized = typeof value === 'string' ? value.replace(',', '.') : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toDateOnlyString = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

const getCurrentCropLabelForUsage = (planning) => (
  planning.crop_name || null
);

const assertDateFormat = (value, label) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const err = new Error(label);
    err.status = 400;
    throw err;
  }
  return String(value);
};

const getEffectiveWorkDate = (value) => assertDateFormat(value, 'La fecha efectiva del trabajo no es válida.');
const getEffectiveSowingDate = (value) => assertDateFormat(value, 'La fecha de siembra no es válida.');

const assertSowingDateMatchesCampaign = async (client, campaignId, companyId, effectiveDate) => {
  const { rows } = await client.query(
    `
    SELECT id, name, status, start_date, end_date
    FROM campaigns
    WHERE id = $1
      AND company_id = $2
      AND $3::date >= start_date
      AND (end_date IS NULL OR $3::date <= end_date)
    LIMIT 1;
    `,
    [campaignId, companyId, effectiveDate]
  );

  if (!rows.length) {
    const err = new Error('La fecha efectiva de siembra debe estar dentro del período formal de la campaña.');
    err.status = 400;
    throw err;
  }

  return rows[0];
};

const assertWorkDateMatchesCampaign = async (client, campaignId, companyId, effectiveDate) => {
  const { rows } = await client.query(
    `
    SELECT id, name, status, work_start_date, start_date, end_date
    FROM campaigns
    WHERE id = $1
      AND company_id = $2
      AND $3::date >= COALESCE(work_start_date, start_date)
      AND (end_date IS NULL OR $3::date <= end_date)
    LIMIT 1;
    `,
    [campaignId, companyId, effectiveDate]
  );

  if (!rows.length) {
    const err = new Error('La fecha seleccionada está fuera del período de trabajos de la campaña.');
    err.status = 400;
    throw err;
  }

  return rows[0];
};

const getPlanningForCompletion = async (client, planningId, companyId) => {
  const { rows } = await client.query(
    `
    SELECT
      p.id,
      p.activity_type,
      p.status,
      p.enabled,
      p.campaign_id,
      p.crop_id,
      p.responsible_user,
      c.name AS crop_name,
      cp.name AS campaign_name
    FROM planning p
    LEFT JOIN crops c
      ON c.id = p.crop_id
     AND c.company_id = p.company_id
    LEFT JOIN campaigns cp
      ON cp.id = p.campaign_id
     AND cp.company_id = p.company_id
    WHERE p.id = $1
      AND p.company_id = $2
    FOR UPDATE OF p
    LIMIT 1;
    `,
    [planningId, companyId]
  );

  if (!rows.length) {
    const err = new Error('No encontramos la planificación solicitada.');
    err.status = 404;
    throw err;
  }

  return rows[0];
};

const getPlanningSelectionsForUsage = async (client, planningId, companyId) => {
  const { rows } = await client.query(
    `
    SELECT
      pl.planning_id,
      pl.lot_id,
      pl.sub_lot_id,
      pl.area_ha,
      l.name AS lot_name,
      sl.name AS sub_lot_name
    FROM planning_lots pl
    JOIN lots l
      ON l.id = pl.lot_id
     AND l.company_id = $2
    LEFT JOIN sub_lots sl
      ON sl.id = pl.sub_lot_id
     AND sl.company_id = $2
    WHERE pl.planning_id = $1
    ORDER BY l.name, sl.sort_order NULLS FIRST, sl.code NULLS FIRST;
    `,
    [planningId, companyId]
  );

  return rows;
};

const getPlanningProductsForUsage = async (client, planningId, companyId) => {
  const { rows } = await client.query(
    `
    SELECT
      pp.id,
      pp.planning_id,
      pp.product_id,
      pp.amount,
      pp.unit,
      pr.name AS product_name,
      pr.unit AS product_unit,
      pr.available_quantity,
      pr.enabled
    FROM planning_products pp
    JOIN products pr
      ON pr.id = pp.product_id
     AND pr.company_id = $2
    WHERE pp.planning_id = $1
    ORDER BY pr.name ASC, pp.id ASC
    FOR UPDATE OF pp;
    `,
    [planningId, companyId]
  );

  return rows;
};

const normalizeActualProducts = (plannedProducts, actualProducts = []) => {
  const plannedIds = new Set(plannedProducts.map(planned => String(planned.id)));
  const byId = new Map();
  for (const item of actualProducts || []) {
    const key = String(item.planning_product_id);
    if (!plannedIds.has(key)) {
      const err = new Error('Uno de los productos informados no pertenece a esta planificación.');
      err.status = 400;
      throw err;
    }
    if (byId.has(key)) {
      const err = new Error('Hay productos repetidos en la confirmación.');
      err.status = 400;
      throw err;
    }
    byId.set(key, item);
  }

  return plannedProducts.map((planned) => {
    const provided = byId.get(String(planned.id));
    const actualAmount = provided
      ? toNum(provided.actual_amount, NaN)
      : toNum(planned.amount, 0);

    if (!Number.isFinite(actualAmount) || actualAmount < 0) {
      const err = new Error(`La cantidad utilizada de ${planned.product_name || 'producto'} no es válida.`);
      err.status = 400;
      throw err;
    }

    return {
      ...planned,
      actual_amount: actualAmount,
    };
  });
};

const assertNoPlanningProductCompletions = async (client, planningId, companyId) => {
  const { rows } = await client.query(
    `
    SELECT 1
    FROM planning_product_completions ppc
    JOIN planning p
      ON p.id = ppc.planning_id
     AND p.company_id = $2
    WHERE ppc.planning_id = $1
    LIMIT 1;
    `,
    [planningId, companyId]
  );

  return rows.length === 0;
};

const applyPlanningProductUsage = async (
  client,
  {
    planning,
    selections,
    plannedProducts,
    actualProducts,
    effectiveDate,
    companyId,
    historicalStockConsumption = false,
  }
) => {
  if (!plannedProducts.length) {
    return { usage_count: 0, consumed_products: 0 };
  }

  const normalizedProducts = normalizeActualProducts(plannedProducts, actualProducts);
  const productIds = [...new Set(normalizedProducts.map((item) => item.product_id))];

  const { rows: lockedProducts } = await client.query(
    `
    SELECT id, name, unit, available_quantity, enabled
    FROM products
    WHERE company_id = $1
      AND id = ANY($2::uuid[])
    FOR UPDATE;
    `,
    [companyId, productIds]
  );
  const productsById = new Map(lockedProducts.map((product) => [String(product.id), product]));
  const requestedByProduct = new Map();

  for (const planned of normalizedProducts) {
    const product = productsById.get(String(planned.product_id));
    if (!product || product.enabled === false) {
      const err = new Error(`${planned.product_name || 'Producto'} no está disponible.`);
      err.status = 409;
      throw err;
    }
    if ((planned.unit || product.unit) !== product.unit) {
      const err = new Error(`La unidad de ${product.name} no coincide con su stock.`);
      err.status = 400;
      throw err;
    }
    requestedByProduct.set(
      String(planned.product_id),
      (requestedByProduct.get(String(planned.product_id)) || 0) + planned.actual_amount
    );
  }

  for (const [productId, requestedAmount] of requestedByProduct.entries()) {
    const product = productsById.get(productId);
    if (requestedAmount > Number(product.available_quantity || 0)) {
      const err = new Error(historicalStockConsumption
        ? `No hay stock actual suficiente de ${product.name} para registrar este consumo histórico. Disponible: ${product.available_quantity} ${product.unit}.`
        : `No hay stock suficiente de ${product.name}. Disponible: ${product.available_quantity} ${product.unit}.`);
      err.status = 409;
      throw err;
    }
  }

  const totalArea = selections.reduce((sum, selection) => sum + Number(selection.area_ha || 0), 0);
  const currentCrop = getCurrentCropLabelForUsage(planning);
  let usageCount = 0;
  let consumedProducts = 0;

  for (const planned of normalizedProducts) {
    let usageId = null;

    if (planned.actual_amount > 0) {
      const { rows: usageRows } = await client.query(
        `
        INSERT INTO usage_records (
          date,
          product_id,
          amount_used,
          unit,
          total_area,
          previous_crop,
          current_crop,
          crop_id,
          user_id,
          company_id,
          source_planning_id,
          source_planning_product_id
        )
        VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11)
        RETURNING id;
        `,
        [
          effectiveDate,
          planned.product_id,
          planned.actual_amount,
          planned.unit || planned.product_unit,
          totalArea,
          currentCrop,
          planning.crop_id || null,
          planning.responsible_user,
          companyId,
          planning.id,
          planned.id,
        ]
      );

      usageId = usageRows[0].id;
      usageCount += 1;
      consumedProducts += 1;

      const usageLotValues = selections.map((_, index) => {
        const base = index * 2 + 2;
        return `($1, $${base}, $${base + 1})`;
      });
      const usageLotParams = [usageId];
      selections.forEach((selection) => {
        usageLotParams.push(selection.lot_id, selection.sub_lot_id || null);
      });

      if (usageLotValues.length) {
        await client.query(
          `
          INSERT INTO usage_lots (usage_id, lot_id, sub_lot_id)
          VALUES ${usageLotValues.join(', ')}
          `,
          usageLotParams
        );
      }

      await client.query(
        `
        UPDATE products
        SET available_quantity = COALESCE(available_quantity, 0) - $1
        WHERE id = $2
          AND company_id = $3;
        `,
        [planned.actual_amount, planned.product_id, companyId]
      );
    }

    await client.query(
      `
      INSERT INTO planning_product_completions (
        planning_product_id,
        planning_id,
        usage_id,
        actual_amount
      )
      VALUES ($1, $2, $3, $4);
      `,
      [planned.id, planning.id, usageId, planned.actual_amount]
    );
  }

  return { usage_count: usageCount, consumed_products: consumedProducts };
};

const resolveOpenCropAssignmentsForSowing = async (client, selection, companyId, effectiveDate) => {
  const { rows } = await client.query(
    `
    WITH selected_surface AS (
      SELECT
        pl.lot_id,
        pl.sub_lot_id,
        COALESCE(sl.geom, l.geom) AS geom
      FROM planning_lots pl
      JOIN lots l
        ON l.id = pl.lot_id
       AND l.company_id = $2
      LEFT JOIN sub_lots sl
        ON sl.id = pl.sub_lot_id
       AND sl.company_id = $2
      WHERE pl.planning_id = $1
        AND pl.lot_id = $3
        AND (
          (pl.sub_lot_id IS NULL AND $4::uuid IS NULL)
          OR pl.sub_lot_id = $4::uuid
        )
      LIMIT 1
    ),
    open_assignments AS (
      SELECT
        ca.id,
        ca.lot_id,
        ca.sub_lot_id,
        COALESCE(ca_sl.geom, ca_lot.geom) AS geom
      FROM crop_assignments ca
      JOIN lots ca_lot
        ON ca_lot.id = ca.lot_id
       AND ca_lot.company_id = $2
      LEFT JOIN sub_lots ca_sl
        ON ca_sl.id = ca.sub_lot_id
       AND ca_sl.company_id = $2
      WHERE ca.company_id = $2
        AND ca.lot_id = $3
        AND ca.start_date < $5::date
        AND (ca.end_date IS NULL OR ca.end_date >= $5::date)
    ),
    measured AS (
      SELECT
        oa.id,
        oa.sub_lot_id,
        ST_Area(ST_CollectionExtract(ST_MakeValid(oa.geom), 3)::geography) AS assignment_area_m2,
        ST_Area(
          ST_CollectionExtract(
            ST_Intersection(
              ST_CollectionExtract(ST_MakeValid(ss.geom), 3),
              ST_CollectionExtract(ST_MakeValid(oa.geom), 3)
            ),
            3
          )::geography
        ) AS intersection_area_m2
      FROM selected_surface ss
      JOIN open_assignments oa ON ss.geom IS NOT NULL AND oa.geom IS NOT NULL
    )
    SELECT
      id,
      sub_lot_id,
      assignment_area_m2,
      intersection_area_m2,
      (assignment_area_m2 - intersection_area_m2) AS outside_selected_m2
    FROM measured
    WHERE intersection_area_m2 > 1;
    `,
    [selection.planning_id, companyId, selection.lot_id, selection.sub_lot_id, effectiveDate]
  );

  const partial = rows.find(row => Number(row.outside_selected_m2 || 0) > 1);
  if (partial) {
    const err = new Error('El lote tiene un cultivo registrado sobre toda su superficie. Antes de completar esta siembra, actualizá el estado productivo para reflejar la nueva división.');
    err.status = 409;
    err.details = { open_assignment_id: partial.id };
    throw err;
  }

  return rows.map(row => row.id);
};

const assertNoRemainingSowingConflicts = async (client, selections, companyId, effectiveDate) => {
  const lotIds = selections.map(selection => selection.lot_id);
  const subLotIds = selections.map(selection => selection.sub_lot_id);

  const { rows } = await client.query(
    `
    WITH requested AS (
      SELECT lot_id, sub_lot_id
      FROM unnest($1::uuid[], $2::uuid[]) AS r(lot_id, sub_lot_id)
    ),
    requested_geom AS (
      SELECT
        r.lot_id,
        r.sub_lot_id,
        COALESCE(sl.geom, l.geom) AS geom
      FROM requested r
      JOIN lots l
        ON l.id = r.lot_id
       AND l.company_id = $3
      LEFT JOIN sub_lots sl
        ON sl.id = r.sub_lot_id
       AND sl.company_id = $3
    ),
    conflicts AS (
      SELECT ca.id
      FROM requested_geom rg
      JOIN crop_assignments ca
        ON ca.company_id = $3
       AND ca.lot_id = rg.lot_id
       AND daterange(ca.start_date, COALESCE(ca.end_date, 'infinity'::date), '[]')
         && daterange($4::date, 'infinity'::date, '[]')
      JOIN lots ca_lot
        ON ca_lot.id = ca.lot_id
       AND ca_lot.company_id = $3
      LEFT JOIN sub_lots ca_sl
        ON ca_sl.id = ca.sub_lot_id
       AND ca_sl.company_id = $3
      WHERE rg.geom IS NOT NULL
        AND COALESCE(ca_sl.geom, ca_lot.geom) IS NOT NULL
        AND ST_Area(
          ST_CollectionExtract(
            ST_Intersection(
              ST_CollectionExtract(ST_MakeValid(rg.geom), 3),
              ST_CollectionExtract(ST_MakeValid(COALESCE(ca_sl.geom, ca_lot.geom)), 3)
            ),
            3
          )::geography
        ) > 1
      LIMIT 1
    )
    SELECT id FROM conflicts;
    `,
    [lotIds, subLotIds, companyId, effectiveDate]
  );

  if (rows.length) {
    const err = new Error('No se pudo registrar el cultivo porque existe un ciclo productivo superpuesto en esa superficie.');
    err.status = 409;
    throw err;
  }
};

const getPreviousDay = async (client, date) => {
  const { rows } = await client.query(
    `SELECT ($1::date - INTERVAL '1 day')::date AS previous_day;`,
    [date]
  );
  return rows[0].previous_day;
};

const getHistoricalCropAssignmentsForSelection = async (client, selection, companyId, effectiveDate) => {
  const { rows } = await client.query(
    `
    WITH selected_surface AS (
      SELECT
        pl.lot_id,
        pl.sub_lot_id,
        COALESCE(sl.geom, l.geom) AS geom
      FROM planning_lots pl
      JOIN lots l
        ON l.id = pl.lot_id
       AND l.company_id = $2
      LEFT JOIN sub_lots sl
        ON sl.id = pl.sub_lot_id
       AND sl.company_id = $2
      WHERE pl.planning_id = $1
        AND pl.lot_id = $3
        AND (
          (pl.sub_lot_id IS NULL AND $4::uuid IS NULL)
          OR pl.sub_lot_id = $4::uuid
        )
      LIMIT 1
    )
    SELECT
      ca.id,
      ca.lot_id,
      ca.sub_lot_id,
      ca.start_date,
      ca.end_date,
      ST_Area(ST_CollectionExtract(ST_MakeValid(COALESCE(ca_sl.geom, ca_lot.geom)), 3)::geography) AS assignment_area_m2,
      ST_Area(
        ST_CollectionExtract(
          ST_Intersection(
            ST_CollectionExtract(ST_MakeValid(ss.geom), 3),
            ST_CollectionExtract(ST_MakeValid(COALESCE(ca_sl.geom, ca_lot.geom)), 3)
          ),
          3
        )::geography
      ) AS intersection_area_m2
    FROM selected_surface ss
    JOIN crop_assignments ca
      ON ca.company_id = $2
     AND ca.lot_id = $3
    JOIN lots ca_lot
      ON ca_lot.id = ca.lot_id
     AND ca_lot.company_id = $2
    LEFT JOIN sub_lots ca_sl
      ON ca_sl.id = ca.sub_lot_id
     AND ca_sl.company_id = $2
    WHERE ss.geom IS NOT NULL
      AND COALESCE(ca_sl.geom, ca_lot.geom) IS NOT NULL
      AND ST_Area(
        ST_CollectionExtract(
          ST_Intersection(
            ST_CollectionExtract(ST_MakeValid(ss.geom), 3),
            ST_CollectionExtract(ST_MakeValid(COALESCE(ca_sl.geom, ca_lot.geom)), 3)
          ),
          3
        )::geography
      ) > 1
    ORDER BY ca.start_date ASC, ca.created_at ASC
    FOR UPDATE OF ca;
    `,
    [selection.planning_id, companyId, selection.lot_id, selection.sub_lot_id]
  );

  return rows;
};

const assertHistoricalSowingSurfaceIsSafe = (selection, assignments) => {
  const incompatibleSurface = assignments.find(row => (
    (row.sub_lot_id || null) !== (selection.sub_lot_id || null)
  ));

  if (incompatibleSurface) {
    const err = new Error('No es posible insertar esta siembra automáticamente porque la distribución histórica del lote no permite determinar el cambio de cultivo con seguridad.');
    err.status = 409;
    err.details = {
      lot_id: selection.lot_id,
      sub_lot_id: selection.sub_lot_id || null,
      conflicting_assignment_id: incompatibleSurface.id,
    };
    throw err;
  }
};

const resolveHistoricalSowingWindow = async (client, selection, companyId, effectiveDate) => {
  const assignments = await getHistoricalCropAssignmentsForSelection(client, selection, companyId, effectiveDate);
  assertHistoricalSowingSurfaceIsSafe(selection, assignments);

  const effectiveTime = Date.parse(`${effectiveDate}T00:00:00.000Z`);
  const containsDate = assignments.filter((row) => {
    const start = Date.parse(`${toDateOnlyString(row.start_date)}T00:00:00.000Z`);
    const end = row.end_date ? Date.parse(`${toDateOnlyString(row.end_date)}T00:00:00.000Z`) : Infinity;
    return start <= effectiveTime && effectiveTime <= end;
  });
  const nextAssignments = assignments.filter((row) => {
    const start = Date.parse(`${toDateOnlyString(row.start_date)}T00:00:00.000Z`);
    return start > effectiveTime;
  });

  if (containsDate.length > 1) {
    const err = new Error('No es posible insertar esta siembra porque hay ciclos productivos superpuestos en esa fecha.');
    err.status = 409;
    throw err;
  }

  const previous = containsDate[0] || null;
  const next = nextAssignments[0] || null;
  const endDate = next ? await getPreviousDay(client, toDateOnlyString(next.start_date)) : null;

  const overlapsNewWindow = assignments.find((row) => {
    if (previous && row.id === previous.id) return false;
    if (next && row.id === next.id) return false;

    const start = Date.parse(`${toDateOnlyString(row.start_date)}T00:00:00.000Z`);
    const end = row.end_date ? Date.parse(`${toDateOnlyString(row.end_date)}T00:00:00.000Z`) : Infinity;
    const newEnd = endDate ? Date.parse(`${toDateOnlyString(endDate)}T00:00:00.000Z`) : Infinity;
    return start <= newEnd && effectiveTime <= end;
  });

  if (overlapsNewWindow) {
    const err = new Error('No es posible insertar esta siembra porque existe un ciclo productivo superpuesto en esa superficie.');
    err.status = 409;
    err.details = { conflicting_assignment_id: overlapsNewWindow.id };
    throw err;
  }

  return { previous, next, endDate };
};

const completeNormalSowingAssignments = async (client, planning, selections, companyId, effectiveDate) => {
  const previousEndDate = await getPreviousDay(client, effectiveDate);
  const closeIds = new Set();

  for (const selection of selections) {
    const idsToClose = await resolveOpenCropAssignmentsForSowing(
      client,
      selection,
      companyId,
      effectiveDate
    );
    idsToClose.forEach(closeId => closeIds.add(closeId));
  }

  if (closeIds.size) {
    await client.query(
      `
      UPDATE crop_assignments
      SET end_date = $1
      WHERE company_id = $2
        AND id = ANY($3::uuid[]);
      `,
      [previousEndDate, companyId, Array.from(closeIds)]
    );
  }

  await assertNoRemainingSowingConflicts(client, selections, companyId, effectiveDate);

  const params = [companyId, planning.campaign_id, planning.crop_id, effectiveDate, planning.id];
  const values = selections.map((selection, index) => {
    const base = index * 3 + 6;
    params.push(selection.lot_id, selection.sub_lot_id, selection.area_ha);
    return `($1, $2, $${base}, $${base + 1}, $3, $4, NULL, $${base + 2}, $5)`;
  });

  const { rows: assignmentRows } = await client.query(
    `
    INSERT INTO crop_assignments (
      company_id, campaign_id, lot_id, sub_lot_id, crop_id, start_date, end_date, area_ha, source_planning_id
    )
    VALUES ${values.join(', ')}
    RETURNING id, lot_id, sub_lot_id;
    `,
    params
  );

  if (assignmentRows.length !== selections.length) {
    const err = new Error('Esta siembra ya fue registrada en el estado productivo.');
    err.status = 409;
    throw err;
  }

  return {
    assignments_created: assignmentRows.length,
    closed_previous_cycles: closeIds.size,
  };
};

const completeHistoricalSowingAssignments = async (client, planning, selections, companyId, effectiveDate) => {
  const previousEndDate = await getPreviousDay(client, effectiveDate);
  const closeIds = new Set();
  const insertRows = [];

  for (const selection of selections) {
    const window = await resolveHistoricalSowingWindow(client, selection, companyId, effectiveDate);

    if (window.previous) {
      closeIds.add(window.previous.id);
    }

    insertRows.push({
      selection,
      endDate: window.endDate,
    });
  }

  if (closeIds.size) {
    await client.query(
      `
      UPDATE crop_assignments
      SET end_date = $1
      WHERE company_id = $2
        AND id = ANY($3::uuid[]);
      `,
      [previousEndDate, companyId, Array.from(closeIds)]
    );
  }

  const params = [companyId, planning.campaign_id, planning.crop_id, effectiveDate, planning.id];
  const values = insertRows.map((row, index) => {
    const base = index * 4 + 6;
    params.push(row.selection.lot_id, row.selection.sub_lot_id, row.selection.area_ha, row.endDate);
    return `($1, $2, $${base}, $${base + 1}, $3, $4, $${base + 3}, $${base + 2}, $5)`;
  });

  const { rows: assignmentRows } = await client.query(
    `
    INSERT INTO crop_assignments (
      company_id, campaign_id, lot_id, sub_lot_id, crop_id, start_date, end_date, area_ha, source_planning_id
    )
    VALUES ${values.join(', ')}
    RETURNING id, lot_id, sub_lot_id;
    `,
    params
  );

  if (assignmentRows.length !== selections.length) {
    const err = new Error('Esta siembra ya fue registrada en el estado productivo.');
    err.status = 409;
    throw err;
  }

  return {
    assignments_created: assignmentRows.length,
    closed_previous_cycles: closeIds.size,
  };
};

const markPlanningCompleted = async (
  client,
  {
    planningId,
    companyId,
    effectiveDate,
    registeredRetroactively = false,
  }
) => {
  await client.query(
    `
    UPDATE planning
    SET
      status = 'completado',
      effective_date = $3::date,
      completed_at = NOW(),
      registered_retroactively = $4
    WHERE id = $1
      AND company_id = $2;
    `,
    [planningId, companyId, effectiveDate, registeredRetroactively]
  );
};

const completeSowingPlanning = async (
  client,
  planning,
  {
    actualProducts = [],
    effectiveDate,
    companyId,
    historical = false,
    registeredRetroactively = false,
  }
) => {
  if (planning.activity_type !== 'siembra') {
    const err = new Error('Esta acción sólo está disponible para planificaciones de siembra.');
    err.status = 400;
    throw err;
  }

  if (planning.status === 'cancelado' || planning.enabled === false) {
    const err = new Error('No se puede completar una planificación cancelada.');
    err.status = 400;
    throw err;
  }

  const { rows: existingSourceRows } = await client.query(
    `
    SELECT id
    FROM crop_assignments
    WHERE source_planning_id = $1
      AND company_id = $2
    LIMIT 1;
    `,
    [planning.id, companyId]
  );

  if (existingSourceRows.length) {
    return {
      already_applied: true,
      message: 'Esta siembra ya fue registrada en el estado productivo.',
      assignments_created: 0,
      closed_previous_cycles: 0,
      usage_records_created: 0,
    };
  }

  if (planning.status === 'completado') {
    const err = new Error('Esta siembra ya está completada. Registrá el cultivo manualmente si corresponde corregir el historial.');
    err.status = 409;
    throw err;
  }

  if (!planning.crop_id) {
    const err = new Error('La siembra debe tener un cultivo seleccionado.');
    err.status = 400;
    throw err;
  }

  if (!planning.campaign_id) {
    const err = new Error('La siembra debe tener una campaña seleccionada.');
    err.status = 400;
    throw err;
  }

  await assertSowingDateMatchesCampaign(client, planning.campaign_id, companyId, effectiveDate);

  const selections = await getPlanningSelectionsForUsage(client, planning.id, companyId);
  if (!selections.length) {
    const err = new Error('La siembra debe tener al menos un lote o sublote seleccionado.');
    err.status = 400;
    throw err;
  }

  const assignmentResult = historical
    ? await completeHistoricalSowingAssignments(client, planning, selections, companyId, effectiveDate)
    : await completeNormalSowingAssignments(client, planning, selections, companyId, effectiveDate);

  const plannedProducts = await getPlanningProductsForUsage(client, planning.id, companyId);
  const productUsage = await applyPlanningProductUsage(client, {
    planning,
    selections,
    plannedProducts,
    actualProducts,
    effectiveDate,
    companyId,
    historicalStockConsumption: registeredRetroactively,
  });

  await markPlanningCompleted(client, {
    planningId: planning.id,
    companyId,
    effectiveDate,
    registeredRetroactively,
  });

  return {
    ...assignmentResult,
    usage_records_created: productUsage.usage_count,
    planned_products_count: plannedProducts.length,
    selections,
  };
};

const completeWorkPlanning = async (
  client,
  planning,
  {
    actualProducts = [],
    effectiveDate,
    companyId,
    registeredRetroactively = false,
  }
) => {
  if (!PRODUCT_CONSUMING_ACTIVITIES.has(planning.activity_type) || planning.activity_type === 'siembra') {
    const err = new Error('Esta acción no corresponde a la actividad seleccionada.');
    err.status = 400;
    throw err;
  }

  if (planning.status === 'cancelado' || planning.enabled === false) {
    const err = new Error('No se puede completar una planificación cancelada.');
    err.status = 400;
    throw err;
  }

  const hasNoCompletions = await assertNoPlanningProductCompletions(client, planning.id, companyId);
  if (!hasNoCompletions) {
    return {
      already_applied: true,
      message: 'Esta planificación ya registró sus consumos.',
      usage_records_created: 0,
    };
  }

  if (planning.status === 'completado') {
    const err = new Error('Esta planificación ya está completada.');
    err.status = 409;
    throw err;
  }

  if (!planning.campaign_id) {
    const err = new Error('La planificación debe tener una campaña seleccionada.');
    err.status = 400;
    throw err;
  }

  await assertWorkDateMatchesCampaign(client, planning.campaign_id, companyId, effectiveDate);

  const selections = await getPlanningSelectionsForUsage(client, planning.id, companyId);
  if (!selections.length) {
    const err = new Error('La planificación debe tener al menos un lote o sublote seleccionado.');
    err.status = 400;
    throw err;
  }

  const plannedProducts = await getPlanningProductsForUsage(client, planning.id, companyId);
  const productUsage = await applyPlanningProductUsage(client, {
    planning,
    selections,
    plannedProducts,
    actualProducts,
    effectiveDate,
    companyId,
    historicalStockConsumption: registeredRetroactively,
  });

  await markPlanningCompleted(client, {
    planningId: planning.id,
    companyId,
    effectiveDate,
    registeredRetroactively,
  });

  return {
    usage_records_created: productUsage.usage_count,
    planned_products_count: plannedProducts.length,
    selections,
  };
};

const completeActivityWithoutProductiveEffects = async (
  client,
  planning,
  {
    effectiveDate,
    companyId,
    registeredRetroactively = false,
  }
) => {
  if (planning.status === 'cancelado' || planning.enabled === false) {
    const err = new Error('No se puede completar una planificación cancelada.');
    err.status = 400;
    throw err;
  }

  if (planning.status === 'completado') {
    const err = new Error('Esta planificación ya está completada.');
    err.status = 409;
    throw err;
  }

  if (planning.campaign_id) {
    await assertWorkDateMatchesCampaign(client, planning.campaign_id, companyId, effectiveDate);
  }

  await markPlanningCompleted(client, {
    planningId: planning.id,
    companyId,
    effectiveDate,
    registeredRetroactively,
  });

  return {
    usage_records_created: 0,
    assignments_created: 0,
    closed_previous_cycles: 0,
    planned_products_count: 0,
    selections: [],
  };
};

module.exports = {
  PRODUCT_CONSUMING_ACTIVITIES,
  getEffectiveWorkDate,
  getEffectiveSowingDate,
  getPlanningForCompletion,
  completeWorkPlanning,
  completeSowingPlanning,
  completeActivityWithoutProductiveEffects,
  applyPlanningProductUsage,
};
