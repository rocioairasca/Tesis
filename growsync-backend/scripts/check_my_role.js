const { pool } = require('../db/supabaseClient');

async function checkUserRole() {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT id, email, role, company_id FROM users WHERE email = $1`,
            ['rocio@mail.com']
        );

        if (result.rows.length > 0) {
            const user = result.rows[0];
            console.log('\n👤 Usuario: rocio@mail.com');
            console.log('   ID:', user.id);
            console.log('   Role:', user.role);
            console.log('   Company ID:', user.company_id);
            console.log('\n📋 Roles:');
            console.log('   0 = Empleado');
            console.log('   1 = Supervisor');
            console.log('   2 = Dueño de Campo');
            console.log('   3 = Admin');
        } else {
            console.log('❌ Usuario no encontrado');
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        client.release();
        process.exit(0);
    }
}

checkUserRole();
