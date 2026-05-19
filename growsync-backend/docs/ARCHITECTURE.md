# Arquitectura del Backend - GrowSync

Este documento describe la arquitectura técnica, la estructura del proyecto y cómo ponerlo en marcha.

## 1. Stack Tecnológico

El backend está construido sobre:
- **Runtime**: Node.js
- **Framework Web**: Express.js
- **Base de Datos**: PostgreSQL (vía Supabase)
- **Autenticación**: JWT / Supabase Auth
- **Validación de Datos**: Zod
- **Manejo de Tareas**: node-cron (para tareas programadas)
- **Websockets**: Socket.io (para notificaciones en tiempo real)

## 2. Estructura de Carpetas

\`\`\`
/
├── controllers/    # Lógica de negocio (lo que hacen los endpoints)
├── routes/         # Definición de endpoints (URLs y métodos HTTP)
├── middleware/     # Funciones intermedias (autenticación, validación)
├── db/             # Conexión a la base de datos (Supabase)
├── validations/    # Esquemas Zod para validar inputs
├── cron/           # Tareas programadas (jobs)
├── utils/          # Funciones auxiliares reutilizables
└── index.js        # Punto de entrada de la aplicación
\`\`\`

## 3. Configuración y Ejecución

### Variables de Entorno (.env)
El sistema requiere un archivo \`.env\` en la raíz con las siguientes claves:
\`\`\`bash
PORT=3000
SUPABASE_URL=...
SUPABASE_KEY=...
# ... otras variables
\`\`\`

### Scripts Disponibles
- \`node index.js\`: Ejecuta el servidor en producción.
