# Weather (Open-Meteo)

Base: `/api/weather`

**GET `/api/weather/latest`**
- Descripcion: obtener el ultimo clima registrado en la BD como fallback historico.
- Acceso: login (checkRole(0)).
- Respuesta: objeto con datos de clima guardados.

**POST `/api/weather/update`**
- Descripcion: consultar Open-Meteo con la ubicacion real del usuario y almacenar el ultimo clima.
- Acceso: login (checkRole(0)).
- Query params: `latitude`, `longitude`. Tambien acepta `lat`, `lon` por compatibilidad.
- Respuesta: mantiene los campos consumidos por el frontend (`temperature`, `humidity`, `wind_speed`, `wind_direction`, `rainfall`) y agrega `weather_code`, `condition`, `icon`, `source`, `observed_at`.

Referencias: `validations/weather.schema.js`, `controllers/openWeatherMap.js`
