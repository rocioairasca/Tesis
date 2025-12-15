# Products

Base: `/api/products`

**GET `/api/products`**
- Descripción: Listado de productos (filtros y paginado).
- Acceso: login (checkRole(0)).
- Query: `q`, `category`, `page`, `pageSize`, `includeDisabled`

**GET `/api/products/disabled`**
- Listado de productos deshabilitados.

**PUT `/api/products/enable/:id`**
- Restaurar producto (Dueño+).

**POST `/api/products`**
- Descripción: Crear producto.
- Acceso: Dueño+ (role >= 2).
- Body (ejemplo mínimo):
  ```json
  { "name": "Fertilizante X", "category": "fertilizantes", "unit": "kg" }
  ```

**PUT `/api/products/:id`**
- Editar producto (parcial).

**DELETE `/api/products/:id`**
- Soft delete (enabled=false) — Dueño+.

Referencias: `validations/products.schema.js`, `controllers/products/*`