# Recetas — fase 3: ejecución con cantidades reales

No requiere migración. La migración de Fase 2 ya instalada sigue siendo suficiente. No se aplica SQL en Supabase ni se escriben datos reales.

## Arquitectura

Planificar conserva Fase 2: snapshot de nombre/dosis, cantidades derivadas de superficie efectiva y cero efectos de inventario. La ejecución conserva planning_products.amount/unit y registra cantidades reales en planning_product_completions.actual_amount. Usage y movimientos se generan únicamente por cantidades reales positivas; cero crea completion sin Usage ni movimiento.

Register-completed crea el snapshot y resuelve las cantidades reales por product_id contra los planning_products recién persistidos, dentro del mismo BEGIN/COMMIT. Valida cobertura completa, pertenencia, duplicados, precisión y conversiones con inventoryConversion. Luego delega en completeWorkPlanning/completeSowingPlanning, applyPlanningProductUsage y stock.consumeStock existentes. Cualquier fallo revierte Planning, sus relaciones, completions, Usage, movimientos y asignaciones productivas.

No se cambian permisos, reglas productivas, FEFO, validación de fecha/partidas ni endpoints antiguos. Complete-work y complete-sowing siguen recibiendo planning_product_id, sin exigir retrospectivamente cobertura completa. No consultan la receta actual para ejecutar snapshots guardados.

## Contrato register-completed

Ambos modos conservan los campos comunes existentes: activity_type, field_context/crop_id según actividad, campaña, responsable, start_at/end_at, effective_date y lot_ids o lot_selections. El origen no es obligatorio.

Manual:

```json
{
  "products": [{"product_id": "<uuid>", "amount": "24", "unit": "L"}]
}
```

No envía actual_products. Sigue utilizando las cantidades manuales como cantidades ejecutadas.

Receta:

```json
{
  "recipe_id": "<uuid>",
  "actual_products": [{"product_id": "<uuid>", "actual_amount": "24000", "unit": "mL"}]
}
```

No envía products, nombres ni dosis. Debe confirmar todos los productos del snapshot, incluso los no utilizados (actual_amount=0). Los decimales se conservan como texto; se admiten hasta seis decimales. Unidad obligatoria y compatible con la unidad base de DB. Payload incompleto/ajeno/duplicado/inválido da 400; falta de stock utilizable da 409 con rollback.

Ejemplo: dosis 2.5 L/ha, superficie 10 ha, real 24 L conserva amount=25 L, completion=24 L, Usage=24 L y movimiento=-24 L. Planificado 25/real 20/stock 22 se ejecuta; real 24/stock 22 falla.

## Formulario

Recetas compatibles disponibles también en Ya realizada. Preview con dosis/ha y total planificado, seguido de Productos utilizados con cantidades reales precompletadas y editables mediante QuantityUnitFields. Acepta cero y conversión de familia existente. El stock visible es una referencia; backend valida según fecha efectiva.

La clave de resincronización incluye receta, actividad/contexto/cultivo, selección de superficies y totales calculados; excluye fecha, responsable y descripción. Cambiar los primeros reinicia la confirmación con los nuevos totales; modificar metadatos conserva los valores editados. Una planificación futura no muestra campos reales durante creación. Al completar una planificación guardada, el modal muestra nombre/dosis históricos, planificado, real editable y disponibilidad.

Al elegir carga manual desde Ya realizada no se transfieren automáticamente los totales de receta: se requiere carga manual explícita, conservando la decisión anterior de seguridad.

## Verificación

Los tests usan PGlite descartable o APIs sintéticas de navegador. Las APIs reales y URLs externas se bloquean en el navegador de pruebas. No se utiliza .env ni Supabase para los nuevos tests. La suite backend se ejecuta con configuración de conexiones locales inválidas para impedir conexiones productivas.

## Archivos

Modificados: growsync-backend/controllers/planning.js; growsync-backend/services/planningRecipes.js; growsync-backend/validations/planning.schema.js; growsync-backend/tests/planningRecipes.integration.test.js; grow-sync/src/features/planning/Planning.jsx; grow-sync/src/features/planning/components/PlanningRecipeFields.jsx; grow-sync/src/features/planning/planningRecipe.mjs; grow-sync/tests/planningRecipes.test.mjs; grow-sync/tests/planningRecipes.browser.mjs; grow-sync/tests/planningRecipes.fixture.jsx.
Nuevo: docs/recipes-phase-3.md.

## Resultados

Suite completa backend: 491 tests, 486 aprobados, 5 omitidos, 0 fallos. Los cinco condicionales requieren backup de aceptación o PostgreSQL/PostGIS/concurrencia externos. La integración Planning/Recetas incluye 39 casos aprobados (no sumar nuevamente al total).
Frontend relacionado: 55 aprobados, 0 fallos. Build frontend correcto. Sin migración, commit, push, despliegue ni escrituras productivas.

Browser Planning/Recetas: 7 aprobados, 0 fallos (incluye payload real, resincronización, snapshots y mobile). git diff --check correcto; revisión completa del diff realizada.
