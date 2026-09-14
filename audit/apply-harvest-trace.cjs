const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.chdir(path.resolve(__dirname, '../growsync-backend'));
const { pool } = require('../growsync-backend/db/supabaseClient');
const migrationPath = path.resolve('migrations/20260909_harvest_registration_trace.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const fields = ['registered_retroactively','retroactive_reason','retroactive_notes','registration_timezone'];
const tables = ['harvest_records','harvest_crop_assignments','crop_assignments','harvest_cycle_closures','lots','sub_lots'];
const file = path.join(__dirname, `harvest-trace-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
async function main() {
  const c = await pool.connect();
  const report = { migration: migrationPath, sha256: crypto.createHash('sha256').update(migration).digest('hex'), started_at: new Date().toISOString() };
  const save = () => fs.writeFileSync(file, JSON.stringify(report,null,2));
  const snapshot = async () => {
    const result = {};
    for (const table of tables) {
      const expr = table === 'harvest_records' ? "to_jsonb(t)-ARRAY['registered_retroactively','retroactive_reason','retroactive_notes','registration_timezone']" : 'to_jsonb(t)';
      result[table] = (await c.query(`SELECT count(*)::int count, md5(COALESCE(string_agg(md5((${expr})::text),'' ORDER BY md5((${expr})::text)),'')) fingerprint FROM ${table} t`)).rows[0];
    }
    return result;
  };
  const columns = async () => (await c.query(`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='harvest_records' AND column_name=ANY($1::text[]) ORDER BY column_name`,[fields])).rows;
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    report.columns_before = await columns();
    report.before = await snapshot();
    report.existing_ids = (await c.query('SELECT id FROM harvest_records ORDER BY id')).rows.map(r=>r.id);
    await c.query('COMMIT');
    save();
    assert.ok(report.columns_before.length === 0 || report.columns_before.length === 4, 'Partial schema: stop without changes');
    if (report.columns_before.length === 0) {
      // Exact authorized file, including its own BEGIN/COMMIT; no other migration or DML.
      await c.query(migration);
      report.migration = 'applied';
    } else report.migration = 'already present; not executed again';
    save();
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    report.columns_after = await columns();
    report.constraints = (await c.query(`SELECT conname,convalidated,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='public.harvest_records'::regclass AND conname IN ('harvest_registration_trace_check','harvest_retroactive_notes_length') ORDER BY conname`)).rows;
    report.after = await snapshot();
    report.legacy = (await c.query(`SELECT count(*)::int existing_count, count(*) FILTER (WHERE registered_retroactively IS NULL AND retroactive_reason IS NULL AND retroactive_notes IS NULL AND registration_timezone IS NULL)::int all_trace_null FROM harvest_records WHERE id=ANY($1::uuid[])`,[report.existing_ids])).rows[0];
    await c.query('COMMIT');
    assert.deepEqual(report.after, report.before, 'Existing data changed');
    assert.equal(report.columns_after.length,4);
    assert.ok(report.columns_after.every(c=>c.is_nullable==='YES' && c.column_default===null));
    assert.equal(report.constraints.length,2);
    assert.ok(report.constraints.every(c=>c.convalidated));
    if (!report.columns_before.length) assert.equal(report.legacy.all_trace_null,report.existing_ids.length);
    report.result = 'OK'; save();
    console.log(JSON.stringify({...report, existing_ids: undefined, audit_file:file},null,2));
  } catch(e) {
    await c.query('ROLLBACK').catch(()=>{});
    report.error = {code:e.code,message:e.message}; save();
    console.error(JSON.stringify({migration:report.migration,error:report.error,audit_file:file}));process.exitCode=1;
  } finally {c.release();}
}
main().finally(()=>pool.end());
