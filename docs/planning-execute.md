# planning.execute — ejecución segura de tareas propias

Implementado sobre el estado actual de `C:\Proyectos\Tesis`. No requiere nuevas tablas, columnas, dependencias ni migraciones.

## Permisos y autorización

`planning.execute` permite iniciar y completar una planificación propia, con fecha efectiva y las cantidades reales admitidas por el flujo existente. No concede edición del plan, reasignación, cancelación, reapertura, restauración, carga histórica ni escrituras directas de inventario.

| Rol | Defaults de Planning |
| --- | --- |
| Empleado (0) | `planning.view` + `planning.execute` |
| Supervisor (1) | `planning.view` + `planning.execute` |
| Dueño (2) | Conserva todos sus permisos anteriores, incluido `planning.edit`; suma `planning.execute` |
| Admin (3) | `all` |

Los demás permisos de cada rol se conservan. `custom_permissions` sigue reemplazando los defaults, también para Admin. No se modifica ningún array persistido: los usuarios personalizados deben recibir `planning.execute` explícitamente si corresponde.

El editor de Usuarios incluye “Ejecutar tareas asignadas” después de Editar. Advierte si falta `planning.view`, sin agregarlo automáticamente. La API permite ejecutar sin view; la navegación y las lecturas de Planning/Mis tareas requieren view.

`assertCanExecutePlanning` recibe la fila de DB obtenida con `FOR UPDATE OF p` dentro de la transacción. Verifica empresa, enabled y estado. Con execute únicamente exige `responsible_user === req.user.id`; con edit o all conserva la ejecución de tareas ajenas dentro de la empresa. No confía en ownership enviado por el cliente. Una reasignación anterior al submit produce 403; un UUID de otra empresa produce 404 en la consulta acotada a company_id. Los históricos siguen bloqueados.

## Endpoints y efectos

Todas las rutas siguientes requieren `planning.edit OR planning.execute`, seguido de la autorización sobre la fila bloqueada:

| Ruta POST `/api/planning/:id/…` | Comportamiento |
| --- | --- |
| `start` | Body vacío estricto. pendiente/planificado → en_progreso. Repetir en_progreso devuelve `already_applied: true`. Solo actualiza status/updated_at; sin stock, fechas efectivas ni avisos. Completadas/canceladas no se inician. |
| `complete-sowing` | Reutiliza íntegramente completion de siembra: fecha, cantidades reales, conversiones, stock, Usage, crop assignment, rollback e idempotencia. |
| `complete-work` | Reutiliza completion de fumigación/fertilización y sus consumos reales transaccionales. |
| `complete-activity` | Body estricto con effective_date. Riego/mantenimiento/otro/cosecha reutilizan `completeActivityWithoutProductiveEffects` y las validaciones existentes de campaña/fecha. Sin stock, Usage, ciclos ni harvest_records. |

Completar una planificación de cosecha no registra kg, rendimiento ni superficie cosechada. Las rutas PATCH, DELETE, restore y register-completed conservan sus permisos previos. Los reintentos de siembra/trabajo conservan la idempotencia existente; complete-activity repetido devuelve 409. No se ofrece reapertura a execute-only.

Las notificaciones de completion se preparan dentro de la transacción y despachan después del commit mediante el servicio existente. Se conserva el aviso al asignador y la exclusión de autoavisos. Iniciar no notifica.

## UI

El helper `planningExecution.mjs` centraliza capacidades, acción primaria y endpoint por actividad. Tabla, lista responsive, calendario y detalle usan estas capacidades; execute-only recibe Iniciar tarea / Completar tarea para sus tareas y no obtiene controles administrativos. Los editores conservan sus acciones.

Se reutilizan los modales existentes. Las actividades simples solicitan fecha efectiva sin cantidades; las productivas conservan cantidades reales. El detalle y el listado se vuelven a consultar al iniciar/completar, sin recargar la página. Mis tareas retira las completadas. Dashboard mantiene Ver tarea y el enlace al detalle, sin formularios de productos. Un 403 muestra “No tenés permiso para ejecutar esta tarea. Puede haber sido reasignada.” y conserva el formulario.

La suite de navegador prueba ejecución con acceso denegado al catálogo `/products`: los productos previstos se obtienen del detalle de Planning y no se concede inventory.edit.

## Archivos modificados o agregados

Código:

- grow-sync/src/components/users/UserTable.jsx
- grow-sync/src/constants/permissions.jsx
- grow-sync/src/features/planning/Planning.jsx
- grow-sync/src/features/planning/planningExecution.mjs (nuevo)
- growsync-backend/constants/permissions.js
- growsync-backend/controllers/planning.js
- growsync-backend/routes/planning.js
- growsync-backend/services/planningCompletion.js (solo agrega company_id a la fila bloqueada)
- growsync-backend/services/planningExecution.js (nuevo)
- growsync-backend/validations/planning.schema.js

Tests:

- grow-sync/tests/planningAssignments.fixture.jsx
- grow-sync/tests/planningExecution.test.mjs (nuevo)
- grow-sync/tests/planningExecution.browser.mjs (nuevo)
- grow-sync/tests/planningExecution.fixture.jsx (nuevo)
- growsync-backend/tests/planningAssignments.integration.test.js
- growsync-backend/tests/planningExecution.test.js (nuevo)

Documentación:

- docs/my-tasks.md
- docs/planning-execute.md (nuevo)

## Validación local

Node **v20.20.2**, comprobado mediante `node --version` antes de las validaciones. PostgreSQL efímero con PGlite y fixtures sintéticas; HTTP local y navegador Edge headless con transporte simulado/tráfico externo bloqueado. Ninguna llamada a servicios productivos.

Comandos backend (desde growsync-backend):

```powershell
node --test tests/planningExecution.test.js tests/planningAssignments.integration.test.js tests/stock.integration.test.js tests/stockPermissions.test.js
node --test tests/planningRecipes.integration.test.js tests/planningEffectiveArea.integration.test.js tests/planningResponsibles.test.js
```

Comandos frontend (desde grow-sync):

```powershell
node --test tests/planningExecution.test.mjs tests/myTasks.test.mjs tests/planningFormFlow.test.mjs tests/historicalPlanning.test.mjs tests/planningRecipes.test.mjs tests/dashboard.test.mjs tests/userDisplay.test.mjs tests/planningLayout.test.mjs tests/planningFieldContext.test.mjs
node --test tests/planningExecution.browser.mjs
node --test --test-concurrency=1 tests/myTasks.browser.mjs tests/planningAssignments.browser.mjs tests/planningRecipes.browser.mjs
npm run build
```

Los tests de navegador resuelven Playwright mediante `PLAYWRIGHT_MODULE` y usan Edge (`msedge`). También se ejecuta `git diff --check` desde la raíz.

Sin commit, push ni deploy. Sin cambios de datos productivos, nuevos permisos persistidos automáticos ni migraciones.

## Resultados

- Backend: 163 tests distintos aprobados (104 de ejecución/asignaciones/stock/permisos, 58 de recetas/superficies/responsables y 1 regresión HTTP adicional contra escrituras directas de inventario; el archivo de permisos final pasó sus 4 tests).
- Frontend: 49 tests aprobados de helpers, formularios, históricos, recetas, Mis tareas, Dashboard, presentación y permisos.
- Navegador: 15 escenarios nuevos de ejecución y 27 existentes (9 Mis tareas, 13 asignaciones y 5 recetas), todos aprobados. Incluye Dashboard → detalle → iniciar → completar → actualización del listado, todos los tipos de actividad, ownership, reasignación, view, edición existente, permission editor y ausencia de overflow a 1440/1024/390 px. Capturas revisadas de desktop, tablet y mobile.
- `npm run build`: aprobado con Node v20.20.2. Permanece el aviso de bundles mayores a 500 kB.
- `git diff --check`: aprobado.
- Sin dependencias agregadas, migraciones, cambios de datos productivos, commit, push ni deploy.