# Harvest Records

Base: `/api/harvest-records`

Las cosechas se almacenan internamente en kg. Las conversiones de unidad solo aplican a endpoints de estadisticas.

**GET `/api/harvest-records/stats/summary`**
- Query params: `campaign`, `crop`, `unit`.
- `unit`: `kg` por defecto, `tn` para toneladas, `qq` para quintales.
- Devuelve totales y rendimiento convertidos a la unidad solicitada.

**GET `/api/harvest-records/stats/by-crop`**
- Query params: `campaign`, `unit`.
- Devuelve produccion y rendimiento por cultivo convertidos a la unidad solicitada.

**GET `/api/harvest-records/stats/by-campaign`**
- Query params: `crop`, `unit`.
- Devuelve produccion y rendimiento por campana convertidos a la unidad solicitada.
