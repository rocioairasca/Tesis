# API - Backend

Resumen de endpoints expuestos por el backend (ejecutar `node index.js` para más detalles).

Rutas públicas:
- `GET /` → mensaje de salud
- `GET /api/health` → { ok: true }
- `POST /api/auth/...` → login / register (ver `routes/auth.js`)

Rutas protegidas (requieren Authorization: Bearer <access_token>):
- `/api/users` → operaciones CRUD de usuarios (ver `routes/userRoutes.js`)
- `/api/lots` → gestión de lotes (`routes/lot.js`)
- `/api/products` → productos (`routes/products.js`)
- `/api/usages` → registros de uso (`routes/usage.js`)
- `/api/stats` → estadísticas (`routes/stats.js`)
- `/api/weather` → consultas a OpenWeather (`routes/weather.js`)
- `/api/planning` → planificaciones (`routes/planning.js`)
- `/api/vehicles` → gestión de vehículos (`routes/vehicle.js`)
- `/api/notifications` → notificaciones en tiempo real (`routes/notifications.js`)

Documentación detallada por recurso:

- `docs/backend/auth.md`
- `docs/backend/users.md`
- `docs/backend/lots.md`
- `docs/backend/products.md`
- `docs/backend/usage.md`
- `docs/backend/planning.md`
- `docs/backend/vehicle.md`
- `docs/backend/notifications.md`
- `docs/backend/stats.md`
- `docs/backend/weather.md`

Próximos pasos:
- Añadir ejemplos de request/respuesta para cada endpoint y parámetros.
- Documentar códigos de error y autorizaciones por rol cuando esté disponible.
