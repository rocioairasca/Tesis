/**
 * Controlador: Notificaciones
 * Ubicación: controllers/notifications.js
 * Descripción: Maneja las notificaciones del sistema
 */

const supabase = require('../db/supabaseClient');

/**
 * LISTAR NOTIFICACIONES del usuario autenticado
 * Soporta: ?read=true/false&priority=low/medium/high&page=1&pageSize=20
 */
const listNotifications = async (req, res, next) => {
    try {
        const userId = req.user.id; // Asumiendo que el middleware de auth agrega req.user
        const {
            read,
            priority,
            page = 1,
            pageSize = 20,
        } = req.query;

        const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
        const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

        let query = supabase
            .from('notifications')
            .select('*', { count: 'exact' })
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        // Filtros opcionales
        if (read !== undefined) {
            query = query.eq('read', read === 'true');
        }
        if (priority) {
            query = query.eq('priority', priority);
        }

        const { data, error, count } = await query;

        if (error) throw error;

        return res.json({
            data: data || [],
            page: Number(page),
            pageSize: limit,
            total: count ?? 0,
        });
    } catch (err) {
        next(err);
    }
};

/**
 * OBTENER CONTADOR de notificaciones no leídas
 */
const getUnreadCount = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const { count, error } = await supabase
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('read', false);

        if (error) throw error;

        return res.json({ unreadCount: count || 0 });
    } catch (err) {
        next(err);
    }
};

/**
 * MARCAR NOTIFICACIÓN como leída
 */
const markAsRead = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const { data, error } = await supabase
            .from('notifications')
            .update({ read: true })
            .eq('id', id)
            .eq('user_id', userId) // Asegurar que solo el dueño pueda marcarla
            .select()
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                error: 'NotFound',
                message: 'Notificación no encontrada'
            });
        }

        return res.json({ notification: data });
    } catch (err) {
        next(err);
    }
};

/**
 * MARCAR TODAS las notificaciones como leídas
 */
const markAllAsRead = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const { error } = await supabase
            .from('notifications')
            .update({ read: true })
            .eq('user_id', userId)
            .eq('read', false);

        if (error) throw error;

        return res.json({ ok: true, message: 'Todas las notificaciones marcadas como leídas' });
    } catch (err) {
        next(err);
    }
};

/**
 * HELPER: Crear una notificación
 * Esta función es para uso interno de otros controladores
 */
const createNotification = async (userId, type, priority, title, message, data = {}) => {
    try {
        const { data: notification, error } = await supabase
            .from('notifications')
            .insert([{
                user_id: userId,
                type,
                priority,
                title,
                message,
                data,
            }])
            .select()
            .single();

        if (error) {
            console.error('Error creating notification:', error);
            return null;
        }

        // Emitir evento Socket.io
        try {
            const io = require('../socket').getIO();
            io.to(userId).emit('new_notification', notification);
        } catch (socketError) {
            console.error('Error emitiendo socket:', socketError.message);
        }

        return notification;
    } catch (err) {
        console.error('Error creating notification:', err);
        return null;
    }
};

module.exports = {
    listNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    createNotification,
};
