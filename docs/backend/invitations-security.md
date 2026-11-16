# P0: autorización de invitaciones

`POST /api/users/invite` exige identidad autenticada, empresa del actor y permiso
**efectivo** `users.invite` (o `all`). La lista custom reemplaza los permisos por
defecto, incluso para role 3. No se refactorizan los middlewares duplicados.

Body estricto: `{ email, role }`. Email: trim + lowercase; role: obligatorio,
entero real sin coerción, solo 0/1/2. No se aceptan propiedades adicionales.
Empresa, token, expiración y used son valores del servidor. El controller repite
el control de permiso y schema si se utiliza directamente desde otra ruta.

| Actor con permiso efectivo | Roles que puede invitar |
| --- | --- |
| 0 | 0 |
| 1 | 0, 1 |
| 2 | 0, 1, 2 |
| 3 | 0, 1, 2 |

Sin permiso: 403. Role 3 no puede emitirse ni canjearse en este flujo. El frontend
conserva la visibilidad por users.invite y limita opciones al rol del actor.
El token conserva 32 bytes aleatorios y expiración de siete días. Creación,
preview y registro usan Cache-Control: no-store. El preview no devuelve token ni
company_id. Los logs de invitación/DB no imprimen secretos o filas completas.

## Canje

`POST /api/register` tiene schema estricto. Role/company/custom_permissions del
cliente se rechazan. El controller usa exclusivamente rol/empresa almacenados y
exige email coincidente. Usadas, vencidas, sin empresa o con rol distinto de 0/1/2
se rechazan antes de llamar a Auth0. El preview también rechaza roles históricos
inválidos. No se altera el login ni la configuración general de Auth0.

## Auditoría manual de producción: NO ejecutada

No se conoce si existen invitaciones peligrosas reales. Consultas de solo lectura,
sin tokens, para ejecutar posteriormente con acceso administrativo autorizado:

```sql
-- Invitaciones abiertas con role 3.
SELECT id, company_id, role, created_at, expires_at
FROM public.invitations
WHERE used = false AND expires_at > now() AND role = 3
ORDER BY created_at DESC;

-- Otras invitaciones abiertas incompatibles con el contrato seguro.
SELECT id, company_id, role, created_at, expires_at
FROM public.invitations
WHERE used = false AND expires_at > now()
  AND (role IS NULL OR role NOT IN (0, 1, 2) OR company_id IS NULL)
ORDER BY created_at DESC;
```

No se modifican datos reales ni se crean migraciones. Las invitaciones inválidas
quedan inutilizables por los controles nuevos. El esquema no guarda el emisor:
no permite reconstruir con certeza si una invitación histórica 0/1/2 excedió sus
facultades al momento de emitirla.

## Límites conservados

El token sigue en texto plano y viaja en el enlace de invitación. Hashing y revisión
de access logs/proxies/referrers quedan como hardening posterior. Auth0 es externo.
Crear usuario y marcar used siguen siendo operaciones separadas del flujo existente:
no se agrega garantía SQL de canje exactamente una vez ni se rediseñan compensaciones
en este P0 de escalamiento de privilegios.

## Validación aislada

Rutas, guards y schemas reales; Supabase, Auth0 y notificaciones simulados.
Nunca se cargan credenciales reales ni se envían mensajes.

```sh
node --test tests/invitationsSecurity.test.js tests/p0Authorization.test.js tests/userProfile.test.js tests/planningResponsibles.test.js tests/socketAuthentication.test.js
```

Para regresiones que inicializan clientes usar configuración sintética con URLs
inválidas, sin DATABASE_URL/SUPABASE_DB_URL ni .env real.
