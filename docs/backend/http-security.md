# HTTP hardening y rate limiting público

Implementación acotada a HTTP; no cambia ROPG, sesión del frontend, permisos, pagos, DB ni Remitos.
No requiere migración. No configura ni despliega Render.

## Límites

Todas las ventanas cuentan intentos, incluidos éxitos y rechazos. Cada grupo tiene su propio MemoryStore.

| Endpoint/grupo | Máximo | Ventana | Clave |
| --- | ---: | --- | --- |
| POST /api/login | 5 | 15 minutos | IP normalizada + SHA-256 del email trim/lowercase |
| POST /api/login, techo adicional | 50 | 15 minutos | IP normalizada |
| POST /api/register | 10 | 1 hora | IP normalizada |
| GET/HEAD /api/invitations/:token | 60 | 15 minutos | IP normalizada |
| POST /api/public/register-company | 5 | 1 hora | IP normalizada |
| /api/public/payments, GET/HEAD | 120 | 5 minutos | IP normalizada |
| /api/public/payments, escrituras | 10 | 15 minutos | IP normalizada |
| /api/public/payments/mercadopago, GET/HEAD | 120 | 5 minutos | IP normalizada |
| /api/public/payments/mercadopago, escrituras | 10 | 15 minutos | IP normalizada |
| /api/admin/company-invitations | 10 | 1 hora | IP normalizada |

Mercado Pago no consume el presupuesto de simulación. Las consultas de un proveedor comparten presupuesto
entre payment IDs/referencias: cambiar el ID no permite evitar el límite. La lectura tiene margen para polling
normal (hasta 24 consultas/minuto sostenidas); el checkout actual consulta cada 5 segundos (12/minuto),
verificado en grow-sync/src/features/public/paymentSimulation.jsx. Las escrituras son más estrictas. OPTIONS no consume presupuesto.
El secret administrativo sigue siendo obligatorio y el límite se evalúa antes del secret. Las rutas privadas
normales no llevan estos limitadores. La invitación privada conserva sus permisos y recibe no-store.

Se utiliza ipKeyGenerator de express-rate-limit (IPv6 agrupada por /56). El techo por IP del login limita la
rotación de identidades; otra identidad conserva su presupuesto mientras no se agote ese techo. No se utiliza
password, token de invitación, referencia de pago ni secret en claves o logs de la nueva capa. El hash del email
no se expone: es un identificador interno temporal, no una garantía de anonimización.

429 responde exclusivamente error=too_many_requests y un mensaje genérico. Retry-After indica segundos hasta
el reset del bucket; no se publican contadores X-RateLimit/RateLimit. También lleva Cache-Control: no-store.

## Proxy: configuración obligatoria antes de desplegar en Render

Antes de este cambio Express no configuraba trust proxy: req.ip provenía del socket (en Render, del proxy).
Render documenta que el cliente llega por X-Forwarded-For a través de su infraestructura de edge/balanceadores.
El repositorio no contiene evidencia de la cantidad exacta de saltos del despliegue activo ni de proxies propios.
Por eso **no se deduce el número de saltos de NODE_ENV ni se activa trust proxy=true**.

- Conexión directa/local: TRUST_PROXY_HOPS=0, o ausente, establece app.set('trust proxy', false).
- Con proxy: TRUST_PROXY_HOPS=N establece app.set('trust proxy', N), entero explícito de 1 a 5.
- En Render (RENDER=true), ausente/0 aborta el arranque antes de inicializar DB, cron o servidor. Esto evita
  desplegar inadvertidamente un limitador global basado en la IP del balanceador. Requiere configurar el valor
  antes de desplegar. Valores booleanos, fracciones o fuera de rango también se rechazan.
- TRUST_PROXY_HOPS=1 es apropiado **solo si** el último salto confiable agrega la IP efectiva del cliente como
  entrada más a la derecha de X-Forwarded-For. Express examina la cadena desde el socket hacia la izquierda y
  se detiene al llegar al primer salto no confiable. Nunca tomar sin validación la primera IP de la cabecera.

Verificación operativa pendiente, sin desplegar ni crear un endpoint de diagnóstico público: comprobar en el
entorno administrado la cadena de proxy usando tráfico controlado desde dos redes, comparar req.ip con la IP
conocida, y repetir enviando un X-Forwarded-For falso a la izquierda. Confirmar que la IP efectiva no cambia
por ese prefijo y que todas las rutas de acceso tienen la misma longitud. No registrar bodies, tokens ni URLs
con tokens. No aumentar N para solucionar un 429 sin comprobar la topología. El puerto de la app no debe ser
accesible directamente por clientes no confiables cuando se habilitan saltos por número.

Referencias: [Express detrás de proxies](https://expressjs.com/en/guide/behind-proxies/),
[Render: IP real y rate limiting](https://render.com/articles/how-render-handles-ddos-attacks),
[express-rate-limit: proxies](https://express-rate-limit.mintlify.app/guides/troubleshooting-proxy-issues).

## Cabeceras

Helmet 8.3.0 antes de CORS y parsing JSON. Defaults activos:

- Cross-Origin-Opener-Policy: same-origin
- Origin-Agent-Cluster: ?1
- Referrer-Policy: no-referrer
- X-Content-Type-Options: nosniff
- X-DNS-Prefetch-Control: off
- X-Download-Options: noopen
- X-Frame-Options: SAMEORIGIN
- X-Permitted-Cross-Domain-Policies: none
- X-XSS-Protection: 0 (desactiva el filtro legacy)
- Elimina X-Powered-By.

Excepciones explícitas:
- CSP desactivada. Una CSP del backend no protege el HTML de Vercel.
- COEP desactivada, consistente con el default de Helmet.
- Cross-Origin-Resource-Policy: cross-origin para la API consumida desde otro origen. No sustituye CORS/autorización.
- HSTS: max-age=31536000; includeSubDomains en NODE_ENV=production o RENDER=true; desactivada en desarrollo.
  No se agrega preload ni redirección propia HTTP/HTTPS: TLS sigue en Render. Se fija una vez en la aplicación.
  No se inspeccionaron ni alteraron cabeceras del edge productivo.

Cache-Control: no-store se fija antes de CORS, parser JSON, limitador, validación y autenticación en login,
register, consulta de invitaciones, admin/company-invitations, register-company, pagos (incluyendo MP) y
users/invite. Cubre respuestas de éxito, validaciones, errores y 429, incluyendo access_token, id_token,
mfa_token, inviteLink y tokens. Se preservan los no-store existentes de P0 pagos/invitaciones.
Referencia: [Helmet](https://helmetjs.github.io/).

## CORS

La lista anterior aceptaba incondicionalmente localhost y un deployment Vercel legacy, también en producción.
Se elimina esa confianza implícita. Solo FRONTEND_URL y CORS_ALLOWED_ORIGINS (lista separada por comas) autorizan
origins en producción/Render. Deben ser origins exactos http/https, sin rutas, slash final, credenciales o *.
El dominio legacy puede autorizarse explícitamente si sigue siendo necesario; no se asume que lo sea.
En desarrollo local se añaden localhost:3000 y localhost:5173. No se cambió ningún entorno remoto.
credentials sigue true y no se usa wildcard. Se preserva preflight, incluyendo X-Registration-Token y
X-Registration-Reference. Sin Origin sigue permitido para clientes servidor; CORS no sustituye autenticación.
Rechazos devuelven 403 sin reflejar el origen recibido en mensajes/logs de esta capa.

## Login

El contrato ROPG, tokens de éxito y mfa_required permanecen. invalid_grant=401, access_denied=403,
too_many_requests/HTTP 429=429 con Retry-After=60 como espera local orientativa del proveedor.
Se elimina details y error_description de la respuesta y del log genérico. Solo se registran status numérico y
un código de una lista cerrada (o provider_error); no se serializa el error Axios, request, payload ni secretos.
Los errores de configuración y respuesta inválida del proveedor también usan mensaje público genérico.
El manejador central oculta el mensaje crudo de entity.parse.failed: Node puede incluir fragmentos del body
(con contraseñas) en ese mensaje. Se conserva la respuesta 400 existente y se registra tipo/status sin el fragmento.

## Dependencias y pruebas

Node de validación: 20.20.2. express-rate-limit 8.7.4 declara Node >=16, Express >=4.11; Helmet 8.3.0 Node >=18.
Transitivas nuevas: ip-address 10.7.6 (Node >=12); debug sube de 4.4.0 a 4.4.3 (Node >=6), requerido por el limiter.
No cambia engines ni runtime. Versiones directas fijadas en package.json y lockfile.

httpSecurity.test.js usa middleware real por HTTP, factory con stores aislados y límites inyectados, sin esperar
ventanas. loginSecurity.test.js usa rutas/validadores/controlador reales con Auth0 simulado. Regresión de pagos,
invitaciones, autorización, perfiles, responsables, sockets y permisos. Sin llamadas externas ni DB productiva.
Validación final: 151 tests, 151 pass, 0 fail, 0 skipped; 20 nuevos de HTTP/login. Comando desde growsync-backend:

```sh
node --version # v20.20.2
node --test tests/httpSecurity.test.js tests/loginSecurity.test.js tests/p0Authorization.test.js tests/publicPayments.integration.test.js tests/invitationsSecurity.test.js tests/socketAuthentication.test.js tests/userProfile.test.js tests/planningResponsibles.test.js tests/inventoryGlobalRegistration.test.js tests/stockPermissions.test.js tests/recipePermissions.test.js
```

Se usaron variables sintéticas para Supabase/MP y DOTENV_CONFIG_PATH inexistente; las fixtures sustituyen las
integraciones externas y no se inició index.js. git diff --check limpio, incluidos archivos nuevos mediante
--no-index. Frontend/configuración compartida sin cambios: no requiere build frontend en esta tarea.

## Límites y trabajo posterior

MemoryStore es por proceso: reinicios borran contadores y varias instancias multiplican el presupuesto. Antes
de escalar horizontalmente se necesita un store compartido; esta fase no incorpora Redis/DB/infraestructura.
No es una defensa completa ante bots distribuidos ni DDoS. Usuarios detrás de NAT comparten techos por IP.
Los límites iniciales necesitan observación operativa del checkout, sin registrar secretos.

P1-PERF pendiente, sin cambios aquí: index.js aplica checkJwt + userData + requireTenant a /api/users y
/api/harvest-records; routes/userRoutes.js vuelve a aplicar checkJwt/userData en /me, /me/profile, /invite y
otras operaciones; routes/harvestRecords.js los repite en /context, /cycles/:assignmentId/finalize y las rutas
CRUD de cosechas. No se eliminó ninguna comprobación ni se modificaron permisos.
