const fs = require('fs');
const path = require('path');
const { pool } = require('../db/supabaseClient');

async function runMigration() {
  const migrationPath = path.join(__dirname, '../migrations/20260830_add_lot_layouts_sub_lots_postgis.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log('Running migration (20260830_add_lot_layouts_sub_lots_postgis)...');
  try {
    await pool.query(sql);
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    if (pool?.end) await pool.end();
  }
}

runMigration();
