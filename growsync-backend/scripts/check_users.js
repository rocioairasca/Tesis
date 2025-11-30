// Quick script to check users and assign them to companies
const { pool } = require('../db/supabaseClient');

async function checkUsers() {
    const client = await pool.connect();
    try {
        // Get users
        const { rows: users } = await client.query(
            'SELECT id, email, name, company_id FROM users ORDER BY created_at DESC LIMIT 10'
        );

        console.log('\n📋 Current Users:');
        console.log('='.repeat(80));
        users.forEach((user, i) => {
            console.log(`${i + 1}. ${user.email}`);
            console.log(`   Name: ${user.name || 'N/A'}`);
            console.log(`   Company: ${user.company_id || 'NOT ASSIGNED'}`);
            console.log(`   ID: ${user.id}`);
            console.log('');
        });

        // Get companies
        const { rows: companies } = await client.query(
            'SELECT id, name FROM companies ORDER BY created_at DESC LIMIT 5'
        );

        console.log('\n🏢 Available Companies:');
        console.log('='.repeat(80));
        companies.forEach((company, i) => {
            console.log(`${i + 1}. ${company.name}`);
            console.log(`   ID: ${company.id}`);
            console.log('');
        });

    } catch (error) {
        console.error('Error:', error);
    } finally {
        client.release();
        process.exit(0);
    }
}

checkUsers();
