# Plantilla para documentar un endpoint

Endpoint: `VERBO /ruta`

- Descripción: Breve descripción del propósito
- Parámetros URL / Query: listar parámetros y tipos
- Body: ejemplo de body JSON (si aplica)
- Respuesta (200): ejemplo de respuesta
- Errores comunes: 400, 401, 403, 404, 500
- Requerimientos de rol: lista de roles permitidos (si aplica)

Ejemplo:

Endpoint: `GET /api/notifications`
- Descripción: Lista notificaciones del usuario autenticado
- Requerimientos: Authorization: Bearer <token>
- Respuesta: `{ notifications: [...] }`
