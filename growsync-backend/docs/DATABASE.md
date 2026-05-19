# Base de Datos - GrowSync

Este documento detalla el esquema de base de datos utilizado en PostgreSQL (Supabase).

## Diagrama Entidad-Relación (ER)

\`\`\`mermaid
erDiagram
    USERS ||--o{ VEHICLES : "gestiona"
    COMPANIES ||--o{ USERS : "emplea"
    COMPANIES ||--o{ VEHICLES : "posee"

    USERS {
        uuid id min PK
        string email
        string role
        uuid company_id FK
    }

    VEHICLES {
        uuid id PK
        string name
        string type
        string status
        uuid company_id FK
    }
\`\`\`

## Tablas Principales

### 1. Vehicles (`vehicles`)
Almacena la información de la maquinaria y vehículos de la empresa.

| Columna | Tipo | Descripción |
| :--- | :--- | :--- |
| `id` | UUID | Identificador único (Primary Key) |
| `company_id` | UUID | Referencia a la empresa dueña (Foreign Key) |
| `name` | Text | Nombre interno del vehículo |
| `type` | Text | Tipo (Tractor, Camioneta, Cosechadora, etc.) |
| `status` | Text | Estado actual (activo, mantenimiento, inactivo) |
| `enabled` | Boolean | Para borrado lógico (Soft Delete) |

*(Repetir este formato para las demás tablas importantes: `users`, `lots`, `plannings`, etc.)*
