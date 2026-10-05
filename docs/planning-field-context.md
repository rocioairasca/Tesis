# Situación del lote en Planning

Implementación local en C:\Proyectos\Tesis. Sin commit ni staging. No se leyó ni modificó producción, no se cargó Santos y no se actualizaron registros reales.

## Diseño y migración

20261008_planning_field_context.sql agrega planning.field_context TEXT NULL con CHECK de cinco valores: growing_crop, stubble, fallow, pre_sowing y other, y COMMENT explicativo. No incluye UPDATE ni backfill. Las filas preexistentes siguen con NULL. Debe aplicarse antes de desplegar el backend que consulta la columna; solo fue ejecutada en bases descartables de prueba.

crop_id sigue referenciando el mismo catálogo y conserva compatibilidad con filtros. El significado depende de la situación: cultivo implantado, origen del rastrojo, cultivo previsto u otro cultivo relacionado. No se introduce otra tabla ni se modifica campaña, cosecha o ciclo productivo.

## Validaciones

Nuevas fumigaciones y fertilizaciones, incluidas register-completed, requieren situación explícita. Cultivo implantado y rastrojo requieren crop_id; barbecho, pre-siembra y otro admiten NULL. El cultivo informado sigue validándose contra la empresa. Valores desconocidos se rechazan en API y base de datos.

PATCH valida la combinación final de actividad/contexto/cultivo con los valores guardados, no solamente el fragmento enviado. Un registro legacy con situación NULL puede seguir editándose sin completarla. Un registro que ya la tiene no puede borrarla mientras siga siendo fumigación/fertilización. Cambiar otra actividad a fumigación/fertilización requiere indicarla. Las restricciones existentes sobre actividades completadas/con consumos se mantienen; no se cambia su contexto desde la edición ordinaria.

Siembra mantiene cultivo obligatorio. Cualquier contexto recibido para siembra se normaliza a NULL: el cultivo sigue siendo lo que se siembra. Los servicios de creación/cierre de ciclos no se modifican.

Los clientes que crean nuevas fumigaciones/fertilizaciones deben incorporar el campo; el frontend actualizado lo envía. Esta exigencia es deliberada, no se infiere desde información previa.

## Suposiciones revisadas

- validations/planning.schema.js y controllers/planning.js exigían cultivo en todas las fumigaciones/fertilizaciones. Ahora aplican las reglas compartidas de planningFieldContext.js.
- services/planningCompletion.js copiaba siempre crop_name a usage_records.current_crop. Para nuevas actividades con contexto no implantado deja current_crop NULL, conservando usage_records.crop_id como referencia para filtros. No infiere un cultivo anterior ni crea relaciones. NULL legacy y siembra mantienen el comportamiento previo. Cantidades, superficie efectiva y consumo de inventario siguen iguales.
- Solo completeSowingPlanning llama a completeNormalSowingAssignments/completeHistoricalSowingAssignments; sus controles por activity_type ya impedían que una fumigación creara ciclos. Se conservan. Los endpoints manuales de cropAssignments son otro flujo, no los llama field_context.
- planningDisplay.js trataba el nombre de crop_id como título sin distinción. Detalle, títulos, lista y calendario ahora expresan Rastrojo de Maíz, Pre-siembra, etc. Las notificaciones de nueva actividad/completado también usan esa descripción.
- Los filtros de Planning siguen comparando crop_id. Las estadísticas no se rediseñan: una agrupación por cultivo incluye referencias a ese cultivo y no demuestra implantación.
- controllers/lots/history.js conserva su proyección previa de crop/crop_id como referencia de la actividad, sin field_context. No crea ciclos. La extensión visual de esa cronología queda fuera del detalle de Planning solicitado; no debe interpretarse su referencia al cultivo como prueba de implantación. campaigns.js consulta Planning para dependencias/conteos y crop_assignments por separado; no convierte crop_id de Planning en un ciclo.

## Interfaz

Fumigación/fertilización muestran Situación del lote con Cultivo implantado, Rastrojo, Barbecho, Pre-siembra y Otro. El selector de cultivo adapta su etiqueta a Cultivo, Rastrojo de, Cultivo previsto o Cultivo relacionado (opcional). No se preselecciona ni infiere una situación. Los legacy muestran Sin especificar.

El detalle muestra frases funcionales, por ejemplo Rastrojo de Maíz. Los títulos existentes se adaptan sin agregar columnas. El editor histórico sigue separado y no se refactorizó. No se muestran nombres internos como etiquetas de usuario.

## Pruebas

- node --test --test-reporter=spec tests/planningEffectiveArea.integration.test.js: 16 aprobadas. Incluye Santos sintético 101.3/10 ha, rastrojo de Maíz, create/read/edit, ciclos existentes idénticos, sin movimientos al crear/editar, todas las combinaciones solicitadas, rechazo de contexto desconocido, legacy NULL, CHECK, migración sin backfill, siembra con ciclo y completion de rastrojo sin cultivo actual ni ciclo.
- node --test --test-reporter=spec tests/historicalNoStock.integration.test.js tests/stockInitial.integration.test.js: 25 aprobadas, 1 aceptación omitida por condición previa. Históricos e inventario conservan sus protecciones.
- node --test tests/planningFieldContext.test.mjs tests/historicalPlanning.test.mjs tests/planningLayout.test.mjs: 8 aprobadas.
- npm run build -- --outDir .tmp-field-context-build: correcto, con avisos existentes de ESM y tamaño de chunks. Carpeta temporal eliminada.
- git diff --check: correcto.

Las pruebas de backend usan PGlite. La prueba de siembra usa geometrías NULL y sustituye únicamente las consultas de intersección por el resultado vacío correspondiente, comprobando primero que la geometría seleccionada sea NULL; no verifica cálculos PostGIS. No se hizo recorrido visual interactivo del navegador.

Se encontró una incompatibilidad previa con Zod instalado: baseBody.partial() sobre un objeto con refinamientos impedía cargar el esquema. PATCH ahora se construye desde z.object(baseBodyShape).partial(), conserva sus refinamientos específicos y valida contexto combinado en el controlador.

## Archivos

- growsync-backend/migrations/20261008_planning_field_context.sql
- growsync-backend/services/planningFieldContext.js
- growsync-backend/services/planningCompletion.js
- growsync-backend/controllers/planning.js
- growsync-backend/validations/planning.schema.js
- growsync-backend/tests/planningEffectiveArea.integration.test.js
- growsync-backend/tests/historicalNoStock.integration.test.js
- growsync-backend/tests/stockInitial.integration.test.js
- grow-sync/src/features/planning/fieldContext.mjs
- grow-sync/src/features/planning/planningDisplay.js
- grow-sync/src/features/planning/Planning.jsx
- grow-sync/tests/planningFieldContext.test.mjs
- docs/planning-field-context.md
