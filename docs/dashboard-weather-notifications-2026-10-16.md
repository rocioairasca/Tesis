# Dashboard: notificaciones y ubicación/clima

Implementado en C:\Proyectos\Tesis, sobre su estado actual. Validación con Node v20.20.2.

## Auditoría y causas

- Notificaciones reales: NotificationsDrawer renderizaba List.Item con una acción lateral en desktop, estrechando el mensaje. En mobile duplicaba el bloque de acción. NotificationBell también mostraba el mensaje guardado literalmente.
- Las cantidades se interpolan en backend (cron/scheduler.js y controladores de productos/usos) dentro de message, con precisión SQL. El nuevo formatter reutiliza formatNumber (es-AR), solo en la frontera de render de Drawer/Bell. Contexto y valores guardados conservan su texto. Esto también evita interpretar dos veces un separador de miles.
- Había cuatro solicitudes directas de geolocation: dashboardSource, MapSelector, Lotes y RainRecords. No se encontró watchPosition ni almacenamiento de una última ubicación propia de la aplicación.
- Dashboard y Lotes: alta precisión, timeout 10 s, maximumAge 0; MapSelector: alta precisión, timeout 10 s y maximumAge omitido (0 por defecto). RainRecords tiene su propia solicitud explícita para sincronizar el día, con alta precisión, 10 s y maximumAge 0.
- No había comprobación de contexto seguro ni Permissions API. Cualquier error en ubicación o POST meteorológico caía en el mismo catch y leía GET /weather/latest. Por eso podían aparecer temperatura/viento/humedad aunque fallara la consulta actual.
- Ese último registro es global: no guarda coordenadas ni código WMO. DashboardView imponía las etiquetas “ubicación no verificada” y “Condición no informada” a todo fallback, incluso si la ubicación actual había funcionado.
- Open-Meteo ya pedía los cinco campos necesarios, incluido weather_code, con timezone auto y timeout 10 s. No faltaba ese parámetro. Además había heurísticas de condición por temperatura/humedad y Number(null) podía convertirse en 0.
- El timestamp priorizaba date, que puede ser solo una fecha, sobre la hora de observación del proveedor. Una hora ISO sin offset también dependía de la zona del servidor.

## Solución

- Helper compartido getCurrentLocation para Dashboard, MapSelector y sugerencia inicial de Lotes. Devuelve latitude, longitude, accuracy y obtainedAt; errores permission_denied, position_unavailable, timeout y unsupported.
- Comprueba isSecureContext y Permissions API si está disponible; una API de permisos ausente o que lanza error no bloquea la solicitud estándar. Permiso denied evita volver a pedir posición.
- Precisión normal, timeout 15 s, maximumAge 2 minutos. Se usa exclusivamente el caché administrado por el navegador; no se persisten coordenadas ni se crea un fallback geográfico. AbortController descarta callbacks tardíos; las sugerencias de Lotes no pisan geometrías seleccionadas ni formularios cerrados.
- Estados visibles independientes: obteniendo ubicación, obteniendo clima, clima actual, error de ubicación/permisos, error del proveedor y último dato disponible. El reintento manual ejecuta nuevamente ubicación y clima. No hay bucles automáticos ni botón de reintento para denied/unsupported.
- Se conserva el fallback histórico existente de /weather/latest, expresamente desactualizado y sin atribuirlo al dispositivo. Si fallan ambos endpoints, se mantiene la causa de error y se indica ausencia de datos. No hay fallback silencioso a Villa María u otra coordenada fija. MapSelector conserva su prioridad por geometrías del lote y luego ubicación; sin ninguna, muestra su estado vacío.
- La condición depende de WMO: ausencia/código desconocido se informa, sin inferir sol o nubes por otras magnitudes. La fecha/hora utiliza observed_at; si el histórico solo tiene fecha, se aclara “hora no registrada”.
- Backend conserva el endpoint y su almacenamiento existente en weather. Rechaza métricas incompletas antes de insertar; missing weather_code queda null y sin condición inventada. Solicita timeformat=unixtime y convierte observed_at a ISO UTC, manteniendo la fecha de registro en Argentina. Referencia: [Open-Meteo Forecast API](https://open-meteo.com/en/docs).
- Cards de notificaciones con icono, título/severidad, mensaje a todo el ancho y pie flexible con fecha/acción secundaria. No leídas con fondo sutil, leídas neutras y sin “Marcar leída”. Filtro mobile sin truncar. Semántica de lectura intacta.

## Registro de lluvias

RainRecords.jsx y controllers/rainRecords.js no se modificaron. La sincronización usa otra consulta Open-Meteo (daily precipitation_sum), tabla rain_records y controles por empresa. Se verificó la protección existente que omite registros manual/edited_api. No se invocaron endpoints reales, no se ejecutó SQL y no se alteraron históricos.

## Validación

- Backend: node --test tests/weather.test.js: 4/4. Respuesta válida, campos solicitados, WMO, valores ausentes/ceros, respuesta incompleta sin insertar, HTTP/timeout sin insertar y sincronización que conserva manual/edited_api.
- Frontend: 34/34 en geolocation, dashboardWeather, dashboard, dashboardCharts, rainPresentation, lotsOverview, lotsMapViewport, mapGeometry, fieldOverview y uiPatterns.
- Navegador Edge/Chromium headless: 3/3 escenarios con el drawer y card meteorológica reales, tema GrowSync, geolocation y transporte simulados. Anchos 1440, 1024 y 390 px; números/unidades, precisión real, leídas/no leídas, acción sin cerrar drawer, ancho del mensaje y ausencia de overflow, permiso denegado, timeout/unavailable, error proveedor y retry completo.
- Build Vite aprobado. Advertencia existente de chunks mayores a 500 kB; tests existentes emiten avisos ESM/HMR concurrente sin fallos.
- git diff --check aprobado.
- Sin cambios de dependencias/runtime, DB o migraciones. Sin llamadas reales a Open-Meteo, datos productivos ni modificación de históricos. Sin commit, push o deploy.
- Las pruebas simulan permisos y proveedor: no prueban disponibilidad de GPS/red en un dispositivo productivo.

## Archivos de esta entrega

- docs/dashboard-weather-notifications-2026-10-16.md
- grow-sync/src/components/MapSelector.jsx
- grow-sync/src/components/NotificationBell.jsx
- grow-sync/src/components/NotificationCard.jsx
- grow-sync/src/components/NotificationsDrawer.jsx
- grow-sync/src/components/notificationCard.css
- grow-sync/src/features/dashboard/Dashboard.jsx
- grow-sync/src/features/dashboard/DashboardView.jsx
- grow-sync/src/features/dashboard/dashboard.css
- grow-sync/src/features/dashboard/dashboardSource.js
- grow-sync/src/features/dashboard/weatherPresentation.jsx
- grow-sync/src/features/lots/Lotes.jsx
- grow-sync/src/utils/geolocation.mjs
- grow-sync/src/utils/userFriendlyErrors.js
- grow-sync/tests/dashboard.test.mjs
- grow-sync/tests/dashboardNotifications.browser.mjs
- grow-sync/tests/dashboardNotifications.fixture.jsx
- grow-sync/tests/dashboardNotifications.fixtureContext.jsx
- grow-sync/tests/dashboardWeather.test.mjs
- grow-sync/tests/geolocation.test.mjs
- growsync-backend/controllers/openWeatherMap.js
- growsync-backend/tests/weather.test.js
