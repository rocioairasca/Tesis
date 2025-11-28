/**
 * Rutas: Notificaciones
 * Ubicación: routes/notifications.js
 */

const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notifications');

// Todas las rutas de notificaciones están protegidas por el middleware global
// (checkJwt + userData ya aplicados en index.js)

// GET /notifications - Listar notificaciones del usuario
router.get(
    '/',
    notificationsController.listNotifications
);

// GET /notifications/unread-count - Obtener contador de no leídas
router.get(
    '/unread-count',
    notificationsController.getUnreadCount
);

// PATCH /notifications/:id/read - Marcar notificación como leída
router.patch(
    '/:id/read',
    notificationsController.markAsRead
);

// PATCH /notifications/read-all - Marcar todas como leídas
router.patch(
    '/read-all',
    notificationsController.markAllAsRead
);

module.exports = router;
