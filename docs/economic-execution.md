# Costo económico real de ejecución

Base de trabajo: f7685d6a233144f1d9a32a9b825166e45f52364d.
Implementación local: no commit, push, deploy ni cambios de producción.

## Migración y activación

Nueva: growsync-backend/migrations/20261105_economic_execution.sql.
Requiere las migraciones existentes de Inventory V1, superficie efectiva, contexto/recetas y stock_batch_valuations.
Crea economic_snapshots, economic_snapshot_lines y economic_snapshot_targets, índices, controles relacionales, inmutabilidad y RLS.
No realiza backfill, no reclasifica actividades antiguas y no cambia saldos.
La migración sólo se ejecutó en PGlite desechable para tests; debe incorporarse al procedimiento normal de migraciones antes de activar este backend. No se aplicó a una DB local persistente ni remota.

## Fuente y momento de captura

markPlanningCompleted llama economicExecution.capture con el MISMO client/transacción que creó Usage, consumió stock, insertó stock_movements y planning_product_completions.
El estado operativo se actualiza antes de capture, pero nada se confirma hasta el COMMIT común.
Una falla económica real revierte también los consumos, completions, siembra y estado; un precio ausente no es una falla.
Aplica a complete-work, complete-sowing, complete-activity y registro realizado normal.
Las notificaciones conservan su envío posterior al COMMIT.

Se crea una línea product por stock_movement de consumption, vinculada al Usage y planning_product correspondiente.
Cantidad y unidad se copian del movimiento; nombre/dosis y receta se congelan como evidencia.
No se vuelve a simular FEFO ni se toma el precio actual del producto.
Se usa la revisión vigente de la partida consumida, nunca el precio legacy de stock_batches.
No se crean snapshots adicionales para cada Usage generado ni por la compra.

## Modelo y estados

Una cadena por empresa/Planning; phase=actual, state=sealed, revision creciente y supersedes_id.
Actor, fecha, motivo y clave/fingerprint identifican las revisiones.
No se persisten totales ni costo/ha: se derivan de líneas y superficies selladas.

- complete: ninguna línea pendiente; labor confirmada o explícitamente no aplicable.
- partial: al menos una línea confirmada y otra pendiente.
- pending: existen pendientes y ninguna línea confirmada.
- Una línea confirmada con importe cero es conocida; NULL no es cero.
- Completion de producto cero no crea Usage, movimiento ni línea ficticia.
- Sin productos y con labor no aplicable, cero es un total completo explícito.

Las líneas pendientes conservan amount_usd=NULL. La respuesta siempre distingue subtotal conocido de total completo.
USD/ha sólo se ofrece si el estado es completo y el área positiva.

## Labor

USD/ha: tarifa × superficie operativa.
ARS/ha: tarifa × superficie / FX, con FX definido como ARS por USD.
Confirmar ARS requiere fecha de pago, fx_date igual a esa fecha, cotización positiva y fuente; se conserva fx_type=divisa_mayorista.
No hay consulta automática de cotizaciones.
La labor pendiente puede conservar tarifa/moneda sin importe USD confirmado. No aplicable se declara explícitamente.
La carga financiera requiere planning.view + inventory.view + planning.edit + inventory.edit.
Un operador con permiso de ejecutar puede elegir beneficiarios y completar físicamente; su labor queda pendiente si no tiene permiso financiero.

## Imputación

La campaña es planning.campaign_id: no se deriva de fechas ni se asigna a partidas.
Superficie: COALESCE(planning_lots.effective_area_ha, area_ha), por destino.
growing_crop con crop_id ofrece ese cultivo como beneficiario; admite selección explícita.
Rastrojo, barbecho, pre-siembra, otro y contexto legacy NULL exigen selección explícita de cada destino.
La elección económica nunca sustituye planning.crop_id ni field_context.

Los cultivos son un catálogo por empresa, no un catálogo por campaña. El target queda vinculado a la campaña del snapshot.
Si se proporciona crop_assignment_id, se verifica empresa, campaña, cultivo, lote y sublote. No se infiere un ciclo por fecha.

Los targets preservan nombre de lote/división/cultivo y superficie. allocation_method=area_proportional.
Pesos a 12 decimales: cociente entero y distribución del residuo por mayores restos; empates por orden estable lote_id/sub_lot_id.
Suman exactamente 1. Se identifica como “Prorrateado por superficie”, no consumo medido por lote.
No se crea economic_area_references ni un denominador global cultivo/campaña.

## Precisión

Tarifas, cantidades y FX: numeric(20,6), aritmética BigInt.
Productos exactos a escala 12; amount_original/amount_usd numeric(40,12) admite el producto completo de entradas numeric(20,6).
No se redondean líneas de productos antes de sumar.
La división ARS/FX puede ser periódica: único redondeo half-up a 12 decimales para guardar esa evidencia USD.
La UI presenta dos decimales. El costo/ha se calcula desde el total exacto, nunca desde importes ya presentados.

## Inmutabilidad y revisiones

No UPDATE, DELETE ni TRUNCATE de snapshots, líneas o targets.
Sólo se agregan hijos durante la transacción creadora; después quedan sellados.
Controles diferidos verifican movimientos, destinos, pesos, labor y estado al confirmar la transacción.
Una revisión no puede modificar los hechos operativos, targets ni líneas de producto ya confirmadas, incluso por SQL directo.

“Revisar costo económico” exige motivo, supersedes_id vigente, actor autenticado e Idempotency-Key.
Actualiza únicamente productos pendientes con la evidencia vigente disponible.
Permite completar o corregir labor en una nueva revisión; las versiones anteriores quedan intactas.
Una corrección de precio posterior de una partida no cambia automáticamente el costo histórico ya confirmado.
La corrección deliberada de un producto ya confirmado requiere una futura operación específica; esta API no la encubre como completar pendientes.

## API y permisos

- GET /api/planning/:id/economics: revisión vigente, líneas, targets, pendientes, subtotal, total y USD/ha.
- GET /api/planning/:id/economics/history?page=1: revisiones, páginas de 25.
- POST /api/planning/:id/economics/revisions: completar pendientes/corregir labor; sin CRUD genérico.
- Los endpoints de completion aceptan economic.targets y, con permisos, economic.labor.
- Lectura: planning.view + inventory.view. Planning deshabilitada requiere además planning.view_disabled.
- Revisión/carga monetaria: permisos de lectura + planning.edit + inventory.edit.
- La captura automática no expone importes en la respuesta operativa a usuarios sin lectura económica.
- Empresa/actor proceden de la sesión, no del body. Esquemas estrictos para entrada económica.
- Todas las tablas tienen company_id, validaciones de relaciones y RLS sin acceso directo de anon/authenticated.
- Respuestas económicas Cache-Control: no-store.
- economic.view/edit/adjust quedan para una etapa posterior.

## UI y regresión operativa

Se conservan Drawer, formularios, listado y navegación actuales.
Pendiente/en progreso: simulación existente. Completada: Costo real histórico, advertencias, detalle de partidas y destinos, historial y revisión según permisos.
Sin snapshot previo: mensaje explícito; no se reconstruye una completada con precios actuales.
Las consultas/revisiones económicas usan estado local del componente: no invocan fetchPlanning ni cambian búsqueda, filtros, página o scroll.
El refresco operativo posterior a completar sigue siendo el existente.
Se retiraron logs de payload que habrían incluido la nueva evidencia financiera.

## Reversas y límites explícitos

La arquitectura actual impide deshabilitar individualmente Usage automático y no ofrece reversa integral de Planning.
La migración impide también insertar una reversa parcial de movimientos con evidencia económica sellada; el intento revierte transaccionalmente.
Las reversas de Usage manual siguen su flujo existente. No se inventa un endpoint de reversa integral ni se borra historia.

HISTORICAL_NO_STOCK y completadas anteriores no reciben backfill automático ni partidas/movimientos/costos inventados.
Usage manual independiente permanece fuera de esta captura; manual_usage_id queda reservado y NULL.
No hay estado void implementado porque no existe todavía reversa integral operativa a coordinar.

El preventivo previo no se conserva todavía. comparison=null y explicación visible: no hay base histórica confiable.
Capturarlo requiere definir qué consulta/tarifa vio y aceptó el usuario y distinguirla del stock a fecha efectiva retrospectiva; no se reconstruye después del consumo.
Esta comparación queda como siguiente microcapacidad permitida por el alcance, sin bloquear el costo real.

Antes de “Plan económico / Costos reales / Resultados” faltan: baseline preventivo versionado, referencias de superficie económica global, agregaciones por campaña/cultivo/lote,
clasificación y evidencia histórica/manual, reversa integral coordinada y corrección explícita de productos ya confirmados.
Rentabilidad, granos, ventas, caja, deuda, compras ERP y cotizaciones automáticas siguen fuera de alcance.

## Validación final (Node v20.20.2)

- Backend económico nuevo: 38/38.
- Backend relacionado: 390 aprobados en total (incluye los 38 nuevos), 1 omitido opcional.
  La corrida conjunta terminó con 385 aprobados, 1 proceso fallido y 1 omitido.
  historicalPlanningProduct.integration.test.js terminó nativamente con exit 3221225477, antes de emitir casos; su repetición aislada aprobó 5/5 sin cambios de código.
  El omitido requiere HISTORICAL_BACKUP_DIR; no se cargaron backups privados ni se accedió a producción para habilitarlo.
- Frontend relacionado: 88/88, incluidos los 5 nuevos de payloads/permisos.
- Navegador económico nuevo: 11/11.
- Regresión de navegador: 46/46 (myTasks, planningList, planningExecution, planningCostEstimate, planningRecipes).
- Total navegador: 57/57. Cobertura 1440 / 1024 / 390, ejecución completa/parcial, USD/ARS/FX,
  beneficiario explícito, multilote, revisiones/paginación, permisos, error aislado y conservación del listado.
- Build Vite correcto; advertencia de chunks mayores a 500 kB.
- git diff --check limpio, incluyendo archivos nuevos mediante git diff --no-index --check.
- Sin dependencias nuevas ni cambio de runtime.

Comandos principales:

```powershell
node --version
# Backend: archivos con prefijos economicExecution, planning, stock, inventory,
# legacyUsage, campaign, harvest, historicalNoStock e historicalPlanningProduct.
node --test --test-concurrency=1 <archivos-backend-relacionados>
node --test tests/historicalPlanningProduct.integration.test.js
# Frontend: archivos planning*, inventory*, myTasks*, campaign* terminados en .test.mjs.
node --test --test-concurrency=1 <archivos-frontend-relacionados>
node --test tests/planningEconomics.test.mjs tests/planningEconomics.browser.mjs
node --test --test-concurrency=1 tests/planningList.browser.mjs tests/myTasks.browser.mjs tests/planningExecution.browser.mjs tests/planningCostEstimate.browser.mjs tests/planningRecipes.browser.mjs
npm run build
git diff --check
```

## Archivos de esta tarea

Modificados (12):

- grow-sync/src/features/planning/Planning.jsx
- grow-sync/tests/planningExecution.browser.mjs
- grow-sync/tests/planningList.fixture.jsx
- grow-sync/tests/planningRecipes.browser.mjs
- growsync-backend/controllers/planning.js
- growsync-backend/routes/planning.js
- growsync-backend/services/planningCompletion.js
- growsync-backend/tests/campaignWindow.integration.test.js
- growsync-backend/tests/planningAssignments.integration.test.js
- growsync-backend/tests/planningEffectiveArea.integration.test.js
- growsync-backend/tests/planningRecipes.integration.test.js
- growsync-backend/validations/planning.schema.js

Nuevos (13):

- docs/economic-execution.md
- grow-sync/src/features/planning/components/ExecutionEconomicFields.jsx
- grow-sync/src/features/planning/components/PlanningActualCost.jsx
- grow-sync/src/features/planning/components/planningEconomics.css
- grow-sync/src/features/planning/planningEconomics.mjs
- grow-sync/tests/planningEconomics.browser.mjs
- grow-sync/tests/planningEconomics.fixture.mjs
- grow-sync/tests/planningEconomics.test.mjs
- growsync-backend/migrations/20261105_economic_execution.sql
- growsync-backend/routes/planningEconomics.js
- growsync-backend/services/economicExecution.js
- growsync-backend/tests/economicExecution.fixture.js
- growsync-backend/tests/economicExecution.integration.test.js

shared/costEstimate.cjs ya estaba sin seguimiento al iniciar. Se reutilizó sin modificarlo; no se agregó al índice.
