# GrowSync - Frontend

Frontend web para GrowSync (React + AntDesing). Maneja UI, navegación, layout, autenticación y control de accesos por rol. Consume la API del backend mediante servicios centralizados.

## Stack
- React (JS)
- Ant Design (UI)
- Routing: React Roter
- Estado: Context API
- Servicios HTTP: (fetch/axios) desde `src\services`

## Estructura del proyecto
**src/**
- auth/: login, helpers de auth, guards (según tu implementación)
- components/:  componentes reutilizables UI (tablas, cards mobile, botones, etc.)
- context/: contextos globales (auth, user, company, theme, etc.)
- css/: estilos globales o compartidos
- features/: módulos del negocio (Inventory, Usage, Planning, Lots, Users, etc.)
- hooks/: hooks custom (responsive, permisos, fetch, etc.)
- layout/: estructura de la app (Sidebar, Header, Layout principal)
- routes/: definición de rutas + protección por rol
- services/: capa de API (llamadas al backend) + helpers de requests
**App.js**
**index.js**

## Requisitos
- Node.js >= 18
- npm (o yarn)

## Instalación
```bash
npm install
```

## Variables de entorno

Copiar `.env.example` a `.env` y completar con los valores apropiados (Auth0, URL del backend):

- `REACT_APP_AUTH0_DOMAIN`
- `REACT_APP_AUTH0_CLIENT_ID`
- `REACT_APP_AUTH0_API_AUDIENCE`
- `REACT_APP_URL` (ej: `http://localhost:4000`)

## Ejecución

- `npm start` inicia la app en `http://localhost:3000`
- `npm run build` para producción

## Roles y accesos 
Jerarquía de roles:
- 0: Empleado
- 1: Supervisor
- 2: Dueño de campo
- 3: Admin

Las rutas se protegen desde `src/routes` (guards/wrappers) y/o desde `auth`.

## Convenciones
- Componentes: `PascalCase`
- Funciones/variables: `camelCase`
- Servicios: una función por endpoint (ej: `inventory.service.js`)
- Evitar lógica de negocio en componentes: va a `features/` + `services/`

## Dónde tocar cosas rápido
- Navegación / rutas: `src/routes`
- Layout (sidebar/header): `src/layout`
- Llamadas al backend: `src/services`
- Permisos por rol: `src/auth` o `src/routes`
