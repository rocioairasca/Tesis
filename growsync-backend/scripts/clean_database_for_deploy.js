const { pool } = require('../db/supabaseClient');

/**
 * Script para limpiar la base de datos antes del deploy
 * Elimina todos los datos de prueba pero mantiene la estructura
 */

async function cleanDatabase() {
    const client = await pool.connect();

    console.log('\n🧹 Limpiando base de datos para deploy...\n');
    console.log('⚠️  ADVERTENCIA: Esto eliminará TODOS los datos de la base de datos!');
    console.log('⚠️  Asegúrate de estar en el ambiente correcto.\n');

    try {
        await client.query('BEGIN');

        // Orden de eliminación (respetando foreign keys)
        const tables = [
            'notifications',
            'planning_products',
            'planning_lots',
            'planning',
            'usage_lots',
            'usage_records',
            'vehicles',
            'lots',
            'products',
            'invitations',
            'users',
            'companies',
            'weather',
            'fuel',
            'plans'
        ];

        for (const table of tables) {
            const result = await client.query(`DELETE FROM ${table}`);
            console.log(`✓ Limpiada tabla: ${table} (${result.rowCount} filas eliminadas)`);
        }

        await client.query('COMMIT');

        console.log('\n✅ Base de datos limpiada exitosamente!');
        console.log('\n📋 Próximos pasos:');
        console.log('1. Crear tu primera empresa (se hará automáticamente al registrar el primer admin)');
        console.log('2. Registrar el primer usuario admin');
        console.log('3. Comenzar a usar la aplicación\n');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n❌ Error al limpiar la base de datos:', error);
        throw error;
    } finally {
        client.release();
        process.exit(0);
    }
}

// Confirmación antes de ejecutar
console.log('\n⚠️  CONFIRMACIÓN REQUERIDA ⚠️');
console.log('Este script eliminará TODOS los datos de la base de datos.');
console.log('Presiona Ctrl+C para cancelar, o espera 5 segundos para continuar...\n');

setTimeout(() => {
    cleanDatabase().catch(err => {
        console.error('Error fatal:', err);
        process.exit(1);
    });
}, 5000);
