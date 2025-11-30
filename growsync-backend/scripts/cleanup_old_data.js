// Cleanup old data - respecting foreign key constraints
const { pool } = require('../db/supabaseClient');

async function cleanup() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('\n🧹 Cleaning up old data without company_id...\n');
        console.log('='.repeat(80));

        // 1. Delete planning_products (references products and planning)
        const { rowCount: planningProductsCount } = await client.query(
            `DELETE FROM planning_products 
       WHERE planning_id IN (SELECT id FROM planning WHERE company_id IS NULL)`
        );
        console.log(`✓ Deleted ${planningProductsCount} planning_products`);

        // 2. Delete planning_lots (references planning and lots)
        const { rowCount: planningLotsCount } = await client.query(
            `DELETE FROM planning_lots 
       WHERE planning_id IN (SELECT id FROM planning WHERE company_id IS NULL)`
        );
        console.log(`✓ Deleted ${planningLotsCount} planning_lots`);

        // 3. Delete planning without company_id
        const { rowCount: planningCount } = await client.query(
            'DELETE FROM planning WHERE company_id IS NULL'
        );
        console.log(`✓ Deleted ${planningCount} planning records`);

        // 4. Delete vehicles without company_id
        const { rowCount: vehiclesCount } = await client.query(
            'DELETE FROM vehicles WHERE company_id IS NULL'
        );
        console.log(`✓ Deleted ${vehiclesCount} vehicles`);

        // 5. Delete lots without company_id
        const { rowCount: lotsCount } = await client.query(
            'DELETE FROM lots WHERE company_id IS NULL'
        );
        console.log(`✓ Deleted ${lotsCount} lots`);

        // 6. Delete products without company_id
        const { rowCount: productsCount } = await client.query(
            'DELETE FROM products WHERE company_id IS NULL'
        );
        console.log(`✓ Deleted ${productsCount} products`);

        await client.query('COMMIT');

        console.log('\n✅ Cleanup completed successfully!');
        console.log('\n📊 Summary:');
        console.log(`   - ${planningProductsCount} planning_products`);
        console.log(`   - ${planningLotsCount} planning_lots`);
        console.log(`   - ${planningCount} planning records`);
        console.log(`   - ${vehiclesCount} vehicles`);
        console.log(`   - ${lotsCount} lots`);
        console.log(`   - ${productsCount} products`);
        console.log('\n💡 Now only data with company_id should be visible.');
        console.log('   Refresh your app and login again with rocio@mail.com\n');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n❌ Error:', error.message);
        console.error('Details:', error);
    } finally {
        client.release();
        process.exit(0);
    }
}

cleanup();
