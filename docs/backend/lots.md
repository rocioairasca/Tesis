# Lots (Lotes)

Base: `/api/lots`

**GET `/api/lots`**
- Descripción: Listado de lotes (habilitados por defecto).
- Autenticación: login (cualquier rol, checkRole(0)).
- Query params: `q`, `page`, `pageSize`, `includeDisabled`
- Respuesta: paginada con campos `{ id, name, area, location, enabled }`.

**GET `/api/lots/count/enabled`**
- Descripción: Devuelve el contador de lotes habilitados.
- Acceso: login (checkRole(0)).

**GET `/api/lots/disabled`**
- Descripción: Listado de lotes deshabilitados (enabled=false).
- Acceso: login (checkRole(0)).

**PUT `/api/lots/enable/:id`**
- Descripción: Restaurar (enable=true) un lote.
- Acceso: Dueño+ (role >= 2).
- Path param: `id` UUID.

**POST `/api/lots`**
- Descripción: Crear nuevo lote.
- Acceso: Dueño+ (role >= 2).
- Body (ejemplo):
  ```json
  { "name": "Lote 1", "area": 12.5, "location": { "type": "Point", "coordinates": [lon, lat] } }
  ```

**PUT `/api/lots/:id`**
- Descripción: Editar lote (parcial).
- Acceso: Dueño+.
- Body: campos `name`, `area`, `location`, `enabled` (opcional).

**DELETE `/api/lots/:id`**
- Descripción: Soft delete (marca `enabled=false`).
- Acceso: Dueño+.

Referencias:
- Validaciones: `validations/lots.schema.js`
- Controladores: `controllers/lots/*`