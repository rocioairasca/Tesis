/**
 * Script para crear el primer usuario Admin
 * Se usa SOLO una vez después de limpiar la base de datos
 */

const axios = require('axios');
const { pool } = require('../db/supabaseClient');
const crypto = require('crypto');

// Configuración del primer admin
const ADMIN_CONFIG = {
    email: 'admin@growsync.com',
    password: 'AdminGrowSync2024!',
    username: 'Admin Principal',
    companyName: 'GrowSync - Empresa Principal'
};

async function createFirstAdmin() {
    console.log('\n🚀 Creando primer usuario Admin...\n');
    console.log('📧 Email:', ADMIN_CONFIG.email);
    console.log('🏢 Empresa:', ADMIN_CONFIG.companyName);
    console.log('');

    const {
        AUTH0_DOMAIN,
        AUTH0_M2M_CLIENT_ID,
        AUTH0_M2M_CLIENT_SECRET
    } = process.env;

    if (!AUTH0_DOMAIN || !AUTH0_M2M_CLIENT_ID || !AUTH0_M2M_CLIENT_SECRET) {
        console.error('❌ Faltan variables de entorno de Auth0');
        process.exit(1);
    }

    const client = await pool.connect();
    let auth0UserId = null;

    try {
        await client.query('BEGIN');

        // 1. Crear empresa
        console.log('📝 Paso 1: Creando empresa...');
        const companyResult = await client.query(
            `INSERT INTO companies (name) VALUES ($1) RETURNING id`,
            [ADMIN_CONFIG.companyName]
        );
        const companyId = companyResult.rows[0].id;
        console.log(`✓ Empresa creada: ${companyId}`);

        // 2. Obtener token de Management API
        console.log('\n📝 Paso 2: Obteniendo token de Auth0...');
        const tokenUrl = `https://${AUTH0_DOMAIN}/oauth/token`;
        const tokenPayload = {
            grant_type: 'client_credentials',
            client_id: AUTH0_M2M_CLIENT_ID,
            client_secret: AUTH0_M2M_CLIENT_SECRET,
            audience: `https://${AUTH0_DOMAIN}/api/v2/`,
        };
        const tokenRes = await axios.post(tokenUrl, tokenPayload);
        const mgmtToken = tokenRes.data.access_token;
        console.log('✓ Token obtenido');

        // 3. Crear usuario en Auth0
        console.log('\n📝 Paso 3: Creando usuario en Auth0...');
        const createUrl = `https://${AUTH0_DOMAIN}/api/v2/users`;
        const createPayload = {
            email: ADMIN_CONFIG.email,
            password: ADMIN_CONFIG.password,
            connection: 'Username-Password-Authentication',
            user_metadata: { username: ADMIN_CONFIG.username },
            email_verified: true,
            verify_email: false,
        };
        const createRes = await axios.post(createUrl, createPayload, {
            headers: { Authorization: `Bearer ${mgmtToken}` },
        });
        auth0UserId = createRes.data.user_id;
        console.log(`✓ Usuario creado en Auth0: ${auth0UserId}`);

        // 4. Crear usuario en base de datos
        console.log('\n📝 Paso 4: Creando usuario en base de datos...');
        await client.query(
            `INSERT INTO users (auth0_id, email, username, role, company_id, enabled) 
             VALUES ($1, $2, $3, $4, $5, true)`,
            [auth0UserId, ADMIN_CONFIG.email, ADMIN_CONFIG.username, 3, companyId]
        );
        console.log('✓ Usuario creado en base de datos');

        await client.query('COMMIT');

        console.log('\n✅ ¡Primer usuario Admin creado exitosamente!\n');
        console.log('📋 Credenciales de acceso:');
        console.log('   Email:', ADMIN_CONFIG.email);
        console.log('   Password:', ADMIN_CONFIG.password);
        console.log('   Rol: Admin (3)');
        console.log('   Empresa:', ADMIN_CONFIG.companyName);
        console.log('\n⚠️  IMPORTANTE: Cambia la contraseña después del primer login!\n');

    } catch (error) {
        await client.query('ROLLBACK');

        // Rollback en Auth0 si se creó el usuario
        if (auth0UserId && mgmtToken) {
            try {
                await axios.delete(
                    `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
                    { headers: { Authorization: `Bearer ${mgmtToken}` } }
                );
                console.log('✓ Rollback en Auth0 completado');
            } catch (delErr) {
                console.error('⚠️ Error en rollback de Auth0:', delErr.message);
            }
        }

        console.error('\n❌ Error al crear el admin:', error.response?.data || error.message);
        process.exit(1);
    } finally {
        client.release();
        process.exit(0);
    }
}

console.log('\n⚠️  Este script creará el PRIMER usuario Admin');
console.log('⚠️  Solo debe ejecutarse UNA VEZ después de limpiar la BD');
console.log('\nPresiona Ctrl+C para cancelar, o espera 3 segundos para continuar...\n');

setTimeout(() => {
    createFirstAdmin();
}, 3000);
