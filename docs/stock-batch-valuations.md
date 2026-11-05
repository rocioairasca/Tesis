# Valorización de partidas — etapa inicial

## Verificación previa (HEAD a8fd43ce, 2026-11-04)

Se contrastaron el esquema capturado en audit/don-santiago-pre-reset/20260916T175923749Z/schema/schema.json,
las migraciones 20260914_inventory_base_units, 20260916_stock_initial y 20260924_inventory_monthly_expiration,
los servicios/controladores de stock y los fixtures de regresión. No se consultó producción.

- products, stock_batches y stock_movements tienen PK UUID y company_id. Partidas referencian producto/empresa/unidad mediante FK compuesta; movimientos referencian partida/producto/unidad y Usage de la misma empresa.
- Cantidades y precios de partida: numeric(20,6). Campos originales: unit_price, currency, exchange_rate, total_original, total_ars, supplier, reference.
- Índices existentes: FEFO y claves compuestas de producto/partida, operación/Usage, idempotencia y reversa única.
- El esquema capturado es anterior a stock_initial y vencimientos mensuales. No es el estado completo actual por sí solo.
- El DDL base completo de Inventario V1 no está en una migración de creación única: está documentado por el esquema capturado y fixtures; las migraciones posteriores lo amplían. La migración nueva requiere esas tablas e índices, no los recrea.
- stock_initial permite cambiar exclusivamente available_quantity y updated_at en la partida; movimientos/manifiesto están protegidos. Esta etapa no altera esos triggers.
- El ingreso actual normaliza cantidades, crea partida y movimiento en una transacción, con idempotencia. Su API admite datos originales de compra y exige FX si la moneda original es USD; no se altera ese contrato legacy.

## Política económica

stock_batch_valuations es la fuente económica desde esta etapa. Los campos originales de stock_batches son evidencia del ingreso, no una valorización vigente. No hay backfill, copia automática ni sincronización bidireccional.
La UI de nuevos ingresos registra datos físicos y remite la carga económica al detalle de partida. Clientes anteriores siguen pudiendo enviar evidencia original al endpoint existente; eso no confirma una valorización.

Sin filas económicas, GET devuelve status=pending y current=null, sin escribir nada. Pending admite NULL; no significa cero. USD confirmado requiere precio y copia exactamente ese precio a unit_cost_usd, sin FX. ARS sólo pending; columnas FX reservadas, NULL y rechazadas por el API en esta etapa. No hay conversiones automáticas.

Importes de entrada/salida son strings decimales (hasta 14 enteros y 6 decimales). La normalización usa BigInt. Cero explícito es válido. invoice_total_original es evidencia documental opcional, no un total calculado ni base para inferir precio: puede incluir descuentos/cargos. El precio es por unidad base de la partida, nunca por cantidad disponible.

## API

Base: /api/products/:id/batches/:batchId/valuation
- GET /: batch, status, current.
- GET /history?page=1&pageSize=25: revisiones descendentes, máximo 100 por página.
- POST /: primera revisión o sucesora; Idempotency-Key obligatorio.
- No PUT/PATCH/DELETE.

POST acepta status, supersedes_id (NULL obligatorio para primera), currency, unit_cost_original, invoice_total_original,
invoice_date, supplier_name, invoice_reference, payment_date, provenance (manual o legacy_review), reason.
No acepta company_id, revision, unit_cost_usd ni FX calculado por cliente.
Cada petición es una revisión completa, no un patch.
Toda sucesora exige reason y supersedes_id igual a la última revisión. Un conflicto devuelve 409 y exige recargar.
Reintento idéntico devuelve la misma revisión (200); creación devuelve 201. Una clave reutilizada con otro contenido da 409.

Lectura: inventory.view, rol mínimo 0. Escritura: inventory.edit, rol mínimo 2, igual que ingresos.
Productos deshabilitados requieren además inventory.view_disabled. Economic.* queda para una etapa posterior.

## Integridad

FK compuesta partida/empresa y actor/empresa; cadena FK misma partida/empresa. UNIQUE de revisión por partida, sucesora por supersedes_id e idempotencia por empresa.
Servicio: bloqueo de idempotencia y fila de partida dentro de transacción. Trigger SQL: bloqueo y verificación de secuencia.
Todas las revisiones, incluidas pending, rechazan UPDATE/DELETE/TRUNCATE. Vigente = mayor revisión; no hay flag mutable.
RLS habilitado, sin acceso directo de navegador; API mediante la conexión SQL privilegiada existente.
No se crean movimientos ni se modifican productos, partidas, saldos, Planning, Usage o stock inicial.

## Aplicación y alcance

La migración está preparada para revisión y aplicación posterior; no se ejecutó en entornos reales.
Tests utilizan bases desechables. La concurrencia del contrato se prueba con solicitudes solapadas y pool serializado de PGlite; las restricciones SQL se prueban directamente.
Quedan fuera ARS confirmado, análisis económico, ejecución valorizada, costos de Usage, FX automático, facturas/proveedores como entidades y rentabilidad.
