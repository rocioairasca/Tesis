# Tipo de registro al crear Planning

Trabajo en C:\Proyectos\Tesis, sin commit ni staging. Solo frontend y documentación. No se modificaron backend, completion, inventario, históricos, procedencia ni datos reales. No hay migraciones ni endpoints nuevos.

## Nuevo orden

Actividad → ¿La actividad ya se realizó? → Fechas → Situación del lote/cultivo → Lotes/superficie → Responsable → Vehículo → Productos → Observaciones/información secundaria.

La pregunta usa dos opciones visibles de ancho completo: Planificar y Ya realizada. Reutiliza register_completed booleano; el estado inicial sigue siendo false (Planificar). El selector aparece después de elegir actividad e inmediatamente antes de las fechas, únicamente al crear.

## Comportamiento

Planificar conserva Duración (Un día/Período), sus fechas, Cantidad y el selector de estado vigente. Envía POST /planning.

Ya realizada muestra Fecha de realización, usa effective_date existente, muestra Cantidad utilizada y oculta Estado. Conserva el envío existente POST /planning/register-completed y la misma construcción de start_at/end_at a partir del día indicado. El backend existente establece el estado completado y la procedencia. No se agregó ninguna lógica de consumo o de actividades distribuidas en varios días.

Cambiar entre modos limpia date_range y effective_date, reinicia duración en Un día y elimina sus errores anteriores. Conserva actividad, cultivo, situación, lotes, superficie, responsable, vehículo, productos y campaña; las fechas nuevas vuelven a pasar por las validaciones de campaña existentes. No se recalculan cantidades. Se pide seleccionar la nueva fecha, sin reutilizar silenciosamente una fecha oculta.

Al editar no se presenta el selector; se conserva el flujo anterior de edición/completado. El payload de envío no fue modificado: no incluye register_completed ni duration_mode; esos campos siguen siendo decisiones exclusivas de interfaz.

## Pruebas

Ejecutadas desde grow-sync:

node --test tests/planningRegistrationType.test.mjs tests/planningFormFlow.test.mjs tests/planningFieldContext.test.mjs tests/historicalPlanning.test.mjs tests/planningLayout.test.mjs

22 aprobadas. Las nuevas cubren orden, default, selector exclusivo de creación, visibilidad de fechas/estado, etiquetas de cantidades, limpieza en ambas direcciones, conservación de campos compatibles, endpoints/payload existentes y adaptación del booleano a las opciones visuales. Se renderizó el selector con ambos valores y se comprobó ancho completo/min-width 0.

npm run build -- --outDir .tmp-registration-type-build: correcto. Carpeta temporal eliminada. Persisten avisos existentes de ESM/tamaño de chunks y un aviso de puerto HMR ocupado durante pruebas concurrentes; ninguna prueba falló.

git diff --check correcto. La comprobación responsive fue por renderizado de componentes y estilos adaptables, sin recorrido interactivo en navegador.

## Archivos

- grow-sync/src/features/planning/Planning.jsx
- grow-sync/src/features/planning/planningFormFlow.mjs
- grow-sync/src/features/planning/components/PlanningRegistrationType.jsx
- grow-sync/tests/planningRegistrationType.test.mjs
- docs/planning-registration-type.md
- docs/planning-form-flow.md (referencia a la nueva ubicación del selector)
