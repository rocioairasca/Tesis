# GrowSync - Backend

Servidor backend de GrowSync (Express + Supabase). Expone API REST, jobs periódicos y sockets.

Quickstart:

- `cd growsync-backend`
- `npm install`
- Copiar `.env.example` a `.env` y completar variables (ver abajo)
- `node index.js` (inicia servidor en `PORT`)

Variables de entorno importantes (ejemplos):

- `PORT` - puerto del servidor (ej: 4000)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`
- `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`
- `AUTH0_M2M_CLIENT_ID`, `AUTH0_M2M_CLIENT_SECRET`, `AUTH0_API_AUDIENCE`
- `OPENWEATHER_API_KEY`

Rutas principales (vistas en `index.js`):
- Public: `/`, `/api/health`, `/api` (auth)
- Privadas (requieren token): `/api/users`, `/api/lots`, `/api/products`, `/api/usages`, `/api/stats`, `/api/weather`, `/api/planning`, `/api/vehicles`, `/api/notifications`

Cron jobs y scripts:
- `cron/scheduler.js` inicializa tareas periódicas al arrancar el servidor
- `scripts/` contiene utilidades y migraciones (leer cada script para detalles)

Seguridad y despliegue:
- Nunca subir `.env` con credenciales reales. Mantener `.env.example` en el repo.
- Validar orígenes permitidos para CORS en `index.js`.

Para desarrolladores:
- Añadir `npm run start` si se desea un script de arranque.
- Documentar endpoints faltantes en `docs/backend/api.md`.
