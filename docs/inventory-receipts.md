# Ingreso multiproducto por comprobante

## API

`POST /api/products/receipts` con `Idempotency-Key` (obligatorio, hasta 200 caracteres).
La empresa y el actor provienen del usuario autenticado. Mantiene los mismos permisos
que el ingreso individual: rol mínimo 2 e `inventory.edit`.

```json
{
  "received_date": "2026-11-07",
  "supplier": "Proveedor",
  "document_type": "Remito",
  "reference": "R-000123",
  "notes": "Entrega completa",
  "items": [
    {"product_id": "UUID_PRODUCTO_A", "quantity": "25.125000", "unit": "kg", "expiration_year": null, "expiration_month": null},
    {"product_id": "UUID_PRODUCTO_B", "quantity": "10.000000", "unit": "L", "expiration_year": 2027, "expiration_month": 9}
  ]
}
```

Devuelve `{ receipt, movements }`. Admite de 1 a 100 productos diferentes. Los UUID
se normalizan antes de detectar duplicados. Proveedor, tipo/número de comprobante,
notas y vencimientos son opcionales; fecha y cantidad positiva son obligatorias.
El backend también acepta el vencimiento exacto existente (`expiration_date`),
excluyente con año/mes, mediante la validación de stock actual.

## Integridad y compatibilidad

- `inventory_receipts` guarda la cabecera común y la idempotencia por empresa.
- `stock_batches.inventory_receipt_id` identifica las partidas del mismo comprobante.
  La FK compuesta impide mezclar empresas; un índice impide duplicar producto por cabecera.
- Una única conexión y transacción envuelve cabecera, partidas y movimientos. Cada
  línea llama al servicio existente `stock.receiveStock`; no hay reglas paralelas
  de stock ni simulación de consumo. Se mantiene la precisión de seis decimales.
- Las líneas se procesan en orden de UUID para mantener un orden consistente de locks.
- Una repetición del mismo payload/clave devuelve la cabecera y movimientos originales.
  Reutilizar la clave con otro payload devuelve 409. Las claves internas de movimientos
  se derivan del UUID de cabecera y producto, independientemente de la clave externa.
- La pantalla mantiene revisión previa y una confirmación conjunta; al finalizar llama
  a `onSaved` una sola vez. Reintentar una respuesta perdida conserva la clave.
- Se conserva el comportamiento vigente de costos: el ingreso crea stock con precio
  null, y la valorización se carga después desde **Ver partida → Valorizar**. No se
  crean precios ni revisiones económicas implícitas. El batch rechaza campos monetarios
  ajenos a este contrato; el endpoint individual mantiene sus campos originales.
- El endpoint individual `POST /api/products/:id/receipts` y el formulario legado sin
  partidas permanecen disponibles. Usage, Planning, FEFO, ajustes, consumo y snapshots
  económicos no fueron modificados.

## Migración

`growsync-backend/migrations/20261107_inventory_receipts.sql` es aditiva y debe
aplicarse antes de habilitar el nuevo endpoint/formulario. No modifica migraciones
anteriores ni hace backfill: las partidas existentes conservan FK null. Usa una
transacción con límites de espera de locks y ejecución. No se aplicó a producción
ni a ninguna base persistente durante esta tarea; sólo a PostgreSQL descartable en tests.

## Validación

Las suites `inventory*.test.js` / `stock*.test.js` del backend y
`inventory*.test.mjs` / `stock*.test.mjs` del frontend cubren compatibilidad.
`stockBatchValuations.browser.mjs` prueba el formulario real con transporte sintético,
una o varias líneas, duplicados deshabilitados, quitar líneas, volver desde revisión,
unidades, cantidades, reintento y callback único en 1440/1024/390 px.
No se cargan credenciales ni se contactan servicios productivos.

### Resultado (Node.js v20.20.2)

- Backend: `node --test --test-concurrency=1` sobre `tests/inventory*.test.js`
  y `tests/stock*.test.js`: **151/151** (incluye 14 regresiones nuevas).
- Frontend: `node --test --test-concurrency=1` sobre `tests/inventory*.test.mjs`
  y `tests/stock*.test.mjs`: **36/36** (incluye 3 regresiones nuevas).
- Navegador: `node --test tests/stockBatchValuations.browser.mjs`: **13/13**.
- `npm run build`: correcto; advertencia existente de chunks mayores a 500 kB.
- `git diff --check`: limpio; también se verificaron archivos nuevos.
- Sin commit, push, deploy ni cambios de datos productivos.

## Archivos de esta tarea

Modificados:

- `grow-sync/src/features/inventory/components/ReceiptModal.jsx`
- `grow-sync/src/services/stockService.js`
- `grow-sync/tests/stockBatchValuations.browser.mjs`
- `grow-sync/tests/stockBatchValuations.fixture.jsx`
- `growsync-backend/routes/products.js`

Nuevos:

- `docs/inventory-receipts.md`
- `grow-sync/src/features/inventory/components/ReceiptModal.css`
- `grow-sync/src/features/inventory/inventoryReceiptModel.mjs`
- `grow-sync/tests/inventoryReceipts.test.mjs`
- `growsync-backend/migrations/20261107_inventory_receipts.sql`
- `growsync-backend/routes/inventoryReceipts.js`
- `growsync-backend/services/inventoryReceipts.js`
- `growsync-backend/tests/inventoryReceipts.integration.test.js`

El archivo previamente no versionado `shared/costEstimate.cjs` no se modificó.
