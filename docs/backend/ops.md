# Operaciones y utilidades

Este documento describe herramientas operativas y scripts útiles para desarrollo y depuración.

Cron jobs
- Los cron jobs se inicializan al arrancar el servidor (archivo `cron/scheduler.js`).
- Jobs incluidos:
  - `Notificar planificaciones próximas` (cada día 08:00)
  - `Notificar stock bajo` (cada día 09:00)
- Logs: los jobs registran su actividad en consola. Para supervisión en producción usar un proceso manager (pm2) o un servicio externo.

Script de depuración de notificaciones
- `grow-sync/debug-notifications.js` es un script pequeño pensado para ejecutarse desde la consola del navegador en desarrollo.
- Uso rápido:
  1. Abrir la app frontend en `http://localhost:3000` y autenticarse.
  2. Abrir DevTools Console y pegar el contenido de `grow-sync/debug-notifications.js`.
  3. El script verifica `access_token`, realiza llamadas a `/api/notifications/unread-count` y `/api/notifications`.

Recomendaciones
- No ejecutar scripts que expongan credenciales en entornos públicos.
- Añadir monitoreo de errores y alertas para jobs críticos (p. ej. envío de notificaciones y salud de la DB).
