const { pool } = require('../db/supabaseClient');

async function listTables() {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);

        console.log('\n📋 Tablas en la base de datos:\n');
        result.rows.forEach(row => {
            console.log(`  - ${row.table_name}`);
        });
        console.log('');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        client.release();
        process.exit(0);
    }
}

listTables();
