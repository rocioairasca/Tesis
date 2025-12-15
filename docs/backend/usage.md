# Usage (Registros de uso)

Base: `/api/usages`

**GET `/api/usages`**
- Descripción: Listar registros de uso con filtros (fecha, producto, lote, usuario).
- Acceso: login (checkRole(0)).
- Query params (ejemplos): `from`, `to`, `product_id`, `lotId`, `user_id`, `page`, `pageSize`, `includeDisabled`
- Respuesta: paginada con objetos `usage`.

**GET `/api/usages/disabled`**
- Listado de usos deshabilitados (enabled=false).

**PUT `/api/usages/enable/:id`**
- Restaurar un uso (Supervisor+).

**POST `/api/usages`**
- Descripción: Crear un registro de uso.
- Acceso: Supervisor+ (role >= 1).
- Body (ejemplo mínimo):
  ```json
  {
    "date": "2025-12-01",
    "product_id": "<uuid>",
    "amount_used": 10,
    "unit": "kg",
    "lot_ids": ["<lot-uuid>"]
  }
  ```

**PUT `/api/usages/:id`**
- Editar registro de uso (Supervisor+).

**DELETE `/api/usages/:id`**
- Soft delete (Supervisor+).

Referencias: `validations/usage.schema.js`, `controllers/usage/*`