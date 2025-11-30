/**
 * Simplified Seed Script: Create Two Test Companies
 * 
 * This version creates companies and database users directly,
 * without creating Auth0 users (you'll need to register them manually via the app)
 */

require('dotenv').config();
const { pool } = require('../db/supabaseClient');

// Test data configuration
const COMPANIES = [
    {
        name: 'Empresa A - Agrícola del Norte',
        products: [
            { name: 'Fertilizante NPK', unit: 'kg', quantity: 500 },
            { name: 'Herbicida Glifosato', unit: 'L', quantity: 200 },
            { name: 'Semillas de Maíz', unit: 'kg', quantity: 1000 }
        ],
        lots: [
            { name: 'Lote Norte 1', area: 10.5 },
            { name: 'Lote Norte 2', area: 8.3 }
        ]
    },
    {
        name: 'Empresa B - Agrícola del Sur',
        products: [
            { name: 'Abono Orgánico', unit: 'kg', quantity: 800 },
            { name: 'Insecticida Natural', unit: 'L', quantity: 150 },
            { name: 'Semillas de Trigo', unit: 'kg', quantity: 1200 }
        ],
        lots: [
            { name: 'Lote Sur 1', area: 12.0 },
            { name: 'Lote Sur 2', area: 9.5 }
        ]
    }
];

// Main seed function
async function seed() {
    console.log('\n🌱 Seeding Multi-tenancy Test Data (Simplified)\n');
    console.log('='.repeat(60));

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const companyIds = [];

        for (const companyData of COMPANIES) {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`\n🏢 Creating: ${companyData.name}`);
            console.log('-'.repeat(60));

            // 1. Create company
            console.log('\n📝 Step 1: Creating company...');
            const { rows: [company] } = await client.query(
                'INSERT INTO companies (name) VALUES ($1) RETURNING id, name',
                [companyData.name]
            );
            console.log(`✓ Company created: ${company.name} (${company.id})`);
            companyIds.push(company.id);

            // 2. Create products
            console.log('\n📝 Step 2: Creating products...');
            for (const productData of companyData.products) {
                const { rows: [product] } = await client.query(
                    `INSERT INTO products (name, unit, available_quantity, company_id, enabled)
           VALUES ($1, $2, $3, $4, true)
           RETURNING id, name`,
                    [productData.name, productData.unit, productData.quantity, company.id]
                );
                console.log(`   ✓ Product: ${product.name}`);
            }

            // 3. Create lots
            console.log('\n📝 Step 3: Creating lots...');
            for (const lotData of companyData.lots) {
                const { rows: [lot] } = await client.query(
                    `INSERT INTO lots (name, area, company_id, enabled)
           VALUES ($1, $2, $3, true)
           RETURNING id, name`,
                    [lotData.name, lotData.area, company.id]
                );
                console.log(`   ✓ Lot: ${lot.name} (${lot.area} ha)`);
            }

            console.log(`\n✅ ${companyData.name} setup complete!`);
        }

        await client.query('COMMIT');

        console.log('\n' + '='.repeat(60));
        console.log('\n🎉 Seed completed successfully!\n');
        console.log('📋 Next Steps:');
        console.log('-'.repeat(60));
        console.log('1. Register two users via the app registration form');
        console.log('2. Assign them to companies in the database:');
        console.log('');
        console.log(`   UPDATE users SET company_id = '${companyIds[0]}' WHERE email = 'user-a@example.com';`);
        console.log(`   UPDATE users SET company_id = '${companyIds[1]}' WHERE email = 'user-b@example.com';`);
        console.log('');
        console.log('3. Login with each user and verify data isolation');
        console.log('');
        console.log('💡 Company IDs created:');
        console.log(`   Empresa A: ${companyIds[0]}`);
        console.log(`   Empresa B: ${companyIds[1]}`);
        console.log('');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n❌ Seed failed:', error);
        throw error;
    } finally {
        client.release();
        process.exit(0);
    }
}

// Cleanup function
async function cleanup() {
    console.log('\n🧹 Cleaning up test data...\n');

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Delete test companies and cascade will handle the rest
        const { rowCount } = await client.query(
            `DELETE FROM companies 
       WHERE name LIKE 'Empresa A%' OR name LIKE 'Empresa B%'`
        );

        await client.query('COMMIT');

        console.log(`✓ Deleted ${rowCount} test companies and related data\n`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Cleanup failed:', error);
    } finally {
        client.release();
        process.exit(0);
    }
}

// Check command line arguments
const args = process.argv.slice(2);

if (args.includes('--cleanup')) {
    cleanup();
} else {
    seed();
}
