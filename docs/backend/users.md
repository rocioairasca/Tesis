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