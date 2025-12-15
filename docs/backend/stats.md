# Stats

Base: `/api/stats`

**GET `/api/stats`**
- Descripción: Obtener estadísticas y agregaciones del sistema (series, contadores, agregados por lotes, actividad, vehículo, etc.).
- Acceso: login (checkRole(0)).
- Query params (ejemplos): `range` (quick presets como `today`, `last7`), `from`, `to`, `groupBy` (`day`,`week`,`month`,`lot`,`activity_type`,`vehicle`), `lotId`, `vehicleId`, `userId`, `limit`.
- Respuesta: objeto con series/valores adecuados al `groupBy` solicitado.

Referencias: `validations/stats.schema.js`, `controllers/stats.js`