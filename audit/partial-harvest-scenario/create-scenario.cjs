// One-off, explicitly authorized fixture. No harvests, updates, migrations or cleanup.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
process.chdir(path.resolve(__dirname, '../../growsync-backend'));
const { pool } = require('../../growsync-backend/db/supabaseClient');
const company = '2601c129-efd5-484d-bee5-d7a6e82dc249';
const manifestPath = path.join(__dirname, 'manifest.json');
const qi = value => '"' + value.replaceAll('"', '""') + '"';
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function main() {
  assert(!fs.existsSync(manifestPath), 'Manifest already exists: inspect it; never repeat creation blindly.');
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query("SET LOCAL statement_timeout = '30s'");
    const one = async (query, params = []) => (await client.query(query, params)).rows[0];
    assert((await one('SELECT name FROM companies WHERE id=$1', [company]))?.name === 'GrowSync Demo', 'Company mismatch');
    const dates = await one(`SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text AS today,
      ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date-4)::text AS start,
      ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date-5)::text AS campaign_start,
      ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date-3)::text AS reference`);
    const testId = dates.today.replaceAll('-', '') + '-' + randomUUID().slice(0, 6).toUpperCase();
    const name = `TEST TEMP — Cosechas parciales — ${testId}`;
    const cropName = `TEST TEMP — Cultivo cosechas parciales — ${testId}`;
    const ids = { lot_id: randomUUID(), crop_id: randomUUID(), campaign_id: randomUUID(), crop_assignment_id: randomUUID() };
    for (const table of ['lots', 'crops', 'campaigns']) {
      assert(Number((await one(`SELECT count(*) n FROM ${table} WHERE name LIKE $1`, [`%${testId}%`])).n) === 0, 'Name collision');
    }
    // Synthetic square in Argentina, iteratively sized using the same geography area as the trigger.
    let delta = 0.007;
    let geom;
    for (let iteration = 0; iteration < 6; iteration++) {
      geom = await one(`WITH g AS (SELECT ST_MakeEnvelope(-64,-34,-64+$1::float8,-34+$1::float8,4326) geom)
        SELECT ST_AsGeoJSON(geom,15)::json AS geojson, ST_Area(geom::geography)/10000 AS area,
        ST_IsValid(geom) AS valid FROM g`, [delta]);
      delta *= Math.sqrt(48.03 / Number(geom.area));
    }
    assert(geom.valid && Math.abs(Number(geom.area) - 48.03) < 0.000001, 'Geometry area mismatch');
    const separation = await one(`WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1),4326) geom), existing AS (
      SELECT COALESCE(geom,gs_polygon_from_location_text(location::text)) geom FROM lots)
      SELECT count(*) FILTER (WHERE ST_Intersects(e.geom,g.geom))::int AS overlaps,
      min(ST_Distance(e.geom::geography,g.geom::geography)) AS nearest_meters,
      count(*) FILTER (WHERE e.geom IS NULL)::int AS missing_geometries FROM existing e CROSS JOIN g`, [JSON.stringify(geom.geojson)]);
    console.log('Geometry separation:', JSON.stringify(separation));
    assert(separation.overlaps === 0 && Number(separation.nearest_meters) > 1000, 'Cannot establish geometric isolation');
    separation.missing_geometry_summary = (await client.query(`SELECT company_id=$1::uuid AS current_company,enabled,count(*)::int count
      FROM lots WHERE COALESCE(geom,gs_polygon_from_location_text(location::text)) IS NULL GROUP BY 1,2`, [company])).rows;
    separation.limitation = 'No overlap with any existing available geometry; three lots have no usable geometry (two disabled in this company, one in another company). Their geographic overlap cannot be evaluated.';
    const tables = (await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND
      (table_name IN ('lots','crops','campaigns','crop_assignments','companies','harvest_records','harvest_crop_assignments','harvest_cycle_closures','planning','plans','planning_lots','usage_records','usage_lots','lot_layouts','sub_lots') OR table_name LIKE '%product%' OR table_name LIKE '%inventory%') ORDER BY table_name`)).rows.map(r => r.table_name);
    const fingerprints = async () => {
      const result = {};
      for (const table of tables) {
        const id = { lots: ids.lot_id, crops: ids.crop_id, campaigns: ids.campaign_id, crop_assignments: ids.crop_assignment_id }[table];
        result[table] = await one(`SELECT count(*)::int n,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) hash FROM public.${qi(table)} t ${id ? 'WHERE id<>$1' : ''}`, id ? [id] : []);
      }
      return result;
    };
    const before = await fingerprints();
    const manifest = { test_id: testId, company_id: company, ...ids, names: { lot: name, crop: cropName, campaign: name },
      created_at: null, purpose: 'Prueba funcional de cosechas parciales', temporary: true, start_date: dates.start,
      campaign_start_date: dates.campaign_start, area_ha: 48.03, geometry: geom.geojson, separation,
      planned_harvests_only: [20,20,8.03], status: 'prepared', before,
      cleanup: [
        'No cleanup is authorized or executed by this file. Obtain explicit approval after the UI test.',
        'Use exact IDs and company_id from this manifest; never delete by name pattern or company.',
        'Read all incoming foreign keys and references again; inventory every harvest linked to this assignment OR temporary lot/crop/campaign, including disabled rows.',
        'Confirm each dependent record belongs exclusively to this test; stop if any productive or shared dependency exists. Back up the exact rows first.',
        'In one transaction, remove only approved test closure records and harvest-assignment links, then test harvest records; respect current trigger rules without disabling integrity constraints.',
        'Delete the temporary crop_assignment, then temporary lot, crop and campaign by exact IDs and company. Do not delete the company.',
        'No Planning, uses, sublots, products or inventories were created. Unexpected references require review, not cascade cleanup.',
        'Verify no references or test records remain and unrelated row fingerprints/counts remain unchanged. Retain this manifest and cleanup audit.'
      ] };
    if (!process.argv.includes('--create')) {
      console.log(JSON.stringify({ mode: 'read-only preflight; transaction will roll back', testId, dates, geom, separation, before }, null, 2));
      await client.query('ROLLBACK');
      return;
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
    const location = [geom.geojson.coordinates[0].map(([lng,lat]) => ({lat,lng}))];
    const lot = await one(`INSERT INTO lots(id,company_id,name,enabled,area,location,geom)
      VALUES($1,$2,$3,true,48.03,$4::jsonb,ST_SetSRID(ST_GeomFromGeoJSON($5),4326)) RETURNING id,area,area_ha,enabled`,
      [ids.lot_id, company, name, JSON.stringify(location), JSON.stringify(geom.geojson)]);
    assert(Number(lot.area) === 48.03 && Number(lot.area_ha) === 48.03, 'Lot trigger area mismatch');
    await client.query('INSERT INTO crops(id,company_id,name,enabled) VALUES($1,$2,$3,true)', [ids.crop_id,company,cropName]);
    await client.query(`INSERT INTO campaigns(id,company_id,name,start_date,end_date,status,work_start_date)
      VALUES($1,$2,$3,$4,NULL,'active',NULL)`, [ids.campaign_id,company,name,dates.campaign_start]);
    const assignment = await one(`INSERT INTO crop_assignments(id,company_id,lot_id,crop_id,campaign_id,start_date,area_ha,sub_lot_id,end_date,source_planning_id,harvest_closure_source)
      VALUES($1,$2,$3,$4,$5,$6,48.03,NULL,NULL,NULL,NULL) RETURNING *,created_at::text AS creation_timestamp`,
      [ids.crop_assignment_id,company,ids.lot_id,ids.crop_id,ids.campaign_id,dates.start]);
    assert(Number(assignment.area_ha) === 48.03 && assignment.end_date === null, 'Assignment mismatch');
    const after = await fingerprints();
    assert(JSON.stringify(before) === JSON.stringify(after), 'Unrelated records changed: rollback required');
    // All incoming single-column foreign keys: only the three intended assignment relationships may exist.
    const fks = (await client.query(`SELECT c.conname,ns.nspname schema,cl.relname tbl,a.attname col,target.relname target
      FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace
      JOIN pg_class target ON target.oid=c.confrelid JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      WHERE c.contype='f' AND c.confrelid IN ('lots'::regclass,'crops'::regclass,'campaigns'::regclass,'crop_assignments'::regclass)
      AND array_length(c.conkey,1)=1`)).rows;
    const referenceCounts = [];
    for (const fk of fks) {
      const id = { lots: ids.lot_id,crops: ids.crop_id,campaigns: ids.campaign_id,crop_assignments: ids.crop_assignment_id }[fk.target];
      const { n } = await one(`SELECT count(*)::int n FROM ${qi(fk.schema)}.${qi(fk.tbl)} WHERE ${qi(fk.col)}=$1`, [id]);
      assert(n === (fk.tbl === 'crop_assignments' ? 1 : 0), `Unexpected reference ${fk.tbl}.${fk.col}`);
      referenceCounts.push({ table: fk.tbl,column: fk.col,count: n });
    }
    Object.assign(manifest, { status: 'verified_before_commit', created_at: assignment.creation_timestamp, verification: { lot, assignment, referenceCounts, unrelated_rows_unchanged: true, after } });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest,null,2));
    await client.query('COMMIT');
    committed = true;
    manifest.status = 'committed';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest,null,2));
    // Exercise the actual productive-state controller, read-only, on committed data.
    const { getLotProductiveState } = require('../../growsync-backend/controllers/lots/productiveState');
    let productiveState;
    await getLotProductiveState({user:{company_id:company},params:{lotId:ids.lot_id},query:{date:dates.reference}},
      {json: value => {productiveState=value;return value;},status: code => {throw new Error(`HTTP ${code}`);}}, error => {throw error;});
    assert(productiveState?.units?.length === 1 && productiveState.units[0].current_crop?.assignment_id === ids.crop_assignment_id, 'Productive-state lookup failed');
    manifest.verification.productive_state = productiveState;
    manifest.verification.reference_date = dates.reference;
    fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
    console.log(JSON.stringify({test_id:testId,...ids,start_date:dates.start,area_ha:48.03,status:manifest.status,referenceCounts,productiveState,manifestPath},null,2));
  } catch(error) {
    if (!committed) await client.query('ROLLBACK');
    console.error(JSON.stringify({code:error.code,message:error.message,committed,manifestPath}));
    process.exitCode=1;
  } finally {client.release();}
}
main().catch(e=>{console.error(e.code,e.message);process.exitCode=1;}).finally(()=>pool.end());
