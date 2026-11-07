# Modal de registro de Planning y porción manual

## Presentación

El formulario crear/editar usa un modal de 1320 px, limitado al viewport, con
header/footer fuera del cuerpo desplazable. En mobile ocupa casi toda la pantalla.
Orden: Trabajo, Contexto productivo, Ubicación, Recursos, Productos, Costo de la
labor, Observaciones. El detalle y los diálogos de ejecución conservan su flujo.

Campaña se mantiene explícita. Cultivo se presenta como Cultivo beneficiario;
la confirmación económica por ubicación sigue siendo explícita cuando corresponde.
Responsable, vehículo y receta comparten fila cuando hay espacio. Productos usa
controles compactos con lápiz/tachito y tooltips de hover/foco, sin iconos junto al
nombre. Las dosis ingresadas manualmente son sólo ayudas de edición: se envían
las cantidades y unidades existentes, sin nuevos campos de dosis al backend.
Las recetas conservan su snapshot y cálculo existentes. La labor pendiente oculta
los campos monetarios sólo en este formulario; no modifica revisiones económicas.

## Persistencia mínima

Migración nueva: `20261108_planning_selection_mode.sql`.
Añade `planning_lots.selection_mode`, nullable, sin backfill:

- `full_lot`: lote completo, sin sub_lot_id.
- `sub_lot`: sublote existente, con sub_lot_id.
- `manual_portion`: porción manual, sin sub_lot_id ni geometría.
- NULL: registros previos/históricos conservados sin reinterpretar sus snapshots.

Se reutiliza la separación existente: `area_ha` conserva la superficie estructural
capturada; `effective_area_ha` conserva la superficie operativa seleccionada.
Ejemplo: lote de 68,30 ha y porción de 30 ha se guarda con area_ha=68.30,
effective_area_ha=30.00 y selection_mode=manual_portion. La API de lectura expone
el modo inferido de los campos previos cuando la columna está en NULL; no escribe
esa inferencia en la DB. No se crea ningún sublote, polígono o asignación de cultivo.

Se conservan los endpoints. Ejemplo de `lot_selections`:

```json
[{"lot_id":"<uuid>","sub_lot_id":null,"selection_mode":"manual_portion","effective_area_ha":30}]
```

Validación: superficie positiva, hasta 4 decimales y no superior a la selección
estructural disponible. El servidor resuelve el área y la empresa; no confía en un
area_ha enviado por el cliente. Las actividades completadas no cambian superficie.
La migración debe aplicarse antes del backend actualizado. Sólo se ejecutó en bases
PostgreSQL descartables de tests; no se ejecutó en producción ni bases persistentes.

## Conflictos y limitaciones

Se conserva el chequeo por identidad y fechas: al no tener geometría, una porción
manual entra en conflicto con cualquier selección del mismo lote que se superponga
en el tiempo (lote completo, otra porción o un sublote), según los estados y límites
de fecha existentes. Nunca se supone separación espacial entre dos porciones.

Por decisión confirmada del usuario, siembra y cosecha siguen usando la superficie
completa de la selección; admiten lote completo o sublote, pero no superficie parcial.
Las labores que ya admitían superficie parcial la mantienen. Los sublotes existentes
con superficie operativa menor también conservan ese comportamiento.
No se cambia FEFO, reglas de consumo, modelos de valorización ni snapshots económicos.
Sin commit, push ni deploy.

## Validación

Runtime: Node.js v20.20.2. Sólo suites relacionadas con Planning y su ejecución.
Los navegadores usan fixtures sintéticos y bloquean requests fuera de localhost.

- Backend: `planning*.test.js`, `economicExecution.integration.test.js` y
  `campaignWindow.integration.test.js`: 206/206 aprobados.
- Históricos: `historicalNoStock.integration.test.js`,
  `historicalHarvestAdoption.integration.test.js` y
  `historicalPlanningProduct.integration.test.js`: 29 aprobados, cero fallos;
  un caso de backup omitido porque no se configuró `HISTORICAL_BACKUP_DIR`.
- Frontend: `planning*.test.mjs` y `historicalPlanning*.test.mjs`: 58 casos
  cubiertos. La corrida inicial pasó 56; tras adaptar el contexto Ant Form del
  fixture y el nombre visual Cultivo beneficiario, las dos suites afectadas
  pasaron 12/12. No quedan fallos pendientes.
- Browser `planningRecipes.browser.mjs`: 10 casos aprobados entre la corrida
  inicial y las repeticiones dirigidas: cinco flujos de recetas, tres tamaños
  del rediseño, restricciones de selección y edición de porción manual.
- Browser `planningExecution.browser.mjs`: 15/15 aprobados.
- Browser `planningEconomics.browser.mjs`: 11/11 en la corrida final. Se hizo
  determinista la selección del helper del test mediante la opción visible.
- Browser `planningList.browser.mjs`: nueve casos aprobados; siete en la corrida
  inicial y los dos de edición tras actualizar el selector del textarea a
  Observaciones. Ambos pasaron en la repetición dirigida.
- Responsive: 1440 / 1024 / 390 px, sin overflow horizontal, con footer visible,
  más inspección de capturas de los tres tamaños.
- `npm run build`: correcto. Advertencia de bundles mayores a 500 kB.
- `git diff --check`: limpio; nuevos archivos comprobados también por separado.

Las primeras corridas también detectaron que el tooltip del lápiz no respondía
al foco de teclado. Se corrigió con trigger hover/focus y se verificaron de nuevo
los tres tamaños. No se alteraron reglas económicas para resolver los tests.

## Archivos de esta implementación

- `docs/planning-registration-modal.md`
- `grow-sync/src/features/planning/Planning.jsx`
- `grow-sync/src/features/planning/components/EffectiveAreaFields.jsx`
- `grow-sync/src/features/planning/components/ExecutionEconomicFields.jsx`
- `grow-sync/src/features/planning/components/PlanningFormProducts.jsx`
- `grow-sync/src/features/planning/components/PlanningFormSection.jsx`
- `grow-sync/src/features/planning/components/PlanningRecipeFields.jsx`
- `grow-sync/src/features/planning/planning.css`
- `grow-sync/tests/planningEconomics.browser.mjs`
- `grow-sync/tests/planningEffectiveArea.test.mjs`
- `grow-sync/tests/planningFieldContext.test.mjs`
- `grow-sync/tests/planningFormFlow.test.mjs`
- `grow-sync/tests/planningList.browser.mjs`
- `grow-sync/tests/planningRecipes.browser.mjs`
- `grow-sync/tests/planningRecipes.fixture.jsx`
- `grow-sync/tests/planningRecipes.test.mjs`
- `grow-sync/tests/planningRegistrationType.test.mjs`
- `growsync-backend/controllers/planning.js`
- `growsync-backend/migrations/20261108_planning_selection_mode.sql`
- `growsync-backend/services/planningSelections.js`
- `growsync-backend/tests/economicExecution.fixture.js`
- `growsync-backend/tests/historicalHarvestAdoption.fixture.js`
- `growsync-backend/tests/historicalNoStock.integration.test.js`
- `growsync-backend/tests/planningEffectiveArea.integration.test.js`
- `growsync-backend/validations/planning.schema.js`
