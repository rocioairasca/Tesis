# Superficie efectiva de Planning — fase 1

Implementado en C:\Proyectos\Tesis. Sin staging ni commit. No se consultó producción ni se modificaron datos reales. Santos se representa exclusivamente mediante datos sintéticos en una base descartable.

## Diseño

planning_lots.area_ha conserva la superficie estructural guardada. La nueva columna effective_area_ha es NUMERIC(12,4) nullable, igual que area_ha. Su valor efectivo es COALESCE(effective_area_ha, area_ha). No hay backfill, actualización masiva ni reinterpretación de superficies históricas.

La migración 20261007_planning_effective_area.sql agrega columna y CHECK: si no es NULL, debe ser positiva, distinta de NaN y no superar un area_ha no nulo. Debe aplicarse antes de desplegar el código que consulta la columna. Solo se ejecutó en PGlite descartable durante las pruebas.

El backend acepta effective_area_ha en lot_selections, como número o decimal con punto/coma, hasta cuatro decimales. Omitido o NULL significa toda la superficie seleccionada. El payload legado lot_ids sigue funcionando. Nunca toma area_ha del cliente: resuelve lote/sublote, pertenencia a empresa y superficie del catálogo. Las superficies nuevas/modificadas se validan contra la superficie física actual y el snapshot conservado. Las selecciones sin cambios conservan el snapshot y la compatibilidad con divisiones archivadas o geometrías modificadas.

La validación y persistencia de selecciones se extrajeron a planningSelections.js para compartir y probar la misma lógica utilizada por create, update y register-completed. Al editar solo superficie se actualiza el nuevo campo sin recrear vínculos. Se bloquea la fila de Planning durante la edición para serializarla con el completado.

## Respuestas, completado e inventario

Los listados y detalle devuelven area_ha y effective_area_ha resuelto por COALESCE para cada lote/sublote, junto con sus nombres. planned_area_ha es ROUND(SUM(COALESCE(effective_area_ha, area_ha)),4).

Al completar Planning, usage_records.total_area toma la suma de superficies efectivas guardadas. Las cantidades planificadas/reales de producto no se recalculan. El consumo sigue usando la cantidad explícita; el caso probado de 10 ha consume exactamente 7 kg cuando esa es la cantidad indicada.

La edición de una Planning completada conserva superficies e identidades; rechaza intentos de cambiarlas, y no vuelve al catálogo para recalcularlas. No se agregan procesos que reaccionen a cambios de geometría. Se mantienen los bloqueos existentes sobre planificaciones con consumos registrados.

Crear/editar superficie no genera movimientos. Completar conserva el flujo habitual de inventario con sus validaciones. No se cambian históricos, cosechas ni crop_assignments, ni se modifica su editor.

## Actividades y conflictos

Fumigación, fertilización, riego, mantenimiento y otro admiten superficie parcial. Siembra conserva toda la superficie seleccionada: un lote completo o un sublote existente completo. No se introduce siembra parcial dentro de un sublote ni se cambia la creación de ciclos. Cosecha conserva su comportamiento existente.

Los conflictos siguen dependiendo únicamente de lote/sublote y período. Una actividad parcial sobre un lote completo también entra en conflicto con los sublotes del mismo lote según las reglas existentes. register-completed mantiene su excepción previa de comprobación de agenda; no se modificó esa regla.

## Interfaz

Se agrega Superficie a trabajar a cada selección, precargada con la superficie completa, con unidad ha y ayuda: Podés indicar una superficie menor sin crear una división. Admite punto/coma. Siembra y registros completados muestran el campo deshabilitado.

El resumen y detalle usan Superficie total. En detalle/completado, un parcial se presenta como 10 ha trabajadas de 101,3 ha; si ambas superficies coinciden se muestra una sola. La tabla y la lista compacta usan el total efectivo, incluido su fallback. El calendario utiliza el mismo drawer/detalle. Controles de ancho completo y texto ajustable para pantallas angostas. El editor histórico permanece separado y conserva sus valores y payload actuales.

## Verificación

- Suite nueva: node --test --test-reporter=spec tests/planningEffectiveArea.integration.test.js: 10 pruebas aprobadas. Cubren create/get/update reales, omisión/NULL/legado, límites y precisión, tenant, sublote de 41.08 con 20 efectivas, siembra parcial rechazada/full válida, conflictos, snapshot completado, completion/usage/productos, register-completed, CHECK y migración sobre filas preexistentes.
- Regresiones aisladas de historicalNoStock, stockInitial y historicalHarvestAdoption: 34 aprobadas y 1 aceptación omitida por su condición previa. Incluidas en una ejecución conjunta con las primeras 7 pruebas nuevas: 41 aprobadas y 1 omitida. Las 10 nuevas se volvieron a ejecutar después del ajuste final de edición.
- Frontend: planningEffectiveArea.test.mjs, historicalPlanning.test.mjs y planningLayout.test.mjs: 8 aprobadas. Verifican fallback y formato argentino, formulario renderizado, protección de completados, editor histórico e integración de vistas compactas.
- Compilación Vite correcta en carpeta temporal. Avisos existentes de configuración ESM y tamaño de chunks. La suite frontend concurrente informó puerto HMR ocupado; las pruebas finalizaron correctamente.
- Las pruebas usan PGlite y geometrías sintéticas como texto; no ejecutan PostGIS. La UI se verificó por renderizado de componentes y compilación, sin recorrido interactivo en navegador.

## Archivos

- growsync-backend/migrations/20261007_planning_effective_area.sql
- growsync-backend/services/planningSelections.js
- growsync-backend/controllers/planning.js
- growsync-backend/services/planningCompletion.js
- growsync-backend/validations/planning.schema.js
- growsync-backend/tests/planningEffectiveArea.integration.test.js
- growsync-backend/tests/historicalNoStock.integration.test.js
- growsync-backend/tests/stockInitial.integration.test.js
- growsync-backend/tests/historicalHarvestAdoption.fixture.js
- grow-sync/src/features/planning/Planning.jsx
- grow-sync/src/features/planning/effectiveArea.mjs
- grow-sync/src/features/planning/components/EffectiveAreaFields.jsx
- grow-sync/src/features/planning/components/PlanningListMobile.jsx
- grow-sync/src/features/planning/components/PlanningTable.jsx
- grow-sync/tests/planningEffectiveArea.test.mjs
- docs/planning-effective-area.md
