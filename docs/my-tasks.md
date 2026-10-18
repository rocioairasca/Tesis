# Mis tareas

Una tarea es una Planning asignada; no se crea otra entidad ni se cambian permisos.

- GET /api/planning?mine=true usa exclusivamente req.user.id y req.user.company_id. Admite también mine=1; false/0 no activan el filtro. mine con responsible devuelve 400.
- mine incluye únicamente enabled=true y estados pendiente, planificado y en_progreso. status_effective sigue siendo calculado por el listado existente; no se modifica su semántica temporal. Los filtros adicionales se intersectan. El historial se consulta con los filtros normales, fuera de mine.
- El listado soporta un límite superior to sin from. Dashboard pide mine=true, to=fin del día local +7, pageSize=6. Sin límite inferior conserva las demoras antiguas. SQL ordena antes de paginar (demoradas primero, inicio ascendente, UUID como desempate estable) y devuelve el total del horizonte. No descarga todas las planificaciones ni hace consultas por tarea.
- Dashboard: Requiere tu atención → Mis tareas → Trabajo del equipo (solo planning.view junto con planning.create o planning.edit) → clima/campo/producción. La sección personal requiere planning.view.
- Categorías excluyentes: En demora según estado efectivo; Hoy si el período calendario incluye hoy; Próximas si inicia después de hoy y dentro de siete días. Se conservan fechas calendario sin conversión UTC local.
- Las URLs /planificaciones?mine=1 y &planningId=<id> usan el detalle existente. Los filtros viven en la URL y soportan back/forward. mine limpia responsible; elegir responsable desactiva mine. Cerrar el detalle solo elimina planningId.
- No se infiere asignador desde creador. Solo se muestra assigned_by_name cuando está documentado. El vacío se refiere al horizonte y mantiene el enlace al listado completo.

## Ejecución de tareas propias: planning.execute

La fase posterior [planning.execute](planning-execute.md) permite iniciar y completar tareas propias mediante endpoints específicos, sin conceder edición. Mis tareas conserva su filtro y navegación al detalle; los formularios de completion permanecen en Planning.

## Validación local

Node 20.20.2. Integración PostgreSQL en PGlite con datos sintéticos, modelos/SSR y navegador Edge headless con API simulada y tráfico externo bloqueado. Sin datos productivos, migraciones nuevas ni notificaciones al abrir el Dashboard.

## Archivos de esta fase

Backend:
- growsync-backend/controllers/planning.js
- growsync-backend/validations/planning.schema.js
- growsync-backend/tests/planningAssignments.integration.test.js

Frontend:
- grow-sync/src/features/planning/Planning.jsx
- grow-sync/src/features/planning/planningFilters.mjs
- grow-sync/src/features/planning/myTasks.mjs
- grow-sync/src/features/dashboard/Dashboard.jsx
- grow-sync/src/features/dashboard/DashboardView.jsx
- grow-sync/src/features/dashboard/dashboardSource.js
- grow-sync/src/features/dashboard/dashboard.css

Tests y fixtures:
- grow-sync/tests/myTasks.test.mjs
- grow-sync/tests/myTasks.browser.mjs
- grow-sync/tests/myTasks.fixture.jsx
- grow-sync/tests/dashboard.test.mjs
- grow-sync/tests/dashboard-preview.jsx

Documentación:
- docs/my-tasks.md

## Resultados de validación

- Node v20.20.2, verificado con node --version.
- Backend: 37 tests aprobados en planningAssignments.integration.test.js y planningResponsibles.test.js, incluyendo HTTP, aislamiento de empresa, identidad autenticada, filtros, estados y paginado.
- Frontend/model: 25 tests aprobados en myTasks.test.mjs, dashboard.test.mjs, userDisplay.test.mjs, planningLayout.test.mjs y planningFieldContext.test.mjs.
- Navegador: 9 escenarios de myTasks.browser.mjs, 13 de planningAssignments.browser.mjs y 10 de planningResponsive.browser.mjs aprobados. Se verificaron Dashboard, enlaces directos, cierre del drawer, atrás/adelante, exclusión mine/responsible, permisos, errores de carga y responsive. La sección nueva se comprobó en 1440, 1024 y 390 px, incluyendo capturas locales revisadas y ausencia de scroll horizontal.
- Build frontend con Vite aprobado. Permanece el aviso de bundles mayores a 500 kB.
- git diff --check aprobado.
- No se agregaron dependencias, tablas ni migraciones. No se modificaron datos productivos. No se hicieron commit, push ni deploy.
