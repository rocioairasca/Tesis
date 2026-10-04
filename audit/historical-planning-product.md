# Agregar producto histórico

Implementado en el checkout local `C:\Proyectos\Tesis`, sin staging ni commit. No se accedió a producción ni se cargaron las cuatro siembras reales.

## Diseño

El editor histórico incorpora «Agregar producto histórico», con Producto, Cantidad utilizada y Unidad de solo lectura, la advertencia solicitada y confirmación «Agregar producto». La cantidad inicial se registra tanto como planificada como utilizada. Luego ambas pueden corregirse desde Productos registrados. El editor es compartido por escritorio, vista compacta y calendario; no se agregó una vía de edición normal.

Se crean únicamente `planning_products` y `planning_product_completions`. `usage_id` ya admite NULL y las consultas del detalle/listado ya obtienen `actual_amount` mediante LEFT JOIN. No se necesitan `usage_records` para representar estas cantidades: no se crean. La corrección histórica existente se adaptó para editar cantidades con completion aunque no tengan un consumo asociado.

Endpoints propios del flujo histórico:

- GET `/api/history/planning/:id/product-options`: solo id, nombre y unidad de productos de la empresa, con ambos permisos y Planning histórica. No agrega el requisito inventory.view.
- POST `/api/history/planning/:id/products`: recibe únicamente `product_id` y `amount`. La unidad se obtiene del catálogo de la misma empresa. Rechaza Planning NORMAL y solicitudes de otra empresa.

No requiere migración: las tablas, auditoría y nulabilidad necesarias ya existen.

## Inventario, auditoría e idempotencia

La incorporación exige `planning.edit` y `history.import`, usuario habilitado y coincidencia de empresa, comprobados en el servicio además de los permisos de ruta. Se ejecuta en una única transacción, con bloqueos de tablas para serializar incorporaciones y evitar cambios concurrentes durante los snapshots. Tiene límites de espera y ejecución y mensajes funcionales si hay operaciones concurrentes.

Se compara un snapshot completo de filas de productos, partidas, movimientos y notificaciones de la empresa, además de los balances por producto. PostgreSQL produce la representación JSON textual, conservando precisión numérica y temporal. La comparación final ocurre después de insertar la auditoría. Cualquier diferencia provoca rollback de toda la operación. No se llama a servicios de consumo, recepción o ajuste.

La auditoría registra actor, Planning, producto, cantidad, unidad, operación `add_historical_product` y el grafo anterior/posterior de Planning, productos y cantidades utilizadas. Los snapshots de auditoría también se conservan como JSON nativo de PostgreSQL.

La identidad de la operación es Planning + producto. El mismo producto con las mismas cantidades devuelve el registro existente, sin duplicarlo ni crear otro evento. Si las cantidades difieren, se rechaza y se indica corregir el producto existente. Los bloqueos evitan la carrera entre reintentos. No se permite eliminar productos desde esta función.

## Pruebas

- Backend: `node --test --test-reporter=spec tests/historicalPlanningProduct.integration.test.js tests/historicalAdoption.integration.test.js tests/historicalNoStock.integration.test.js`: 36 aprobadas, 1 omitida por configuración previa, 0 fallos.
- Tras preservar JSON nativo de auditoría, se repitieron las 5 pruebas nuevas: 5 aprobadas.
- Frontend: `node --test tests/historicalPlanning.test.mjs`: 5 aprobadas, incluyendo render del editor y cantidades sin consumo asociado.
- Frontend: `npm run build`: correcto. Advertencias de configuración Vite y tamaño de bundles; sin errores de compilación.
- `git diff --check`: correcto.

La fixture sintética de siembra histórica sin productos usa 70.97 ha y 4613.05 kg de Semilla Soja. Verifica cantidades iguales, Planning intacta, stock y movimientos intactos, ausencia de consumos nuevos, auditoría, reintentos, concurrencia, empresas ajenas, permisos, rechazo de NORMAL y corrección posterior. Un trigger de prueba que modifica existencias provoca rollback completo. Los tests usan PostgreSQL aislado en memoria; no bases externas. No se realizó una prueba manual en navegador autenticado.

## Archivos

- `growsync-backend/services/historicalPlanningProduct.js` (nuevo)
- `growsync-backend/routes/history.js`
- `growsync-backend/services/historicalMutation.js`
- `growsync-backend/tests/historicalPlanningProduct.integration.test.js` (nuevo)
- `growsync-backend/tests/historicalNoStock.integration.test.js`
- `grow-sync/src/features/planning/components/AddHistoricalProduct.jsx` (nuevo)
- `grow-sync/src/features/planning/components/HistoricalPlanningFields.jsx`
- `grow-sync/src/features/planning/historicalPlanning.mjs`
- `grow-sync/src/features/planning/Planning.jsx`
- `grow-sync/tests/historicalPlanning.test.mjs`
- `audit/historical-planning-product.md` (este informe)