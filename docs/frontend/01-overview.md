# Overview Frontend

GrowSync Frontend es una SPA en React + Ant Design.
**Objetivo:** proveer UI, navegación y control de accesos por rol, consumiendo el backend vía `src/services`.

## Principios
- UI reutilizable en `components`
- Módulos del negocio en `features`
- Requests centralizados en `services`
- Acceso por roles desde `routes`/`auth`
- Layout desacoplado en `layout`

## Flujo general
1. Usuario se autentica (módulo `auth`)
2. Se guarda sesión/usuario/rol en `context`
3. `routes` define qué puede ver según rol
4. `features/*` renderiza pantallas y usa `services/*` para datos