# Users

Base: `/api/users`

**GET `/api/users`**
- Descripción: Listar usuarios (paginado).
- Autenticación: Bearer token + rol Admin (3).
- Query params:
  - `page` (int)
  - `pageSize` (int)
  - `includeDisabled` (boolean)
  - `q` (string, búsqueda por email)
- Respuesta (200):
  ```json
  { "data": [{ "id": "...", "email": "...", "role": 1 }], "page": 1, "pageSize": 50, "total": 123 }
  ```

**PUT `/api/users/:id/role`**
- Descripción: Actualizar el rol de un usuario.
- Autenticación: Admin (3).
- Path param: `id` UUID
- Body: `{ "role": 0|1|2|3 }`
- Respuesta: 200 con usuario actualizado.

**GET `/api/users/email/:email`**
- Descripción: Obtener datos de usuario por email.
- Acceso: Admin puede ver cualquiera; usuarios < Admin solo pueden ver su propio email.
- Respuesta: 200 con objeto usuario o 404 si no existe.

**POST `/api/users/invite`**
- Descripción: Invitar un usuario (envía email/invitación).
- Acceso: Admin/Owner (valida company_id internamente).
- Body: `{ "email": "...", "role": 1 }`
- Respuesta: 200/201 indicando invitación creada/enviada.

Referencias:
- Validaciones: `validations/users.schema.js`
- Controladores: `controllers/users/*`, `controllers/auth/inviteUser.js`
## Perfil propio y nombre visible

GET /api/users/me y PATCH /api/users/me/profile usan checkJwt + userData; no requieren rol Admin ni users.edit. La identidad sale exclusivamente de req.user.id y req.user.company_id. Solo se accede a usuarios habilitados, incluso al actualizar. No se aceptan parámetros de consulta ni identificadores externos.

GET devuelve exclusivamente id, full_name, email, role, enabled, company_id y company_name (relación companies de ese usuario). Ambas respuestas llevan Cache-Control: no-store. PATCH devuelve el mismo perfil actualizado.

PATCH acepta únicamente { "full_name": "Rocío Airasca" }. Zod aplica trim, exige string de 2–100 caracteres y rechaza caracteres de control. Admite tildes, ñ, apóstrofes, guiones y nombres de una palabra; no cambia mayúsculas ni separa nombres. Cualquier campo adicional, incluidos id/user_id, email, role, company_id, enabled, permisos o identificadores Auth0, devuelve 400. Solo se escribe full_name.

Se reutiliza users.full_name (text nullable), confirmado en el esquema auditado existente; no hay migraciones, nuevas columnas ni backfill. Los nombres vacíos existentes siguen siendo válidos para lectura.

El Header abre UserProfileModal, que consulta el perfil actual al abrir. Nombre y apellido es el único campo editable; correo, empresa y rol son de solo lectura. Errores mantienen el modal abierto; la carga puede reintentarse. Al guardar se actualiza full_name en el Header/localStorage, conservando el resto de la sesión; localStorage solo representa UX y no autoriza el endpoint. Cancelar no guarda y nunca se abre el perfil automáticamente.

userDisplayName prioriza full_name.trim(), luego email y finalmente Usuario. userInitials usa la primera y última palabra (o una inicial del email). Se reutiliza en Header, responsables de planificación (tabla, mobile, detalle y calendario), usos, autores de cosechas disponibles, dashboard y Usuarios. Usuarios mantiene visible el email. Las opciones de responsables muestran el email como dato secundario solo en el dropdown para distinguir homónimos; una vez elegido queda el nombre. Conservan user.id y las planificaciones exponen responsible_name con la misma prioridad desde SQL, también cuando el catálogo no está disponible. No se infieren nombres para autores no disponibles ni se modifican los datos históricos. Los campos username/nickname del registro Auth0 no se eliminan; dejan de ser la identidad visual de personas.

Las etiquetas de roles se centralizan en constants/roles.mjs: Empleado, Supervisor, Dueño y Administrador. Las invitaciones conservan los roles permitidos anteriormente (0–2). No se agregan permisos, tareas ni notificaciones.

### Validación de la fase

Node 20.20.2. Aprobados: 48 tests backend (perfil, responsables y planificación con PGlite), 31 frontend relacionados, 4 escenarios de navegador de perfil y 5 de planificación real. La regresión ampliada de listado/detalle SQL y las opciones enriquecidas del responsable también se verificaron individualmente. Responsive del perfil/dropdown validado a 1440, 1024 y 390 px. Build correcto (aviso existente por tamaño de bundles); git diff --check sin errores. Tests con identidades sintéticas y proveedor simulado; sin datos productivos ni llamadas a Auth0/Supabase. No se modificaron dependencias ni runtime.

### Archivos de la fase

- `docs/backend/users.md`
- `grow-sync/src/components/users/UserOption.jsx`
- `grow-sync/src/components/users/UserTable.jsx`
- `grow-sync/src/constants/roles.mjs`
- `grow-sync/src/features/dashboard/DashboardView.jsx`
- `grow-sync/src/features/harvest/harvestPresentation.mjs`
- `grow-sync/src/features/planning/Planning.jsx`
- `grow-sync/src/features/planning/components/HistoricalPlanningFields.jsx`
- `grow-sync/src/features/planning/components/PlanningListMobile.jsx`
- `grow-sync/src/features/planning/components/PlanningTable.jsx`
- `grow-sync/src/features/profile/UserProfileModal.jsx`
- `grow-sync/src/features/profile/profile.css`
- `grow-sync/src/features/usages/Usage.jsx`
- `grow-sync/src/features/users/Users.jsx`
- `grow-sync/src/layout/Header.jsx`
- `grow-sync/src/utils/userDisplay.mjs`
- `grow-sync/tests/userDisplay.test.mjs`
- `grow-sync/tests/userProfile.browser.mjs`
- `grow-sync/tests/userProfile.fixture.jsx`
- `growsync-backend/controllers/planning.js`
- `growsync-backend/controllers/users/profile.js`
- `growsync-backend/routes/userRoutes.js`
- `growsync-backend/services/userProfile.js`
- `growsync-backend/tests/planningEffectiveArea.integration.test.js`
- `growsync-backend/tests/userProfile.test.js`
- `growsync-backend/validations/userProfile.schema.js`
