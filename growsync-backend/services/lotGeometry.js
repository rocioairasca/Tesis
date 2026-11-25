const { lotPolygon, MESSAGE } = require('../validations/lotLocation');
const invalid = () => Object.assign(new Error(MESSAGE), { status: 400 });
const projection = `id,name,area,area_ha,location,enabled,created_at,
  ST_AsGeoJSON(geom)::json AS geom`;

// One transaction: validate the exact geometry, write it and verify the stored invariant.
// The legacy area column remains synchronized for older consumers; client area is ignored.
async function saveLot(pool, { companyId, id, name, location }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let current;
    if (id) {
      current = (await client.query('SELECT id, geom FROM lots WHERE id=$1 AND company_id=$2 FOR UPDATE', [id, companyId])).rows[0];
      if (!current) throw Object.assign(new Error('Lote no encontrado'), { status: 404 });
    }
    let geometry, area;
    if (location !== undefined) {
      const polygon = lotPolygon(location);
      if (!polygon) throw invalid();
      const parsed = (await client.query(`WITH parsed AS (
        SELECT gs_polygon_from_location_text($1) AS geom
      ) SELECT geom, CASE WHEN geom IS NOT NULL AND ST_GeometryType(geom)='ST_Polygon'
        AND NOT ST_IsEmpty(geom) AND ST_IsValid(geom) AND ST_SRID(geom)=4326
        THEN ROUND((ST_Area(geom::geography)/10000)::numeric,4) END AS area
        FROM parsed`, [JSON.stringify(polygon)])).rows[0];
      if (!parsed?.geom || !(Number(parsed.area) > 0)) throw invalid();
      geometry = parsed.geom;
      area = parsed.area;
    } else if (!current?.geom) throw invalid();

    let lotId = id;
    if (!id) {
      lotId = (await client.query(`INSERT INTO lots (name,area,location,geom,company_id)
        VALUES ($1,$2,$3,$4,$5) RETURNING id`, [name, area, typeof location === 'string' ? location : JSON.stringify(location), geometry, companyId])).rows[0].id;
    } else if (geometry) {
      // Set geom explicitly: the existing trigger only parses location when geom is NULL.
      await client.query(`UPDATE lots SET name=COALESCE($3,name),area=$4,location=$5,geom=$6
        WHERE id=$1 AND company_id=$2`, [id, companyId, name ?? null, area, typeof location === 'string' ? location : JSON.stringify(location), geometry]);
    } else {
      await client.query('UPDATE lots SET name=COALESCE($3,name) WHERE id=$1 AND company_id=$2', [id, companyId, name ?? null]);
    }
    const lot = (await client.query(`SELECT ${projection},
      COALESCE(ST_IsValid(geom) AND NOT ST_IsEmpty(geom) AND area_ha > 0, false) AS spatial_valid
      FROM lots WHERE id=$1 AND company_id=$2`, [lotId, companyId])).rows[0];
    if (!lot?.geom || !lot.spatial_valid) throw invalid();
    await client.query('COMMIT');
    // Match the numeric JSON representation of the previous Supabase writes.
    return { ...lot, area: Number(lot.area), area_ha: Number(lot.area_ha) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
module.exports = { saveLot };
