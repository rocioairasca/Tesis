# Cosechas: Resultados por lote (FIN-01A, base productiva)

Estado: implementado localmente. No commit, push, deploy ni migraciones. No se consultó producción ni staging.
No hay migraciones nuevas: la vista solo lee tablas existentes (`harvest_records`, `harvest_crop_assignments`, `crop_assignments`, `lots`, `sub_lots`, `crops`, `campaigns`).

## Alcance

Dentro de la MISMA pantalla `Cosechas`: pestañas `Registros` y `Resultados por lote`, con filtros compartidos (campaña como filtro principal, cultivo, lote o sublote, buscar).
Esta microetapa NO incluye gastos, gasto/ha, costo/tn, estado económico, `economic_snapshots`, `cost_entries` ni declaración de completitud. La respuesta de la API y la UI no contienen ningún dato económico.

## Endpoint

`GET /api/harvest-records/results` (permiso `harvest.view`, empresa siempre desde la sesión, `Cache-Control: no-store`).
Parámetros: `campaign` (id o nombre) o `campaign_id`, `crop` (nombre) o `crop_id`, `lot_id`, `sub_lot_id`, `search`, `page`, `pageSize` (máx. 100).
No recibe unidad: kg y kg/ha son los datos; qq/ha y tn/ha son solo presentación en el frontend.

Respuesta: `summary` (sobre TODO el conjunto filtrado), `data` (página) y `pagination`. Cada fila: lote/sublote, campaña, cultivo, `surface_ha`,
`production_kg`, `harvested_area_ha`, `yield_kg_ha`, `records_count`, `harvest_status`, `production_basis` y `children` (sublotes).

`GET /api/harvest-records` (listado existente) acepta además `campaign_id`, `crop_id` y `sub_lot_id`. Un registro pertenece a una clave por sus vínculos de ciclo
(`harvest_crop_assignments`); los registros legacy sin vínculos usan sus propias columnas. Se usa para "Ver los N registros".

## Reglas

- Clave: `lot_id + sub_lot_id + campaign_id + crop_id`. Varias cosechas parciales de la misma clave son una sola fila.
- Rendimiento: `SUM(production_kg) / SUM(harvested_area_ha)`, en aritmética exacta (centésimas con BigInt). Nunca se promedia `yield_kg_ha`.
- Registros `enabled=false` quedan excluidos.
- Un registro repartido entre varios vínculos:
  - Si todos terminan en la misma clave: se consolida sin prorrateo.
  - Si terminan en claves distintas: la producción se reparte proporcionalmente a las superficies vinculadas (mayor resto, total exacto). Se marca `production_basis.method = "area_proportional"`
    y la UI lo rotula "Prorrateada": es un prorrateo, no una medición por destino.
  - Si falta una superficie válida: no se infiere; el registro se informa aparte.
- Registros sin campaña, sin cultivo, sin superficie o con vínculos huérfanos NO se asignan: `summary.unclassified` los cuenta por motivo (`missing_campaign`, `missing_crop`, `invalid_area`, `invalid_link_area`, `orphan_link`, `invalid_production`).
- Sublotes (D2): la fila padre del lote es el total autoritativo (nivel lote + sublotes); las subdivisiones se expanden. Nada de nivel lote se reparte entre hijas.
  Un filtro `sub_lot_id` devuelve las subdivisiones como filas de primer nivel, nunca un total parcial del lote.
- Superficie: suma de los ciclos productivos de la clave; sin ciclo, área del lote/sublote (`surface_source`).
- Estado de cosecha: solo desde ciclos (`end_date`): `not_started`, `in_progress`, `closed`; `null` si no hay ciclo. Un ciclo sin cosecha aparece con producción `null` (Pendiente), nunca 0.
- Paginación: después de agregar. El resumen no depende de la página.

## Frontend

`Harvest.jsx` es dueño de pestaña, filtros, páginas, subdivisiones expandidas, unidad y filtro "Ver los N registros". `HarvestFilters.jsx` es la zona de filtros compartida.
`HarvestTable.jsx` (Registros, rediseñado, resumen compacto y gráficos en panel lateral plegable) y `HarvestResults.jsx` (tabla desktop / tarjetas en 390 px).
Helpers puros en `harvestResults.mjs`. Se conservan registrar cosecha, histórica, edición, permisos, paginación, filtros y `HarvestDetail`.
La columna "Registrado por" salió de la tabla (sigue en el detalle) y el resumen de Registros muestra superficie, producción y cantidad de registros (se retiró el rendimiento promedio, que mezclaba cultivos).

## Límites conocidos

- La agregación se hace en el servicio con todas las cosechas habilitadas de la empresa (una consulta por tabla). Es correcto y exacto; si el volumen crece conviene empujar filtros a SQL.
- Los sublotes pertenecen a versiones de división: si la división cambia entre la siembra y la cosecha, la clave se parte por ids; no se reconcilia automáticamente.
- El estado de cosecha es `null` para cosechas legacy sin ciclo.

## Tests

- Backend: `tests/harvestResults.integration.test.js` (PGlite, datos sintéticos).
- Frontend: `tests/harvestResults.test.mjs` y `tests/harvest.browser.mjs` (fixture `tests/harvest.fixture.jsx`, adaptador Axios local).
  El navegador usa Edge como las demás suites; `GS_BROWSER_CHANNEL=default` usa el Chromium incluido.
