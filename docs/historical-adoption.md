# Adopción administrativa de antecedentes existentes

Implementada directamente en el checkout local. No se ejecutó ninguna migración
ni operación contra producción. No se reimportan, recrean o reclasifican filas
por antigüedad automáticamente.

## Endpoints y permisos

- `POST /api/history/adopt-existing/prepare`, body `{"planning_ids":["uuid"]}`.
- `POST /api/history/adopt-existing/confirm`, mismo listado y
  `"confirmed_no_stock":true`, más encabezado `Idempotency-Key`.

Ambos heredan checkJwt, userData y requireTenant. Exigen Admin (role 3),
`planning.edit` y `history.import`, respetando custom_permissions como reemplazo
de los permisos del rol. Servicio y funciones SQL vuelven a verificar al actor.
La empresa y el actor se toman de la sesión, nunca del body.

Preview: `persisted:false`, fecha de corte, planificaciones, fechas, grafo de
relaciones, nombres de lotes/productos/sublotes y bloqueos por planificación.
No persiste auditoría ni permisos temporales. Acepta 1–50 IDs únicos.
Confirmación: vuelve a validar todo; si hay bloqueo devuelve 409 y el preview
actualizado, sin escribir. La clave se guarda en historical_imports con origen
`adopt-existing`; reintentos devuelven el resultado original y una clave usada
con otro listado devuelve conflicto. El orden de los IDs no altera el payload.

## Inmutabilidad y vía restringida

Migración: `growsync-backend/migrations/20261004_adopt_existing_history.sql`.

No utiliza un flag de sesión como autorización ni desactiva triggers. Una función
SECURITY DEFINER, ejecutable únicamente por el propietario y service_role,
crea permisos internos por transacción + backend + tabla + ID + importación.
El esquema y la tabla de permisos internos no son accesibles a service_role,
authenticated, anon ni PUBLIC. Solamente el propietario de las funciones puede
emitirlos. Se eliminan inmediatamente después de cada conversión.

El trigger de inmutabilidad admite exclusivamente NORMAL sin procedencia previa
→ HISTORICAL_NO_STOCK con la importación autorizada. Rechaza cualquier otro
cambio de modo o procedencia y cualquier dato productivo adicional. Mantiene el
bloqueo completo de ciclos históricos y no permite conversión inversa.
Se preserva updated_at incluso si existe el trigger de timestamps de ciclos.
La columna generada date_range se verifica después de que PostgreSQL la calcule.
Las filas se vuelven a leer después de los triggers AFTER para comprobar que
solo cambiaron los dos campos semánticos autorizados.

Se convierten conjuntamente Planning, Usage relacionados y crop_assignments
cuyo source_planning_id apunta a ese Planning. Se conservan IDs, estado,
responsables, fechas, campañas, productos, superficies, planning_lots,
usage_lots y planning_product_completions. No se crean relaciones faltantes.
Cada Planning genera un historical_event con actor, empresa, fecha, grafo previo,
modos anterior/nuevo, relaciones convertidas, corte usado y confirmación.
Los JSONB se construyen nativamente dentro de PostgreSQL; no hay un string JSON
pasado a un parámetro postgres.js de tipo JSONB que pueda codificarse dos veces.

## Existencia, fechas y stock

Se admite Planning completado NORMAL y sin historical_import_id, de siembra,
fumigación o fertilización. Debe tener fecha anterior estrictamente al corte.
D se toma de effective_date; si falta, del día argentino de end_at. Los Usage
y el inicio de los ciclos también deben ser anteriores al corte.

Se buscan Usage por source_planning_id, source_planning_product_id y completions,
y se rechazan links inconsistentes o de otro tenant. Los datos de relaciones
ajenas no se devuelven en el preview. Se verifica que completion, producto y
cantidad real coincidan, sin convertir unidades ni corregir datos silenciosamente.

Cualquier stock_movement ligado por Usage, operation_id del Planning o clave
planning-product bloquea la adopción, incluso si el movimiento fue revertido.
No se llama a consumeStock, reverseStock, completion ni servicios de ciclos.
Se comparan antes/después las partidas completas, movimientos, balances,
productos legacy y notificaciones de la empresa. Se comparan también las tablas
intermedias. Una diferencia aborta toda la transacción.

La confirmación toma locks SHARE ROW EXCLUSIVE de las tablas involucradas para
impedir escrituras concurrentes y nuevos links entre validación y comparación.
Es un bloqueo a nivel tabla que puede demorar escrituras de otros tenants; el
servicio limita espera de locks a 5 segundos y sentencias a 30 segundos. No hay
llamadas de red dentro de la transacción. Un conflicto/timeout pide reintentar.
Esta decisión prioriza integridad en una operación administrativa poco frecuente;
no debe usarse como proceso masivo automático.

## UI

Planificaciones ofrece la acción en tabla, móvil y calendario solo para Admin
con ambos permisos, con registros completados NORMAL anteriores al corte. El
corte se consulta al backend. El modal muestra fecha, lotes/superficies,
productos/cantidades y relaciones, los bloqueos y una confirmación explícita.
Tras confirmar refresca la lista; el modo histórico activa el editor existente
“Corrección de antecedente”. Un error de red mantiene la clave del intento.

## Casos que requieren revisión

- Corte sin configurar, fecha igual/posterior, estado no completado, modo o
  procedencia histórica previos (salvo reintento de la misma clave).
- Movimientos V1 asociados: no se neutralizan ni compensan.
- Cosechas o cierres de ciclo relacionados: se bloquea para evitar convertir
  parcialmente un grafo productivo. No se modifican cosechas ni cierres.
- Relaciones de otra empresa, productos/unidades/cantidades incompatibles,
  referencias ambiguas, otros tipos de actividad o fechas no anteriores al corte.
- Triggers instalados que produzcan efectos secundarios detectados.

La ausencia de Usage/completions/ciclos por sí sola no bloquea ni crea registros.
Las limitaciones previas del editor siguen vigentes: una línea sin Usage no se
inventa para editar cantidades; cambios de fechas/superficies con ciclos
históricos vinculados requieren corrección integral.

## Despliegue

1. Revisar y aplicar la migración una vez mediante el procedimiento normal de
   migraciones, con el propietario de las tablas/funciones. Depende del esquema
   histórico 20260916, Inventory V1, vencimientos mensuales y tablas de cosechas.
2. Desplegar backend y frontend. El usuario SQL del backend debe ser el propietario
   o tener únicamente EXECUTE sobre las dos funciones públicas; nunca otorgar
   acceso al esquema history_internal ni a su tabla. No hay variables nuevas.
3. Usar la acción de Planificaciones. No se necesita Postman ni SQL por empresa.
   No ejecutar una reclasificación masiva de fechas.

## Archivos

- growsync-backend/migrations/20261004_adopt_existing_history.sql (nuevo)
- growsync-backend/services/historicalAdoption.js (nuevo)
- growsync-backend/routes/history.js
- growsync-backend/tests/historicalAdoption.integration.test.js (nuevo)
- grow-sync/src/features/planning/historicalAdoption.mjs (nuevo)
- grow-sync/src/features/planning/components/AdoptExistingModal.jsx (nuevo)
- grow-sync/src/features/planning/Planning.jsx
- grow-sync/src/features/planning/components/PlanningTable.jsx
- grow-sync/src/features/planning/components/PlanningListMobile.jsx
- grow-sync/tests/historicalAdoption.test.mjs (nuevo)
- docs/historical-adoption.md (este documento)

## Pruebas

- Backend: `node --test tests/historicalAdoption.integration.test.js tests/historicalNoStock.integration.test.js tests/stockInitial.integration.test.js`
  → 41 aprobadas, 1 aceptación omitida por su condición existente.
- Adopción focalizada: 16 aprobadas, incluido rollback por un trigger sintético,
  revalidación, idempotencia, tenants, permisos, invariancia del grafo y stock,
  endpoints HTTP y PATCH histórico. El servidor HTTP de prueba usa identidad
  sintética; no contacta Auth0. Todas las bases son PGlite descartables.
- Frontend: `node --test tests/historicalAdoption.test.mjs tests/historicalPlanning.test.mjs tests/planningLayout.test.mjs`
  → 9 aprobadas. Incluye permisos, cutoff, payload, integración de acciones y
  renderizado del editor histórico existente.
- `npm run build` correcto. No se probó ni ejecutó la migración contra producción.