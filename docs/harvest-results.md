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

# FIN-01B: costos reales provenientes de Planning

Estado: implementado localmente (sin commit, push, deploy ni migraciones). No hay tablas nuevas: se leen `economic_snapshots`, `economic_snapshot_lines`
y `economic_snapshot_targets` (migración `20261105`, que debe estar aplicada). No hay `cost_entries`, declaración de completitud, ventas, ingresos, margen ni rentabilidad.

## Regla de producto
Nunca hay `Completo`: aunque todas las líneas de Planning estén confirmadas, pueden existir gastos fuera de Planning (FIN-01C).
Estados visibles: `pending` (no hay costo conocido) y `partial` (hay al menos un costo conocido, aunque sea 0 confirmado). NULL no es cero; cero confirmado es conocido.
`is_minimum` es `true` siempre que haya costo conocido (es un piso). `is_provisional` es `true` si hay costo/tn y la cosecha no está `closed`.

## Fuente y asignación
- Solo la **última revisión** de cada Planning (`NOT EXISTS` otra fila con `supersedes_id = id`): una revisión supersedida nunca se cuenta. `planning.enabled = false` es soft-disable/visibilidad, NO una reversa económica: la evidencia sellada sigue contando una sola vez (el detalle informa `planning_enabled`). Solo una reversa/void económica explícita (futura) podrá retirar o compensar un costo.
- Importe por destino = `amount_usd × allocation_weight` de `economic_snapshot_targets`, en BigInt exacto (escala 1e24); no se recalcula FEFO, dosis ni superficies.
  Un destino con peso 0 no recibe costo ni líneas pendientes. Los pesos de una Planning suman exactamente 1 (lo garantiza el sellado), así que el reparto conserva el total.
- Clave económica = `lot_id + sub_lot_id + campaign_id (del snapshot) + beneficiary_crop_id`; debe coincidir ids con la clave productiva. No se asocia por nombre ni fechas;
  una campaña o cultivo distinto produce otra fila. Un lote con costos y sin cosecha aparece igual (superficie del lote como respaldo).
- Padre/hijas (D2): el padre suma costos del nivel lote + sublotes; las hijas solo lo imputado a su sublote. Los líneas pendientes se cuentan por `line_id` distinto (no se duplican entre hijas).
- Gasto/ha = gasto conocido ÷ superficie autoritativa de FIN-01A (ciclos o respaldo); no se suman superficies de las labores. Costo/tn = gasto conocido ÷ (producción kg ÷ 1000), solo con producción positiva.

## API
`GET /api/harvest-records/results`: cada fila agrega `costs` y el resumen agrega `cost_access`, `known_cost_usd`, `incomplete_lots` y `lots_without_known_cost`.
```
"costs": { "status": "pending|partial", "known_total_usd": "…"|null, "products_usd": "…"|null, "labor_usd": "…"|null, "pending_lines": 0,
           "per_ha_usd": "…"|null, "per_tn_usd": "…"|null, "is_minimum": true, "is_provisional": true }
```
Importes como texto decimal (6 decimales). `products_usd`/`labor_usd` son `null` si ninguna línea de ese tipo está confirmada. No hay promedio ni "costo completo".
`GET /api/harvest-records/results/detail?campaign_id&crop_id&lot_id[&sub_lot_id]`: resultado + `records_query` + (con acceso) `cost_detail.plannings[]`
(actividad, fecha efectiva, revisión, peso, productos, labor, conocido, pendientes y líneas) y la nota «Pueden existir otros gastos aún no imputados».
No se exponen `request_hash`, `idempotency_key` ni `created_txid`.

## Permisos
Costos solo con los permisos económicos existentes (`planning.view` + `inventory.view`, vía `economicExecution.allowed`). Con solo `harvest.view` el endpoint devuelve la producción,
`summary.cost_access = false`, `costs = null` y ningún importe. No se agregaron permisos. La UI no oculta datos que el servidor ya devolvió: simplemente no los recibe.

## Frontend
`HarvestResults.jsx` agrega Gastos, Gasto/ha, Costo/tn y Estado económico (solo con `cost_access`; en ese caso se omite «Sup. cosechada», disponible en el detalle) y la métrica «Gasto conocido»
(ayuda «Costos registrados hasta el momento» + lotes con costos incompletos). Tarjetas móviles: gasto conocido, costo/tn y estado. `HarvestResultDetail.jsx`: panel acoplado no modal en escritorio y pantalla completa en 390 px.
La selección, filtros y página viven en `Harvest.jsx`: «Ver los N registros» y volver los conservan. Formato USD con máximo 2 decimales, half-up sobre enteros, sin `,00`.

## Eficiencia
- Los filtros de campaña, cultivo, lote y sublote se empujan a SQL en ciclos, snapshots/targets/líneas (siempre) y como pre-filtro conservador en cosechas (la exactitud sigue en JS).
- Sin filtro de campaña se siguen leyendo todas las cosechas habilitadas de la empresa; las consultas de costos leen una vez targets y una vez líneas (sin producto cartesiano en SQL).
- Consulta potencialmente costosa: `NOT EXISTS (… n.supersedes_id = s.id)` usa el índice único de `supersedes_id`; conviene un índice `economic_snapshots(company_id, campaign_id)` y
  `economic_snapshot_targets(company_id, lot_id, beneficiary_crop_id)` si el volumen crece (no se agregó migración). Sin caché.

## Tests
Backend: `tests/harvestResultsCosts.integration.test.js` (PGlite; tablas económicas con las columnas de la migración, sin aplicar sus triggers).
Frontend: `tests/harvestResults.test.mjs` (helpers), `tests/harvestCosts.browser.mjs` (fixture `harvest.fixture.jsx` con `?costs`).

# FIN-01C: gastos adicionales y completitud explícita

Estado: implementado localmente (sin commit, push, deploy ni migraciones ejecutadas). No se consultó producción ni staging. Las migraciones nuevas
(`20261123_cost_entries.sql`, `20261123_economic_completeness.sql`) solo se validaron en PGlite y **no** están aplicadas en ningún entorno.
Requieren `20261105` (economic_snapshots) ya aplicada. Sin ventas, precios de grano, ingresos, margen, ROI, caja ni contabilidad.

## Tablas
- `cost_entries`: append-only (`root_id`, `revision`, `supersedes_id` único, `state` active|void). Categorías cerradas: seed, contractor, labor, fuel_machinery, rent, freight, drying, other.
  Moneda USD confirma directo; ARS confirma solo con fecha de pago, cotización mayorista, fecha de cotización = fecha de pago y fuente; si no, `cost_status='pending'` y `amount_usd NULL`
  (NULL ≠ 0; sin consulta automática de FX). UPDATE/DELETE/TRUNCATE bloqueados por trigger; `Idempotency-Key` + `request_hash` por empresa.
- `cost_entry_targets`: destinos explícitos (lote, sublote, cultivo, superficie de referencia, método `area_proportional|manual_percent`, `allocation_weight` NUMERIC(20,12)).
  Los pesos suman EXACTAMENTE 1 y un solo método por gasto (constraint trigger diferido al COMMIT). Sellados en la misma transacción. «Toda la campaña» se expande al guardar a los destinos actuales (un lote o ciclo posterior no recibe parte).
- `economic_completeness_declarations`: append-only por empresa+campaña+lote+sublote+cultivo (estado open|complete, revisión, `supersedes_id`, motivo, observación, `auto_invalidated`, huella de la evidencia, total conocido, actor y fecha).
- RLS habilitado y REVOKE a `anon`/`authenticated` (acceso solo vía backend). Triggers con `search_path` fijo y verificación de tenant (campaña, lote, sublote, cultivo, usuario).
- Índices: `cost_entries(company_id, campaign_id)`, `cost_entry_targets(company_id, lot_id, beneficiary_crop_id)`, `economic_completeness_declarations(company_id, campaign_id)`.

## API (siempre `Cache-Control: no-store`, empresa y actor desde la sesión)
- `GET /api/cost-entries` (filtros `campaign_id`, `lot_id`, `sub_lot_id`, `crop_id`, `category`, `status`, `include_void`, `page`, `pageSize`), `GET /api/cost-entries/:id`,
  `POST /api/cost-entries` y `POST /api/cost-entries/:id/revisions` (con `supersedes_id` y `reason`, o `state:'void'`). `Idempotency-Key` obligatorio en escrituras. No hay PUT/PATCH/DELETE.
- `GET|POST /api/harvest-records/results/completeness`: consultar, `action: 'complete'` o `'reopen'` (con motivo), `include_children` para un lote con sublotes. Idempotente.
- `GET /api/harvest-records/results` agrega `costs.other_usd`, `costs.pending_entries` y estado `complete`; el resumen agrega `complete_lots`, `incomplete_lots` (estado ≠ complete) y `additional_costs_available`.
  `GET …/results/detail` agrega `cost_detail.other_expenses` (por categoría), `completeness` (estado, partes, bloqueos, `can_declare`, `can_reopen`) y `economic_edit`.

## Reglas
- Estado visible: **Pendiente** (sin costo conocido), **Parcial** (hay costo conocido pero hay pendientes o no existe una declaración vigente), **Completo** solo con costo conocido, sin líneas ni gastos pendientes y declaración `complete` cuya huella coincide con la evidencia actual.
  `≥` solo en Parcial; en Completo no aparece, pero el costo/tn mantiene «prov.» mientras la cosecha no esté cerrada.
- Sin doble conteo: los gastos no nacen de `economic_snapshots`; solo cuenta la última revisión de cada gasto y de cada snapshot; los `void` no suman. La UI advierte (sin bloquear): «Verificá que este gasto no esté ya registrado mediante una planificación ejecutada.»
- Sublotes (D2): la completitud es por clave literal. Un lote padre es Completo si toda parte con evidencia (nivel lote y cada sublote) tiene declaración vigente y nada pendiente; una parte sin evidencia se ignora hasta que aparece evidencia. Nada de nivel lote se reparte a las hijas.
- Invalidación: crear o revisar/anular un gasto inserta, en la misma transacción, una revisión `open` (`auto_invalidated`) para cada clave afectada que estuviera `complete` (claves del destino viejo y del nuevo). Nada se borra. Respaldo: la declaración guarda la huella (sha256) de la evidencia; si llega evidencia nueva por otra vía (p. ej. un snapshot de Planning posterior), deja de ser válida sin intervención.
- Permisos (sin permisos nuevos): leer = `planning.view` + `inventory.view`; registrar gastos/declarar/reabrir = además `planning.edit` + `inventory.edit` (`economic.editKeys`). El servidor decide; la UI solo oculta acciones. Si en el futuro se quiere separar «editar economía» de planificación/inventario, conceptualmente correspondería un permiso `economic.edit`; no se agregó por falta de justificación todavía.
- Compatibilidad de despliegue: si las tablas aún no existen, el agregador trata su ausencia como «sin evidencia adicional» (no devuelve 500); registrar/declarar sí requiere las migraciones.

## Rendimiento
Una consulta para destinos y otra para líneas de Planning, una para gastos+destinos y una para declaraciones, todas filtradas por campaña/cultivo/lote en SQL; sin producto cartesiano cosechas×líneas×destinos; sin caché.

## Tests
Backend: `tests/costEntries.integration.test.js` (PGlite con las migraciones reales: constraints, inmutabilidad, pesos, tenant, permisos, idempotencia, completitud, invalidación, sublotes).
Frontend: `tests/harvestResults.test.mjs` (helpers) y `tests/harvestEconomic.browser.mjs` (fixture `?costs&edit`; 390 px incluido). Se actualizó la aserción de FIN-01B «nunca Completo» porque el contrato cambió a propósito.

## Decisiones aprobadas (FIN-01C)
- Crear, revisar o anular un gasto que afecta una combinación declarada `complete` inserta una revisión `open` con `auto_invalidated=true`; la historia se conserva.
- Un gasto no cambia de campaña por revisión: se anula y se registra de nuevo en la campaña correcta.
- «Toda la campaña» solo admite `area_proportional`; `manual_percent` requiere destinos explícitos.
- Evidencia nueva de Planning (snapshot o revisión) invalida por huella sin escribir nada: `results`, `results/detail` y `GET …/completeness` muestran el estado efectivo (`partial`/`open`).
  `GET …/completeness` devuelve `state` (efectivo), `declared_state` (lo guardado) y `stale`.
- Falla preexistente (resuelta en QA-ECON): las fixtures referenciaban `20261108_planning_selection_mode.sql`; el archivo real es `20261107_planning_selection_mode.sql`.
