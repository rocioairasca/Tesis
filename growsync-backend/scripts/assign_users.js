// Assign users to test companies
const { pool } = require('../db/supabaseClient');

async function assignUsers() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Assign rocio@mail.com to Empresa A
        await client.query(
            `UPDATE users 
       SET company_id = $1 
       WHERE email = $2`,
            ['89951a8e-6fef-46fe-8bab-b6403ca594f2', 'rocio@mail.com']
        );
        console.log('✓ Assigned rocio@mail.com to Empresa A');

        // Assign emiler_1799@hotmail.com to Empresa B
        await client.query(
            `UPDATE users 
       SET company_id = $1 
       WHERE email = $2`,
            ['e5825a49-25df-459c-9136-2ab25c217169', 'emiler_1799@hotmail.com']
        );
        console.log('✓ Assigned emiler_1799@hotmail.com to Empresa B');

        await client.query('COMMIT');

        console.log('\n✅ Users assigned successfully!');
        console.log('\n📋 Test Setup:');
        console.log('='.repeat(60));
        console.log('\nEmpresa A - Agrícola del Norte:');
        console.log('  User: rocio@mail.com');
        console.log('  Products: Fertilizante NPK, Herbicida Glifosato, Semillas de Maíz');
        console.log('\nEmpresa B - Agrícola del Sur:');
        console.log('  User: emiler_1799@hotmail.com');
        console.log('  Products: Abono Orgánico, Insecticida Natural, Semillas de Trigo');
        console.log('\n💡 Next: Login with either user and verify you only see your company\'s data!');
        console.log('');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error:', error);
    } finally {
        client.release();
        process.exit(0);
    }
}

assignUsers();
