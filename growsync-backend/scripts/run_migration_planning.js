const fs = require('fs');
const path = require('path');
const { pool } = require('../db/supabaseClient');

async function runMigration() {
    const migrationPath = path.join(__dirname, '../migrations/add_company_id_to_planning_usage.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running migration (add_company_id_to_planning_usage)...');
    try {
        await pool.query(sql);
        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        if (pool.end) await pool.end();
        process.exit();
    }
}

runMigration();
