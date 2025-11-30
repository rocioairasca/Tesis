const { pool } = require('../db/supabaseClient');

async function describeTable() {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'companies'
            ORDER BY ordinal_position
        `);

        console.log('\n📋 Estructura de la tabla "companies":\n');
        result.rows.forEach(row => {
            console.log(`  - ${row.column_name} (${row.data_type}) ${row.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
        });
        console.log('');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        client.release();
        process.exit(0);
    }
}

describeTable();
