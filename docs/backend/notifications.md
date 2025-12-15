# Notifications

Base: `/api/notifications`

Nota: Todas estas rutas están protegidas por token y devuelven/actúan sobre las notificaciones del usuario autenticado.

**GET `/api/notifications`**
- Descripción: Listar notificaciones del usuario.
- Respuesta: `{ notifications: [...] }` con metadatos.

**GET `/api/notifications/unread-count`**
- Descripción: Obtener el contador de notificaciones no leídas (int).

**PATCH `/api/notifications/:id/read`**
- Descripción: Marcar una notificación como leída.
- Path param: `id` UUID

**PATCH `/api/notifications/read-all`**
- Descripción: Marcar todas las notificaciones del usuario como leídas.

Referencias: `controllers/notifications.js`