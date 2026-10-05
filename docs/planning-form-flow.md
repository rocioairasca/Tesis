# Flujo del formulario Planning: actividad y duración

Cambio exclusivamente frontend en C:\Proyectos\Tesis. Sin commit ni staging. Sin modificaciones de backend, base de datos, reglas de inventario o registros existentes. No requiere migración.

## Orden visual

1. Actividad, con mayor jerarquía.
2. Duración: Un día / Período.
3. Fecha, o Desde y Hasta.
4. Situación del lote y cultivo, según las reglas vigentes.
5. Lotes y superficie a trabajar.
6. Responsable.
7. Vehículo.
8. Productos.
9. Descripción/observaciones.
10. Información adicional: Campaña y los controles existentes de registro/estado.

Campaña sigue siendo obligatoria y conserva la selección sugerida y validaciones por fechas. No se agregó un flujo de registrar actividades realizadas: el interruptor y su fecha efectiva ya existían y se conservaron como campos secundarios, con su comportamiento anterior. Cuando se activa ese flujo preexistente se usa su fecha real de realización, no el selector de período de planificación.

Antes de seleccionar actividad no se muestran los campos dependientes. En edición se carga la actividad existente y los campos aparecen inmediatamente. El editor de corrección histórica conserva su rama y componentes anteriores.

## Fechas

Los nombres reales del contrato son start_at y end_at, no start_date/end_date. No se modificaron nombres, columnas ni formato de envío.

El formulario nuevo inicia en Un día. DatePicker muestra Fecha y mantiene internamente el mismo día en ambos extremos. Período muestra dos controles Desde/Hasta y rechaza fechas incompletas o una fecha final anterior a la inicial. Los controles muestran DD/MM/YYYY.

Al editar, se compara el día calendario de start_at/end_at para detectar el modo, sin cambiar los valores guardados al abrir. Cambiar de período a un día reemplaza realmente la fecha final por la inicial; volver a período conserva esa fecha inicial y permite elegir otra final. duration_mode existe solamente en el formulario y no se envía al backend.

La función común de presentación devuelve una fecha cuando coinciden o DD/MM/YYYY al DD/MM/YYYY cuando difieren. La usan tabla, lista compacta, tarjetas de calendario y detalle. El detalle adapta su etiqueta a Fecha o Período.

## Cambio de actividad

Fumigación/fertilización mantienen Situación del lote y las etiquetas de cultivo ya aprobadas. Pasar a siembra u otra actividad que no utiliza esa situación limpia únicamente field_context. Conserva crop_id, fechas, responsable, vehículo y productos compatibles. Las reglas de superficie de siembra ya existentes siguen llevando la selección a su superficie completa. No se agregaron reglas funcionales nuevas ni se modificó la validación backend.

## Verificación

node --test tests/planningFormFlow.test.mjs tests/planningFieldContext.test.mjs tests/planningLayout.test.mjs tests/historicalPlanning.test.mjs

16 pruebas aprobadas: modo inicial, fechas del payload existente, período válido/invertido/incompleto, detección de edición, eliminación del final oculto, fecha única en presentación, limpieza selectiva al cambiar actividad, orden y visibilidad de campos, carga de edición, contrato del payload, renderizado de controles, compatibilidad agronómica e histórica y diseño compacto.

npm run build -- --outDir .tmp-planning-flow-build: compilación correcta. Se eliminó la carpeta temporal al terminar. Se mantienen avisos existentes de ESM/tamaño de chunks; la ejecución concurrente de pruebas SSR informó puerto HMR ocupado sin fallar.

git diff --check correcto. No se ejecutaron pruebas backend porque no cambió código backend.

Responsive: controles de ancho completo y rejilla adaptable que apila Desde/Hasta en espacios angostos; drawer conserva scroll y altura móvil existentes. Verificación mediante renderizado de componentes y compilación; no se realizó recorrido interactivo de navegador.

## Archivos modificados/agregados

- grow-sync/src/features/planning/Planning.jsx
- grow-sync/src/features/planning/planningDisplay.js
- grow-sync/src/features/planning/planningFormFlow.mjs
- grow-sync/src/features/planning/components/PlanningDateFields.jsx
- grow-sync/tests/planningFormFlow.test.mjs
- docs/planning-form-flow.md
