# Unidades base de inventario — implementación controlada

Fecha: 14/09/2026. Implementado en el workspace; no desplegado. La base real se inspeccionó en modo de solo lectura. **La migración no se ejecutó en la base real.**

## Comportamiento

`products.unit` continúa siendo la única fuente de verdad. Catálogo compartido en `shared/inventoryUnits.json`: L, mL, kg, g, unit y bag. La interfaz presenta unidades y bolsas en español. Los aliases legacy se aceptan de manera controlada; productos nuevos guardan el código canónico. No hay conversiones de magnitud ni un campo `stock_unit`.

El backend verifica la unidad en productos, ingresos, Usage, Planning y completion; ajustes heredan la unidad. Un producto sin referencias ni saldos legacy puede cambiarla. Con historial, incluso deshabilitado, responde con un error claro. Se descubren las referencias FK realmente instaladas a productos: partidas, consumos y productos planificados cubren también movimientos y completions dependientes. Los saldos legacy no nulos bloquean conservadoramente el cambio. La UI recibe `unit_locked` y deshabilita el selector; si no hay información verificada, no presume que sea editable.

Partidas y movimientos conservan unidad explícita y consistente con el producto. Las operaciones sobre productos históricos conservan el literal almacenado (`litros`, por ejemplo), necesario para las FK compuestas y la inmutabilidad del historial. La presentación lo muestra como L. No se actualizan cantidades históricas.

Ingresos muestran la unidad junto al input, sin selector. Ajustes y sus previews usan el mismo formato. FEFO conserva su algoritmo. Usage rechaza unidades incompatibles; el origen del movimiento admite `usage_id` y el alias anterior `usage_record_id`. Planning hereda la unidad y completion utiliza la unidad del producto al generar Usage y movimientos.

Las cantidades admiten hasta seis decimales; la presentación argentina omite ceros innecesarios. Se validaron 0,125 L, 0,005 kg, 1,25 bolsas y 35,000001 g. La suma de consumos por producto en completion utiliza aritmética decimal entera. No se cambió el formato monetario ni de hectáreas. Persisten usos de Number en formularios/legacy: no se garantiza representación exacta de todo el rango extremo de NUMERIC(20,6) más allá de la precisión segura de JavaScript.

`minimum_stock` usa la unidad base. Se conserva el fallback anterior de 5 y se explica en el formulario para que se configure por producto; no se aplica ninguna equivalencia entre unidades. Coincidencias por nombre siguen la detección existente y muestran categoría y unidad.

## Diagnóstico real y cambios SQL preparados

Script: `growsync-backend/scripts/diagnose-inventory-units.cjs`.
Resultado: `audit/inventory-units-installed-2026-09-14.json`.

Se confirmaron partidas y movimientos NUMERIC(20,6), checks limitados a kg/litros, FK compuestas con unidad y protecciones de inmutabilidad. Completion tiene NUMERIC(12,4). Unidades de productos encontradas en el agregado: litros (51), kg (8), bolsas (2).

`growsync-backend/migrations/20260914_inventory_base_units.sql` prepara exactamente:

1. Función de normalización controlada de códigos.
2. Sustitución transaccional de los dos checks de unidad por L, mL, kg, g, unit, bag y los literales históricos litros/bolsas. Rechaza definiciones desconocidas o checks adicionales en vez de eliminarlos a ciegas.
3. Ampliación de `planning_product_completions.actual_amount` de NUMERIC(12,4) a NUMERIC(20,6), sin conversión de magnitud.
4. Trigger de productos que canonicaliza altas y bloquea cambios con historial.
5. Trigger en usage_records, planning_products y stock_batches que bloquea el producto durante la escritura, valida e hereda su unidad. Complementa la protección backend ante escrituras concurrentes y clientes anteriores.

No elimina registros, no ejecuta UPDATE masivos, no modifica FK/RLS ni desactiva triggers existentes de movimientos. Es idempotente y debe ejecutarse dentro de una transacción, con parada ante errores. Incluye límites de espera de locks y de sentencia. Fue aplicada dos veces en PostgreSQL aislado y se comparó el historial antes/después; también se verificó rechazo de un check inesperado con rollback.

## Aplicación pendiente

No ejecutar la migración aisladamente mientras siga operando un backend que solo acepta kg/litros. Preparar el backend nuevo incluyendo la carpeta raíz `shared/` en su artefacto; el frontend también la necesita al construir. En una ventana coordinada sin escrituras: repetir diagnóstico, comprobar que coincide con el esquema revisado, aplicar el SQL en una única transacción con parada ante error, activar el backend y frontend compatibles y verificar los flujos. Ante un error SQL se revierte la transacción completa. No se propone un downgrade de unidades después de crear operaciones con códigos nuevos.

Hasta completar ese despliegue, los checks reales siguen restringiendo V1 y completion real sigue con cuatro decimales. Las protecciones adicionales de concurrencia SQL tampoco están activas todavía. No se habilitaron empresas V1 ni se alteraron allowlists de aperturas legacy. No se cargaron Finesse ni los demás ejemplos reales.

## Archivos de esta implementación

- Compartido: `shared/inventoryUnits.json`.
- Backend: `services/inventoryUnits.js`, `services/inventoryQuantity.js`, `services/productUnitHistory.js`, `services/stock.js`, `services/stockUsage.js`, `services/stockLegacy.js`, `services/planningCompletion.js`.
- Backend controladores: `controllers/products/products.js`, `controllers/products/stock.js`, `controllers/usage/usage.js`, `controllers/planning.js`.
- Backend validación: `validations/products.schema.js`, `validations/usage.schema.js`, `validations/planning.schema.js`.
- SQL y diagnóstico: los archivos indicados arriba.
- Frontend: `src/utils/inventoryUnits.js`, `src/features/inventory/inventoryModel.mjs`, `Inventory.jsx`, `DisabledInventory.jsx`, componentes `ProductIdentityForm`, `ReceiptModal`, `AdjustmentModal`, `ProductDetailDrawer`, `SimilarProducts`; `src/features/usages/Usage.jsx`, `DisabledUsages.jsx`; `src/features/planning/Planning.jsx`; `vite.config.js` (acceso al catálogo compartido en desarrollo).
- Tests: `growsync-backend/tests/inventoryUnits.integration.test.js`, `stockPermissions.test.js`; `grow-sync/tests/inventoryUnits.test.mjs`, `inventoryUI.test.mjs`.

Las rutas de backend anteriores son relativas a growsync-backend. No se atribuyen a esta tarea otros cambios preexistentes del workspace.

## Validación

- Backend: 51 pruebas pasaron (13 nuevas de unidades, 27 de stock y 11 de permisos). Se añadieron después cuatro verificaciones de FEFO y seguridad SQL: la suite de unidades final pasó sus 17 pruebas. Total de casos backend verificados: 55.
- Frontend: suite completa de 56 pruebas aprobada. Después se amplió el caso SSR del selector editable/bloqueado y se repitieron las 10 pruebas de inventario, aprobadas.
- Build Vite aprobado, salida aislada en `grow-sync/node_modules/.cache/inventory-units-build`.
- Avisos no bloqueantes: configuración ESM de Vite, tamaño de chunks, addonAfter de Ant Design y puertos HMR compartidos entre tests SSR. No se realizó una prueba end-to-end contra datos reales ni se declara una validación visual de navegador en esta pasada.
