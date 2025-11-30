// Delete or assign users without company_id
const { pool } = require('../db/supabaseClient');

async function cleanupUsers() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('\n🧹 Cleaning up users without company_id...\n');

        // Delete test users without company_id
        const { rowCount } = await client.query(
            `DELETE FROM users 
       WHERE company_id IS NULL 
       AND (email LIKE 'fail%' OR email LIKE 'testuser_%')`
        );

        await client.query('COMMIT');

        console.log(`✅ Deleted ${rowCount} test users without company_id`);
        console.log('\n💡 Now only users with company_id should be visible.');
        console.log('   Refresh your app and check the users list.\n');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error:', error.message);
    } finally {
        client.release();
        process.exit(0);
    }
}

cleanupUsers();
