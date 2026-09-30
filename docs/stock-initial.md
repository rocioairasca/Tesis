# STOCK_INITIAL transaccional — GrowSync

Actualización posterior: la validación PostgreSQL/PostGIS local ya se ejecutó.
Ver [pre-reset-final-validation.md](pre-reset-final-validation.md) para los
resultados, correcciones y bloqueos vigentes. Las limitaciones de entorno
descritas abajo corresponden al cierre de la etapa anterior.

Entrega de código del 16/09/2026. No se ejecutaron migraciones de producción,
reset, aperturas ni escrituras operativas en Don Santiago. Las pruebas usan
empresas sintéticas en PostgreSQL embebido; la simulación lee el backup local.

## A. Diseño

Una apertura representa existencia física al inicio del control. Se registra
una sola vez por empresa en `stock_initial_openings`, con manifiesto, fecha
efectiva, actor, clave de idempotencia, hash, fecha de registro y resultado.
La transacción crea una partida y un movimiento positivo por línea; recién
después confirma el manifiesto completo. Cualquier fallo revierte todo.

`effective_date` debe coincidir exactamente con
`companies.inventory_control_start_date`; si no está configurada, se rechaza.
El timestamp de registro conserva el momento real de la operación y nunca se
presenta como fecha de compra. No se usan fechas de alta/adquisición del producto.

Las cantidades son explícitas, positivas, de hasta 14 enteros y 6 decimales.
Se usa aritmética fija, sin redondeos o conversiones. El consumidor debe omitir
existencias cero; incluir una línea cero produce error, nunca una partida cero.
La unidad es obligatoria y debe coincidir con la unidad base del producto.
Los alias existentes de etiqueta, como `litros`/`L`, no escalan cantidades.
`g`/`kg`, `mL`/`L` y paquete/litros son unidades distintas: se rechazan.

Solo productos existentes, habilitados y de la misma empresa. No se crean,
fusionan o renombran productos. Se permiten partidas separadas por vencimiento
para el mismo producto; repetir producto y vencimiento se rechaza para evitar
duplicar una existencia por error. Debe declararse explícitamente la cantidad
total de esa combinación.

## B. Archivos de esta ampliación

- `growsync-backend/services/stockInitialPlan.js`: preview y confirmación.
- `growsync-backend/routes/history.js`: endpoint de confirmación.
- `growsync-backend/migrations/20260916_stock_initial.sql`: modelo y protecciones.
- `growsync-backend/tests/stockInitial.integration.test.js`: casos A–P.
- `growsync-backend/tests/stockInitialDatabase.fixture.js`: ejecutor aislado y opción PostGIS.
- `growsync-backend/package.json`: `npm run test:stock-initial`.
- `growsync-backend/scripts/simulateStockInitialDonSantiago.js`: simulación de lectura.
- `grow-sync/src/features/inventory/inventoryModel.mjs`: etiquetas diferenciadas.
- `grow-sync/src/features/inventory/components/ProductDetailDrawer.jsx`: fecha efectiva y fecha de registro separadas.
- Este informe, `historical-no-stock.md`, `don-santiago-stock-initial-simulation.md`
  y su JSON con los 42 resultados y candidatos.

Los archivos de HISTORICAL_NO_STOCK de la entrega anterior permanecen en el
workspace. Esta ampliación no ejecuta sus migraciones en producción.

## C. Migraciones

Orden requerido: esquema Inventory V1 existente →
`20260914_inventory_base_units.sql` → `20260916_historical_no_stock.sql` →
`20260916_stock_initial.sql`. Las migraciones no activan el feature flag.
La de unidades debe ejecutarse dentro de una transacción, como en los tests.

La nueva migración agrega apertura, vínculos de partidas/movimientos, fecha
efectiva del movimiento, checks de tipo/signo, FKs compuestas por empresa,
unicidad por empresa y por partida inicial, RLS y protecciones de auditoría.
La restricción diferida exige que manifiesto, partidas y movimientos estén
completos al COMMIT; compara los productos, unidades, cantidades y vencimientos
del manifiesto contra las partidas. Un registro incompleto no puede confirmarse.
No se actualizan productos, operaciones ni saldos existentes.

## D. Partida creada

`origin='stock_initial'`, `stock_initial_id` enlaza la apertura, empresa/producto
existentes, `initial_quantity=available_quantity=cantidad explícita`, unidad
del producto, `received_date=fecha de control`, vencimiento completo o NULL,
`created_by=actor` y timestamps del registro. Precio, proveedor y moneda quedan
NULL: la apertura no inventa una compra.

En partidas de esta apertura solo cambian saldo y timestamp de actualización
por operaciones de inventario. Cantidad original, identidad, origen, fechas y
proveniencia permanecen protegidos. Las correcciones de cantidades son ajustes.

## E. Movimiento creado

`movement_type='stock_initial'`, cantidad positiva exactamente igual a la partida,
unidad, empresa, producto, partida, `stock_initial_id`, `operation_id=opening_id`,
clave/hash, actor y `effective_date=fecha de control`.
`usage_id=NULL`; no hay un consumo ficticio. `occurred_at` y `created_at` son
timestamps de auditoría del registro, no la fecha efectiva ni de compra.
La interfaz muestra por separado la fecha de apertura y cuándo se registró.

## F. API, confirmación e idempotencia

Ambos endpoints requieren sesión, empresa del usuario y permiso efectivo
administrativo `history.import` o `all`. Se revalida el usuario habilitado y sus
permisos actuales dentro de la transacción, sin hardcodear `role === 3`.
Un rol administrador con permisos personalizados vacíos tampoco puede abrir.

`POST /api/history/stock-initial/prepare` recibe:

```json
{
  "date": "2026-08-31",
  "entries": [
    {"product_id": "UUID_EXISTENTE_REVISADO", "quantity": "80", "unit": "L", "expiration_date": null}
  ]
}
```

Devuelve el plan validado, `preview_hash`, estado del flag y `persisted:false`.
No escribe. Es una validación de contenido; la confirmación vuelve a verificar
la elegibilidad de la empresa, inventario vacío, unidades y estado del catálogo.

`POST /api/history/stock-initial/confirm` recibe los mismos `date` y `entries`,
el `preview_hash` devuelto y `confirmed:true`. Exige header `Idempotency-Key`.
Conservar exactamente el payload del preview al confirmar y al reintentar.
La respuesta es 201 para la primera apertura y 200 con `replayed:true` para un
reintento. Se devuelve el resultado guardado con los mismos IDs y actor original.
Misma clave con contenido distinto produce 409, sin nuevos registros.
Se considera contenido también el orden de líneas y la representación original
de cantidad: cambiar de número a string requiere tratarlo como otro payload.

## G. Segunda apertura y concurrencia

Una restricción UNIQUE por empresa evita otra apertura incluso con otra clave
o fecha. La fecha de control queda protegida después de abrir. Inventario con
cualquier partida o movimiento previo impide la apertura, incluso deshabilitado
o agotado: no se apila stock físico inicial sobre otra base existente.
Una apertura legacy tampoco puede agregarse después de STOCK_INITIAL.

Un advisory lock por empresa se comparte con todos los INSERT de partidas;
las aperturas no pueden competir sin protección con un ingreso. Hay bloqueos
de empresa/productos y validación del catálogo bajo bloqueo. Como en cualquier
operación SQL concurrente, un deadlock puede abortar una transacción; se reintenta
con la misma clave, nunca se acepta un estado parcial. Las pruebas embebidas
serializan conexiones: no sustituyen una prueba de carreras con varias sesiones
en el entorno PostgreSQL final.

## H. Correcciones

No editar ni borrar movimientos iniciales. Los triggers rechazan UPDATE,
DELETE y TRUNCATE de movimientos. La auditoría de apertura solo permite guardar
el resultado una vez dentro de la misma transacción; luego queda inmutable.
Una diferencia física posterior se registra con ajuste positivo o negativo,
motivo, actor e idempotencia mediante el mecanismo de ajustes existente.
No existe endpoint de reapertura o borrado de la apertura.

## I. Legacy e INVENTORY_V1

STOCK_INITIAL NO modifica ni sincroniza `products.total_quantity` ni
`products.available_quantity`. Esos valores quedan como legado, sin sumarlos.
Con INVENTORY_V1, `stock.decorate()` usa exclusivamente las partidas y expone
las columnas anteriores por separado como `legacy_*`; los tests comprueban que
un legacy disponible 888 y una apertura 10.123456 dan 10.123456, no 898.123456.

`total_quantity` de V1 conserva su significado actual: suma de cantidades
iniciales de partidas. El stock físico actual es `on_hand_quantity`, suma de
saldos. El disponible excluye partidas vencidas. La ecuación de movimientos
se concilia contra existencia física, no contra stock utilizable sin vencidos.

El preview funciona sin activar V1, pero confirmar exige el flag activo.
La transición requiere mantenimiento: migrar y revisar catálogo, configurar
fecha, activar V1 y confirmar inmediatamente la apertura antes de reabrir
operaciones. No volver al flag legacy para una empresa ya abierta: sus columnas
legadas no se mantienen sincronizadas. No se cambió el flag de Don Santiago.

## J. Pruebas

`npm run test:stock-initial` ejecuta 8 escenarios agrupados con los casos A–P:
fecha ausente, cantidades inválidas, unidad incompatible, vencimientos parciales,
dos productos, precisión de seis decimales, actor/fecha/partida/movimiento,
preview sin escritura, fallo inyectado en segunda partida con rollback,
replay, conflicto, doble apertura (también legacy), permisos efectivos, V1,
producto ajeno/no disponible, inventario previo, NULL de vencimiento,
importación histórica sin cambios de stock ni alertas, compra, Planning NORMAL,
ajustes de ambos signos, FKs, transacción incompleta y protecciones de auditoría.

La secuencia sintética verifica exactamente:
`10.123456 + 5 - 3 - 2 + 1 = 11.123456` y saldo = suma de movimientos.
Un antecedente con uso 1000 no cambia esa apertura ni produce una notificación.

Resultado final: `npm test` con aceptación del backup habilitada aprobó
163/163 pruebas, sin fallos ni omisiones (49,3 s). Incluye los 8 escenarios
de STOCK_INITIAL. El frontend aprobó `npm run build`; Vite conserva sus avisos
de configuración y bundles grandes, sin errores de compilación. El primer
intento no pudo reemplazar archivos de `dist` dentro del sandbox; el reintento
autorizado fuera del sandbox terminó correctamente. `git diff --check` pasó.

## K. PostgreSQL/PostGIS

Se ejecutaron las migraciones y restricciones relacionales en PGlite (PostgreSQL
embebido), no en un servidor con PostGIS. La instalación local encontrada solo
tiene herramientas de línea de comandos; no contiene el árbol `share/extension`
ni archivos PostGIS. No se encontró Docker ni un staging seguro identificado.
No se usó producción como sustituto. La validación PostgreSQL/PostGIS sigue
pendiente y bloquea declarar verificado el despliegue productivo completo.

Quedó preparado el mismo conjunto de pruebas para una base local descartable
con PostGIS previamente instalado. No carga `.env` ni toma URLs de producción.
Exige hostname loopback, nombre `growsync_test_*` y autorización explícita de
uso descartable; crea un esquema aleatorio, prueba geometría MultiPolygon real,
aplica migraciones, ejecuta los casos y elimina únicamente ese esquema.

```powershell
$env:STOCK_INITIAL_POSTGIS_URL='postgresql://USUARIO:CLAVE@127.0.0.1:5432/growsync_test_stock_initial'
$env:STOCK_INITIAL_ALLOW_DISPOSABLE='yes'
npm run test:stock-initial
```

Este comando está documentado, NO ejecutado. El fixture representa el esquema
relacional respaldado; para aprobar despliegue se debe contrastar también el
resto de triggers y extensiones del entorno destino, no solo el fixture.

## L. Simulación de Don Santiago

Ver `don-santiago-stock-initial-simulation.md` y JSON para las 42 líneas,
IDs candidatos, unidades, enabled y errores de preview. Fuente: backup
`audit/don-santiago-pre-reset/20260916T175923749Z/data/products.json`.
Se asumió fecha 31/08/2026 únicamente en un adaptador de lectura en memoria.
No se llamó `confirm()`, no se conectó a la base y no se cargó ninguna apertura.

35/42 líneas tienen algún candidato que supera el preview técnico individual.
7/42 no lo superan: Finesse, Imazapic, Nicosulfuron granulado, Lambdacialotrina,
Apron, Maxim y Efimax. Pasar el preview no decide identidades ni duplicados.
Una vez definidos los IDs, cantidades/unidades explícitas y fechas completas
o NULL, el contrato puede representar las 42 líneas sin inferir movimientos.

## M. Bloqueantes concretos restantes

1. Elegir IDs de Glifosato, MSO, EHE y Finesse. El backup muestra además
   Atrazina duplicada, con una fila deshabilitada: dejar asentado el ID elegido.
2. Confirmar Percon/Pericon y Perside/Preside; revisar también las diferencias
   Diflufenican/Diflufenicam, Thiencarbazone metil/Thiencarbazonemetil y el nombre
   Maxim/tiabendazol. La simulación propone candidatos, no equivalencias.
3. Finesse 1050 g frente a kg, Nicosulfuron granulado 300 g frente a kg e
   Imazapic 1 paquete frente a litros: resolver antes del importador. El bloqueo
   de unidades con historial puede exigir un procedimiento de catálogo separado;
   no modificar automáticamente esos productos para hacerlos encajar.
4. Declarar explícitamente Lambdacialotrina en una única unidad: la API no
   convierte la expresión compuesta «5 L + 500 cc».
5. Apron 03/27, Maxim 12/26 y Efimax 01/27: obtener fecha completa, o decidir
   explícitamente NULL y conservar el mes/año en el documento fuente externo.
   El modelo actual no admite precisión mes/año. No se elige primer/último día.
6. Validar migraciones, esquema real y concurrencia en PostgreSQL/PostGIS
   descartable; desplegar bajo mantenimiento y establecer fecha/flag de forma
   controlada. No hay autorización para ejecutar el reset ni esta transición.

No se usan sobrantes/faltantes, saldos legacy, consumos históricos o compras
supuestas para cerrar diferencias. El inventario inicial no incluye productos
ausentes de la hoja por el solo hecho de existir en el catálogo.

## N. Secuencia posterior

El núcleo transaccional y la interacción con históricos están implementados y
probados de forma aislada. No se declara todavía lista para ejecución productiva
la secuencia completa de Don Santiago: faltan las decisiones anteriores y la
validación PostgreSQL/PostGIS. El reset y su conservación del grafo histórico
son un procedimiento separado; esta entrega no implementa ni ejecuta un reset.

Tras resolver y autorizar, la secuencia prevista es reset autorizado →
configurar fecha de control → activar V1 bajo mantenimiento y STOCK_INITIAL →
importar antecedentes sin stock → ingresos posteriores con sus fechas reales →
conciliación. La apertura requiere un ledger vacío y el manifiesto completo
revisado; los antecedentes no corrigen ni consumen la apertura.

RESET DE DON SANTIAGO: NO EJECUTADO.
STOCK INITIAL DE DON SANTIAGO: NO EJECUTADO.
DATOS OPERATIVOS DE DON SANTIAGO: NO MODIFICADOS.

Esperar autorización antes de cualquier ejecución sobre Don Santiago.
