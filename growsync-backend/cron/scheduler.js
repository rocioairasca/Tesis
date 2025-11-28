const cron = require('node-cron');
const { pool } = require('../db/supabaseClient');
const supabase = require('../db/supabaseClient');
const { createNotification } = require('../controllers/notifications');

/**
 * Inicializar Cron Jobs
 */
const initCronJobs = () => {
    console.log('Inicializando Cron Jobs...');

    // 1. Notificar Planificaciones Próximas (Cada día a las 08:00 AM)
    // '0 8 * * *'
    cron.schedule('0 8 * * *', async () => {
        console.log('[CRON] Verificando planificaciones próximas...');
        try {
            // Buscar planificaciones que inicien en las próximas 24-48 horas
            // start_at >= NOW() + 24h AND start_at <= NOW() + 48h
            const query = `
        SELECT id, title, start_at, responsible_user, activity_type
        FROM planning
        WHERE status NOT IN ('completado', 'cancelado')
          AND start_at >= NOW() + INTERVAL '24 hours'
          AND start_at <= NOW() + INTERVAL '48 hours'
          AND enabled = TRUE
      `;
            const { rows } = await pool.query(query);

            for (const p of rows) {
                if (p.responsible_user) {
                    await createNotification(
                        p.responsible_user,
                        'planning_upcoming',
                        'medium',
                        'Planificación próxima',
                        `La planificación "${p.title}" comienza pronto (el ${new Date(p.start_at).toLocaleDateString()}).`,
                        { planning_id: p.id, start_at: p.start_at }
                    );
                }
            }
            console.log(`[CRON] ${rows.length} notificaciones de planificación enviadas.`);
        } catch (err) {
            console.error('[CRON] Error en job de planificaciones:', err);
        }
    });

    // 2. Notificar Stock Bajo (Cada día a las 09:00 AM)
    // '0 9 * * *'
    cron.schedule('0 9 * * *', async () => {
        console.log('[CRON] Verificando stock bajo...');
        try {
            // Umbral genérico: < 10 unidades disponibles
            const { data: products, error } = await supabase
                .from('products')
                .select('id, name, available_quantity, unit')
                .lt('available_quantity', 10)
                .eq('enabled', true);

            if (error) throw error;

            if (products && products.length > 0) {
                // Notificar a admins
                const { data: admins } = await supabase
                    .from('users')
                    .select('id')
                    .in('role', [1, 2, 3]);

                if (admins && admins.length) {
                    for (const prod of products) {
                        for (const admin of admins) {
                            await createNotification(
                                admin.id,
                                'low_stock',
                                'medium',
                                'Alerta de Stock Bajo',
                                `El producto "${prod.name}" tiene bajo stock (${prod.available_quantity} ${prod.unit}).`,
                                { product_id: prod.id, available: prod.available_quantity }
                            );
                        }
                    }
                }
                console.log(`[CRON] ${products.length} productos con bajo stock detectados.`);
            }
        } catch (err) {
            console.error('[CRON] Error en job de stock:', err);
        }
    });
};

module.exports = initCronJobs;
