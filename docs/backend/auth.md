# Auth (Endpoints públicos)

Base: `/api`

**POST `/api/register`**
- Descripción: Registra un usuario local (flujo de registro interno).
- Body:
  ```json
  { "email": "user@example.com", "password": "********", "token": "<invitation-token>", "full_name": "Nombre" }
  ```
- Respuestas:
  - 201: usuario creado (objeto user)
  - 400: validación inválida
- Notas: Valida `token` (invitación) si aplica.

**POST `/api/login`**
- Descripción: Login local; devuelve token y datos de usuario.
- Body:
  ```json
  { "email": "user@example.com", "password": "********" }
  ```
- Respuestas:
  - 200: `{ access_token: "<jwt>", user: { id, email, role, ... } }`
  - 401: credenciales inválidas

**GET `/api/invitations/:token`**
- Descripción: Obtener información pública de una invitación.
- Parámetros: `:token` en path
- Respuesta: 200 con detalles de la invitación o 404 si no existe.

Referencias:
- Validaciones: `validations/auth.schema.js`