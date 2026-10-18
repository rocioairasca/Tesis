# Asignación de trabajos y notificaciones

Implementado sobre el working tree de `C:\Proyectos\Tesis`. Planning sigue siendo la fuente de verdad; se reutilizan `notifications`, `createNotification` y Socket.io. No hay una entidad de tareas ni cambios de permisos de completion.

## Contrato y trazabilidad

- El responsable debe existir, estar habilitado y pertenecer a la empresa autenticada. Se valida dentro de la transacción al crear, registrar una actividad realizada y cambiar de responsable, incluida la corrección histórica pública.
- `created_by` proviene de `req.user.id`. Los contratos públicos rechazan `created_by`, `assigned_by`, `assigned_at` y `actor_user_id`. Las importaciones/reconciliaciones internas conservan su contrato de autoría separado.
- Creación y reasignación guardan `assigned_by` y `assigned_at` desde el servidor. Otros cambios conservan esos valores. Los UUID equivalentes con diferente capitalización no son una reasignación.
- La corrección histórica conserva sus controles de inventario, ciclos, cosechas y auditoría. Solo se agregan validación y metadata al cambiar realmente el responsable; no emite notificaciones.
- El detalle muestra nombres completos, con email como fallback, y la hora de asignación local. Los datos históricos ausentes se presentan como “No documentado”.

## Eventos

| Hecho confirmado | Destinatario | Tipo |
| --- | --- | --- |
| Creación normal | Responsable, si es distinto del actor | `planning_assigned` |
| Reasignación | Nuevo responsable y anterior, excluyendo al actor | `planning_assigned`, `planning_unassigned` |
| Cambio significativo | Responsable, si es distinto del actor | Un único `planning_updated` |
| Cancelación | Responsable, si es distinto del actor | `planning_cancelled` |
| Completion | Asignador actual o, si falta, creador; distinto del actor | `planning_completed` |

Los destinatarios se verifican por empresa y habilitación. Los mensajes usan identidad consultada en servidor, título de Planning o actividad/cultivo/contexto y fechas de calendario en español. `data` incluye planning, acción, actor, actividad y fechas; en actualizaciones agrega categorías de cambios.

Las comparaciones usan el estado persistido anterior y posterior: fechas por instante; selecciones por identidad y área efectiva, sin depender del orden; productos por producto/cantidad/unidad/dosis, sin IDs de filas ni pérdida de precisión decimal. Una completion o cancelación prevalece sobre el aviso genérico; una reasignación no suma un segundo aviso de actualización.

No notifican las autoasignaciones/acciones propias, descripciones, metadata, no-ops, cambios de orden ni reintentos sin cambios. `registerCompleted` no anuncia una nueva tarea. Los históricos no reciben notificaciones retroactivas. Se mantienen las respuestas existentes de reintento: `already_applied` cuando hay efectos registrados y 409 cuando corresponde.

Los eventos se preparan dentro de la transacción y se envían solo después de COMMIT. Un fallo de envío se registra y no convierte un guardado confirmado en un error. Se mantiene envío best effort, sin outbox ni reintentos distribuidos.

## Navegación

Campana desktop y drawer utilizan el mismo helper: marcan leída y navegan a `/planificaciones?planningId=<UUID>`. Las notificaciones anteriores sin ID conservan el acceso al listado.

`Planning.jsx` obtiene el detalle con GET por ID, independientemente de la página del listado. La URL conserva el ID mientras está abierto; cerrar elimina únicamente ese parámetro. Se mantiene atrás/adelante, se cancelan peticiones obsoletas y se muestran errores seguros ante 400/403/404. Los permisos de visualización de deshabilitadas siguen vigentes. La apertura normal utiliza la misma convención. Los cambios de estado y completions refrescan el detalle; el botón flotante mobile se oculta mientras está abierto.

## SQL pendiente, no aplicado a producción

Archivo: `growsync-backend/migrations/20261018_planning_assignment.sql`. Aplicar antes de desplegar el backend:

```sql
ALTER TABLE public.planning ADD COLUMN IF NOT EXISTS assigned_by uuid NULL REFERENCES public.users(id);
ALTER TABLE public.planning ADD COLUMN IF NOT EXISTS assigned_at timestamptz NULL;
```

No hay backfill: `created_by` no demuestra quién realizó la última reasignación. La migración es repetible, agrega una FK y no necesita índices para este acceso por ID. Solo se ejecutó contra bases PGlite descartables en los tests.

## Archivos de la fase

Backend:

- `growsync-backend/controllers/planning.js`
- `growsync-backend/services/planningNotifications.js` (nuevo)
- `growsync-backend/services/historicalMutation.js`
- `growsync-backend/services/historicalPlanningGuard.js`
- `growsync-backend/validations/planning.schema.js`
- `growsync-backend/migrations/20261018_planning_assignment.sql` (nuevo)
- `growsync-backend/tests/planningAssignments.integration.test.js` (nuevo)
- `growsync-backend/tests/planningEffectiveArea.integration.test.js`
- `growsync-backend/tests/planningRecipes.integration.test.js`

Frontend:

- `grow-sync/src/components/NotificationBell.jsx`
- `grow-sync/src/components/NotificationsDrawer.jsx`
- `grow-sync/src/features/planning/Planning.jsx`
- `grow-sync/src/features/planning/planning.css`
- `grow-sync/src/utils/notificationTarget.mjs` (nuevo)
- `grow-sync/tests/notificationTarget.test.mjs` (nuevo)
- `grow-sync/tests/planningAssignments.browser.mjs` (nuevo)
- `grow-sync/tests/planningAssignments.fixture.jsx` (nuevo)
- `grow-sync/tests/planningAssignments.fixtureContext.jsx` (nuevo)
- `grow-sync/tests/planningRecipes.fixture.jsx`
- `grow-sync/tests/planningResponsive.fixture.jsx`

Documentación: `docs/planning-assignments.md` (este archivo).

No se actualizaron Node, package.json, lockfiles ni dependencias. No se ejecutaron commit, push, deploy, llamadas reales de notificaciones ni cambios de datos productivos.

## Validación (Node.js v20.20.2)

`node --version` confirmó `v20.20.2`. No se cargaron credenciales ni se utilizaron servicios productivos en las pruebas.

- Backend: 117 tests OK en la tanda final de `planningAssignments.integration`, `planningEffectiveArea.integration`, `planningRecipes.integration`, `planningResponsibles` e `inventoryUnits.integration`. La nueva suite aporta 30 casos con PostgreSQL descartable, controladores reales y pruebas HTTP de contratos/permisos.
- Regresión histórica: `historicalPlanningProduct.integration`, `historicalCycleCorrection.integration`, `historicalNoStock.integration`, `historicalAdoption.integration` e `historicalHarvestAdoption.integration`: 51 tests adicionales OK. Un caso opcional preexistente de aceptación de backup se omitió porque `HISTORICAL_BACKUP_DIR` no está configurado. Total backend sin duplicados: 168 OK y 1 omitido.
- Frontend: 44 tests OK en `notificationTarget`, `planningRegistrationType`, `planningRecipes`, `planningLayout`, `planningFormFlow`, `planningFieldContext`, `planningEffectiveArea`, `userDisplay` e `historicalPlanning`.
- Build: `node node_modules/vite/bin/vite.js build` completado. Advertencia de bundles mayores a 500 kB; sin errores de compilación.

Los tests de navegador usan Edge headless con Playwright, API sintética y bloqueo de tráfico externo. No mandan notificaciones reales. La suite `planningAssignments.browser.mjs` valida los enlaces, marcado de lectura, errores, historia del navegador, cancelación de requests, trazabilidad, actualización del detalle y nombres extensos. También se ejecutaron `planningRecipes.browser.mjs`, `planningResponsive.browser.mjs` y `dashboardNotifications.browser.mjs`.

Para ejecutar las suites de navegador en esta instalación, `PLAYWRIGHT_MODULE` apunta al paquete Playwright del runtime de Codex. Conviene `node --test --test-concurrency=1 ...` para no competir entre varias instancias de Vite/Edge.

Resultado de navegador: **34 casos verificados**, incluidos **13 nuevos** de asignaciones y **21** de las suites relacionadas. La suite nueva finalizó con 13/13 OK. Se comprobaron visualmente las capturas de 1440, 1024 y 390 px y se verificó ausencia de overflow horizontal, incluso con nombres largos.

`git diff --check`: OK. Los archivos nuevos también se verificaron para detectar whitespace al final de línea y asegurar newline final. Las cachés locales creadas por los tests se eliminaron del working tree.
