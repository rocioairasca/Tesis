# Planning (Planificaciones)

Base: `/api/planning`

**GET `/api/planning`**
- Descripción: Listar planificaciones (filtros: fecha, tipo, estado, responsable, lote).
- Acceso: login (checkRole(0)).
- Query: `from`, `to`, `type`, `status`, `responsible`, `lotId`, `search`, `page`, `pageSize`, `includeCanceled`, `includeDisabled`

**GET `/api/planning/:id`**
- Descripción: Obtener detalle de una planificación por ID.

**POST `/api/planning`**
- Descripción: Crear planificación.
- Acceso: Supervisor+ (role >= 1).
- Body (ejemplo):
  ```json
  {
    "title": "Fumigación lote 1",
    "activity_type": "fumigacion",
    "start_at": "2025-12-20T08:00:00Z",
    "end_at": "2025-12-20T10:00:00Z",
    "responsible_user": "<user-uuid>",
    "lot_ids": ["<lot-uuid>"]
  }
  ```

**PATCH `/api/planning/:id`**
- Descripción: Actualizar planificación (parcial). Supervisor+.

**DELETE `/api/planning/:id`**
- Descripción: Soft delete / cancelar planificación. Dueño+.

**GET `/api/planning/disabled`**
- Listar planificaciones deshabilitadas.

**PUT `/api/planning/enable/:id`**
- Restaurar planificación (Dueño+).

Referencias: `validations/planning.schema.js`, `controllers/planning.js`