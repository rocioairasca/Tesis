# Validación final pre-reset — PostgreSQL/PostGIS e inventario Don Santiago

16/09/2026. **No se ejecutó ningún cambio productivo ni reset.** El servidor
temporal, pruebas y correcciones de código son locales. Para Don Santiago se
usaron exclusivamente el backup verificado y las fuentes de auditoría existentes.
No se realizaron consultas nuevas a producción.

## Resultado para decidir

La integración de apertura e históricos está validada en PostgreSQL/PostGIS
real local. La suite completa pasó **166/166, sin omisiones**. No equivale a
aprobar un reset: la instalación completa desde cero sigue bloqueada por falta
del esquema base versionado, y la apertura física tiene decisiones pendientes.

La [conciliación completa](don-santiago-final-reconciliation.md) contiene las
42 líneas, todos los candidatos, duplicados, siete bloqueos originales,
equivalencias, soja, compras y preguntas finales. Su [JSON](don-santiago-final-reconciliation.json)
incluye referencias históricas por ID y plantillas de compras no ejecutables.

No corresponde llamar «35 READY» a las 35 líneas del preview anterior:
**27 READY técnicos, 4 REVIEW_DUPLICATE y 11 BLOCKED**. Los 11 son las siete
originales más cuatro equivalencias sin confirmar. READY solo indica que no se
detectó un bloqueo técnico en esa línea; no es autorización de carga.

## A–B. Entorno y versiones

No había Docker, Podman ni una distribución WSL operativa. Se preparó PostgreSQL
portátil dentro de `.local-postgis/`, excluido de Git, sin instalar servicios de
Windows ni modificar `.env`. Escucha exclusivamente en `127.0.0.1:55439`, con
autenticación SCRAM y contraseña aleatoria local. La base se llama
`growsync_test_stock_initial`. El ejecutor verifica host, puerto, nombre y ruta
real del clúster antes de usarlo. El servidor quedó detenido al finalizar
(`pg_ctl`: `server stopped`); los archivos locales se conservan para reproducirlo.

| Componente | Backup Supabase | Validación local |
|---|---|---|
| PostgreSQL | 17.6, Linux aarch64 | 17.6, Windows x86_64 |
| PostGIS | 3.3.7 | 3.6.2 |
| btree_gist | 1.7 | 1.7 |
| pgcrypto | 1.3 | 1.3 |
| uuid-ossp | 1.1 | 1.1 |
| plpgsql | 1.0 | 1.0 |

La versión principal y menor de PostgreSQL coincide. PostGIS, sistema operativo
y arquitectura difieren: es una aproximación funcional, no una réplica binaria
de Supabase. `supabase_vault` y `pg_stat_statements` no se reprodujeron; no son
dependencias de las operaciones probadas. No se simuló la capa Auth/PostgREST
de Supabase ni se certifica con estas pruebas toda su configuración de permisos.

La instalación portátil sigue la opción de binarios documentada por
[PostgreSQL/EDB](https://www.postgresql.org/download/windows/) y los paquetes
[PostGIS para Windows](https://postgis.net/documentation/getting_started/install_windows/released_versions/).
Versiones observadas y URLs exactas: [versions.json](../audit/local-postgis-validation/versions.json).

Hashes SHA-256 calculados de las descargas:

- PostgreSQL: `d378882abd001a186735acd6f6ba716bca6ccd192e800412d4fd15ed25376b3e`.
- PostGIS: `7ba180ee2a352987b9a2f194673652c59483b55852295ccf401dceccd8765425`.

El MD5 de PostGIS coincidió con el publicado por OSGeo. Los SHA-256 anteriores
identifican los archivos usados; no se presentan como firmas del proveedor.

## C. Esquema, migraciones y prueba desde cero

Se probaron separadamente dos caminos:

**Instalación desde una base vacía: BLOQUEADA.**
`create_companies_and_invitations.sql` termina intentando alterar `users`, que
no existe: SQLSTATE `42P01`. El ensayo fue transaccional y revirtió el intento.
El repositorio no contiene una cadena de migraciones que cree las tablas base
`users`, `products`, `lots`, `planning`, `usage_records` e Inventory V1 antes de
sus ALTER. Ordenar los archivos actuales no reemplaza esos CREATE faltantes.
Los scripts `run_migration_*` tampoco resuelven ese origen: ejecutan fragmentos
y varios cargan la conexión configurada, por lo que no se utilizaron.

Es una deuda de reproducibilidad confirmada, no corregida con un esquema
inventado. Antes de declarar soportadas instalaciones nuevas, hace falta una
migración baseline revisada, orden/dependencias explícitos y registro de
migraciones, con una prueba completa desde base vacía. El test que detecta esta
limitación pasa porque espera el error; **no significa que la instalación pase**.

**Migración desde un esquema legacy equivalente: APROBADA en el alcance probado.**
Se reconstruyó el subconjunto relacional capturado en
`tests/historySchema.fixture.sql`, con `geometry(Polygon,4326)` real.
No se cargaron datos productivos en esta prueba, solo entidades sintéticas.

Orden usado:

1. Esquema prerequisito capturado, anterior a historical_no_stock/STOCK_INITIAL.
2. `20260830_add_lot_layouts_sub_lots_postgis.sql`: funciones, triggers e índices
   espaciales del repositorio, aplicado al esquema vacío antes de sembrar datos.
3. Protecciones Inventory V1 existentes, tomadas del fixture auditado; funciones
   y triggers de cosechas parciales de `20260908_add_partial_harvests.sql`.
   Las columnas/constraints de cosechas parciales ya están en el snapshot;
   no se volvió a ejecutar su ALTER no idempotente ni se afirma que esa migración
   completa haya corrido desde un esquema anterior.
4. `20260914_inventory_base_units.sql`, dentro de una transacción.
5. Datos legacy sintéticos, incluyendo Planning, Usage, cosecha, asignación,
   lote, layout y sublote.
6. `20260916_historical_no_stock.sql`.
7. `20260916_stock_initial.sql`.

Cada escenario crea un esquema nuevo y lo elimina al terminar. Se repitieron
desde esquemas vacíos después de cada corrección; no se parcheó una ejecución
fallida en sitio. Las nuevas migraciones se ejecutaron sin modificar su SQL.
La reubicación de `public` al esquema aleatorio ocurre solo en el harness de
aislamiento; las migraciones del proyecto permanecen intactas.

Se inspeccionaron **25 tablas, 295 columnas, 24 funciones, 30 triggers,
178 constraints y 56 índices**. Todos los constraints inspeccionados figuran
validados, incluyendo **77 FKs y 67 checks**. Hay inventario explícito de
definiciones y tipos en [schema-check.json](../audit/local-postgis-validation/schema-check.json).
No se afirma equivalencia total con todos los objetos de Supabase: el backup
de septiembre no contiene las definiciones de todas sus funciones/triggers.

## D. Fallos encontrados y correcciones

| Hallazgo | Causa | Corrección / resultado |
|---|---|---|
| «Campos desconocidos en planning» en importación histórica | El servicio consultaba columnas solo en `public`, mientras los tests usan un esquema aislado | `historicalImport.js` consulta `current_schema()`, consistente con sus INSERT sin schema explícito. En el despliegue habitual sigue siendo `public`. Validación repetida desde cero: aprobada. |
| Deadlock `40P01` en carrera apertura/ingreso | Ingreso bloqueaba producto antes del advisory lock de empresa que ya tenía la apertura | `stock.receiveStock()` toma primero el mismo lock de empresa y luego producto/partida. La nueva carrera terminó con ambas operaciones y saldo 15, sin duplicar apertura. No se deshabilitó ningún trigger. |
| Harness usaba MultiPolygon | La migración espacial del repositorio define Polygon | Se corrigió el fixture PostGIS y la geometría sintética para usar `Polygon,4326`. No cambió ninguna geometría productiva. |
| Campaña sintética de cosecha rechazada | El fixture ampliado usaba una etiqueta, después una barra, pero el check exige `AAAA-AAAA` | Se corrigió solo el dato sintético a `2019-2020`; se recreó el esquema y volvió a correr. No se relajó el constraint. |
| Primer comando initdb mal formado | PowerShell separó el argumento del archivo de contraseña | Corregido el argumento del script local; no fue un error de migración. |
| Instalación limpia falla por `users` inexistente | Falta el esquema baseline previo a las migraciones versionadas | Bloqueo documentado; no se ocultó ni inventó una migración productiva. |

La evidencia de los fallos queda en
[primer intento](../audit/local-postgis-validation/attempt-1-tests.tap) y
[fallo de fixture](../audit/local-postgis-validation/attempt-3-fixture-failure.tap).

## E. Integración y concurrencia

- Suite local específica: **11/11 aprobadas**, incluida la detección explícita
  de que falta el baseline de instalación. [Resultado final](../audit/local-postgis-validation/tests.tap).
- Suite backend completa con aceptación del backup y PostGIS activados:
  **166/166 aprobadas**, sin fallos ni omisiones, 47,6 s.
  [Resultado completo](../audit/local-postgis-validation/full-suite.tap).
- Después se amplió el escenario legacy con asignaciones/cosechas previas y
  triggers de cosecha reales; se repitió la suite local: **11/11**, 7,5 s.
  No hubo cambios de servicios después de la suite completa.

Se verificó apertura → partidas → movimientos → saldo; histórico sin cambio
de stock/alertas; compra +5; Planning NORMAL −3; ajustes −2/+1. La igualdad fue
`10.123456 + 5 - 3 - 2 + 1 = 11.123456` y coincidió con la suma de movimientos.
También: rollback de la segunda partida, precision/unidades, NULL de vencimiento,
conflicto de idempotencia, segunda apertura rechazada, permisos efectivos,
protección contra escrituras directas y contra apertura incompleta al COMMIT.

Con sesiones PostgreSQL realmente concurrentes:

- Misma clave: dos respuestas, una apertura y saldo 10.
- Claves distintas: una apertura y un 409, saldo 10.
- Apertura frente a compra: ambas confirmadas en la ejecución final, una apertura
  y saldo 15. Si la compra se confirma primero, el contrato permite rechazar la
  apertura por inventario ya existente; nunca apilarla sobre ese ingreso.

## F. Preservación de legacy y geometrías

Las nuevas migraciones no cambiaron los valores de productos, Planning, Usage,
asignación ni cosecha preexistentes. Las cuatro clases quedaron en `NORMAL`;
la fecha inicial siguió NULL; no aparecieron partidas/movimientos por migrar.

Se compararon geometrías antes/después de migrar y después de importar la
Planning histórica vinculada al sublote: **EWKB idéntico byte a byte, SRID 4326,
número de puntos, áreas e IDs de lote/layout/sublote idénticos**. Se usaron tres
geometrías sintéticas reales, no texto ni funciones ST simuladas. No hubo
simplificación ni reasignación. Este resultado no significa que se haya aplicado
una migración o reescrito las 47 geometrías del backup de Don Santiago.

## G–K. Conciliación, duplicados y nombres

La tabla completa y sus siete explicaciones individuales están en
[don-santiago-final-reconciliation.md](don-santiago-final-reconciliation.md).
Se verificaron los **42 archivos SHA-256** del respaldo, sin alterarlos.

Recomendaciones de identidad principal, **pendientes de aprobación humana**:

| Producto | ID sugerido | Fundamento |
|---|---|---|
| Glifosato | a009dbe1-931c-4980-a9bc-29c014fd43e6 | Activo, 2 Planning y 2 Usage |
| MSO | 571bfc48-a3c7-4ffb-93c8-932e7d392446 | Activo, 3 Planning y 3 Usage |
| Finesse | efff7e45-bedd-4d86-a8c2-82cc7ed5f2df | Activo, 1 Planning y 1 Usage; esto NO valida la escala del saldo legacy |
| Atrazina | f687a8f4-17eb-4269-a870-138335468a8b | Activo, 1 Planning y 1 Usage; otro duplicado deshabilitado |
| 2,4-D EHE | Sin preferencia técnica fundada | Dos activos con 20 L y sin Planning/Usage; no hay evidencia para elegir por uso |

Todos los IDs alternativos, enabled, unidades, saldos legacy y created_at
digitales están en la conciliación. El JSON conserva IDs de cada referencia.
No hubo fusiones, bajas, correcciones ni decisiones automáticas.

Las siete bloqueadas originales son Finesse, Nicosulfuron granulado,
Lambdacialotrina, Imazapic, Apron, Maxim y Efimax. Se agregan como BLOCKED de
identidad Percon/Pericon, Perside/Preside, Diflufenican/Diflufenicam y
Thiencarbazone metil/Thiencarbazonemetil. El parecido ortográfico no prueba
equivalencia; Maxim también requiere confirmar su ficha.

## L. Vencimientos parciales e Imazapic

Se propone **precisión de vencimiento explícita unknown/day/month**, preservando
año/mes sin fabricar día. Debe diseñarse junto con FEFO, disponibilidad y alertas:
NULL hoy implica ausencia de vencimiento conocido; agregar solo una nota puede
dejar disponible una partida que necesita revisión. No se implementó todavía
este cambio de modelo ni una regla que asuma primer/último día del mes.

Imazapic está en litros y la hoja cuenta un paquete. Se requiere nombre/formulación,
contenido y decidir si se controlan paquetes o contenido. Una unidad `package`
puede ser generalizable, pero no debe equipararse automáticamente a L/kg/bag/unit.
No se implementó esa unidad ni conversión.

## M–N. Soja y compras posteriores

Soja: 33570 kg en total y disponible legacy, sin Planning/Usage; alta digital
13/09/2026 22:32:54.270392. No figura en la hoja inicial. No hay evidencia para
afirmar compra o ingreso físico el 13/09. Se necesita origen, fechas efectivas y
cantidades por entrega; si era existencia inicial omitida, el tratamiento cambia.

Compras confirmadas: Glifosato +38 L, Atrazina +100 L, MSO +25 L, Dicamba +16 L,
Difimet +62 L y Sulfato de amonio +45 L. Las plantillas JSON mantienen `origin:
purchase`, cantidades explícitas y fechas/IDs/claves pendientes. No son payloads
listos para ejecutar. Se necesitan fechas reales, eventual distribución por
entrega/partida, IDs confirmados y vencimiento si se conoce. No se toman fechas
de alta/actualización como fechas de compra.

## O. Preguntas finales

1. ¿Confirmás las fichas principales recomendadas y cuál de las dos activas
   corresponde a 2,4-D EHE?
2. ¿Son el mismo producto las equivalencias de nombres señaladas, incluido Maxim?
3. ¿Confirmás las cantidades físicas y aprobás declarar expresamente Finesse
   1,050 kg, Nicosulfuron 0,300 kg y Lambdacialotrina 5,5 L, o hay que corregirlas?
4. ¿Qué producto/contenido tiene el paquete de Imazapic y cómo querés controlarlo?
5. ¿Los tres envases indican solo mes/año y aprobás diseñar su soporte y política
   de disponibilidad antes de abrir inventario?
6. ¿Cuándo y en qué cantidades ingresaron la soja y cada una de las seis compras?
   ¿La soja fue compra posterior o existencia previa?

Resolver estas preguntas no autoriza el reset. Sigue pendiente también cerrar
la reproducibilidad del esquema base y revisar las diferencias del entorno
destino antes de aplicar migraciones productivas.

## Reproducción local

Los scripts no leen `.env`. Los binarios y credenciales quedan solo en la
carpeta ignorada `.local-postgis`. Con las descargas y el clúster ya preparados:

```powershell
./growsync-backend/scripts/localPostgis.ps1 -Action Start
cd growsync-backend
node scripts/runLocalPostgisValidation.cjs --all
cd ..
./growsync-backend/scripts/localPostgis.ps1 -Action Stop
```

El ejecutor crea esquemas aleatorios y los elimina; no admite URL remota ni
nombre de base productiva. Al clonar en otra máquina hay que preparar los
archivos portátiles desde las URLs documentadas o aportar un entorno local
descartable compatible al harness. No es un instalador de producción.

MIGRACIONES EN PRODUCCIÓN: NO APLICADAS.
RESET DON SANTIAGO: NO EJECUTADO.
STOCK INITIAL DON SANTIAGO: NO EJECUTADO.
DATOS PRODUCTIVOS DON SANTIAGO: NO MODIFICADOS.
