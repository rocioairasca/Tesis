const fs = require('fs');
const path = require('path');
const { pool } = require('../db/supabaseClient');

async function runMigration() {
    const migrationPath = path.join(__dirname, '../migrations/create_companies_and_invitations.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running migration...');
    try {
        // Split by semicolon to run statements individually if needed, 
        // but postgres.js might handle multiple statements if enabled. 
        // For safety with simple drivers, running the whole block is usually fine if it's DDL.
        // However, postgres.js `unsafe` might support it.

        await pool.query(sql);
        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        // pool.end() might be needed if the script hangs, 
        // but pool definition in supabaseClient.js wraps sql.end()
        if (pool.end) await pool.end();
        process.exit();
    }
}

runMigration();
