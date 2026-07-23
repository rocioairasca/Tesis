# Rain Records

Base: `/api/rain-records`

**GET `/api/rain-records`**
- Descripcion: listar registros de lluvia filtrados por empresa.
- Query params: `from`, `to`, `source`, `includeDisabled`, `page`, `pageSize`.

**POST `/api/rain-records`**
- Descripcion: crear un registro manual.
- Body: `date`, `rain_mm`, `notes`.

**PUT `/api/rain-records/:id`**
- Descripcion: editar un registro. Si el origen era `api`, pasa a `edited_api`.
- Body: `date`, `rain_mm`, `notes`.

**PATCH `/api/rain-records/:id/disable`**
- Descripcion: soft delete mediante `enabled = false`.

**PATCH `/api/rain-records/:id/enable`**
- Descripcion: reactivar un registro deshabilitado si no duplica una fecha activa.

**POST `/api/rain-records/sync-today`**
- Descripcion: consulta Open-Meteo con `precipitation_sum` y guarda la lluvia del dia actual.
- Body: `latitude`, `longitude`.
- Regla: actualiza registros `api`; no sobrescribe registros `manual` ni `edited_api`.

**GET `/api/rain-records/stats/monthly`**
- Descripcion: devuelve lluvia acumulada por mes para graficar.
