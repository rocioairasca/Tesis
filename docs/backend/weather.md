# Weather (Open-Meteo)

Base: /api/weather. Acceso: usuario autenticado, checkRole(0).

## POST /api/weather/update

Acepta latitude/longitude (lat/lon por compatibilidad). Valida coordenadas antes de consultar la caché o el proveedor. Mantiene source: "open-meteo", las métricas existentes, weather_code, condition, icon y observed_at. Agrega cache: false para una lectura nueva y cache: true para una lectura reutilizada, incluida una request que se une a otra en curso.

### Caché y concurrencia

- Implementación: services/weatherCache.js, en memoria, por proceso backend. No usa Redis, DB ni dependencias nuevas.
- TTL fijo: **15 minutos desde la finalización de la lectura y su guardado**. Un hit no renueva el TTL.
- Key: latitud y longitud redondeadas a **3 decimales**, normalizando también -0. Ejemplo: -32.414542/-63.253653 → -32.415:-63.254. La request externa conserva las coordenadas originales, y los hits conservan las coordenadas y hora de observación de la lectura obtenida originalmente para esa zona.
- Hit vigente: responde inmediatamente, sin llamar Open-Meteo y **sin insertar otra fila en weather**.
- Miss: una única Promise por key cubre la consulta, validación, inserción y almacenamiento en caché. Las solicitudes concurrentes esperan esa misma Promise. Se elimina del Map en finally, tanto en éxito como en error.
- La caché almacena solo campos meteorológicos públicos y metadatos de la lectura; no contiene usuarios ni empresas. Puede compartirse entre empresas para una misma zona.
- Se eliminan entradas vencidas al consultar y se limita a **500 entradas**, expulsando la menos recientemente utilizada. No hay intervalos ni timers permanentes.
- El caché y el cooldown se pierden al reiniciar. Cada réplica/proceso tiene su propio estado: el ahorro descrito aplica por proceso, no como garantía global entre réplicas.

| Escenario en un proceso | Llamadas externas | Filas nuevas |
| --- | ---: | ---: |
| Primera consulta de una zona, válida | 1 | 1 |
| Repeticiones dentro del TTL, incluso pequeñas variaciones en la misma key | 0 | 0 |
| 20 solicitudes simultáneas de una zona sin caché | 1 | 1 |
| Misma zona después de vencer el TTL, válida | 1 | 1 |
| Dos zonas distintas sin caché | 2 | 2 |
| Cooldown activo sin caché vigente | 0 | 0 |
| Caché vigente durante cooldown | 0 | 0 |

La inserción existente solo ocurre al obtener una lectura nueva y válida del proveedor. Fallos del proveedor o respuestas incompletas no generan filas. Un fallo de guardado no se cachea como éxito.

### HTTP 429 y cooldown

Solo un **429 de Open-Meteo** activa el cooldown compartido por todas las zonas de clima actual en ese proceso. Respeta Retry-After en segundos o como fecha HTTP futura, con mínimo 1 segundo y máximo **24 horas**. Header ausente, inválido, cero o pasado: **15 minutos**.

Durante cooldown se sirven primero las entradas todavía vigentes. Para el resto se devuelve HTTP 429, sin llamar al proveedor, con header Retry-After y cuerpo:

~~~json
{
  "error": "WeatherRateLimited",
  "message": "El servicio meteorológico alcanzó temporalmente su límite de consultas.",
  "retry_after_seconds": 900
}
~~~

retry_after_seconds expresa el tiempo restante, redondeado hacia arriba. Al terminar, la próxima solicitud puede volver a consultar; no hay reintento automático. Las requests de otras zonas que ya estaban en curso antes de recibir el 429 pueden terminar normalmente.

Otros errores conservan su categoría: FetchWeatherError/502, IncompleteWeather/502 o DbError/500. No se exponen payloads internos del proveedor. Logs: cache hit/miss y joined in-flight en debug, rate limited en warn, errores genéricos con status; sin coordenadas exactas ni URLs del proveedor.

## GET /api/weather/latest y fallback

Conserva el último registro histórico existente. No consulta Open-Meteo. No se agregó stale-cache: las entradas expiradas no se sirven como clima actual. Ante error, el frontend mantiene este fallback con **“Último dato disponible · Desactualizado”**, la fecha/hora disponible y la aclaración sobre ubicación del histórico. Un 429 muestra además el tiempo de espera sugerido; Reintentar sigue siendo una acción explícita y el backend vuelve a aplicar caché/cooldown.

## Auditoría frontend y lluvias

Dashboard tenía una única ruta de consulta y no tenía polling ni retries automáticos. StrictMode ya abortaba el primer intento antes de llegar al POST; ahora el hook evita además invocar loaders cancelados. El loader meteorológico se independizó de fechas y permisos de otras secciones: solo cambia ante cambio de source o identidad de sesión/empresa, montaje nuevo o reintento explícito. Los filtros de producción y rerenders no lo relanzan.

No se modificó geolocation.mjs: helper compartido, permisos, timeout 15 s, maximumAge 2 minutos y errores tipificados intactos.

Registro de lluvias no consulta desde Dashboard ni durante su carga: handleSyncToday se ejecuta mediante “Sincronizar lluvia de hoy”. Conserva su request independiente daily=precipitation_sum y reglas manual/api/edited_api. No utiliza el caché de clima actual ni se modificó su lógica. Sus tests de protección manual/edited_api y presentación siguen incluidos en la validación.

## Validación local

Node **v20.20.2**. Open-Meteo y DB simulados; reloj inyectado para avanzar TTL/cooldown sin esperas reales.

- Backend: node --test tests/weather.test.js tests/weatherCache.test.js.
- Frontend: node --test tests/geolocation.test.mjs tests/dashboard.test.mjs tests/dashboardWeather.test.mjs tests/dashboardCharts.test.mjs tests/rainPresentation.test.mjs.
- Navegador: tests/dashboardNotifications.browser.mjs, con Dashboard real bajo StrictMode, conteo de POST por montaje, cambios de otras secciones, avance de reloj 30 minutos sin polling, remount, reintento, 429 y fallback desactualizado. Incluye los escenarios responsive existentes a 1440/1024/390 px.
- Build Vite y git diff --check.

Sin cambios de dependencias, Node, schema, migraciones o datos históricos. Sin llamadas reales al proveedor ni a producción. Sin commit, push o deploy.

Referencias: validations/weather.schema.js, controllers/openWeatherMap.js, services/weatherCache.js.
