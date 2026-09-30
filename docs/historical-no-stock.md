# Antecedentes históricos sin inventario

## Alcance y estado

Implementación general, sin IDs ni fechas de una empresa en código de dominio.
No se ejecutó ningún reset, recuperación, alta de stock o compra. La migración
`20260916_historical_no_stock.sql` está preparada; solo se aplica en pruebas
aisladas. Desplegar primero la migración y luego backend/frontend compatibles.
No conectar las pruebas a una base de datos externa: usan PostgreSQL embebido
en memoria (PGlite), sin `.env`, Supabase ni el servidor de la aplicación.

## Auditoría de los efectos existentes

| Flujo | Efecto ordinario | Protección histórica |
|---|---|---|
| `controllers/planning.js`: create, registerCompleted, completeSowing, completeWork | Completion crea Usage y consumos; siembra crea/cierra ciclos | Importación específica; modo no aceptado desde CRUD ordinario |
| `services/planningCompletion.js`: applyPlanningProductUsage | Legacy resta disponible; V1 consume partidas y crea movimientos | Modo de Planning heredado por Usage; sin comprobación de saldo ni consumo |
| `controllers/usage/usage.js`: createUsage/adjustStock | Resta legacy y puede notificar low_stock | CRUD no admite asignar modo; importador no llama este flujo |
| `services/legacyUsage.js`: mutate | Editar devuelve anterior y descuenta nuevo; disable devuelve; enable descuenta | Rechaza antecedentes y cambios de modo; servicio histórico específico |
| `services/stockUsage.js`: createManualUsage/disableManualUsage | Consumo o reversión de partidas | Rechaza cambio de modo y reversión histórica |
| `services/stock.js`: consumeStock/reverseStock | Modifica partidas y crea movimientos | Verifica Usage histórico antes de modificar partidas; trigger adicional en movimientos |
| `services/stock.js`: receiveStock/adjustStock | Ingresos y ajustes explícitos | No usados por importación ni correcciones históricas |
| `controllers/products/products.js` | CRUD legacy y addStock pueden modificar total/disponible y alertar | Son operaciones independientes de inventario; historial nunca llama estas rutas |
| `services/stockLegacy.js` | Propone apertura desde disponible legacy | No usado para reconstrucción desde una hoja física |
| `services/harvestCycles.js`, controladores de cosechas/asignaciones | Cierres/reaperturas, cálculo de superficies | Importa relaciones explícitas sin ejecutar servicios; bloquea recalcular ciclos históricos |
| Notificaciones posteriores a legacy, productos y tareas programadas | Alertas según saldo actual | Importación/corrección no escribe saldos ni emite notificaciones |

`registered_retroactively` conserva su significado independiente. Ninguna fecha
convierte automáticamente una operación NORMAL en histórica.

## Modelo y garantías

- `inventory_impact_mode`: NORMAL por defecto o HISTORICAL_NO_STOCK en Planning,
  Usage, cosechas y asignaciones. Check en BD y modo inmutable desde creación,
  incluso antes de completar: regla deliberadamente más estricta que permitir
  conversiones de operaciones sin consumos.
- `historical_import_id`: procedencia inmutable; referencia a importación.
- `historical_imports`: empresa, clave idempotente, hash del contenido, actor,
  origen, fecha, contenido original y resultado. Conserva también los textos y
  valores originales enviados, aunque los registros reciban metadatos nuevos.
- `historical_events`: correcciones con actor, fecha y valores anteriores;
  eventos protegidos frente a modificación/eliminación y RLS habilitado.
- `companies.inventory_control_start_date`: fecha nullable, sin backfill.
- Trigger exige acuerdo entre modo de Usage y Planning. Otro trigger impide
  crear movimientos asociados a Usage históricos. No se crean movimientos cero.
- Asignaciones históricas inmutables: un flujo ordinario no puede cerrar o
  reabrir accidentalmente un ciclo recuperado.

La importación mantiene IDs. IDs ya existentes bajo otra clave son un conflicto,
no un permiso para sobrescribir. Las referencias se validan contra la empresa,
incluidos responsables, productos, campañas y superficies. No se resuelven
productos por nombre ni se convierten unidades. Lotes deshabilitados y layouts
locked son válidos como antecedentes cuando sus relaciones son explícitas.
Una referencia de lote completo sigue sin layout histórico determinado.

## API y permisos

Rutas privadas bajo `/api/history`, con JWT, usuario y tenant existentes y el
permiso `history.import`. Se usa el resolvedor `getEffectivePermissions`:
`all` también autoriza, y permisos personalizados sustituyen al rol. El servicio
revalida el usuario habilitado y su permiso en BD. No se concede automáticamente
este permiso a supervisores o dueños; puede otorgarlo la administración.

### Importación

`POST /api/history/imports`, header `Idempotency-Key` (1–200 caracteres).

```json
{
  "source": "Archivo de antecedentes validado",
  "confirmed_no_stock": true,
  "records": {
    "planning": [],
    "planning_lots": [],
    "planning_products": [],
    "usage_records": [],
    "usage_lots": [],
    "planning_product_completions": [],
    "crop_assignments": [],
    "harvest_records": [],
    "harvest_crop_assignments": []
  }
}
```

Cada fila usa los campos de su tabla y un ID estable donde la entidad tiene ID.
La empresa se toma del usuario autenticado; un company_id diferente se rechaza.
Los modos originales del archivo no se reutilizan: la confirmación explícita
establece que las filas importadas son antecedentes. No se admiten tablas de
stock, productos, geometrías, usuarios o configuración en este manifiesto.
El importador fija su propia procedencia sin reemplazar autores históricos.

El manifiesto aporta las relaciones y cantidades declaradas, incluidas completions
y Usage si existen. Una descripción no produce nuevos consumos. La ausencia de
Usage o relaciones directas se conserva. Columnas generadas se calculan por BD;
se rechaza una diferencia de cantidad/superficie/rendimiento en lugar de aceptarla
silenciosamente. No se invocan rutinas de completion, siembra ni cierre de cosecha.

Orden transaccional: Planning → superficies/productos → Usage/superficies →
completions → asignaciones → cosechas → relaciones de cosecha. Las relaciones
dependientes acompañan a sus padres en el mismo manifiesto. Se valida coherencia
de productos, cantidades de completion, sublotes y cultivo/campaña de cosechas.

Misma empresa + clave + contenido devuelve el resultado anterior. Misma clave
con otro contenido devuelve conflicto. Advisory lock y transacción serializan
reintentos concurrentes; cualquier fallo revierte toda la importación. Límite:
10000 filas y 5 MB por petición; dividir por conjuntos completos de relaciones.

### Correcciones

Las rutas habituales interceptan antecedentes antes de los controladores
ordinarios y exigen también `history.import`, además de su permiso funcional.

- Planning PATCH: title, description, start_at/end_at, effective_date,
  responsible_user; `products: [{planning_product_id, actual_amount, amount?}]`
  corrige cantidades de Usage y completion sin stock.
- `lot_selections: [{lot_id, sub_lot_id, area_ha}]` conserva referencias explícitas;
  no busca automáticamente el layout activo.
- Planning DELETE / enable: ocultar/restaurar, conservando estado de realización,
  sin reabrir ni volver a completar. Los Usage asociados se ocultan/restauran.
- Usage manual histórico: fecha, cantidad, superficie declarada, responsable,
  textos y selecciones; disable/enable sin stock. Usage de Planning se corrige
  desde su padre para no desacoplar completion y cantidad.
- Cosecha histórica: notas y ocultar/restaurar sin ejecutar cierres.

No se cambia identidad de producto, modo, campaña o estructura de un ciclo ya
vinculado. Fecha/superficie de Planning con asignaciones requiere una corrección
histórica integral; se rechaza el cambio aislado. Tampoco se simula consumo
para permitir normalizar un antecedente. Una nueva operación real usa un ID nuevo.

La UI marca Planning (escritorio/móvil/detalle), Usage y cosechas como
“Histórico · Sin impacto en inventario”. El detalle explica el carácter informativo
de los productos. No hay módulo nuevo ni selector de modo para empleados.
El formulario ordinario no es un editor completo de importaciones; las correcciones
administrativas usan los cuerpos específicos anteriores.

### Fecha inicial y STOCK_INITIAL

`PUT /api/history/inventory-control-start` recibe
`{"inventory_control_start_date":"YYYY-MM-DD"}` o null. No cambia actividades.
Una fecha ya establecida no se sustituye libremente y se registra el actor.

`POST /api/history/stock-initial/prepare` recibe fecha y entries con product_id,
quantity, unit y expiration_date explícita (fecha completa o null). Valida contra la fecha configurada,
unidades y pertenencia; devuelve una propuesta `kind: STOCK_INITIAL`,
`persisted: false`. Nunca utiliza disponible legacy para determinar cantidades.

Ampliación posterior: STOCK_INITIAL ya tiene persistencia transaccional,
confirmación explícita, origen separado, idempotencia y controles de duplicación.
Ver [stock-initial.md](stock-initial.md) para el contrato y las pruebas actuales.
No se registraron existencias iniciales de Don Santiago ni se desplegaron migraciones.

## Pruebas y aceptación del backup

`npm test` ejecuta las pruebas aisladas. `npm run test:history` cubre ambos modelos,
completion normal/histórica, importación, correcciones, toggles, permisos, tenant,
modo inmutable, reintentos y ausencia de cambios en alertas, saldos y partidas.

Para la prueba opcional del backup local, establecer `HISTORICAL_BACKUP_DIR` y
ejecutar `npm run test:history`. El test únicamente lee ese directorio; crea una
base efímera en memoria. Recupera 24 Planning, 24 Usage, 25 planning_products,
24 completions, 10 cosechas y 12 asignaciones, más sus relaciones. Conserva la
cadena de la cosecha real, comprueba que no se duplica y compara literalmente
title/description. Repetir la importación no crea otra copia.

La fixture reproduce columnas, checks, FK, claves e índices únicos. Las geometrías
se guardan como valores opacos para verificar que no cambian; no sustituye una
prueba de integración con PostGIS ni reproduce todos los triggers de producción.
Antes de un reset real: aplicar la migración en staging compatible, probar el
manifiesto con los triggers/PostGIS instalados, validar STOCK_INITIAL en ese entorno, revisar
las decisiones del catálogo y compras y obtener autorización del reset.

No se declara segura todavía la secuencia productiva completa
reset → stock inicial → recuperación: la recuperación sin stock está probada
relacionalmente; la apertura también está probada de forma aislada en la ampliación
documentada en stock-initial.md. La validación de despliegue sigue pendiente.

## Archivos de la entrega

Nuevos: migración `20260916_historical_no_stock.sql`; servicios `inventoryImpact.js`,
`historicalImport.js`, `historicalMutation.js`, `stockInitialPlan.js`; middleware
`historicalOperations.js`; ruta `history.js`; pruebas `historicalNoStock.integration.test.js`
y fixture `historySchema.fixture.sql`; este documento.

Modificados en backend: `index.js`, `constants/permissions.js`, rutas `planning.js`,
`usage.js`, `harvestRecords.js`, `cropAssignments.js`; servicios `planningCompletion.js`,
`legacyUsage.js`, `stockUsage.js`, `stock.js`, `harvestCycles.js`; controladores
`usage/usage.js` y `harvestRecords.js`; fixture existente de pruebas de cosechas
`partialHarvests.integration.test.js`; `package.json` y lockfile (PGlite de desarrollo
y comandos de pruebas).

Modificados en frontend: catálogo de permisos, `Planning.jsx`, `PlanningTable.jsx`,
`PlanningListMobile.jsx`, `Usage.jsx`, `HarvestTrace.jsx`. Sin nueva navegación.

## Resultado de validación local — 16/09/2026

- Suite completa: 154 pruebas aprobadas, sin fallos ni omisiones, incluyendo el
  backup opcional. Después se añadió una prueba específica de compatibilidad de
  migración y se reforzaron las protecciones de auditoría y validación de fechas.
- Suite histórica final, repetida tras esos cambios: 12/12 aprobadas, incluyendo
  rechazo de movimientos por trigger, migración y aceptación del backup.
- Frontend: `npm run build` aprobado; quedaron advertencias de configuración
  Vite y tamaño de bundles, sin errores de compilación.
- `git diff --check`: aprobado.
- Ninguna migración ni prueba se ejecutó contra la base de Don Santiago.
