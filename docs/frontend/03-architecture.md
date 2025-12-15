# Arquitectura del Frontend

Este documento describe la arquitectura del frontend de GrowSync, incluyendo el manejo de autenticación, rutas, layout, estado global y comunicación con el backend.

La aplicación está desarrollada como una **Single Page Application (SPA)** utilizando React y Ant Design.

---

## Visión general

La arquitectura del frontend se basa en una separación clara de responsabilidades:

- **Rutas y control de acceso** → `routes`
- **Autenticación** → `auth` + Auth0
- **Estado global** → `context`
- **Layout y navegación** → `layout` + `components`
- **Lógica del negocio (UI)** → `features`
- **Comunicación con backend** → `services`
- **Reutilización y soporte** → `hooks`, `components`, `css`

---

## Autenticación y autorización

### Auth0
La aplicación utiliza **Auth0** como proveedor de autenticación.

Configuración principal:
- Definida en `App.js` mediante `Auth0Provider`
- Uso de `access_token` para consumir la API
- Persistencia del token en `localstorage`
- Audience configurado para el backend

Flujo simplificado:
1. Usuario accede a `/login`
2. Auth0 valida credenciales
3. Se obtiene token + datos del usuario
4. La app guarda el usuario/rol en `context`
5. Se habilita el acceso a rutas protegidas

---

## Control de acceso por rol

Ubicación principal: `src/routes/GuardedRoute.js`

Responsabilidades:
- Verifica que el usuario esté autenticado
- Valida que el rol del usuario sea suficiente
- Redirige a `/login` o a una pantalla de acceso denegado

Ejemplo conceptual:
- Sin `allowedRoles` → cualquier usuario autenticado
- Con `allowedRoles={[3]}` → solo Admin

Los roles se definen de forma jerárquica:
- 0 → Empleado
- 1 → Supervisor
- 2 → Dueño de campo
- 3 → Admin

---

## Sistema de ruteo

Ubicación: `src/App.js`

Características:
- React Router
- Separación entre rutas públicas y privadas
- Rutas privadas envueltas en `GuardedRoute`
- Uso explícito de `Navigate` para redirecciones
- Fallback global hacia `/login`

El ruteo define:
- Qué pantalla se renderiza
- Qué layout se utiliza
- Qué rol mínimo se requiere

---

## Layout de la aplicación

Ubicación: `src/layout`

El layout principal (`AppLayout`) contiene:
- Sidebar (menú lateral)
- Header (barra superior)
- Área de contenido

Funciones del layout:
- Mantener consistencia visual
- Adaptarse a desktop y mobile
- Centralizar navegación principal

Todas las pantallas protegidas se renderizan dentro de `AppLayout`.

---

## Navegación mobile

Ubicación: `src/components/MobileBottomNavigationWrapper`

Características:
- Visible solo en dispositivos móviles
- Provee navegación rápida entre módulos principales
- Se renderiza a nivel global en `App.js`

Permite mantener una experiencia mobile-first sin duplicar lógica de ruteo.

---

## Estado global (Context API)

Ubicación: `src/context`

Se utiliza **Context API** para:
- Usuario autenticado
- Rol del usuario
- Información de la empresa (`company_id`)
- Notificaciones globales

Ejemplos de contextos:
- AuthContext (usuario, rol, sesión)
- NotificationsContext (mensajes, alerts)

Los contextos envuelven a la aplicación completa en `App.js`.

---

## Features (módulos del negocio)

Ubicación: `src/features`

Cada carpeta representa un módulo funcional independiente:
- `dashboard`
- `users`
- `inventory`
- `lots`
- `usages`
- `vehicles`
- `planning`

Responsabilidades:
- Renderizar pantallas
- Manejar estado local de UI
- Consumir servicios del backend
- Orquestar componentes reutilizables

Regla clave:
> No realizar llamadas HTTP directamente desde componentes visuales si existe un service asociado.

---

## Services (capa de API)

Ubicación: `src/services`

Responsabilidades:
- Centralizar llamadas al backend
- Configurar baseURL
- Adjuntar tokens de autenticación
- Manejar errores comunes

Convención:
- Un archivo por dominio (`inventory.service.js`, `usage.service.js`, etc.)
- Funciones simples y reutilizables
- Documentadas con JSDoc

Esta capa desacopla la UI del backend.

---

## Hooks personalizados

Ubicación: `src/hooks`

Se utilizan para:
- Lógica reusable (responsive, permisos, helpers)
- Evitar duplicación de código
- Simplificar componentes complejos

Ejemplos:
- Hooks para detectar mobile
- Hooks para permisos o roles
- Hooks para fetch/control de estado

---

## Componentes reutilizables

Ubicación: `src/components`

Incluye:
- Tablas
- Cards mobile
- Formularios genéricos
- Wrappers de UI

Los componentes:
- No conocen el backend
- Reciben datos y callbacks por props
- Son reutilizables entre features

---

## Estilos

Ubicación:
- `src/css`
- `App.css`
- `index.css`

Convención:
- Estilos globales mínimos
- Ant Design como base visual
- Overrides específicos cuando es necesario

---

## Principios arquitectónicos

- Separación clara de responsabilidades
- UI desacoplada de la API
- Control de acceso centralizado
- Arquitectura modular y escalable
- Pensada para uso real y datos sensibles

---

## Resumen

El frontend de GrowSync está diseñado para:
- Escalar funcionalmente
- Mantener seguridad por rol
- Facilitar mantenimiento
- Permitir evolución del sistema sin refactors grandes

Esta arquitectura acompaña los objetivos de GrowSync como sistema de gestión agropecuaria real.
