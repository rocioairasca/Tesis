# Estimación actual de una Planning

Microetapa de lectura, sin migraciones ni persistencia. Base: 41229b1 (2026-11-05).
GET /api/planning/:id/cost-estimate requiere planning.view E inventory.view (también con permisos personalizados).
No recibe tarifa, moneda, fecha de simulación ni empresa desde cliente. La fecha de cálculo es hoy en Argentina, no la fecha futura/pasada de Planning. Respuesta Cache-Control: no-store.

Estados permitidos: planificado, pendiente (estado operativo existente) y en_progreso. Deshabilitadas, canceladas, completadas e HISTORICAL_NO_STOCK se rechazan; la UI no ofrece esta simulación para ellas.

Fuente: planning_products.amount/unidad ya persistidas. Sólo se usa el conversor existente para unidades de entrada compatibles; no se recalculan dosis, recetas ni superficies desde geometrías.
Área: suma exacta de COALESCE(planning_lots.effective_area_ha,area_ha). Datos incompletos/no positivos impiden USD/ha y labor, no el subtotal de productos.

stockFefo.js comparte con consumeStock las reglas de elegibilidad y orden:
partida habilitada, saldo positivo, fecha de ingreso (o creación local) <= hoy, vencimiento exacto/mensual >= hoy, sin vencimiento admitido.
Orden: vencimiento ASC NULLS LAST, ingreso ASC NULLS LAST, UUID ASC.
La estimación no usa FOR UPDATE, advisory locks, movimientos ni reservas. Usa una transacción REPEATABLE READ READ ONLY para coherencia entre consultas.

Sólo se usa la revisión más reciente por partida. confirmed USD -> precio conocido (incluye cero explícito); pending, ARS o sin revisión -> cantidad pendiente. No se usa ningún precio legacy.
Producto deshabilitado no es utilizable; cantidades/unidades inválidas se informan sin inventar cero.
Faltantes de stock se muestran sin asignarles un precio.

complete: todas las cantidades válidas cubiertas y valorizadas; una Planning sin productos tiene cero insumos previstos.
partial: existe una parte conocida y otra pendiente/faltante/inválida.
unavailable: no se puede valorizar ninguna cantidad requerida.
known_products_cost_usd es siempre un subtotal conocido, nunca un total completo si status != complete.
simulated_batches documenta las cantidades/precios/revisiones de la simulación; no garantiza la asignación futura.

Precisión: entradas hasta seis decimales, multiplicación exacta BigInt a escala 12 y suma sin redondear líneas.
La API conserva los decimales del producto (hasta 12; al menos 6), incluso si excede la precisión de almacenamiento de las entradas. No persiste resultados.
Presentación: USD con dos decimales, half-up. USD/ha se calcula desde el total exacto, no desde importes mostrados ya redondeados.

La tarifa de labor sólo existe en el estado React del detalle. Sin tarifa se indica "sin labor", sin interpretarla como costo real cero.
Con estimación incompleta se conserva la etiqueta subtotal y no se presenta un total/ha completo. Actualizar vuelve a consultar stock/precios; cerrar desmonta la simulación y descarta tarifa.
No hay localStorage, PATCH, POST ni nuevos permisos economic.*. La separación de permisos económicos queda para otra etapa.

## Archivos de esta microetapa

Modificados:
- growsync-backend/routes/planning.js
- growsync-backend/services/stock.js
- grow-sync/src/features/planning/Planning.jsx
- grow-sync/vite/inventoryConversionPlugin.mjs
- grow-sync/tests/planningList.fixture.jsx

Nuevos:
- growsync-backend/routes/planningCostEstimate.js
- growsync-backend/services/planningCostEstimate.js
- growsync-backend/services/stockFefo.js
- growsync-backend/tests/planningCostEstimate.integration.test.js
- shared/costEstimate.cjs
- grow-sync/src/features/planning/components/PlanningCostEstimate.jsx
- grow-sync/src/features/planning/components/planningCostEstimate.css
- grow-sync/tests/planningCostEstimate.test.mjs
- grow-sync/tests/planningCostEstimate.browser.mjs
- docs/planning-cost-estimate.md

## Validación local

Node v20.20.2. Datos sintéticos, backend aislado en PGlite y navegador con adaptador HTTP simulado.
- Backend: 18 pruebas nuevas; suite relacionada stock/inventory/planning: 276/276 (incluye las nuevas).
- Frontend: suites planning/inventory/myTasks: 77/77 (incluye 7 nuevas de aritmética).
- Navegador de estimación: 8/8; responsive 1440, 1024 y 390, permisos, parcialidad, errores, refresco y reinicio de tarifa.
- Regresión de navegador planningList + myTasks: 18/18.
- Build frontend correcto; advertencia de chunks mayores a 500 kB.
- git diff --check limpio, incluyendo verificación separada de archivos nuevos.

Sin migraciones, cambios de dependencias, llamadas a producción, commit, push ni deploy.
