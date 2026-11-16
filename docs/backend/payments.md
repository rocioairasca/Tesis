# Pagos y registro público de empresas

## Producción: simulación deshabilitada

`POST /api/public/payments`, `POST /api/public/payments/:id/confirm` y
`GET /api/public/payments/:id` devuelven 403 por defecto. Sus controladores también
verifican la configuración, incluso si se montaran en otra ruta.

Para desarrollo/test aislado se requieren **ambas** variables del backend:

```env
NODE_ENV=test
ALLOW_SIMULATED_PAYMENTS=true
```

También se admite `NODE_ENV=development`. Solo el string exacto `true` habilita
la bandera. `NODE_ENV=production` siempre bloquea simulación, incluso con esa
bandera. Un staging con runtime productivo conserva ese bloqueo; no es necesario
cambiar su configuración para probar los rechazos. No se modifica ningún permiso
de usuario ni se agrega una bandera de seguridad en frontend.

## Mercado Pago

`POST /api/public/payments/mercadopago/preference` toma únicamente el identificador
de plan. Plan, monto y moneda se determinan en backend (basic: 20000 ARS;
professional: 45000 ARS) y se guardan junto con la referencia aleatoria y la
preferencia antes de entregar la URL de checkout.

`POST /api/public/register-company` mantiene el payload de registro existente y
acepta exactamente una vía: `mercadoPagoExternalReference` o, solo con simulación
habilitada, `paymentId`. Ambas vías exigen además `X-Registration-Token`. No confía
en estados, planes, montos o monedas del cliente.

El backend busca el pago por referencia y vuelve a consultarlo por ID mediante
la API autenticada de Mercado Pago. Exige `approved`, `live_mode=true`, referencia
exacta, plan en metadata, monto y moneda coherentes con la intención guardada,
y ausencia de monto reembolsado. Un pago sandbox no habilita el flujo real.

## Consumo atómico y despliegue

Aplicar primero `growsync-backend/migrations/20261116_company_registration_payments.sql`
con el procedimiento habitual de migraciones. No se ejecuta automáticamente.
Crea `company_registration_payments`, sin alterar pagos, empresas o usuarios
existentes. La tabla usa RLS, sin acceso para `anon`/`authenticated`.

La transacción bloquea la referencia (`FOR UPDATE`), reserva el ID de pago, crea
empresa/cultivos predeterminados/administrador y asocia el consumo. Los índices
únicos por proveedor+referencia y proveedor+ID de pago impiden reutilización,
incluso concurrente o usando otra referencia. Una segunda solicitud devuelve 409.
Un error revierte los cambios locales; el rol del administrador sigue siendo 3.
No existe fallback de registro si falta la conexión SQL o la migración.

Las preferencias anteriores a esta migración carecen de términos confiables y
se rechazan. No se hace backfill automático: pagos históricos que ya se cobraron
requieren revisión y conciliación antes del despliegue, sin pedir un segundo pago
al cliente. No se pueden identificar automáticamente los consumos históricos
porque el esquema anterior no guardaba esa asociación.

Auth0 sigue siendo un servicio externo: un fallo SQL después de crear la identidad,
o una respuesta de Auth0 perdida por timeout, puede dejar una identidad sin
empresa local. Requiere conciliación; no habilita reutilización de un pago ya
consumido ni crea un administrador local sin pago. El secreto acredita la sesión
que inició la intención, no la identidad legal del pagador. No se cambian login,
invitaciones ni permisos en esta etapa.

## Validación aislada

```sh
node --test tests/publicPayments.integration.test.js tests/inventoryGlobalRegistration.test.js
```

Por defecto utiliza PGlite descartable y proveedores simulados. Para repetir sobre
un cluster PostgreSQL **descartable local**, el fixture admite
`REGISTRATION_TEST_DATABASE_URL` solo con host localhost/127.0.0.1 y usuario
`registration_test`; crea y elimina únicamente una base aleatoria de tests (requiere CREATEDB).
Nunca importar `.env`, usar la URL productiva ni llamar proveedores reales en estas pruebas.


## Auditoría final de la migración P0-SEC-01

La tabla se crea explícitamente en `public`, igual que `public.companies`.
Las consultas de consumo también especifican `public`; no dependen del search_path.
La migración es de ejecución única, transaccional y deliberadamente sin
`IF NOT EXISTS`: si ya existe la tabla, debe fallar sin modificar ni ocultar un
esquema diferente. No inserta filas ni cambia información histórica.

Restricciones principales (con índices B-tree únicos creados por PostgreSQL):
- `company_registration_payments_provider_reference_pk`: `(provider, reference)`.
- `company_registration_payments_provider_payment_key`: `(provider, provider_payment_id)`.
- `company_registration_payments_company_key`: `(company_id)`.
- `company_registration_payments_company_fk`: empresa existente, `ON DELETE RESTRICT`.
- `company_registration_payments_consumption_check`: empresa/fecha de consumo juntas;
  un consumo exige ID de pago. Los IDs nulos se permiten solo para intenciones aún no consumidas.

RLS habilitado, sin políticas permisivas. Se revocan todos los privilegios de
PUBLIC, anon y authenticated. También se eliminan grants heredados de service_role
antes de otorgarle SELECT/INSERT/UPDATE, sin DELETE/TRUNCATE. El propietario SQL y
roles BYPASSRLS son servidores de confianza; no se usa FORCE RLS para bloquear el
propietario que ejecuta el backend. No se modifica el ACL de otras tablas.

Atomicidad local: BEGIN, bloqueo de referencia, reserva del ID de pago, empresa,
seeds, usuario local, asociación/fecha de consumo y COMMIT utilizan una conexión
reservada. Auth0 se invoca mientras el lock está retenido, pero NO participa en la
transacción de PostgreSQL. La verificación de Mercado Pago ocurre antes del BEGIN.
No hay envío explícito de email en este flujo; cualquier efecto externo de Auth0
queda fuera del rollback. No se devuelven filas del ledger en respuestas públicas.

La validación local de concurrencia usa solicitudes HTTP simultáneas con PGlite
(sesión SQL única); no equivale a una prueba de contención multi-sesión en un
servidor PostgreSQL. Las garantías del código dependen del lock y de constraints
PostgreSQL, no de un mutex de aplicación.

## Intención privada de registro

Al crear cada preferencia (o pago simulado habilitado), el servidor genera
`crypto.randomBytes(32).toString('hex')`: 256 bits aleatorios independientes de los
IDs/referencias. La respuesta inicial incluye `registrationToken` una sola vez,
fuera del objeto de Mercado Pago. Ninguna consulta posterior recupera el secreto.
No se envía a Mercado Pago, URLs, logs, email, Auth0 ni se almacena en texto plano.

Se agrega a la misma migración pendiente:

```sql
registration_token_hash text NOT NULL,
CONSTRAINT company_registration_payments_token_hash_check
  CHECK (registration_token_hash ~ '^[0-9a-f]{64}$')
```

Representación canónica: SHA-256 del token UTF-8, hexadecimal minúsculo de 64
caracteres (32 bytes de digest). No se agrega otra migración ni valores históricos.
`registrationIntents.validate` centraliza provider, referencia, hash comparado con
`crypto.timingSafeEqual` y estado no consumido. La validación ocurre antes de las
consultas al proveedor y vuelve a ejecutarse bajo `FOR UPDATE` al consumir.

Endpoints protegidos:
- `GET /api/public/payments/mercadopago/reference/:externalReference`: token por header.
- `GET /api/public/payments/mercadopago/payment/:paymentId`: token y
  `X-Registration-Reference`; verifica además que el pago consultado tenga esa referencia.
- `POST /api/public/register-company`: referencia/ID en el payload actual y token por header.
- `POST /api/public/payments/:id/confirm` y `GET /api/public/payments/:id`: token por header,
  además del bloqueo de simulación en producción.

Ausencia, formato incorrecto, secreto ajeno o referencia desconocida devuelven
403 sin datos de pago. Una intención consumida devuelve 409 solo después de
validar correctamente su secreto. El token no sustituye la aprobación real,
live_mode, plan, monto, moneda, referencia ni comprobación de reembolso.

El servicio frontend guarda el token exclusivamente en `sessionStorage`, asociado
a provider+referencia, y lo elimina del objeto entregado a componentes. Los
requests usan headers; al registrar exitosamente se elimina de sessionStorage.
La referencia puede seguir en localStorage/URL, pero ya no basta para consultar
ni registrar. Se retiraron logs de respuestas/errores Axios que podrían incluir
headers privados. CORS existente permite los headers solicitados; no requiere
cambios globales de política.

Volver a la pestaña original después del checkout conserva la sesión. Un navegador
nuevo, cerrar la sesión o borrar sessionStorage pierde el secreto: no hay mecanismo
de recuperación basado solo en payment ID/referencia. Requiere conciliación si
el pago ya ocurrió. El secreto sigue expuesto a un XSS con acceso al mismo origen,
como otros secretos en almacenamiento de sesión; no se aborda XSS general aquí.

Tests frontend adicionales:

```sh
node --test tests/registrationSession.test.mjs tests/registrationToken.browser.mjs
npm run build
```

El browser test usa el servicio real con respuestas HTTP interceptadas, nunca
Mercado Pago real. Prueba retorno en misma pestaña, headers, ausencia de token en
URL/localStorage/consola, nueva sesión sin credenciales y simulación.
