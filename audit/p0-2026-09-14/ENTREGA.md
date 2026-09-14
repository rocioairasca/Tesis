# Corrección P0 — Q01, Q02 y Q03

Fuente: `audit/e2e-2026-09-14/INFORME.md`, `probes.cjs` y `probes-results.json`. Los archivos de esa auditoría se conservaron como evidencia histórica.

## 1–3. Q01: causa, solución y rollback

El controlador actualizaba Usage y sus lotes mediante llamadas REST independientes antes de ajustar stock. El error de stock no revertía el Usage ya escrito; cambiar de producto también podía dejar un reintegro parcial.

Ahora `services/legacyUsage.js` ejecuta la edición con el adaptador SQL existente y `stock.transaction`:

1. `BEGIN` y lectura del Usage por **ID + empresa**, con `FOR UPDATE`.
2. Bloqueo de los productos anterior/nuevo mediante `ORDER BY id FOR UPDATE`, para ordenar los locks incluso en cambios cruzados de producto.
3. Validación de unidad, cantidad, lotes y responsable dentro de la misma transacción.
4. Ajuste por diferencia o reintegro/descuento entre productos; reemplazo de lotes, snapshot de cultivo y edición del Usage con **el mismo cliente SQL**.
5. `COMMIT` solamente al terminar todo. Cualquier excepción anterior provoca `ROLLBACK`; no hay compensaciones REST.

La unidad debe corresponder al producto destino. Un cambio entre unidades incompatibles requiere declarar la unidad correcta del nuevo producto; no hay conversión automática. Se conserva la representación almacenada del producto y se usa la aritmética decimal existente.

Caso obligatorio comprobado a través del controlador real:

| Solicitud | Respuesta | Usage posterior | Stock posterior |
| --- | --- | ---: | ---: |
| Stock 5 kg; Usage 2 kg; editar a 20 kg | **409 Stock insuficiente** | **2 kg** | **5 kg** |

Las pruebas comparan el estado completo de Usage, productos y relaciones de lotes ante errores de validación, producto insuficiente y fallos inyectados en UPDATE de producto, DELETE/INSERT de lotes, lectura de cultivo y UPDATE final de Usage.

Las notificaciones de bajo stock se procesan **después del commit** y sus fallos no convierten una operación confirmada en una respuesta de error. No forman parte de la persistencia contable. Una pérdida de conexión después de que PostgreSQL confirme el commit puede dejar una respuesta incierta, como en cualquier transacción; el reintento de la misma edición calcula diferencia cero sobre el estado ya confirmado.

## 4–6. Q02: causa, solución y reintento

El reintegro/descuento y el cambio de `enabled` eran escrituras separadas. Si fallaba la segunda, el próximo intento volvía a mover stock.

Deshabilitación y restauración utilizan la misma transacción y el mismo lock del Usage. Se vuelve a comprobar `enabled` **después de obtener el lock**:

| Operación | Éxito | Fallo antes del commit | Repetición del estado ya aplicado |
| --- | --- | --- | --- |
| Deshabilitar Usage 2, stock 5 | enabled=false, stock 7 | enabled=true, stock 5 | 200, `replayed:true`, sin reintegro adicional |
| Restaurar ese Usage | enabled=true, stock 5 | enabled=false, stock 7 | 200, `replayed:true`, sin descuento adicional |

Se probaron dos fallos consecutivos de persistencia, éxito posterior, repetición y stock insuficiente al restaurar. El lock serializa edición/deshabilitación/restauración del mismo Usage y los locks de producto serializan sus ajustes entre estas operaciones.

Esto es idempotencia por estado, sin tabla ni claves nuevas: si entre dos solicitudes iguales existe una transición opuesta confirmada, la siguiente solicitud vuelve a solicitar una transición válida. No se añadió deduplicación histórica de comandos. Tampoco se reescribió el alta legacy ni otros escritores de stock fuera de Q01/Q02.

**V1 no fue activado ni modificado:** deshabilitar sigue delegando a `stockUsage.disableManualUsage`; editar/restaurar mantienen su rechazo existente. Los usos automáticos de Planning siguen bloqueados para modificación independiente.

## 7–9. Q03: causa y matriz resultante

CRUD de Cosechas tenía autenticación pero no permisos funcionales; Usage/Vehículos y lecturas de Planning dependían del rol. Ahora las rutas inequívocas usan `requirePermission` y el catálogo existente. No se cambió el catálogo, Auth0 ni los permisos de ningún usuario.

Prefijos verificados en `index.js`: `/api/harvest-records`, `/api/usages`, `/api/vehicles` y `/api/planning`; los paths siguientes son **relativos a cada router**.

| Router | Método y path | Permiso exigido |
| --- | --- | --- |
| harvestRecords | GET `/`, `/:id`, `/stats/filters`, `/stats/summary`, `/stats/by-crop`, `/stats/by-campaign` | `harvest.view` |
| harvestRecords | POST `/` | `harvest.create` |
| harvestRecords | PUT `/:id` | `harvest.edit` |
| harvestRecords | PATCH `/:id/disable` | `harvest.disable` |
| harvestRecords | PATCH `/:id/enable` | `harvest.enable` |
| harvestRecords | GET `/disabled` | `harvest.view_disabled` |
| harvestRecords | GET `/context` | `harvest.create` **o** `harvest.edit`, conservado |
| harvestRecords | POST `/cycles/:assignmentId/finalize` | `harvest.edit`, conservado |
| usage | GET `/` | `usage.view` |
| usage | POST `/` | `usage.create` |
| usage | PUT `/:id` | `usage.edit` |
| usage | DELETE `/:id` | `usage.disable` |
| usage | PUT `/enable/:id` | `usage.enable` |
| usage | GET `/disabled` | `usage.view_disabled` |
| vehicle | GET `/`, `/:id` | `vehicles.view` |
| vehicle | POST `/` | `vehicles.create` |
| vehicle | PATCH `/:id` | `vehicles.edit` |
| vehicle | DELETE `/:id` | `vehicles.disable` |
| vehicle | PUT `/enable/:id` | `vehicles.enable` |
| vehicle | GET `/disabled` | `vehicles.view_disabled` |
| planning | GET `/`, `/:id` | `planning.view` |
| planning | GET `/disabled` | `planning.view_disabled` |
| planning | POST `/` | `planning.create`, conservado |
| planning | PATCH `/:id`, POST `/:id/complete-work`, POST `/:id/complete-sowing` | `planning.edit`, conservado |
| planning | POST `/register-completed` | `planning.create` **y** `planning.edit`, conservados |
| planning | DELETE `/:id` | `planning.edit` **y** `planning.disable`, conservados |
| planning | PUT `/enable/:id` | `planning.edit` **y** `planning.enable`, conservados |

Los cuatro listados generales también exigen `*.view_disabled` cuando el query solicita deshabilitados según la interpretación actual de su controlador. Los detalles de Cosechas/Vehículos/Planning exigen ese permiso adicional si el registro está deshabilitado. Así no basta cambiar el URL para eludir la protección de `/disabled`.

Modelo de permisos conservado:

| Identidad | Resultado |
| --- | --- |
| Cualquier rol con `custom_permissions: []` | 403 |
| Rol 0 con el permiso personalizado requerido | Permitido, aunque el rol base no lo otorgue |
| Sin lista personalizada | Se usan exactamente los permisos por defecto del catálogo |
| Admin sin lista personalizada | `all`: permitido |
| Admin con lista personalizada | Esa lista reemplaza `all`, igual que antes |
| Empresa inválida/no asignada | Rechazo del middleware de tenant existente |
| ID de Usage de otra empresa | 404 y ninguna modificación, probado con SQL en memoria |
| ID de Cosecha ajeno en mutación | Búsqueda por ID + empresa, 404 y rollback; controlador probado con persistencia simulada |

Por defecto, Supervisor conserva crear/ver Cosechas y crear/ver/editar Usage; no obtiene editar/deshabilitar/restaurar Cosechas ni deshabilitar/restaurar Usage. Dueño conserva los seis permisos de cada módulo. Empleado recupera la creación de Usage que su catálogo ya otorgaba. No se elevaron roles.

## 10–12. Regresión y build

- **70 pruebas nuevas permanentes**, en `legacyUsage.integration.test.js` (23) y `p0Authorization.test.js` (47).
- **115/115 backend**: 45 existentes más 70 nuevas, cero fallos y cero omitidas dentro de las suites seleccionadas.
- Los casos Q01–Q03 originales se trasladaron a pruebas que ejecutan el controlador/servicio SQL y la cadena real de permisos. El fake REST original no implementa `pool.connect`; no se presenta un 503 por falta de adaptador como una corrección exitosa.
- `audit/p0-2026-09-14/probes.cjs` ejecuta esos tres casos permanentes y escribe resultados separados: Q01=409 con Usage 2/stock 5; Q02=stock 5 y Usage activo tras dos fallos; Q03=403 sin llegar al controlador.
- Pruebas de autorización con identidad sintética: se conserva el middleware funcional real y se sustituyen autenticación, validación de payload y controlador final para la matriz de rutas. No son sesiones Auth0 reales. El aislamiento se prueba por separado en servicio/controlador.
- PGlite es de una sesión: la prueba de doble submit encola conexiones y verifica locks SQL y relectura. **No se ejecutó concurrencia con dos conexiones PostgreSQL reales.**
- No se ejecutaron `inventoryUnits.integration.test.js` ni `partialHarvests.integration.test.js`: su setup ejecuta archivos de migración, expresamente prohibidos para esta tarea. Las demás suites backend existentes sí se ejecutaron.
- Build frontend aprobado, salida en `grow-sync/node_modules/.cache/p0-build`; advertencia de tamaño de chunks, sin despliegue.
- **58/58 tests frontend aprobados**, registrados en `frontend-tests.txt`; no se modificó código frontend.

Reejecución desde la raíz, con `INVENTORY_TEST_PGLITE` apuntando a la instalación local existente:

```powershell
node --test growsync-backend/tests/stock.integration.test.js growsync-backend/tests/stockPermissions.test.js growsync-backend/tests/harvestAreas.test.js growsync-backend/tests/harvestRegistration.test.js growsync-backend/tests/legacyUsage.integration.test.js growsync-backend/tests/p0Authorization.test.js
node audit/p0-2026-09-14/probes.cjs
npm --prefix grow-sync run build -- --outDir node_modules/.cache/p0-build
```

## 13. Archivos de esta corrección

Código nuevo:

- `growsync-backend/services/legacyUsage.js`
- `growsync-backend/middleware/requireDisabledRead.js`

Código modificado:

- `growsync-backend/controllers/usage/usage.js`: delegación transaccional para editar/deshabilitar/restaurar; notificación posterior al commit.
- `growsync-backend/routes/harvestRecords.js`
- `growsync-backend/routes/usage.js`
- `growsync-backend/routes/vehicle.js`
- `growsync-backend/routes/planning.js`
- `growsync-backend/controllers/harvestRecords.js`, `controllers/vehicle.js`, `controllers/planning.js`: permiso al consultar detalle deshabilitado, sin alterar sus mutaciones.

Pruebas nuevas: los dos archivos indicados arriba. Evidencia nueva: esta carpeta, con `ENTREGA.md`, `probes.cjs`, `probes-results.json`, `probes-output.txt`, `backend-tests.txt`, `frontend-tests.txt` y `build.txt`. El árbol ya contenía cambios de tareas anteriores; no se descartaron ni se atribuyen a esta corrección.

## 14. Ambigüedades y alcance

- **Combustible:** no hay permisos dedicados en el catálogo. No se infirió que alta/baja de cargas equivalga a crear/deshabilitar el vehículo. Sus tres rutas conservan los guards por rol existentes; requieren una decisión funcional separada.
- **Planning:** combinaciones existentes de edit+disable/edit+enable y create+edit se preservan; no se reinterpretó el significado de ejecutar/restaurar una actividad.
- **Q08:** no se arregló la mutación de `req.query`, su coerción booleana ni los aliases `/disabled`. El guard nuevo coincide con la lectura actual del controlador; en Usage/Planning el string `false` puede seguir considerándose truthy y requerir `view_disabled`. Corregir su parsing pertenece a Q08.
- No se abordaron Q04–Q12. En particular no se añadieron validaciones de lote habilitado, correcciones de concurrencia de Planning, autor de Vehículos, vencimientos, paginación ni rediseño.

**CAMBIOS DB: NINGUNO. MIGRACIONES: NINGUNA.** Solo se crearon datos/esquemas sintéticos en memoria para pruebas; no se conectó a la base real ni se cambió su configuración. Sin activación de Inventory V1, cambios Auth0, cambios de permisos reales o borrado de datos.
