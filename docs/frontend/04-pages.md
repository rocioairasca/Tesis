# Módulos / Pantallas (features)

Este documento lista las rutas principales del frontend, qué pantalla renderizan, si requieren autenticación y qué rol mínimo requieren (según `GuardedRoute` en `App.js`).

## Convención de roles
- 0: Empleado
- 1: Supervisor
- 2: Dueño de campo
- 3: Admin

> Nota: si una ruta usa `<Guarded Route>` sin `allowedRoles`, se asume accesible para usuarios autenticados (cualquier rol válido).

---

## Autenticación
### /login
- Feature: `auth`
- Componente: `LoginRegister`
- Layout: **No usa `AppLayout`**
- Acceso: Público
- Objetivo: Inicio de sesión (Auth0 embedded / flujo definido en `auth`)

---

## Dashboard
### /dashboard
- Feature: `features/dashboard`
- Componente: `Dashboard`
- Layout: `AppLayout`
- Acceso: Protegido (cualquier rol autenticado)
- Objetivo: vista general (KPIs, accesos rápidos, etc.)

---

## Usuarios
### /usuarios
- Feature: `features/users`
- Componente: `Users`
- Layout: `AppLayout`
- Acceso: Protegido (solo Admin)
- Roles permitidos: [3]
- Objetivo: gestión de usuarios y asignación de roles

---

## Inventario
### /inventario
- Feature: `features/inventory`
- Componente: `Inventory`
- Layout: `AppLayout`
- Acceso: Protegido (cualquier rol autenticado)
- Objetivo: listar/crear/editar productos (stock, unidades, etc.)

### /productos-deshabilitados
- Feature: `features/inventory`
- Componente: `DisabledInventory` (importado como `DisabledProducts`)
- Layout: `AppLayout`
- Acceso: Protegido (solo Admin)
- Roles permitidos: [3]
- Objetivo: ver productos deshabilitados y volver a habilitarlos

---

## Lotes
### /lotes
- Feature: `features/lots`
- Componente: `Lotes`
- Layout: `AppLayout`
- Acceso: Protegido (cualquier rol autenticado)
- Objetivo: gestión de lotes (mapa + tabla / vista responsive)

### /lotes-deshabilitados
- Feature: `features/lots`
- Componente: `DisabledLotes`
- Layout: `AppLayout`
- Acceso: Protegido (solo Admin)
- Roles permitidos: [3]
- Objetivo: ver lotes deshabillitados y volver a habilitarlos

---

## Registros de uso (Usages)
### /usage
- Feature: `features/usages`
- Componente: `Usage`
- Layout: `AppLayout`
- Acceso: Protegido (cualquier rol autenticado)
- Objetivo: Registrar y listar usos (agroquímicos/insumos, lotes, hectáreas, etc.)

### /usages-disabled
- Feature: `features/usages`
- Componente: `DisabledUsages`
- Layout: `AppLayout`
- Acceso: Protegido (solo Admin)
- Roles permitidos: [3]
- Objetivo: ver registros deshabilitados y restaurarlos

---

## Vehículos
### /vehiculos
- Feature: `features/vehicles`
- Componente: `Vehicles`
- Layout: `AppLayout`
- Acceso: Protegido (cualquier rol autenticado)
- Objetivo: gestión de vehiculos

### /vehiculos-deshabilitados
- Feature: `features/vehicles`
- Componente: `DisabledVehicles`
- Layout: `AppLayout`
-  Acceso: Protegido (según App.js actual: cualquier rol autenticado)
- Objetivo: Ver vehículos deshabilitados y restaurarlos
- Observación: Esta ruta normalmente sería solo Admin, pero actualmente NO restringe roles.

---

## Planificaciones
### /planificaciones
- Feature: `features/planning`
- Componente: `Planning`
- Layout: `AppLayout`
- Acceso: Protegido (cualquier rol autenticado)
- Objetivo: Gestión de planificaciones / actividades

### /planificaciones-deshabilitadas
- Feature: `features/planning`
- Componente: `DisabledPlanning`
- Layout: `AppLayout`
- Acceso: Protegido (cualquier rol autenticado)
- Objetivo: Ver planificaciones deshabilitadas y restaurarlas
- Observación: Esta ruta normalmente sería solo Admin, pero actualmente NO restringe roles.

---

## Ruta por defecto

### *
- Componente: `Navigate`
- Acción: redirige a `/login`
- Objetivo: fallback para rutas inexistentes