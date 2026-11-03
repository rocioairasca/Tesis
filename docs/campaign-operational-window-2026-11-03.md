# Ventana operativa de campañas

Base: df35f584847cdffaa38ce7dc0916fc717c1cfe9e.

## Modelo y migración

Se conservan start_date/end_date como fechas oficiales y work_start_date como inicio de trabajos. La migración 20261103_add_campaign_work_end_date.sql agrega work_end_date y copia end_date, incluidos sus null. No cambia IDs, asociaciones ni work_start_date. No consulta ni corrige referencias históricas.

Ventana efectiva inclusiva: COALESCE(work_start_date, start_date) a COALESCE(work_end_date, end_date). Si el fin efectivo es null, no hay límite superior conocido. Status active/closed sigue siendo administrativo; las ventanas superpuestas y las campañas simultáneas siguen permitidas.

Las restricciones existentes conservan work_start_date <= start_date <= end_date cuando hay fechas. La nueva restricción exige que work_end_date explícito tenga un end_date conocido y sea igual o posterior. Un fin de trabajos definido sin fin oficial sería incompatible con garantizar que la ventana cubra el período oficial: por eso se rechaza. Para abrir ambos fines hay que enviar ambos null.

La migración debe aplicarse antes de ejecutar el backend nuevo. En esta implementación se ejecuta únicamente en PGlite descartable para pruebas; no se aplica a bases operativas.

## Planning

Todas las actividades, incluida siembra creada, registrada como realizada y completada, usan la misma ventana operativa. Los dos extremos del rango se verifican. Se mantienen la identidad explícita campaign_id, el aislamiento por empresa y las autorizaciones para usar campañas cerradas.

El selector muestra las campañas autorizadas, compatibles primero y el resto después, con los dos períodos identificados. Cambiar fecha nunca selecciona, reemplaza ni borra la campaña. Una nueva operación incompatible no se guarda.

Una planificación previa incompatible conserva su ID y muestra la advertencia. Si no cambian fecha/rango/campaña, se permite corregir otros datos; el frontend omite timestamps sin cambios para conservar la hora guardada. El backend compara valores efectivos y no la mera presencia de campos. Las protecciones de consumos y HISTORICAL_NO_STOCK permanecen vigentes.

## Edición de campañas e históricos

Renombrar o ampliar una campaña no revalida anomalías preexistentes. Una reducción comprueba las fechas que estaban dentro de la ventana anterior y quedarían afuera de la nueva; responde 409 con mínimo, máximo y cantidad de fechas afectadas. El diagnóstico incluye inicio, fin y fecha efectiva de Planning, fechas de ciclos y cosechas. Los timestamps calendario de Planning se convierten a fecha UTC para que el diagnóstico no dependa de la zona de la sesión SQL.

No se reasigna ni repara ningún registro histórico. Los filtros, agregaciones y compatibilidad legacy de cosechas siguen usando sus reglas actuales de identidad.

## Ciclos: alcance conservador y pendiente

El inicio operativo y el fin operativo sustituyen a los límites oficiales en las comprobaciones existentes de crop_assignments y en Lotes. No se agrega obligación de cerrar ciclos ni de hacer coincidir su fin biológico con el fin de campaña.

Se conserva la regla previa del backend: inicio >= inicio efectivo; si el ciclo tiene fin y la campaña tiene fin efectivo, fin de ciclo <= fin efectivo. Un ciclo abierto no agrega un límite nuevo sobre su fin. La UI ya comprueba que las fechas ingresadas estén dentro del período y ahora usa el operativo.

Queda pendiente una decisión de producto sobre desacoplar el fin biológico de la campaña y armonizar la validación superior del inicio de ciclos abiertos en API/UI. Esta fase no endurece esa regla ni reinterpreta cierres legacy/manuales/automáticos. Las reconciliaciones históricas específicas no se modifican.

## Revisión manual de datos

La migración no amplía automáticamente ninguna campaña. Para permitir trabajos después del fin oficial debe definirse work_end_date explícitamente.

La evidencia de auditoría es un snapshot local de 2026-09-16, no una consulta actual de producción. Allí Gruesa 2025-2026 tiene fin 2026-08-09 y referencias posteriores hasta 2026-09-11: requieren revisión manual antes de decidir una ampliación. Las fechas de Gruesa 2026-2027 usadas en los tests son sintéticas; no constituyen una actualización de esa campaña en producción.

## Validación

Las pruebas nuevas cubren límites inclusivos, siembra de octubre, ejecución después del fin oficial, rangos completos, solapamientos con ID explícito, aislamiento por empresa, campañas abiertas, backfill, reducción/expansión, edición histórica y ciclos. El navegador utiliza la UI real con transporte HTTP simulado, sin conexiones de producción, a 1440/1024/390 px.


### Resultados ejecutados

Node.js v20.20.2. Edge headless en browser.

| Grupo | Pass | Fail | Omitidos |
|---|---:|---:|---:|
| Backend: Planning, ejecución y cosechas | 137 | 0 | 0 |
| Backend: ventana operativa nueva | 26 | 0 | 0 |
| Backend: históricos y declaraciones | 139 | 0 | 1 |
| Frontend unitario | 42 | 0 | 0 |
| Browser: ventana operativa 1440/1024/390 | 10 | 0 | 0 |
| Browser: planningList | 9 | 0 | 0 |
| Browser: myTasks | 9 | 0 | 0 |
| Browser: planningExecution | 15 | 0 | 0 |
| Browser: planningRecipes | 5 | 0 | 0 |
| Browser: planningResponsive | 10 | 0 | 0 |


La omisión corresponde a la aceptación de backup de historicalNoStock.integration.test.js, que requiere HISTORICAL_BACKUP_DIR. No se utilizaron datos de producción para reemplazar esa fixture opcional.

Build frontend: npm run build correcto (advertencia de bundles mayores a 500 kB). git diff --check: correcto.

Comandos de backend (desde growsync-backend):

```powershell
node --test tests/planningAssignments.integration.test.js tests/planningEffectiveArea.integration.test.js tests/planningRecipes.integration.test.js tests/planningExecution.test.js tests/partialHarvests.integration.test.js tests/harvestRegistration.test.js tests/harvestAreas.test.js
node --test tests/campaignWindow.integration.test.js
node --test tests/historicalNoStock.integration.test.js tests/historicalPlanningProduct.integration.test.js tests/reconcileSowing.integration.test.js tests/reconcileBarleyT3.integration.test.js tests/productiveStateDeclarations.integration.test.js
```

Comandos de frontend (desde grow-sync; suites browser ejecutadas secuencialmente):

```powershell
node --test tests/campaigns.test.mjs tests/campaignWindow.test.mjs tests/planningList.test.mjs tests/planningFormFlow.test.mjs tests/planningRegistrationType.test.mjs tests/planningExecution.test.mjs tests/historicalPlanning.test.mjs tests/lotsOverview.test.mjs tests/harvestPresentation.test.mjs
node --test tests/campaignWindow.browser.mjs
node --test tests/planningList.browser.mjs
node --test tests/myTasks.browser.mjs
node --test tests/planningExecution.browser.mjs
node --test tests/planningRecipes.browser.mjs
node --test tests/planningResponsive.browser.mjs
npm run build
```

Los dos tests de creación con recetas se adaptaron para seleccionar explícitamente la campaña. No se cambió la lógica de recetas. Las tres fixtures backend existentes incorporan la nueva migración a sus bases descartables.

### Archivos de esta implementación

- `grow-sync/src/features/lots/LotDivisions.jsx`
- `grow-sync/src/features/planning/Planning.jsx`
- `grow-sync/src/utils/campaigns.mjs`
- `grow-sync/tests/planningRecipes.browser.mjs`
- `growsync-backend/controllers/campaigns.js`
- `growsync-backend/controllers/cropAssignments.js`
- `growsync-backend/controllers/planning.js`
- `growsync-backend/services/planningCompletion.js`
- `growsync-backend/tests/planningAssignments.integration.test.js`
- `growsync-backend/tests/planningEffectiveArea.integration.test.js`
- `growsync-backend/tests/planningRecipes.integration.test.js`
- `growsync-backend/validations/campaigns.schema.js`
- `docs/campaign-operational-window-2026-11-03.md`
- `grow-sync/tests/campaignWindow.browser.mjs`
- `grow-sync/tests/campaignWindow.fixture.jsx`
- `grow-sync/tests/campaignWindow.test.mjs`
- `growsync-backend/migrations/20261103_add_campaign_work_end_date.sql`
- `growsync-backend/services/campaignWindow.js`
- `growsync-backend/tests/campaignWindow.integration.test.js`
