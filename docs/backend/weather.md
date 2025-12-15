# Weather (OpenWeather)

Base: `/api/weather`

**GET `/api/weather/latest`**
- Descripción: Obtener el último clima registrado en la BD o por `city`.
- Acceso: login (checkRole(0)).
- Query params: `city` (opcional)
- Respuesta: objeto con datos de clima (source, timestamp, temperatura, condiciones, etc.).

**POST `/api/weather/update`**
- Descripción: Consultar OpenWeather y almacenar último clima.
- Acceso: Supervisor+ (checkRole(1)).
- Query params / Body: `lat`,`lon` o `city`. Opcionales `units` (`metric` por defecto) y `lang` (`es` por defecto).
- Respuesta: objeto con datos recién guardados.

Referencias: `validations/weather.schema.js`, `controllers/openWeatherMap.js`