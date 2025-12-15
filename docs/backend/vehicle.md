# Vehicle (Vehículos)

Base: `/api/vehicles`

**GET `/api/vehicles`**
- Descripción: Listado de vehículos (paginado y filtros).
- Acceso: login (checkRole(0)).

**GET `/api/vehicles/:id`**
- Descripción: Detalle de vehículo.

**POST `/api/vehicles`**
- Descripción: Crear vehículo. Dueño+ (role >= 2).

**PATCH `/api/vehicles/:id`**
- Descripción: Actualizar vehículo. Dueño+.

**DELETE `/api/vehicles/:id`**
- Descripción: Soft delete (enabled=false). Admin (3) en implementación actual.

**GET `/api/vehicles/disabled`**
- Listado de vehículos deshabilitados.

**PUT `/api/vehicles/enable/:id`**
- Restaurar vehículo. Dueño+.

Referencias: `validations/vehicle.schema.js`, `controllers/vehicle.js`