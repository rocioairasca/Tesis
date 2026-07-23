# API - Backend

Resumen de endpoints expuestos por el backend (ejecutar `node index.js` para mas detalles).

Rutas publicas:
- `GET /` - mensaje de salud
- `GET /api/health` - { ok: true }
- `POST /api/auth/...` - login / register (ver `routes/auth.js`)
- `POST /api/public/payments` - pagos simulados previos a registro

Rutas protegidas (requieren Authorization: Bearer <access_token>):
- `/api/users` - operaciones CRUD de usuarios (ver `routes/userRoutes.js`)
- `/api/lots` - gestion de lotes (`routes/lot.js`)
- `/api/products` - productos (`routes/products.js`)
- `/api/usages` - registros de uso (`routes/usage.js`)
- `/api/harvest-records` - cosechas y estadisticas de cosecha (`routes/harvestRecords.js`)
- `/api/stats` - estadisticas (`routes/stats.js`)
- `/api/weather` - consultas a Open-Meteo (`routes/weather.js`)
- `/api/rain-records` - registro y sincronizacion de lluvias (`routes/rainRecords.js`)
- `/api/planning` - planificaciones (`routes/planning.js`)
- `/api/vehicles` - gestion de vehiculos (`routes/vehicle.js`)
- `/api/notifications` - notificaciones en tiempo real (`routes/notifications.js`)

Documentacion detallada por recurso:

- `docs/backend/auth.md`
- `docs/backend/payments.md`
- `docs/backend/users.md`
- `docs/backend/lots.md`
- `docs/backend/products.md`
- `docs/backend/usage.md`
- `docs/backend/harvest-records.md`
- `docs/backend/planning.md`
- `docs/backend/vehicle.md`
- `docs/backend/notifications.md`
- `docs/backend/stats.md`
- `docs/backend/weather.md`
- `docs/backend/rain-records.md`

Proximos pasos:
- Anadir ejemplos de request/respuesta para cada endpoint y parametros.
- Documentar codigos de error y autorizaciones por rol cuando este disponible.
