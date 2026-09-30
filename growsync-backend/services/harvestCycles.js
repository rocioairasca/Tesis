const { areaCents, areaValue, fail, dateKey, cycleBalance } = require('./harvestAreas');
const { isHistorical } = require('./inventoryImpact');

async function lockAssignments(client, companyId, ids) {
  const unique = [...new Set(ids)].sort();
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || lot_id::text, 0))
    FROM (SELECT DISTINCT lot_id FROM crop_assignments WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY lot_id) scoped`, [companyId, unique]);
  const { rows } = await client.query(`SELECT * FROM crop_assignments
    WHERE company_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [companyId, unique]);
  if (!unique.length || rows.length !== unique.length) throw fail('Ciclo productivo no encontrado.', 404);
  if (rows.some(isHistorical)) throw fail('Los ciclos históricos requieren una corrección histórica explícita.',409);
  return rows;
}

async function ledger(client, companyId, assignmentId, excludeHarvestId = null) {
  const { rows } = await client.query(`SELECT hca.harvested_area_ha, hr.harvest_date, hr.enabled
    FROM harvest_crop_assignments hca JOIN harvest_records hr ON hr.id = hca.harvest_id
    WHERE hca.crop_assignment_id = $1 AND hr.company_id = $2
      AND ($3::uuid IS NULL OR hr.id <> $3)`, [assignmentId, companyId, excludeHarvestId]);
  return rows;
}

async function balances(client, companyId, assignments, excludeHarvestId = null) {
  const result = [];
  for (const assignment of assignments) {
    const balance = cycleBalance(assignment.area_ha, await ledger(client, companyId, assignment.id, excludeHarvestId));
    result.push({ ...assignment, total_area_ha: areaValue(balance.total),
      harvested_area_ha: areaValue(balance.harvested), remaining_area_ha: areaValue(balance.remaining) });
  }
  return result;
}

function allocate(assignments, area, requested) {
  const total = areaCents(area);
  if (total <= 0) throw fail('La superficie de esta jornada debe ser mayor a cero.');
  let allocations = requested;
  if (!allocations && assignments.length === 1) {
    allocations = [{ crop_assignment_id: assignments[0].id, harvested_area_ha: areaValue(total) }];
  }
  if (!allocations && assignments.reduce((sum, a) => sum + areaCents(a.remaining_area_ha), 0) === total) {
    allocations = assignments.filter((a) => areaCents(a.remaining_area_ha) > 0)
      .map((a) => ({ crop_assignment_id: a.id, harvested_area_ha: a.remaining_area_ha }));
  }
  if (!Array.isArray(allocations) || !allocations.length) {
    throw fail('La jornada cubre varios ciclos. Indicá las hectáreas de cada ciclo o registrá cada sublote por separado.');
  }
  const seen = new Set();
  let sum = 0;
  const result = allocations.map((item) => {
    const assignment = assignments.find((a) => a.id === item.crop_assignment_id);
    if (!assignment || seen.has(assignment.id)) throw fail('El reparto contiene ciclos incompatibles o repetidos.');
    seen.add(assignment.id);
    if (assignment.harvest_closure_source === 'legacy') throw fail('Este ciclo tiene un cierre legacy. Requiere conciliación antes de registrar más cosechas.', 409);
    if (assignment.harvest_closure_source === 'manual') throw fail('El ciclo ya fue finalizado explícitamente.', 409);
    const cents = areaCents(item.harvested_area_ha);
    if (!cents || cents > areaCents(assignment.remaining_area_ha)) throw fail('La superficie de esta jornada supera la superficie pendiente del ciclo.', 409);
    sum += cents;
    return { crop_assignment_id: assignment.id, harvested_area_ha: areaValue(cents) };
  });
  if (sum !== total) throw fail('La suma de hectáreas por ciclo debe coincidir con la superficie de la jornada.');
  return result;
}

async function assertNoReopeningConflict(client, companyId, assignment, endDate) {
  const { rows } = await client.query(`SELECT other.id FROM crop_assignments other
    JOIN lots l ON l.id = other.lot_id AND l.company_id = other.company_id
    LEFT JOIN sub_lots sl ON sl.id = other.sub_lot_id
    LEFT JOIN sub_lots selected ON selected.id = $4::uuid
    WHERE other.company_id = $1 AND other.lot_id = $2 AND other.id <> $3
      AND daterange(other.start_date, COALESCE(other.end_date, 'infinity'::date), '[]')
        && daterange($5::date, COALESCE($6::date, 'infinity'::date), '[]')
      AND (other.sub_lot_id IS NULL OR $4::uuid IS NULL OR other.sub_lot_id = $4
        OR ST_Area(ST_CollectionExtract(ST_Intersection(
          ST_CollectionExtract(ST_MakeValid(sl.geom), 3),
          ST_CollectionExtract(ST_MakeValid(selected.geom), 3)), 3)::geography) > 1)
    LIMIT 1`, [companyId, assignment.lot_id, assignment.id, assignment.sub_lot_id, dateKey(assignment.start_date), endDate]);
  if (rows.length) throw fail('La operación reabriría o extendería el ciclo y se superpone con otro ciclo productivo. Corregí primero el conflicto.', 409);
}

async function recalculate(client, companyId, assignments) {
  await client.query("SELECT set_config('growsync.harvest_cycle_write', 'on', true)");
  for (const assignment of assignments) {
    // Historical and explicit closures are not inferred from current totals.
    if (isHistorical(assignment)) continue;
    if (assignment.harvest_closure_source === 'legacy') continue;
    const balance = cycleBalance(assignment.area_ha, await ledger(client, companyId, assignment.id));
    if (balance.remaining < 0) throw fail('La superficie acumulada supera la superficie del ciclo.', 409);
    if (assignment.harvest_closure_source === 'manual') continue;
    const oldEnd = assignment.end_date && dateKey(assignment.end_date);
    if (oldEnd && (!balance.endDate || balance.endDate > oldEnd)) {
      await assertNoReopeningConflict(client, companyId, assignment, balance.endDate);
    }
    await client.query(`UPDATE crop_assignments SET end_date = $1, harvest_closure_source = $2
      WHERE id = $3 AND company_id = $4`, [balance.endDate, balance.endDate ? 'automatic' : null, assignment.id, companyId]);
  }
}

module.exports = { lockAssignments, ledger, balances, allocate, recalculate, assertNoReopeningConflict };
