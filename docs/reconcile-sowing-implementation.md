# Implementación de reconcile-sowing

Implementada localmente en `C:\Proyectos\Tesis`. Sin commit ni staging. **No se ejecutó prepare ni confirm contra Supabase producción, no se aplicaron migraciones ni se modificaron datos productivos.**

## Alcance

Soporte restringido a Don Santiago SRL (`2791ea15-7dad-48e2-945b-3791e2d44478`), Trigo (`2f9aabe7-d74d-400c-92c7-8b2b4f8fed8f`) y campaña existente `42894d7b-337a-4833-8995-f35a36b42104`.

| Planning | Lote | Inicio real confirmado |
|---|---|---|
| bc06146e-086e-4a10-8dec-fcaa3d5d71f1 | 81e0ba67-b201-4bb6-ac01-09b26f6635aa (13-15) | 2026-05-23 |
| c6a6bea6-345b-44f2-baa8-9d10cd81e255 | b3e6227c-65cc-45ff-9174-19f432cf5a3a (12) | 2026-05-26 |
| ab0c87f3-8edf-40b3-b1e4-4eca931734ec | a21d67cd-667d-4c17-bbc6-db7f4b20b617 (1) | 2026-05-29 |
| b71d0fad-659e-493b-8127-104b93844983 | a7df5a3f-9b62-4347-b576-be736896470d (T1) | 2026-06-01 |

Los IDs y fechas son una lista fija de soporte en el servidor: el cliente no puede cambiar empresa, cultivo, campaña, fecha, lote ni área. Acepta de 1 a 4 IDs únicos, normalizados y ordenados. T2 `74842b24-19cd-4f88-bf4b-3f43dedd7837` devuelve 409 por Soja abierta whole-lot; T3 `c843269e-50a5-4ea5-b63d-4c5587e5b48d` devuelve 409 por vínculo histórico T4. Cualquier otro ID queda fuera del alcance.

## Endpoints y payloads

Montados debajo de `/api/history`, detrás de los middleware existentes checkJwt, userData y requireTenant. El router específico exige history.import y planning.edit; el servicio vuelve a consultar el actor habilitado, rol Admin (3), permisos efectivos y empresa autorizada. Custom permissions reemplazan los permisos del rol, según mecanismo existente.

`POST /api/history/reconcile-sowing/prepare`:

```json
{
  "planning_ids": [
    "bc06146e-086e-4a10-8dec-fcaa3d5d71f1",
    "c6a6bea6-345b-44f2-baa8-9d10cd81e255",
    "ab0c87f3-8edf-40b3-b1e4-4eca931734ec",
    "b71d0fad-659e-493b-8127-104b93844983"
  ]
}
```

Prepare usa `stock.transaction` con `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`. La DB rechaza escrituras incluso si un helper intenta introducirlas. No crea permisos, eventos, imports, assignments ni claves de idempotencia. Devuelve `persisted:false`, `can_confirm:true`, `fingerprint` SHA-256 y cuatro `items` con grafo, lote, cultivo, campaña, fecha, área estructural fuente/predicha y evidencia. Errores de precondición devuelven conflicto; no se persiste un preview fallido. `Cache-Control: no-store`.

`POST /api/history/reconcile-sowing/confirm` requiere `Idempotency-Key` y:

```json
{
  "planning_ids": [
    "bc06146e-086e-4a10-8dec-fcaa3d5d71f1",
    "c6a6bea6-345b-44f2-baa8-9d10cd81e255",
    "ab0c87f3-8edf-40b3-b1e4-4eca931734ec",
    "b71d0fad-659e-493b-8127-104b93844983"
  ],
  "fingerprint": "COPIAR_EL_SHA256_DE_PREPARE",
  "confirmed": true
}
```

El texto de fingerprint del ejemplo es un placeholder deliberado: se exige una cadena hexadecimal real de 64 caracteres. Campos adicionales del body son rechazados (400). Confirmación inicial devuelve 201; replay 200. Falta de fingerprint/key/confirmación: 400. Sin permisos/empresa autorizada: 403. Planning inexistente/de otra empresa: 404, sin exponer grafo ajeno. Estado cambiado, T2/T3, superposición o idempotencia incompatible: 409.

## Precondiciones y revalidación

Para cada Planning:

- Empresa autorizada; siembra, completado, enabled=true, crop_id NULL, campaña exacta.
- HISTORICAL_NO_STOCK, historical_import_id presente y perteneciente a empresa. **No convierte NORMAL ni adopta automáticamente**.
- Exactamente una selección del lote autorizado, sub_lot_id NULL. Lote habilitado de esa empresa y lots.area_ha numérica positiva. No fallback a lots.area aproximada ni área operativa de Planning.
- Primer día argentino de start_at coincide con fecha confirmada; end_at compatible. effective_date NULL se conserva; si ya tiene otra fecha, conflicto. Fecha dentro de campaña existente.
- Ningún assignment de origen, aun si es de otro tenant o ya cerrado.
- Ningún ciclo del mismo lote, incluido cualquier sublote, abierto o terminado en/después de inicio confirmado. La ventana propuesta es `[inicio, infinito]`, inclusiva. También bloquea ciclos futuros. Ciclos previos cerrados antes se conservan exactamente.
- Ninguna cosecha de ese lote ni cierre relacionado fechado en/después de la nueva siembra, ni referencias de otro tenant. No deducir cierres/cosechas.
- Grafo de productos/usos/completions leído por source_planning_id, source_planning_product_id y completion; referencias validadas por mecanismos históricos existentes. Usage de otra empresa, vínculo incompatible o selección de uso distinta bloquea.
- Protecciones de modo/procedencia en Planning y ciclos y de auditoría/imports deben estar habilitadas. Esquema requerido completo, sin particiones públicas ni FKs entrantes desde otro esquema; esas variantes requieren revisión explícita.

Confirm toma locks `SHARE ROW EXCLUSIVE` sobre tablas públicas ordinarias en orden estable, luego advisory locks empresa/lote; relee permisos, esquema, estado y grafo. Timeouts: locks 5 segundos, cada sentencia 30 segundos. Fingerprint incluye actor, lista canónica, manifest, esquema/columnas/constraints/triggers/índices y snapshot. Si cambió, rollback y nuevo prepare.

### Guard conservador y límites operativos

Esta primera versión es una **operación ocasional de soporte**, no un proceso masivo: snapshot completo de todas las tablas públicas ordinarias y locks globales evitan filas nuevas/relaciones desconocidas y detectan efectos secundarios también sobre otros tenants. Solo el grafo autorizado se devuelve; los demás datos quedan internos. Una escritura ajena entre prepare y confirm también vence el fingerprint. Requiere una ventana de poca actividad y medir volumen/latencia en staging; no se optimiza eliminando protecciones silenciosamente.

`row_security=off` evita snapshots parcialmente ocultos: PostgreSQL rechaza lecturas si el rol no puede ver todo bajo RLS. El usuario SQL del backend necesita acceso completo de lectura y privilegios de locks/escritura existentes. No otorgar privilegios a usuarios finales. Relaciones externas al esquema público/particiones bloquean; el guard no afirma cubrir efectos externos de red ni escritores de esquemas privados. Revisar definiciones instaladas antes de usar soporte. Las lecturas completas pueden ser costosas en una base grande.

Para **estos cuatro casos whole-lot** no se calcula intersección espacial: cualquier sublote del mismo lote forma parte de la cobertura solicitada y se considera conflicto. No se usan funciones ST ni geometrías simuladas para aprobar un solapamiento. Extender a sublotes/layouts históricos/geometrías entre unidades exige implementación y pruebas PostGIS reales separadas; T2/T3 siguen excluidos.

## Deltas permitidos

1. Planning: únicamente crop_id NULL → Trigo. Se permite updated_at original o timestamp transaccional producido por trigger convencional; todos los otros campos, incluidas start_at/end_at/effective_date/completed_at, quedan exactos.
2. Un assignment nuevo por Planning: empresa/lote/cultivo/campaña fijos, sub_lot_id NULL, inicio confirmado, end_date/cierre NULL, source_planning_id correcto, HISTORICAL_NO_STOCK y **historical_import_id original de Planning**.
3. Área fuente: lots.area_ha actual, validada. Se consulta numeric_scale instalado y presencia del trigger documentado normalize_new_harvest_cycle_area para predecir redondeo; se verifica luego por igualdad numeric en PostgreSQL. Cambios inesperados de área/campos abortan. Se audita tanto texto fuente como **área realmente persistida**, incluida precisión de columna. En esquema numeric(12,2), valores esperados del backup serían 92.65, 64.36, 44.05 y 68.84; no se hardcodean estas áreas.
4. Cuatro eventos nuevos y una constancia de idempotencia por lote de confirmación. No se modifica import original.

No se llama a planningCompletion, consumeStock, reverseStock ni recálculo de cosechas/ciclos. No cambian planning_lots.area_ha/effective_area_ha, productos/cantidades/completions/usages/usage_lots/fechas, stock/movimientos, cosechas/repartos/cierres, eventos/imports anteriores ni ciclos anteriores. Una columna nueva no revisada de assignment bloquea; no se acepta por defecto un delta adicional.

## Auditoría, idempotencia y rollback

Evento append-only con entity_table=planning: before_data conserva la fila original exacta; after_data contiene Planning corregida, assignment completo y reconciliation con operación `reconcile-sowing`, actor/empresa, fecha confirmada, evidencia **“primer día del período confirmado como inicio real de siembra”**, assignment_id, área fuente/persistida, fingerprint y referencia idempotency_import_id. Los grafos completos quedan protegidos por comparación de snapshots; no se reescriben eventos anteriores.

historical_imports conserva un recibo separado source=`reconcile-sowing`, request_hash y payload canónico; ese recibo **no reemplaza la procedencia histórica del ciclo**. Misma empresa/key/payload devuelve resultado original sin duplicar ciclos/eventos. Misma key con IDs, fingerprint o fuente distintos devuelve 409. Orden de IDs no cambia payload. Reintento solo exige permisos actuales; devuelve recibo original antes de requerir que crop_id siga NULL. Otra key para Planning ya reconciliada bloquea por precondición.

JSON de snapshots y filas se produce como texto JSONB en PostgreSQL para preservar numerics/timestamps; los parámetros JSON se vinculan como texto con cast jsonb para evitar doble codificación de postgres.js. Fingerprint no depende de parsear números protegidos en JS. El grafo de preview sí es JSON de presentación.

Toda confirmación, evento y resultado se guarda con stock.transaction. Comparación final exacta de tablas públicas contra la allowlist de deltas, incluyendo efectos AFTER de auditoría/recibo. `SET CONSTRAINTS ALL IMMEDIATE` fuerza triggers diferidos y otra comparación antes de COMMIT. Error, timeout o diferencia revierte **todo el lote**, incluidos eventos/import/key. No se desactiva trigger ni se debilitan historicalMutation/historicalPlanningGuard generales.

## Pruebas

Pruebas en `growsync-backend/tests/reconcileSowing.integration.test.js`, PostgreSQL embebido PGlite descartable, sin .env/Supabase. Fixture usa registros de backup, modo/procedencia históricos sintéticos explícitos y stock no vacío. Usa constraints reales de fixture, migraciones históricas existentes e índices de origen; instala triggers de timestamp capturados. La prueba de redondeo usa trigger sintético de redondeo sin funciones espaciales, marcado como tal: **no prueba equivalencia completa de los triggers PostGIS productivos**.

Cobertura: los cuatro casos; prepare read-only; confirm/cultivo/ciclo/fechas/campaña/procedencia; área estructural independiente de operativa; conservación exacta de tablas protegidas y eventos previos; idempotencia y payload distinto; fingerprint de datos/esquema vencido; origen existente/crop no NULL; superposición whole-lot/sublote/futura; cosecha inesperada; tenant/permisos; T2/T3; integridad de procedencia y fechas; rollback por cambios de inventario/usos/productos/completions/área/Planning/ciclo, fallo en último ciclo, auditoría tardía y trigger diferido; precision numeric(12,4); effective_area_ha; router HTTP real con pool inyectado.

Comando de reconciliación y regresión ejecutado:

```powershell
node --test --test-reporter=spec growsync-backend/tests/reconcileSowing.integration.test.js growsync-backend/tests/historicalCycleCorrection.integration.test.js growsync-backend/tests/historicalAdoption.integration.test.js growsync-backend/tests/historicalNoStock.integration.test.js
```

**Resultado: 82 pruebas, 81 aprobadas, 0 fallos, 1 omitida.** La omitida es la aceptación existente de backup opcional (HISTORICAL_BACKUP_DIR no configurado); los **44 tests nuevos de reconciliación pasaron**. También pasaron controles de sintaxis de servicio/router/history.js. Tests espaciales no se simulan: no hay rama espacial en el nuevo servicio de cuatro lotes completos. Antes de cualquier ampliación espacial, usar PostGIS real; antes de uso productivo, validar schema/triggers/permisos instalados mediante prepare y staging.

## Migraciones y SQL

**No hay migración nueva ni SQL de reparación manual en Supabase.** Se reutilizan tablas/columnas e índices existentes. No se aplicó ninguna migración local a producción. El esquema histórico, procedencia, catálogo y protecciones existentes deben estar ya desplegados: ausencia/incompatibilidad bloquea soporte y requiere revisión, no auto-migración desde endpoint.

Solo desplegar backend con servicio/router nuevos y montaje en history.js; no hay cambios frontend ni configuración de credenciales nueva. No iniciar servidor ni registrar operaciones automáticamente durante deploy.

## Pasos posteriores para ejecutar únicamente prepare en producción

1. Revisar cambios y resultados; desplegar backend por procedimiento habitual. Comprobar autenticación/empresa y esquema en staging, especialmente permisos SQL y costo de snapshot global.
2. Iniciar sesión como Admin de Don Santiago con planning.edit e history.import. Usar la URL real del backend desplegado y un access token de esa sesión; no incluir IDs de empresa/actor en body.
3. Enviar **solo** el siguiente request. Esta documentación no lo ejecuta:

```http
POST /api/history/reconcile-sowing/prepare HTTP/1.1
Host: <host-real-del-backend>
Authorization: Bearer <access-token-de-Admin-Don-Santiago>
Content-Type: application/json

{
  "planning_ids": [
    "bc06146e-086e-4a10-8dec-fcaa3d5d71f1",
    "c6a6bea6-345b-44f2-baa8-9d10cd81e255",
    "ab0c87f3-8edf-40b3-b1e4-4eca931734ec",
    "b71d0fad-659e-493b-8127-104b93844983"
  ]
}
```

4. Revisar 200, persisted=false, can_confirm=true y cuatro items. Verificar IDs, fechas, campaña, origen histórico y áreas estructurales fuente/predichas. Guardar respuesta/fingerprint sin credenciales. Un 409 requiere investigar el bloqueo; no cambiar datos para forzarlo.
5. **Detenerse en prepare. No ejecutar confirm en producción en esta tarea.** El fingerprint vence ante cambios de datos/esquema; una futura ejecución autorizada de confirm requerirá prepare reciente, review de sus resultados y clave estable. Ningún ejemplo de confirm constituye autorización de ejecución.

## Archivos

- Nuevo: `growsync-backend/services/reconcileSowing.js`.
- Nuevo: `growsync-backend/routes/reconcileSowing.js`.
- Modificado: `growsync-backend/routes/history.js`, montaje del router.
- Nuevo: `growsync-backend/tests/reconcileSowing.integration.test.js`.
- Actualizado: `docs/productive-state-reconciliation.md`, fechas confirmadas/estado del soporte.
- Nuevo: `docs/reconcile-sowing-implementation.md`, este documento.

