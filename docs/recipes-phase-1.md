# Recetas — fase 1

Recetas son plantillas de productos y dosis por hectárea. No tienen lotes, superficie trabajada, campaña ni ejecución. No crean Usage, planning_products, completions o movimientos de stock. No se migran registros históricos existentes.

## Modelo y migración

`growsync-backend/migrations/20261012_recipes.sql` crea `recipes` y `recipe_items`, con UUID, timestamps, soft delete, índice único por empresa/nombre normalizado solo para recetas activas, producto único por receta y dosis numeric(20,6) positivas. Triggers validan empresa del cultivo, autor y productos; los productos nuevos deben estar habilitados. Un constraint trigger diferido exige al menos un item al terminar la transacción. RLS está habilitado sin políticas de acceso directo desde clientes; la API usa la conexión SQL existente.

La migración se entrega para revisión: **no se aplica en producción**. API/frontend requieren esas tablas antes de desplegarse. Los tests la aplican únicamente en PGlite descartable.

La API valida las dosis con `shared/inventoryConversion.cjs` antes de escribir; conserva cantidad/unidad ingresadas (aliases canónicos, por ejemplo cc → mL). No convierte entre familias ni guarda `/ha` en dose_unit. Las restricciones numeric SQL no reemplazan esta validación, ya que PostgreSQL puede redondear entradas con demasiados decimales al castear a numeric(20,6).

## API y permisos

Todos los endpoints están detrás de checkJwt, userData y requireTenant. Empresa/actor vienen de la sesión, nunca del body.

| Endpoint | Permiso |
| --- | --- |
| GET /api/recipes | usage.view |
| GET /api/recipes/options | usage.view |
| GET /api/recipes/:id | usage.view |
| POST /api/recipes | usage.create |
| PUT /api/recipes/:id | usage.edit |
| DELETE /api/recipes/:id | usage.disable |
| POST /api/recipes/:id/enable | usage.enable |

GET permite `enabled=true` (default), `false` o `all`; los últimos dos y el detalle deshabilitado requieren además usage.view_disabled. Filtros adicionales: search, activity_type, crop_id. Options expone productos activos y cultivos de la empresa para el formulario sin requerir permisos de Inventario o Planning.

CREATE/PUT reciben `{name, activity_type, field_context?, crop_id?, items:[{product_id,dose_amount,dose_unit}]}`. PUT reemplaza la selección de items de forma atómica, conservando las filas de productos retenidos para permitir editar dosis de productos posteriormente deshabilitados. La respuesta incluye nombres, unidades base, dosis y product_enabled. Los conflictos de nombre en creación, edición o restauración devuelven 409.

## Compatibilidad y siguientes fases

`/usage` presenta Recetas; `/usages-disabled` redirige a `/usage`. Se mantienen posición/icono en navegación y las claves internas **usage.*** deliberadamente: crear recipe.* ahora quitaría acceso a usuarios con custom_permissions. Solo cambian los textos humanos de permisos. Una futura migración a recipe.* debe trasladar explícitamente los permisos personalizados y mantener compatibilidad durante la transición.

Las pantallas, rutas backend y tablas antiguas de Usage se conservan; dejan de estar en navegación. Los consumidores operativos existentes siguen usando Usage. Planning no se modifica en esta fase. La futura integración tendrá que definir snapshots, superficie efectiva y ejecución sin usar esta fase para descontar stock.
