# Documentación de API - GrowSync

Esta sección documenta los endpoints principales del backend.

## Autenticación
La mayoría de los endpoints requieren un token JWT en el header:
\`Authorization: Bearer <TOKEN>\`

## Endpoints

### 1. Vehículos (`/api/vehicles`)

#### **Listar Vehículos**
Obtiene una lista paginada de vehículos activos.

- **Método**: \`GET\`
- **URL**: \`/api/vehicles\`
- **Permisos**: Requiere rol de Empleado (0) o superior.
- **Query Params**:
    - \`page\`: Número de página (default: 1)
    - \`pageSize\`: Elementos por página (default: 50)
    - \`q\`: Búsqueda por texto (nombre, marca, modelo)
    - \`type\`: Filtrar por tipo
    - \`status\`: Filtrar por estado

**Respuesta Exitosa (200 OK):**
\`\`\`json
{
  "data": [
    {
      "id": "uuid-...",
      "name": "Tractor John Deere",
      "type": "tractor",
      "status": "activo",
      "company_id": "uuid-..."
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 15
}
\`\`\`

#### **Crear Vehículo**
Registra un nuevo vehículo en el sistema.

- **Método**: \`POST\`
- **URL**: \`/api/vehicles\`
- **Permisos**: Requiere ser Dueño (2) o Admin (3).
- **Body (JSON)**:
\`\`\`json
{
  "name": "Nuevo Tractor",
  "type": "tractor",
  "brand": "Fiat",
  "model": "640",
  "status": "activo"
}
\`\`\`

**Respuesta Exitosa (201 Created):**
\`\`\`json
{
  "vehicle": {
      "id": "uuid-...",
      "name": "Nuevo Tractor",
      "created_at": "..."
  }
# Documentación de API - GrowSync

Esta sección documenta los endpoints principales del backend.

## Autenticación
La mayoría de los endpoints requieren un token JWT en el header:
`Authorization: Bearer <TOKEN>`

## Endpoints

### 1. Vehículos (`/api/vehicles`)

#### **Listar Vehículos**
Obtiene una lista paginada de vehículos activos.

- **Método**: `GET`
- **URL**: `/api/vehicles`
- **Permisos**: Requiere rol de Empleado (0) o superior.
- **Query Params**:
    - `page`: Número de página (default: 1)
    - `pageSize`: Elementos por página (default: 50)
    - `q`: Búsqueda por texto (nombre, marca, modelo)
    - `type`: Filtrar por tipo
    - `status`: Filtrar por estado

**Respuesta Exitosa (200 OK):**
```json
{
  "data": [
    {
      "id": "uuid-...",
      "name": "Tractor John Deere",
      "type": "tractor",
      "status": "activo",
      "company_id": "uuid-..."
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 15
}
```

#### **Crear Vehículo**
Registra un nuevo vehículo en el sistema.

- **Método**: `POST`
- **URL**: `/api/vehicles`
- **Permisos**: Requiere ser Dueño (2) o Admin (3).
- **Body (JSON)**:
```json
{
  "name": "Nuevo Tractor",
  "type": "tractor",
  "brand": "Fiat",
  "model": "640",
  "status": "activo"
}
```

**Respuesta Exitosa (201 Created):**
```json
{
  "vehicle": {
      "id": "uuid-...",
      "name": "Nuevo Tractor",
      "created_at": "..."
  }
}
```

### 2. Usuarios (`/api/users`)

#### **Listar Usuarios**
Obtiene una lista paginada de usuarios de la plataforma (solo Admin).

- **Método**: `GET`
- **URL**: `/api/users`
- **Permisos**: Requiere rol de Admin (3).
- **Query Params**:
    - `page`: Número de página (default: 1)
    - `pageSize`: Elementos por página (default: 50)
    - `q`: Búsqueda parcial por email
    - `includeDisabled`: `1` o `true` para incluir usuarios deshabilitados

**Respuesta Exitosa (200 OK):**
```json
{
  "data": [
    {
      "id": "uuid-...",
      "email": "user@example.com",
      "full_name": "Juan Pérez",
      "role": 2,
      "enabled": true,
      "created_at": "2024-01-01T10:00:00Z"
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 1
}
```

#### **Invitar Usuario**
Envía una invitación por email para unirse a la empresa.

- **Método**: `POST`
- **URL**: `/api/users/invite`
- **Permisos**: Requiere ser Dueño (2) o Admin (3).
- **Body (JSON)**:
```json
{
  "email": "nuevo@empleado.com",
  "role": 0  // 0: Empleado, 1: Supervisor, 2: Dueño
}
```

#### **Actualizar Rol**
Cambia el nivel de permisos de un usuario.

- **Método**: `PUT`
- **URL**: `/api/users/:id/role`
- **Permisos**: Requiere rol de Admin (3).
- **Body (JSON)**:
```json
{
  "role": 1
}
```

### 3. Autenticación (`/api`)

#### **Registro**
Crea una nueva cuenta de usuario (generalmente dueños de nuevas empresas).

- **Método**: `POST`
- **URL**: `/api/register`
- **Body (JSON)**:
```json
{
  "email": "juan@empresa.com",
  "password": "securePassword123",
  "full_name": "Juan Dueño",
  "company_name": "Agro S.A."
}
```

#### **Login**
Inicia sesión y devuelve un token JWT.

- **Método**: `POST`
- **URL**: `/api/login`
- **Body (JSON)**:
```json
{
  "email": "juan@empresa.com",
  "password": "securePassword123"
}
```

**Respuesta (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1Ni...",
  "user": {
      "id": "uuid...",
      "email": "juan@empresa.com",
      "role": 2,
      "company_id": "uuid..."
  }
}
```

*(Continuar con otros endpoints clave como `users`, `lots`, `planning` usando este formato)*
