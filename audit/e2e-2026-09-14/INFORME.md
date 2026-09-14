# Auditoría funcional e integridad — GrowSync

Fecha: 14/09/2026. Rol del auditor: QA, sin implementación de correcciones.

## 1. Resumen ejecutivo

**Resultado: no aprobar todavía la integridad end-to-end.** Las pruebas existentes pasan, pero las pruebas adversariales reproducen fallos de stock legacy y autorización que esas suites no detectan.

Hallazgos prioritarios:

- **Crítico:** editar un Usage legacy con stock insuficiente devuelve 409 pero deja alterada su cantidad.
- **Crítico:** un fallo al deshabilitar un Usage legacy deja el stock reintegrado; reintentar vuelve a incrementarlo.
- **Crítico:** la cadena de middleware de alta de Cosechas permite llegar al controlador con un Empleado autenticado sin permisos. Usage y Vehículos también presentan divergencias entre permisos efectivos y comprobación por rol.
- **Alto:** Usage acepta lotes deshabilitados, tanto en legacy como en V1.
- **Alto, reproducción con intercalado simulado:** cancelar puede sobrescribir el estado de una planificación completada concurrentemente.

La empresa observada en localhost funciona en modo **legacy**: partidas sin historial disponible y ajuste deshabilitado. Por eso el recorrido real hasta movimiento FEFO no puede aprobarse en esa empresa. No se activó V1.

**No se completó un alta end-to-end real Empresa → Cosecha con escrituras.** Se auditó la aplicación real en consulta y se ejecutó el tramo de stock/completion contra datos sintéticos en memoria. Se distinguen expresamente estos niveles de evidencia; un test aislado no certifica Auth0, PostGIS, la base instalada ni la concurrencia de producción.

## 2. Entorno, límites y cambios

- URL real: `http://localhost:3000`; sesión Admin iniciada por la usuaria, empresa GrowSync Demo.
- Única sesión real disponible: Admin. Dueño, Supervisor y Empleado se analizaron con identidades sintéticas en middleware; no se alteraron roles ni permisos.
- No se inició el backend, no se ejecutaron cron jobs, no se aceptó geolocalización ni se pulsaron sincronizaciones. El Dashboard mostró el fallback del último clima guardado.
- No se enviaron formularios de alta, edición, ejecución, deshabilitación o restauración a la aplicación real. Los borradores abiertos se cerraron.
- Pruebas SQL en PGlite, solo en memoria, con esquemas sintéticos. **No se ejecutó ningún archivo de migración**, tampoco dentro de las pruebas.
- Se excluyeron `inventoryUnits.integration.test.js` y `partialHarvests.integration.test.js`, porque ejecutan migraciones en su preparación. Sus resultados de turnos anteriores no se cuentan como ejecución de esta auditoría.
- **Código funcional modificado por esta auditoría: ninguno.** Se añadieron exclusivamente scripts/resultados e informe en esta carpeta; el build se generó bajo `grow-sync/node_modules/.cache/qa-e2e-build`.
- **Base de datos real modificada por el auditor: NO. Migraciones ejecutadas: NO.** No se realizó una comparación transaccional de toda la base para atribuir eventuales cambios de otros usuarios o procesos.

## 3. Escenarios ejecutados y cobertura

| Área | Ejecución | Resultado / límite |
| --- | --- | --- |
| Sesión Admin | Login realizado por usuaria, navegación privada real | Empresa visible consistente; no se recopilaron credenciales |
| Otros roles | Middleware real con identidad sintética, matriz 0/1/2/3 y permisos vacíos | Se detectaron divergencias; no son sesiones Auth0 reales |
| Multiempresa stock | Suite aislada: producto/lote/actor ajenos, FK y rollback | Pasan casos cubiertos; no certifica todos los módulos |
| Lotes | Consulta real de 5 lotes, árbol, selección de Lote 15, contexto y mapa; alta abierta sin guardar | Selección sincronizada y contexto de 2 divisiones visibles |
| Subdivisiones | Revisión de activación, locks, validación espacial; tests de geometría/map viewport | No se crearon layouts; PostGIS y activación concurrente no probados en entorno real |
| Productos | Inventario real, detalle, alta móvil y catálogo de seis unidades sin guardar | UI expone seis unidades; la empresa sigue legacy |
| Ingreso/completion/Usage/movimiento | Seis recorridos de servicios con PostgreSQL en memoria | Unidad, cantidad, saldo y referencias consistentes |
| FEFO/ajustes | 27 tests de stock existentes, incluyendo partidas, vencidas, ajustes +/− y reintentos | Pasan; ingreso/ajuste real no ejecutado |
| Planning | Tabla real; tipos de actividad; mantenimiento; opción Registrar como realizada | No se inició ni completó una planificación real |
| Usage | Listado y detalle real de uso automático; probes legacy y V1 | Origen Siembra y ambos sublotes visibles; fallos adversariales documentados |
| Cosechas | Listado y detalle real, autor, campaña, geometría; tests puros de área y procedencia | No se creó/modificó/restauró una cosecha real ni se reran suites con migraciones |
| Campañas | Tests de identidad/cronología y revisión SQL; etiquetas reales observadas | Código actual usa fechas/ID; datos sin metadatos no permiten tendencia completa |
| Lluvias | Consulta real mobile, métricas, gráfico, historial y paginación visible | 0 mm mes / 245 mm año; sin sincronización ni edición |
| Vehículos | Consulta real, lista y acciones; schema/controlador con dobles de persistencia | Riesgo en referencias a usuario y autor documentado |
| Usuarios | Acceso Admin y revisión de aislamiento/cambio de rol | No se modificaron usuarios, roles o permisos |
| Mobile | Viewport 390×844: navegación, mapa/lote seleccionado, alta de lote, Cosechas/detalle, lluvia, inventario/alta | Sin overflow de documento en Lotes/Cosechas/Lluvia; no equivale a prueba en teléfono físico |

## 4. Flujo trazado y casos exitosos

`stock-trace.cjs` crea empresa, usuario, producto, lote y referencias sintéticas; registra ingreso y ejecuta **applyPlanningProductUsage**. Verifica por JOIN completion → usage → usage_lots → stock_movements, el ID de planificación, lote y sublote y el saldo. Los IDs no se utilizan como labels visibles.

| Unidad | Stock inicial | Real consumido | Saldo |
| --- | ---: | ---: | ---: |
| L | 38 | 8,5 | 29,5 |
| mL | 100 | 0,125 | 99,875 |
| kg | 1 | 0,005 | 0,995 |
| g | 130 | 35 | 95 |
| unit | 10 | 1 | 9 |
| bag | 10 | 1,25 | 8,75 |

Es un tramo de servicios, **no** incluye alta HTTP de planificación, transición de estado, geometría PostGIS ni cosecha posterior. El esquema sintético usa seis unidades y NUMERIC(20,6); no prueba que esa configuración esté desplegada en la empresa real.

La suite de stock valida precisión exacta, FEFO, exclusión de partidas vencidas del consumo V1, ajustes negativos que pueden retirar vencidos, stock insuficiente con rollback, idempotencia, reversión y FK/inmutabilidad. Los tests puros de Cosechas validan redondeo de superficie, saldo de ciclo, cierre y procedencia/fechas. El frontend valida formato argentino, geometría, selección, campañas y componentes.

En la aplicación real se pudo seguir **Siembra completada → Usage de 20 L → Lote 15-A/15-B**, y consultar una cosecha de Maíz en Lote 15-A con campaña Gruesa y autor legible. No hay evidencia para afirmar que esa cosecha corresponde a la misma ejecución o para reconstruir el movimiento FEFO, inexistente en la UI legacy. Ambos registros observados están fechados 29/09/2026, posterior al día de auditoría: anomalía preexistente a revisar, no datos creados aquí.

## 5. Fallos reproducidos y riesgos

Las rutas de archivos que siguen son relativas a la raíz del proyecto. “Simulado” significa que se ejecutó código real con una dependencia de persistencia controlada; no implica haber provocado el fallo en producción.

### Q01 — CRÍTICO — Edición legacy rechazada deja Usage alterado

- **Reproducir:** producto con 5 kg disponibles y Usage activo de 2 kg; editar a 20 kg. Ejecutar `node audit/e2e-2026-09-14/probes.cjs`, caso `LEGACY_EDIT_INSUFFICIENT`.
- **Esperado:** 409 y persistencia intacta: Usage 2, stock 5.
- **Actual:** 409 Stock insuficiente, Usage **20**, stock **5**.
- **Impacto:** contabilidad consumo/stock inconsistente después de un error que el usuario interpreta como operación no realizada.
- **Evidencia:** controlador real con almacenamiento en memoria. `controllers/usage/usage.js` actualiza el uso (línea 486) antes del ajuste, sin transacción/compensación de esa edición.
- **Archivo:** `growsync-backend/controllers/usage/usage.js:415`.
- **Riesgo de corregir:** alto; migrar la operación completa a una transacción exige preservar las reglas legacy y probar cambios de producto, lotes y fallos parciales. No corregido.

### Q02 — CRÍTICO — Reintento de deshabilitación legacy puede crear stock

- **Reproducir:** mismo stock 5 y Usage 2; simular fallo de persistencia al marcar enabled=false; deshabilitar dos veces. Caso `LEGACY_DISABLE_RETRY_AFTER_FAILURE`.
- **Esperado:** los intentos fallidos no afectan stock, o una operación idempotente completa el cambio una sola vez.
- **Actual:** Usage sigue activo y stock pasa de **5 a 9**.
- **Impacto:** reintegro repetido y saldo ficticio. La restauración tiene el patrón inverso de descuento antes del cambio de estado.
- **Evidencia:** inyección de error en doble de Supabase; código real. No se cortó la conexión real.
- **Archivo:** `growsync-backend/controllers/usage/usage.js:524`, reintegro línea 557; restauración línea 672.
- **Riesgo de corregir:** alto por atomicidad, concurrencia y compatibilidad de reintentos. No corregido.

### Q03 — CRÍTICO — Permisos de UI no exigidos consistentemente en API

- **Reproducir:** identidad autenticada rol 0, `custom_permissions: []`; recorrer middlewares de POST `/api/harvest-records`. Caso `HARVEST_EMPLOYEE_NO_PERMISSION_REACHES_CREATE`.
- **Esperado:** 403 antes de entrar al controlador de creación.
- **Actual:** el controlador es alcanzado. La prueba sustituye solo autenticación/carga de identidad y el controlador final; conserva la cadena de la ruta. El controlador real no agrega comprobación de permiso funcional.
- **Impacto:** ocultar botones no impide mutaciones por API dentro de la empresa. Las rutas CRUD de Cosechas solo exigen autenticación; algunas rutas especiales sí tienen permisos, produciendo una protección desigual.
- **Relacionado:** Usage usa `checkRole(1)` para crear/editar/deshabilitar/restaurar, ignorando permisos vacíos de Supervisor/Dueño/Admin; Empleado tiene `usage.create` por catálogo pero la ruta lo rechaza. Lecturas de deshabilitados de Planning/Usage y rutas de Vehículos tampoco aplican uniformemente los permisos efectivos.
- **Archivos:** `growsync-backend/routes/harvestRecords.js`, `routes/usage.js`, `routes/vehicle.js`, `routes/planning.js`; `middleware/checkRole.js`; ambos catálogos `constants/permissions` y `grow-sync/src/utils/permissions.jsx`.
- **Riesgo de corregir:** medio/alto: definir una matriz única y verificar que no bloquee operaciones legítimas ni permisos personalizados. No se modificó Auth0 ni permisos.

### Q04 — ALTO — Usage acepta lotes deshabilitados

- **Reproducir:** usar un ID de lote de la empresa con enabled=false en un consumo manual.
- **Esperado:** rechazo antes de escribir consumo y stock.
- **Actual:** legacy devuelve 201; V1 también crea Usage y descuenta stock. Casos `LEGACY_DISABLED_LOT_EXPIRED_PRODUCT` y `V1_DISABLED_LOT_ACCEPTED`.
- **Evidencia:** legacy con doble de persistencia; V1 con PostgreSQL en memoria. Las consultas verifican empresa e ID pero no enabled.
- **Archivos:** `growsync-backend/controllers/usage/usage.js:703`, `growsync-backend/services/stockUsage.js:9`. Revisar también validación de selecciones al completar Planning: la lectura no revalida enabled/layout vigente.
- **Riesgo de corregir:** medio; distinguir nueva operación sobre lote deshabilitado de carga histórica legítima. No cambiar indiscriminadamente el acceso a historial.

### Q05 — ALTO — Cancelación puede pisar completion concurrente

- **Reproducir:** cancelación lee estado en progreso; antes de su UPDATE, completion confirma consumos y estado completado; luego continúa cancelación.
- **Esperado:** una operación gana y la otra rechaza/revalida el estado bajo lock.
- **Actual en intercalado simulado:** cancelación responde 200 y deja cancelado/deshabilitado. Su SELECT no tiene FOR UPDATE y el UPDATE no condiciona el estado leído.
- **Impacto:** estado cancelado con consumos/productividad ya aplicados.
- **Evidencia:** `CANCEL_AFTER_CONCURRENT_COMPLETION_SIMULATION`, controlador real con intercalado inyectado. **Pendiente reproducir con dos conexiones PostgreSQL reales en staging**; no se afirma haber ejecutado concurrencia real.
- **Archivo:** `growsync-backend/controllers/planning.js:1383`, SELECT 1396, UPDATE 1436. Revisar análogamente edición, SELECT 1108.
- **Riesgo de corregir:** medio/alto; orden de locks y transiciones deben evitar deadlocks y estados parciales.

### Q06 — ALTO — Vehículos admite autor y responsable no verificados

- **Reproducir:** payload de alta con `created_by` distinto del actor y `responsible_user` de otra empresa; UUIDs válidos.
- **Esperado:** autor desde sesión y validación del responsable contra empresa/estado habilitado.
- **Actual:** controlador pasa ambos IDs directamente al INSERT sin consulta de validación. Probe `VEHICLE_UNVERIFIED_USER_REFERENCES`: una sola consulta y respuesta 201 con persistencia simulada.
- **Impacto:** atribución falsificada y posible referencia cruzada entre empresas. **No se comprobó si una restricción instalada en DB mitiga la referencia cruzada**; no se intentó sobre datos reales.
- **Archivos:** `growsync-backend/controllers/vehicle.js:103`, `validations/vehicle.schema.js`.
- **Riesgo de corregir:** medio; conservar autores históricos, derivar solo nuevas altas de la sesión y validar referencias sin reescritura masiva.

### Q07 — ALTO — Stock vencido legacy se presenta disponible y se consume

- **Reproducir:** consultar inventario real: Insecticida Rapid tiene 50 L, vencimiento 29/09/2025 y estado Disponible; fecha de auditoría 14/09/2026. En probe legacy usar producto vencido con saldo positivo.
- **Esperado:** estado vencido inequívoco y política explícita de consumo vencido coherente con V1.
- **Actual:** UI muestra Disponible; `adjustStock` legacy no verifica vencimiento y el consumo de prueba se acepta. El probe combina lote deshabilitado y producto vencido; la ausencia de validación de vencimiento se confirma por inspección del camino ejecutado.
- **Archivos:** `grow-sync/src/features/inventory/inventoryModel.mjs:9`, `:12`; `growsync-backend/controllers/usage/usage.js:36`. También revisar el fallback de adquisición como “vencimiento”.
- **Impacto:** estado operativo engañoso y comportamiento diferente entre modelos de stock.
- **Riesgo de corregir:** medio; decidir tratamiento de legacy y de retiros/ajustes de productos vencidos, que sí deben poder registrarse.

### Q08 — MEDIO — Query flags y listados de deshabilitados inconsistentes

- **Reproducir:** `EXPRESS5_QUERY_REINJECTION` con Request real de Express 5, `includeDisabled=false`; luego ruta sintética `/disabled` con `req.query.onlyDisabled=true`.
- **Esperado:** el controlador recibe booleanos validados y el flag de ruta.
- **Actual:** `includeDisabled` sigue siendo string y `onlyDisabled` desaparece: `req.query` es un getter. Además Zod `z.coerce.boolean()` transforma el string `"false"` en true.
- **Impacto:** rutas de deshabilitados de Lluvias/Cosechas pueden volver a listar activos; Usage puede interpretar `includeDisabled=false` como verdadero. Vehículos actualmente reparsa el string y mitiga ese caso concreto: no confundir el defecto del schema con un fallo confirmado en ese listado.
- **Archivos:** `growsync-backend/middleware/validate.js`, `routes/rainRecords.js`, `routes/harvestRecords.js`, `validations/usage.schema.js`, `validations/vehicle.schema.js`, controladores de listados.
- **Evidencia:** objetos Request reales de Express y middlewares locales, sin petición a la API real. La pantalla principal de Lluvias usa query explícito y no necesariamente manifiesta el fallo de la ruta alias.
- **Riesgo de corregir:** medio; tests HTTP de todos los booleanos, normalización y rutas alias antes de modificar middleware global.

### Q09 — MEDIO — Usage solo carga la primera página del servidor

- **Reproducir:** tener más de 50 usos activos; abrir Usage y buscar/paginar hasta uno anterior al registro 50.
- **Esperado:** historial completo accesible con paginación real.
- **Actual por inspección:** GET `/usages` sin página; se conserva solo `data`, se descartan `total/page`; la tabla pagina localmente de a 5. No solicita la segunda página del backend.
- **Evidencia:** lectura de código; la empresa consultada no tiene suficientes filas para reproducir el corte visual.
- **Archivos:** `grow-sync/src/features/usages/Usage.jsx:110`, `:390`; backend `controllers/usage/usage.js:244` (pageSize 50).
- **Riesgo de corregir:** bajo/medio; preservar selección/filtros y evitar buscar solo sobre páginas parciales.

### Q10 — MEDIO — Mensajes ofrecen una corrección que el sistema bloquea

- **Reproducir:** intentar cambiar estructura/reabrir una planificación con consumos automáticos; seguir la instrucción “Corregí los usos asociados”.
- **Esperado:** mecanismo autorizado de corrección integral o mensaje que explique que aún no está disponible.
- **Actual:** Planning indica corregir Usage, pero Usage automático bloquea edición/deshabilitación independiente, correctamente por integridad. No hay un camino implementado de reversión integral visible.
- **Archivos:** `growsync-backend/controllers/planning.js:1141`, `:1421`; `controllers/usage/usage.js:435`, `:547`; `services/stockUsage.js`.
- **Impacto:** callejón sin salida operativo; no implica que deba permitirse editar Usage automático aisladamente.
- **Riesgo de corregir:** bajo para mensaje, alto para diseñar reversión integral. No se implementó ninguna.

### Q11 — MEDIO — Productos visibles para trabajos que no generan consumo

- **Reproducir:** abrir Nueva Planificación, seleccionar Mantenimiento. La UI mantiene Productos/Agregar producto. Registrar como realizada una actividad de ese tipo con productos en entorno seguro.
- **Esperado:** ocultar/rechazar productos si no corresponden o explicar explícitamente que no habrá consumo.
- **Actual observado/estático:** campos visibles para Mantenimiento; el servicio `completeActivityWithoutProductiveEffects` marca completado y devuelve cero consumos. No se guardó el formulario real.
- **Archivos:** `grow-sync/src/features/planning/Planning.jsx:2035`; `growsync-backend/services/planningCompletion.js:992`; validación de Planning.
- **Impacto:** el usuario puede creer que registró materiales usados cuando ese flujo no los descuenta. Debe confirmarse la regla de negocio para Riego/Cosecha/Mantenimiento/Otro.
- **Riesgo de corregir:** medio, requiere decisión funcional, no un cambio cosmético unilateral.

### Q12 — BAJO — Acciones de Planning sin nombre accesible

- **Reproducir:** consultar tabla de Planning mediante lector de pantalla/árbol accesible.
- **Esperado:** cada botón tiene nombre funcional y los códigos internos no reemplazan etiquetas humanas.
- **Actual:** botones de fila anónimos; estado accesible “Cambiar estado en_progreso”/“en_demora”, además de acción Iniciar/Completar.
- **Archivo:** `grow-sync/src/features/planning/components/PlanningTable.jsx` y presentación de estados de Planning.
- **Impacto:** navegación asistida ambigua. No se considera un rediseño estético.
- **Riesgo de corregir:** bajo; labels accesibles y separación clara estado/acción.

## 6. Datos observados, campañas y Cosechas

- Dashboard y Cosechas coincidieron en **9 registros, 5.869 kg, 206,03 ha y 28,49 kg/ha** con filtros generales. No se recalcularon contra toda la DB.
- Se observaron datos TEST TEMP preexistentes dentro de esos KPIs (415 kg en el grupo de pruebas). Es contaminación del dataset demo para interpretar resultados, no un fallo demostrado de agregación. No se borraron.
- Se observó cosecha y Usage efectivos el **29/09/2026**, y siembra completada con ese período, aun siendo 14/09/2026. El detalle de cosecha indica procedencia no documentada y creación 02/09/2026. Requiere revisión del dato histórico; el validador actual de cosechas rechaza fechas futuras en sus tests. No atribuir automáticamente el dato a un fallo actual de alta.
- Campaña Gruesa conservó su nombre. El código compartido ordena por fechas y preserva ID; la API de estadísticas agrupa por ID. El Dashboard consultado mostró campañas sin cronología completa y lo aclaró: no se infirieron años del nombre.
- Conviven trigo/Trigo y campañas legacy 2025-2026/2025/26. No se agruparon ni renombraron automáticamente. Revisar identidad de catálogos/legacy antes de normalizar estadísticas.
- Autor de cosecha observado: nombre legible; fallback del helper: full_name → email → No informado. No se vio UUID en la muestra de Cosechas.
- Cosechas parciales, límites espaciales y restauración transaccional requieren una pasada adicional en staging con esquema ya preparado; no se ejecutaron las suites que aplican migraciones.

## 7. Ediciones, soft delete y trazabilidad

| Entidad | Regla observada en código / limitación |
| --- | --- |
| Producto | Unidad bloqueada por historial/referencias y saldos legacy; no se probó un cambio real |
| Lote | Nombre/área/geometría editables por formulario; activación de layout bloquea el lote y valida draft/geometría; falta prueba espacial real |
| Planning | Estructura bloqueada con completions; siembra ejecutada protege asignaciones; carrera Q05 y salida de corrección Q10 |
| Usage manual legacy | Editable con ajuste por diferencia, pero no atómico: Q01/Q02 |
| Usage manual V1 | Edición exige reversión y nuevo registro; reversión de consumo probada aislada |
| Usage automático | No editable/deshabilitable de forma independiente; conserva referencia a Planning |
| Cosecha | Cálculos/áreas/procedencia tienen validadores; edición/restauración real no ejercitadas |
| Lluvia | Fecha/mm/notas, aislamiento por empresa y control de duplicado; no se ejecutó concurrencia de duplicados ni edición real |
| Vehículo | Metadatos/estado/responsable y enabled; no hay bloqueo general por historial; referencias Q06 |
| Usuario | Cambio de rol protege último Admin en código; no se probó concurrencia de dos degradaciones ni se cambiaron roles |

No se retiró Usage. Entrada manual sigue cubriendo consumos sin planificación; las actividades realizadas ya tienen `register-completed`, evitando la obligación de crear Planning y después Usage manual. Una carga manual adicional puede duplicar el hecho económico: no se observó deduplicación semántica entre ambos canales. La creación histórica tampoco demuestra idempotencia de reintento de red como las operaciones V1. Esto requiere tests de contrato adicionales, no una eliminación inmediata de la navegación.

## 8. Mobile y UX funcional

Probado viewport 390×844, no dispositivo físico. Lotes/Cosechas/Lluvia: `documentElement.scrollWidth === 390`; mapa y contexto se adaptaron; bottom nav permitió acceder a inventario y módulos secundarios. Se abrieron/cerraron alta de lote, alta de producto y detalle de cosecha, sin guardar.

No se validó teclado virtual real, todos los touch targets, todos los tipos de planificación en mobile ni submit/refresh durante una escritura. No se declara aprobada la ejecución completa móvil. No se realizó auditoría estética.

Los cierres de drawers requirieron observar el fin de transición: no se clasificó como bug una captura intermedia. Consola observada: deprecaciones de Ant Design, sin utilizarlas como evidencia de un error de integridad.

## 9. Tests y evidencias reproducibles

- `backend-tests.txt`: **45/45** aprobados: stock, permisos de inventario, área y procedencia de cosechas. No incluye integración con migraciones.
- `frontend-tests.txt`: **58/58** aprobados.
- `stock-trace.cjs` / `stock-trace-results.json`: seis trazas PostgreSQL en memoria y prueba de lote deshabilitado aceptado en V1.
- `probes.cjs` / `probes-results.json`: errores legacy, matriz de roles, cadena de alta Cosechas, cancelación intercalada, getter Express 5 y referencias Vehículos. Los probes documentan fallos: su proceso termina normalmente para poder reunir resultados; **no interpretar exit 0 como ausencia de bugs**.
- `build.txt`: build aprobado, salida aislada; warnings de ESM/chunks/timings. No se desplegó.

Reejecución (desde raíz): `node audit/e2e-2026-09-14/probes.cjs` y `node audit/e2e-2026-09-14/stock-trace.cjs`. El segundo utiliza la instalación PGlite local ya existente; no descarga dependencias ni se conecta a Supabase.

## 10. Cobertura que falta y recomendaciones priorizadas

1. **P0:** acordar corrección de Q01–Q03 con tests negativos antes de tocar lógica. No aprobar release por tener suites verdes.
2. **P1:** transacciones/reintentos legacy, concurrencia completion/cancelación, lotes deshabilitados/archivados, autor/responsable y aislamiento de Vehículos.
3. **P1:** habilitar un staging con esquema ya preparado y cuatro cuentas de prueba. No activar V1 ni aplicar migraciones como parte de esta auditoría.
4. **P2:** test HTTP real de middlewares Express 5 y aliases `/disabled`; matriz permiso × método × estado para todos los módulos.
5. **P2:** test de más de 50 Usages, corrección integral de trabajo ejecutado, idempotencia de register-completed y decisiones sobre productos por actividad.
6. **P2:** recorrido completo en staging: lotes y subdivisiones reales PostGIS, ingreso FEFO, Planning real=0/8,5/insuficiente, Usage/movimiento, cosechas parciales y restauración, historial y dos empresas.
7. **P2:** repetir en teléfono físico: teclado, scroll con mapa/drawer, touch targets, refresh y doble submit. No confundir emulación de ancho con esa validación.

Deuda de pruebas: el backend aún tiene un script `npm test` placeholder; parte de la integración depende de instalaciones PGlite fuera del paquete y de migraciones dentro del setup. Faltan tests de roles reales y de middleware con Request Express, no solo objetos planos. Separar validación del esquema desplegado de validación del código objetivo.

**Siguiente paso propuesto:** autorizar una tarea separada de corrección de los tres críticos, conservando esta auditoría como evidencia. Después ejecutar la matriz pendiente en staging y emitir un nuevo dictamen de aceptación. No se aplicó ningún workaround funcional ni corrección automática.
