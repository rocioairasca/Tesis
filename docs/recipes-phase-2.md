# Recetas — fase 2: snapshots en Planning

La migración `20261012_planning_recipe_snapshots.sql` se entrega para revisión; **no se aplica en Supabase**. Agrega `planning.recipe_id uuid NULL REFERENCES recipes(id)` (origen), `recipe_name_snapshot text NULL`, `planning_products.dose_amount numeric(20,6) NULL` y `dose_unit text NULL`. Checks exigen nombre junto al origen y dosis/unidad juntas, positiva/no NaN y unidad canónica válida. Un trigger asegura que Planning y receta pertenecen a la misma empresa. No hay backfill ni inferencia de dosis.

## Cálculo

`shared/recipeCalculation.cjs` reutiliza `decimalText` y `normalizeQuantity` del inventario. Suma las superficies con BigInt, escogiendo `effective_area_ha ?? area_ha` para cada selección. Multiplica la dosis normalizada por el total efectivo, en micro-unidades. Redondeo **half up** a seis decimales (para cantidades positivas, un empate incrementa el último decimal). Rechaza área/cantidad no positiva, resultados redondeados a cero, incompatibilidad de familias y overflow. Cantidad y dosis se persisten como números decimales exactos; no se usa multiplicación float de JS. `amount/unit` son totales en unidad base del producto; `dose_amount/dose_unit` son la dosis original canónica.

## API

POST /api/planning acepta `recipe_id` opcional. Con receta, no puede venir `products`, ni siquiera vacío. `recipe_name_snapshot` y dosis de cliente se rechazan. Dentro de la misma transacción se bloquea/valida receta activa de la empresa, compatibilidad exacta de actividad y restricciones de contexto/cultivo (NULL general), productos activos y superficie resuelta por Planning. No se comprueba disponibilidad para impedir este CREATE: no hay consumo de inventario.

GET /api/planning/recipe-options, autorizado con planning.create o planning.edit, devuelve recetas activas compatibles y sus items/disponibilidad. Query: activity_type, field_context opcional, crop_id opcional. No exige usage.view para planificar. Omite recetas cuyos productos ya no se pueden agregar. No cambia las claves de permisos existentes.

Las lecturas de Planning exponen **solamente los snapshots persistidos**, no joins a recipes ni recalculaciones. Dosis/totales derivados se exponen como texto decimal para preservar precisión. Lecturas manuales conservan la representación previa y dosis NULL.

## Edición

En planes no completados, una nueva recipe_id revalida receta activa/compatible y reemplaza productos por un snapshot nuevo. Si se conserva el origen y cambia la selección/superficie, se recalcula con las **dosis guardadas**, conservando nombre, unidades, productos y sus identificadores, aunque la receta original haya cambiado o se haya deshabilitado. Un cambio de actividad/contexto/cultivo exige compatibilidad con las restricciones de la receta de origen; si no coincide, se pide quitar/cambiar receta. La verificación de restricciones no cambia nombre ni dosis guardadas.

Quitar receta explícitamente convierte los productos actuales a manuales: conserva cantidades y limpia origen/nombre/dosis. Si además se envían productos manuales, se aplica la edición manual explícita existente. Después de quitar receta, cambiar superficie no modifica sus cantidades automáticamente. Los planes completados/históricos conservan las protecciones de edición; no se agregan recetas a antecedentes históricos.

## Frontend y registro de trabajos realizados

Selector después de superficie, para Fumigación/Fertilización/Siembra. Incluye Sin receta / Carga manual. La edición de un origen existente siempre utiliza su nombre/dosis guardados, no las dosis actuales del catálogo. El preview reacciona a lotes, sublotes, área efectiva y selección de receta, muestra dosis, total normalizado y disponibilidad. El stock insuficiente es una advertencia visual, no un bloqueo de la planificación derivada. Los productos de receta no son editables manualmente; quitándola se conservan como manuales.

**Register-completed bloquea recipe_id en esta fase**, tanto schema/backend como formulario. Se confirmó que el endpoint existente ejecuta completion y consume productos. No se introducen consumos indirectos: al pasar de receta a manual en el modo Ya realizada no se transfieren automáticamente los totales calculados; deben cargarse explícitamente. Complete-work/complete-sowing conservan su semántica existente y no se agrega nueva lógica de ejecución. Crear/editar snapshots no crea Usage, completions ni stock_movements. No hay compras, parsing histórico o reconciliaciones en esta fase.

Los tests aplican migraciones exclusivamente en PostgreSQL embebido descartable; los flujos de navegador usan API sintética y bloquean URLs externas.
