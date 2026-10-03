# Consumo NORMAL según fecha operativa

La fecha D se obtiene de `usage_records.date`: Usage manual persiste `body.date`
y los completados de Planning (incluido `register-completed`) copian su
`effective_date` al uso generado. Para registros antiguos sin fecha se conserva
el día operativo actual en America/Argentina/Buenos_Aires.

`consumeStock` selecciona partidas de la misma empresa y producto, habilitadas,
con remanente positivo, existentes en D y no vencidas en D. Mantiene FEFO,
desempate por fecha de ingreso e ID y vencimiento mensual al último día del mes
(inclusive). La insuficiencia devuelve el error funcional 409 y revierte la
transacción completa.

Existencia de partidas:

- Compras y devoluciones: `received_date`, obligatorio en los servicios actuales.
- STOCK_INITIAL: `received_date`, que ya coincide con la fecha efectiva de apertura.
- Ajustes positivos y legacy sin ingreso conocido: día local de `created_at`
  como límite conservador. No se presume existencia anterior ni se escribe una
  fecha de recepción inventada. Una fecha verificada de ingreso tiene prioridad.

El saldo utilizable es el **remanente actual** de las partidas elegibles en D.
No es una reconstrucción contable del saldo que mostraba el sistema ese día:
no recupera cantidades ya consumidas posteriormente, no reasigna consumos ni
crea compensaciones. Tampoco reconstruye cambios pasados de habilitación, pues
el esquema mantiene el estado actual. Partidas legacy sin fecha verificada no
pueden respaldar operaciones anteriores a su creación.

El bug anterior ignoraba el ingreso y comparaba vencimiento contra hoy.
Además Planning validaba previamente el saldo decorado a hoy; V1 ahora deja
esa validación al consumo transaccional común.

No se modifican recepciones, ajustes, aperturas ni HISTORICAL_NO_STOCK. No se
requiere migración, variables nuevas ni escrituras de reparación en producción.

Usage y los formularios de completado muestran el saldo de hoy como referencia,
sin usarlo como máximo para bloquear el envío. Cantidades/unidades siguen
validándose en el cliente; la disponibilidad temporal se valida en el backend.

## Archivos modificados

- `growsync-backend/services/stock.js`
- `growsync-backend/services/planningCompletion.js`
- `grow-sync/src/features/planning/Planning.jsx`
- `grow-sync/src/features/usages/Usage.jsx`
- `growsync-backend/tests/stock.integration.test.js`
- `growsync-backend/tests/inventoryExpiration.integration.test.js`
- `growsync-backend/tests/inventoryUnits.integration.test.js`
- `growsync-backend/tests/historicalNoStock.integration.test.js`
- `grow-sync/tests/stockEffectiveDate.test.mjs` (nuevo)
- Este documento (nuevo).

## Validación local

Backend: 108 pruebas aprobadas y una aceptación omitida por su condición
existente, entre stock, vencimientos, unidades, HISTORICAL_NO_STOCK y
STOCK_INITIAL. Las 83 de stock/vencimiento/unidades se repitieron después de
normalizar CRLF en la comparación textual del fixture de vencimientos.

Frontend: 14 pruebas aprobadas entre stockEffectiveDate, inventoryConversion,
historicalPlanning y planningLayout. `npm run build` correcto. Las pruebas
SQL usan PGlite desechable; no se conectan a producción.
