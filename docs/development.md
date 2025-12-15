# Guía de desarrollo y puesta en marcha

Este documento almacena pasos prácticos para que nuevos desarrolladores configuren el entorno local y las convenciones del proyecto.

Pasos iniciales:

1. Clonar el repositorio
2. Frontend:
   - `cd grow-sync`
   - `npm install`
   - `cp .env.example .env` y completar variables
   - `npm start`
3. Backend:
   - `cd growsync-backend`
   - `npm install`
   - `cp .env.example .env` y completar variables
   - `npm start`

Buenas prácticas:
- Añadir documentación de endpoints nuevo en `docs/backend/api.md` o crear un archivo específico por endpoint.
- Mantener pruebas rápidas para código crítico cuando sea posible.
- Seguir convenciones de código (camelCase, PascalCase para componentes).
