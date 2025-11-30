// Check which users belong to which company
const { pool } = require('../db/supabaseClient');

async function checkUserCompanies() {
    const client = await pool.connect();
    try {
        // Get Empresa A ID
        const { rows: [empresaA] } = await client.query(
            "SELECT id, name FROM companies WHERE name LIKE 'Empresa A%' LIMIT 1"
        );

        console.log('\n🏢 Empresa A:');
        console.log(`   ID: ${empresaA.id}`);
        console.log(`   Name: ${empresaA.name}`);

        // Get users for Empresa A
        const { rows: usersA } = await client.query(
            'SELECT id, email, name, role FROM users WHERE company_id = $1',
            [empresaA.id]
        );

        console.log(`\n👥 Users in Empresa A: ${usersA.length}`);
        usersA.forEach(u => {
            console.log(`   - ${u.email} (${u.name || 'No name'})`);
        });

        // Get users WITHOUT company_id
        const { rows: usersNoCompany } = await client.query(
            'SELECT id, email, name FROM users WHERE company_id IS NULL'
        );

        console.log(`\n⚠️  Users WITHOUT company_id: ${usersNoCompany.length}`);
        if (usersNoCompany.length > 0) {
            usersNoCompany.forEach(u => {
                console.log(`   - ${u.email} (${u.name || 'No name'})`);
            });
            console.log('\n💡 These users will appear for everyone! They need company_id assigned.');
        }

        // Get total users
        const { rows: [{ count }] } = await client.query(
            'SELECT COUNT(*)::int as count FROM users'
        );

        console.log(`\n📊 Total users in database: ${count}`);
        console.log(`   - With company_id: ${count - usersNoCompany.length}`);
        console.log(`   - Without company_id: ${usersNoCompany.length}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        client.release();
        process.exit(0);
    }
}

checkUserCompanies();
