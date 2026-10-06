# Reconciliación del estado productivo — Don Santiago SRL

Referencia: **06/10/2026**, Argentina. Empresa `2791ea15-7dad-48e2-945b-3791e2d44478`.

## Actualización: cuatro Trigos reconciliados y declaraciones implementadas

La fuente operativa confirmó que el primer día del período fue el inicio real de siembra: 13-15 **23/05/2026**, Lote 12 **26/05/2026**, Lote 1 **29/05/2026**, T1 **01/06/2026**. Ya no falta ese dato para estos cuatro casos. `effective_date` histórica se conserva, incluso si sigue NULL: la fecha confirmada se usa exclusivamente como inicio del nuevo ciclo.

Según confirmación del usuario, **13-15, 12, 1 y T1 ya fueron reconciliados exitosamente en producción mediante reconcile-sowing**: Trigo desde 23/05/2026, 26/05/2026, 29/05/2026 y 01/06/2026, respectivamente. **Stock unchanged; 0 movimientos creados.** Esta tarea no consultó producción para repetir esa comprobación ni ejecutó endpoints productivos. Soporte limitado a los cuatro IDs de Trigo y campaña confirmados. T2 y T3 excluidos explícitamente. Ver [reconcile-sowing-implementation.md](reconcile-sowing-implementation.md) para contrato, límites y ejecución posterior de prepare.

Implementado localmente el modelo multiempresa de declaraciones y resolver único de lectura. T2-A puede representarse como Trigo y T2-B como Rastrojo de Soja observados el 06/10/2026, con conflicto explícito frente a Soja whole-lot abierta. **No se insertaron esas declaraciones reales**, no se modificó Soja ni la Planning Trigo de T2, y no se reparó T3, canal ni Alfalfa. Ver [productive-state-declarations.md](productive-state-declarations.md).

## Alcance y evidencia

Diagnóstico y diseño, sin cambios de datos. **No se consultó ni escribió Supabase producción, no se aplicaron migraciones, sin commit ni staging.** La lista operativa confirmada por el usuario es la verdad vigente; el historial no la sustituye silenciosamente.

Se revisaron código, migraciones, documentos y backup en `C:\Proyectos\Tesis`. Fuente histórica: `audit/don-santiago-pre-reset/20260916T175923749Z/data/`. El backup del 16/09 **no es una captura del 06/10**. Los archivos SQL no prueban qué migraciones están instaladas. Las consultas propuestas deben ejecutarse posteriormente con acceso read-only; sus resultados condicionan toda reparación. No se ejecutaron scripts de reparación existentes ni se leyeron credenciales.

## Arquitectura

| Componente revisado | Comportamiento y consecuencia |
|---|---|
| planning / planning_lots | Planning conserva período, tipo, estado, cultivo, campaña, fecha efectiva y procedencia. planning_lots.area_ha es **área operativa histórica**, no superficie del ciclo. |
| planning_products / planning_product_completions | Cantidades planificadas y realizadas; completions vinculan usos. La ausencia de una completion no autoriza a reconstruir consumo. |
| usage_records / usage_lots | Revisar vínculos por source_planning_id, source_planning_product_id y completion. crop_id/current_crop son snapshots históricos, no estado vigente. |
| crop_assignments | Cultivo/campaña/lote/fecha inicial/área obligatorios; fin nullable. source_planning_id expresa origen. Índices únicos parciales por origen y superficie no reemplazan control espacial/temporal. |
| harvest_records / harvest_crop_assignments | Cosecha y reparto por ciclo; una cosecha no implica cierre completo. Verificar área acumulada, enabled y procedencia de cierre. |
| harvest_cycle_closures / services/harvestCycles.js | Finalización explícita con motivo y balance. Recálculo automático respeta cierres manuales/legacy e históricos; reabrir exige control de conflictos. |
| services/planningCompletion.js | Completar puede crear usos/completions, consumir stock y cerrar ciclos anteriores. La siembra histórica también ajusta ventanas. Inserta área de selección operativa. **No llamar para reparar Planning ya completada.** |
| services/historicalMutation.js | Corrección auditada sin servicios de stock/ciclos. Whitelist Planning: título, descripción, fechas, responsable, productos y lot_selections. **No admite crop_id/campaign_id ni crear assignments.** Con ciclos bloquea cambio de fechas y selección; permite área operativa en idénticos pares lote/sublote. Sin ciclos reconstruye selecciones y usage_lots por source_planning_id. |
| services/historicalPlanningGuard.js | Locks, permisos y comparación de inventario/estructura antes y después. Su guard actual impide cualquier cambio de ciclos; requiere variante acotada para reconciliación, sin debilitar PATCH general. Ampliar planningGraph para vínculos indirectos y usage_lots. |
| historical adoption | `/api/history/adopt-existing/prepare` y `/confirm`, Admin + planning.edit + history.import, tenant/actor de sesión, idempotencia. Solo convierte modo/procedencia de registros existentes; no crea relaciones ni completa cultivo NULL. Versiones locales 04–06/10 amplían diagnóstico/cosechas; despliegue pendiente de verificar. |
| controllers/lots/productiveState.js | Unidades de layout activo/sublotes habilitados. Assignment whole-lot puede aparecer en todos los sublotes. Rango inclusivo; LIMIT 1 puede ocultar conflictos. previous_crops calcula intersecciones sin exigir cosecha: **no equivale a rastrojo**. Fecha omitida usa CURRENT_DATE de DB. |

### Integridad y triggers

Revisar instalados: migraciones de campañas/ciclos/origen del 30/08, relajación de calendario del 31/08, cosechas parciales/precisión del 08/09, historial sin stock del 16/09 y adopción del 04–06/10.

- FKs individuales no prueban pertenencia multiempresa ni sublote al lote: validar ambas en servicio y DB. Fechas ordenadas, área positiva y unicidad del origen siguen obligatorias.
- `normalize_new_harvest_cycle_area` toma advisory lock empresa/lote, redondea área nueva/cambiada a 2 decimales y bloquea nuevas superposiciones con ciclos cosechados. No garantiza por sí solo ausencia de superposición con ciclos sin cosecha.
- `protect_harvest_cycle_structure` protege estructura de ciclos cosechados y cierres; harvest_closure_source distingue automatic/manual/legacy. No usar flags de sesión como autorización administrativa.
- Modos/procedencias son inmutables salvo adopción con permisos privados de transacción/fila. historical_events/imports son protegidos contra modificación/borrado.
- Comparar filas persistidas después de triggers BEFORE/AFTER y de escribir auditoría; cualquier efecto no autorizado revierte la transacción. No desactivar triggers.
- El calendario de campañas fue relajado por migración posterior; no asumir que la exclusión original sigue instalada ni inventar otra campaña por el año de siembra.

## Diagnóstico por superficie

A = reparación segura demostrada; B = dato faltante; C = historial compatible, falta representar rastrojo; D = conflicto histórico. C es provisional hasta verificar esquema/grafo actual, cierre y cobertura. Ninguna clase autoriza escritura.

| Superficie | Verdad vigente | Clasificación con evidencia disponible | Diagnóstico / acción |
|---|---|---|---|
| T1 | Trigo | A ejecutada, confirmada por usuario | Reconciliado en producción mediante reconcile-sowing. Backup previo conservado como evidencia histórica, no estado vigente. |
| 13-15 | Trigo | A ejecutada, confirmada por usuario | Reconciliado en producción mediante reconcile-sowing. Backup previo conservado como evidencia histórica, no estado vigente. |
| 12 | Trigo | A ejecutada, confirmada por usuario | Reconciliado en producción mediante reconcile-sowing. Backup previo conservado como evidencia histórica, no estado vigente. |
| 1 | Trigo | A ejecutada, confirmada por usuario | Reconciliado en producción mediante reconcile-sowing. Backup previo conservado como evidencia histórica, no estado vigente. |
| T2-A | Trigo | D + B | Soja abierta whole-lot invade ambas unidades. No abrir Trigo hasta resolver integridad y fecha. |
| T3 | Cebada | D + B | Siembra asociada a T4; confirmar grafo, fecha y superficie histórica. |
| 16 | Alfalfa | B | Implantación sin fecha conocida. Declarar estado sin ciclo ficticio. |
| 2 | Rastrojo Maíz | C con revisión puntual | Backup tiene dos ciclos Maíz consecutivos, uno de un día sin origen y con cosecha. Revisar ese antecedente; no afirmar historial íntegro correcto. |
| T4 | Rastrojo Maíz | D, luego C | Maíz cerrado 07/08 compatible; la Planning Cebada errónea contradice esa superficie. |
| 3-4-A | Rastrojo Maíz | C | Maíz cerrado 11/09 con cosecha en backup. |
| 5-6-7 completo | Rastrojo Maíz | C | Maíz cerrado 28/07 con cosecha; distinguir lote completo, 5-6-7 y bajo. |
| 8-11 | Rastrojo Maíz | C | Maíz cerrado 03/08 con cosecha; verificar layout/cobertura. |
| Santos | Rastrojo Maíz | B | No ciclo/cosecha para su ID en backup. Declarar estado, no fabricar antecedente. |
| T2-B | Rastrojo Soja | D + B | Soja whole-lot abierta contradice estado; cierre no demostrado. |
| 8-11 canal | Rastrojo Soja | D + B | Sorgo cerrado 02/07 con cosecha; preservar Sorgo, declarar discrepancia actual. |
| 3-4-B | Rastrojo Sorgo | C | Sorgo cerrado 30/06 con cosecha. |
| 8-11 porton | Rastrojo Sorgo | C | Sorgo cerrado 02/07 con cosecha. |

Son **17 superficies** confirmadas. No asignar estados a otras unidades por similitud de nombres. Backup contiene dos lotes T3; el autorizado es `21bdf5bf-fef2-419d-814d-22a508134ac0`, no `ad200c71-dfe0-4d48-aca9-78d231a168eb`.

## Cuatro siembras Trigo sin conflicto T2

Cultivo `2f9aabe7-d74d-400c-92c7-8b2b4f8fed8f`. Backup: campaña existente `42894d7b-337a-4833-8995-f35a36b42104` (Fina), dos productos, dos completions y dos usos por cada Planning. Conservar IDs, cantidades, unidades y fechas.

| Superficie | Planning | Período confirmado | Lote ID | Estructura backup ha |
|---|---|---|---|---|
| 13-15 | bc06146e-086e-4a10-8dec-fcaa3d5d71f1 | 23–25/05/2026 | 81e0ba67-b201-4bb6-ac01-09b26f6635aa | 92.6495 |
| 12 | c6a6bea6-345b-44f2-baa8-9d10cd81e255 | 26–29/05/2026 | b3e6227c-65cc-45ff-9174-19f432cf5a3a | 64.3593 |
| 1 | ab0c87f3-8edf-40b3-b1e4-4eca931734ec | 29–30/05/2026 | a21d67cd-667d-4c17-bbc6-db7f4b20b617 | 44.0532 |
| T1 | b71d0fad-659e-493b-8127-104b93844983 | 01–02/06/2026 | a7df5a3f-9b62-4347-b576-be736896470d | 68.8447 |

**La fecha inicial de los cuatro ciclos fue confirmada explícitamente por la fuente operativa.** effective_date/completed_at son NULL en backup y deben conservarse; esa ausencia ya no bloquea estos cuatro casos porque existe confirmación externa del inicio real. No se dedujo fecha desde usos ni desde el fallback de adopción. La ejecución de estos cuatro casos ya fue confirmada como exitosa por el usuario. El contrato mantiene las precondiciones para cualquier operación futura, sin adopción automática.

Assignment debe tomar estructura vigente y cobertura documentada, conservando planning_lots.area_ha. Bajo trigger actual, si estructura coincide, valores nuevos serían 92.65/64.36/44.05/68.84; auditar área fuente y persistida. Para Lote 12 whole-lot puede representar cobertura completa aun subdividido, pero validar geometría y conflictos; no dividir la Planning ni inventar reparto de usos.

### Diseño de referencia e implementación específica

Implementados localmente `POST /api/history/reconcile-sowing/prepare` y `/confirm` para los cuatro casos confirmados. El contrato concreto está en el documento de implementación. Las siguientes reglas conservan el diseño de referencia; la versión actual exige que cada Planning ya sea HISTORICAL_NO_STOCK con procedencia, sin convertir NORMAL.

1. Admin habilitado + planning.edit + history.import, permisos efectivos, empresa/actor de sesión. Manifest explícito de IDs, fecha y evidencia, cultivo, selección estructural y motivo.
2. Prepare solo SELECT: grafo por todas las rutas, bloqueos, deltas y fingerprint canónico de filas/relaciones/esquema relevante. Sin auditoría persistida.
3. Confirm exige fingerprint e Idempotency-Key; clave igual/payload distinto = 409. Revalidar bajo locks del guard, incluyendo lot_layouts y auditoría, más advisory locks por empresa/lote; orden estable, timeouts 5s/30s. Cambio concurrente = abortar.
4. Precondiciones: enabled/completado/siembra, crop NULL esperado, modo/procedencia exactos, selección igual al manifest, campaña existente y fecha válida, estructura/cobertura exactas, ninguna asignación de origen ni superposición con **cualquier** ciclo; cosechas/cierres inesperados bloquean. No cerrar ciclos anteriores automáticamente.
5. Si NORMAL, evaluar adopción existente por separado; solo si cumple corte/grafo/ausencia de movimientos. No neutralizar movimientos para habilitar adopción. Si no es adoptable, bloquear y diseñar corrección administrativa NORMAL separada. No convertir modo/procedencia informalmente.
6. Delta permitido: planning.crop_id NULL → Trigo, assignment(s) acordados con source_planning_id, campaña existente, fecha probada, área estructural, fin/cierre NULL, HISTORICAL_NO_STOCK y procedencia consistente. No duplicar Planning ni reimportar siembra. No actualizar snapshots NULL de usage_records: mostrar asociación vía Planning corregida.
7. Evento append-only por Planning con before/after completo, IDs nuevos, área fuente/persistida, evidencia de fecha/cultivo, motivo, actor/empresa, manifest y fingerprint. Evento e idempotencia en la misma transacción; eventos anteriores intactos.
8. Comparar después de todos los triggers y auditoría: inventario/balances/notificaciones, productos/completions/usages/usage_lots/planning_lots, cosechas/cierres, catálogos y ciclos ajenos idénticos. Allowlist solo para delta autorizado y timestamps previstos. Diferencia = rollback completo. Variante del guard específica, sin debilitar PATCH general.

**No se prepara SQL de reparación manual**: las fechas de los cuatro Trigos están confirmadas; el estado vivo se verificará mediante prepare después del deploy. No usar INSERT/UPDATE aislados que salteen el contrato.

## T2 sin fabricar cierre Soja

Assignment `8b0241db-9ece-4ef4-86cc-1d86f81b2f88`, origen `fe4b75d4-84eb-4f4b-814e-3d06653e572e`, inicio 05/12/2025, fin NULL, lote `f992c02e-dd31-4d52-8d49-38fccc9b9d24`. Backup: área operativa 70.9676, ciclo 70.97.

Trigo origen `74842b24-19cd-4f88-bf4b-3f43dedd7837`, período 25–26/05/2026, **41.1 ha operativas confirmadas**, distintas de 70.9676 del backup: no restaurar el valor antiguo. A `c92a023d-226e-41b8-a37d-720b16d15dd9`, estructura 41.0802 (nuevo ciclo esperado 41.08 si precisión instalada coincide). B en backup `de3c01bd-023a-42de-aa6c-f6019979e1ff`; verificar layout actual.

No usar 24/05 como cierre deducido, ni 06/10, ni cosecha ficticia. No reducir Soja a B sin demostrar cobertura histórica. No crear Trigo aunque UI pudiera priorizar A y ocultar el whole-lot.

- Si aparece cosecha/finalización real con fecha y cobertura probadas, corregir cierre y grafo mediante mecanismo histórico integral; luego validar Trigo.
- Si se demuestra atribución errónea del assignment, preparar corrección/retractación administrativa auditada: **no es cierre agronómico** y conserva fila/evidencia. Requiere soporte de vigencia/retractación en todos los lectores, validators, cosechas y completado; no basta ignorarlo en productiveState. Revisar referencias y evidencia antes de invalidar. No asumir que toda la siembra Soja fue falsa.
- Si solo se conoce estado vigente, declarar A Trigo/B rastrojo Soja con conflicto visible; **seguir bloqueando nuevo ciclo Trigo**. La declaración no resuelve integridad histórica.

## T3/Cebada y T4

Planning `c843269e-50a5-4ea5-b63d-4c5587e5b48d`, 04–06/06/2026. Backup: crop NULL, campaña Fina, selección T4 `12aad78a-66de-4b08-9b07-f841c072f703`, whole-lot, **68.713 ha históricas**; producto de Planning `44dc1aa7-28bd-41d7-92e5-c72f5e4c6c91`, catálogo `7a17bc98-87ec-47b4-a6cf-971bf229a653`, **2391 kg**. Ningún uso/completion/ciclo de origen en backup; ausencia actual no demostrada.

T3 autorizado `21bdf5bf-fef2-419d-814d-22a508134ac0`, estructura 46.0932; Cebada `fb5158a3-7c70-4f56-bf31-8de684037e45`. Soja T3 previa cerrada 01/05 con cosecha. Maíz T4 cerrado 07/08: Cebada desde junio allí sería contradictoria. Actividad T3/Cebada del 28/08 confirmada por usuario; no se identificó fila de esa fecha en backup examinado.

Cambios a preparar, **sin ejecutar**:

1. Confirmar identidad/alcance real de siembra; planning_lots.lot_id T4 → T3, sublote solo según cobertura probada. **Conservar 68.713**, no reemplazar por 46.0932. Si área histórica también es errónea, obtener dato separado; diferencia es alerta, no licencia para igualar.
2. planning.crop_id → Cebada por contrato nuevo; campaña/período/responsables/productos/2391 kg intactos salvo error confirmado aparte. Verificar producto, no inferir cultivo por insumo.
3. Inspeccionar usos por las tres rutas y usage_lots. Solo trasladar vínculos exclusivos que reflejan error T4; mantener IDs/cantidades/unidades/fechas/total_area. Usos compartidos o ambiguos bloquean. Mantener completions y referencias; no crear faltantes.
4. Si hay assignment/cosechas/repartos/cierres actuales, diseñar corrección integral específica; no mover Planning sola ni violar estructuras protegidas. Histórico previo se conserva, evento nuevo explica corrección.
5. Inspeccionar todas las FKs entrantes y relaciones adicionales, attachments/vehículos/responsables si existen. Vínculo desconocido bloquea confirmación hasta análisis.
6. Crear/vincular ciclo T3 después de fecha efectiva demostrada, cobertura/campaña válidas y cero conflictos. Área estructural T3, 46.09 bajo trigger actual. Nunca área histórica de T4 copiada al ciclo T3.

PATCH histórico sin ciclos admite lot_selections pero reconstruye usos por source_planning_id y no corrige crop_id: insuficiente para garantizar operación integral. Preferir nuevo preview/confirm transaccional acotado.

## Alfalfa y canal

Lote 16: declaración `growing_crop / Alfalfa`, observada 06/10/2026, inicio agronómico desconocido. Sin Planning/campaign/assignment ficticios. Observación es fecha de conocimiento, no implantación.

8-11 canal: conservar Sorgo y su cosecha/cierre; declarar `stubble / Soja` observado 06/10 con discrepancia abierta. Investigar ciclo omitido, identidad/cobertura o dato erróneo. No renombrar Sorgo ni fabricar siembra/cosecha Soja.

## Modelo recomendado: derivación y declaraciones no derivables

**Un único resolver**, compartido por API/UI/validaciones. Ciclos/cosechas son hechos agronómicos; almacenar solo declaraciones cuando estado no sea derivable o una confirmación vigente contradiga historial. Evitar tabla editable de estado actual que copie cada transición y pueda desincronizarse.

Nueva tabla append-only `productive_state_declarations`: id, company_id, lot_id, sub_lot_id/layout_id, kind (`growing_crop`, `stubble`, `fallow`, `unknown`), crop_id nullable, observed_on, recorded_at, actor_id, source/evidence, reason, supersedes_id, referencia a discrepancia y cobertura versionada. observed_on **no es siembra/cosecha**. growing_crop/stubble requieren crop; fallow/unknown no representan cultivo activo. FKs/RLS/permisos por empresa y relación lote/layout; idempotencia y auditoría. Sin campaña ni superficie operativa inventadas. Versionar cobertura para que cambios de layout no propaguen estados silenciosamente.

Reglas:

1. Siembra realizada con ciclo válido abre implantado. Cosecha parcial mantiene cultivo y avance. Cierre completo respaldado por cosecha produce rastrojo del cultivo desde después del último día activo (rango actual inclusivo). Pérdida/no cosechado/end_date legacy sin soporte no prueba rastrojo: unknown o declaración.
2. Nueva siembra válida sustituye rastrojo/estado manual previo sobre su cobertura. Reconciliación no infiere cierre previo. En flujo normal, cierre al día previo requiere causa explícita y no demuestra cosecha.
3. Declaración posterior a evidencia aplicable determina estado confirmado; si contradice ciclo abierto, mostrar declaración + conflict, sin modificar ciclo. No permitir que lectura vuelva a imponer antecedente viejo.
4. Hechos reales posteriores a observación sustituyen declaración; importación tardía de hechos anteriores no vence por recorded_at. Corrección/retractación explícita, empates incompatibles bloqueados. Nueva división requiere transferencia espacial probada o revisión.
5. Ausencia de assignment = desconocido, no barbecho. Barbecho requiere declaración/evidencia de manejo; si debe coexistir con residuo, atributo de manejo separado sin perder cultivo del rastrojo.

API: state.kind, cultivo/residuo, source derived/declaration, observed_on o fecha real del hecho, evidence_ids, conflict/quality; mantener current_crop/previous_crops durante transición. Implantado declarado sin assignment se muestra con inicio desconocido.

### Cambios futuros concretos

- Declaraciones y, solo si la solución T2 lo exige, retractación administrativa general; no ignorar ciclos solo en un endpoint.
- Variante acotada de historicalPlanningGuard y grafo completo; nuevo servicio/rutas reconcile-sowing. No ampliar whitelist genérica sin validación integral.
- planningCompletion: separar área estructural de operativa/effective_area_ha y causa de transición. harvestCycles/harvestRegistration: evidencia explícita de cierre sin reinterpretar cantidades.
- productiveState: resolver compartido, todas las evidencias/conflictos sin LIMIT 1 silencioso. GET `/productive-states` y `/:lotId/productive-state` en routes/lot.js; verificar prefijo de montaje. Prepare/confirm de declaraciones implementados localmente; pendientes de desplegar, sin declaraciones reales insertadas.
- Frontend de lotes/Planning: rastrojo, implantado con fecha desconocida, unknown y conflictos; no generar ciclos/consumos desde declaración.
- historical_events/imports: auditoría/idempotencia reutilizadas con procedencia de reconciliación, sin editar eventos previos ni duplicar estado derivado.

## Fases

1. Captura read-only consistente del esquema/grafo vigente; verificar migraciones y permisos, comparar IDs y manifest.
2. Fechas de los cuatro Trigos completadas por confirmación operativa; siguen pendientes fecha Cebada, cierre/alcance T2, superficie histórica T3 y antecedentes canal/Santos.
3. Implementar resolver/declaraciones/corrección en bases descartables; migraciones de esquema separadas, sin reparación de datos al instalar.
4. Revisar/desplegar por proceso habitual en una tarea futura; comprobar compatibilidad de todos los lectores/escritores y triggers reales.
5. Declarar estados no derivables con discrepancias visibles; ejecutar A solo tras precondiciones. T2/T3 independientes, sin lote masivo que mezcle bloqueos.
6. Verificación posterior read-only: 17 estados coinciden, historia intacta, stock/usos/cantidades sin delta. Reversión por eventos compensatorios auditados, nunca borrar historia.

## Consultas read-only propuestas

Usar conexión con rol SELECT; **no ejecutadas en producción**. Inspeccionar columnas antes de extender. Prepare HTTP solo si versión desplegada garantiza lectura sin persistencia.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SELECT table_name,column_name,data_type,numeric_precision,numeric_scale
FROM information_schema.columns WHERE table_schema='public'
AND table_name IN ('planning','planning_lots','crop_assignments','harvest_records',
 'harvest_crop_assignments','harvest_cycle_closures','historical_events');
SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid),pg_get_functiondef(t.tgfoid)
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal
AND c.relname IN ('planning','crop_assignments','harvest_records','usage_records',
 'stock_movements','historical_events','historical_imports');
SELECT conrelid::regclass,confrelid::regclass,conname,pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid IN ('planning'::regclass,'crop_assignments'::regclass,
 'planning_lots'::regclass,'harvest_records'::regclass)
OR confrelid IN ('planning'::regclass,'crop_assignments'::regclass,
 'planning_products'::regclass,'usage_records'::regclass,'lots'::regclass);
SELECT l.id,l.name,l.enabled,l.area_ha,ll.id AS layout_id,ll.status,
 sl.id AS sub_lot_id,sl.name AS sub_name,sl.enabled AS sub_enabled,sl.area_ha AS sub_area
FROM lots l LEFT JOIN lot_layouts ll ON ll.lot_id=l.id AND ll.company_id=l.company_id
LEFT JOIN sub_lots sl ON sl.layout_id=ll.id AND sl.company_id=l.company_id
WHERE l.company_id='2791ea15-7dad-48e2-945b-3791e2d44478';
WITH targets AS (
 SELECT * FROM planning WHERE company_id='2791ea15-7dad-48e2-945b-3791e2d44478'
 AND id IN ('bc06146e-086e-4a10-8dec-fcaa3d5d71f1',
 '74842b24-19cd-4f88-bf4b-3f43dedd7837','c6a6bea6-345b-44f2-baa8-9d10cd81e255',
 'ab0c87f3-8edf-40b3-b1e4-4eca931734ec','b71d0fad-659e-493b-8127-104b93844983',
 'c843269e-50a5-4ea5-b63d-4c5587e5b48d','fe4b75d4-84eb-4f4b-814e-3d06653e572e')
)
SELECT to_jsonb(p) AS planning,
 (SELECT jsonb_agg(to_jsonb(x)) FROM planning_lots x WHERE x.planning_id=p.id) AS lots,
 (SELECT jsonb_agg(to_jsonb(x)) FROM planning_products x WHERE x.planning_id=p.id) AS products,
 (SELECT jsonb_agg(to_jsonb(x)) FROM planning_product_completions x WHERE x.planning_id=p.id) AS completions,
 (SELECT jsonb_agg(to_jsonb(u)||jsonb_build_object('lots',
  (SELECT jsonb_agg(to_jsonb(ul)) FROM usage_lots ul WHERE ul.usage_id=u.id)))
  FROM usage_records u WHERE u.company_id=p.company_id AND
  (u.source_planning_id=p.id OR u.source_planning_product_id IN
  (SELECT id FROM planning_products WHERE planning_id=p.id) OR u.id IN
  (SELECT usage_id FROM planning_product_completions WHERE planning_id=p.id))) AS usages,
 (SELECT jsonb_agg(to_jsonb(x)) FROM crop_assignments x
  WHERE x.company_id=p.company_id AND x.source_planning_id=p.id) AS assignments,
 (SELECT jsonb_agg(to_jsonb(x)) FROM historical_events x
  WHERE x.company_id=p.company_id AND x.entity_id=p.id) AS events
FROM targets p;
SELECT to_jsonb(ca) AS cycle,
 (SELECT jsonb_agg(to_jsonb(hca)||jsonb_build_object('harvest',to_jsonb(hr)))
 FROM harvest_crop_assignments hca JOIN harvest_records hr ON hr.id=hca.harvest_id
 WHERE hca.crop_assignment_id=ca.id AND hr.company_id=ca.company_id) AS harvests,
 (SELECT jsonb_agg(to_jsonb(x)) FROM harvest_cycle_closures x
 WHERE x.crop_assignment_id=ca.id AND x.company_id=ca.company_id) AS closures
FROM crop_assignments ca WHERE ca.company_id='2791ea15-7dad-48e2-945b-3791e2d44478';
SELECT p.*,pl.lot_id,pl.sub_lot_id,pl.area_ha FROM planning p
JOIN planning_lots pl ON pl.planning_id=p.id
WHERE p.company_id='2791ea15-7dad-48e2-945b-3791e2d44478'
AND pl.lot_id='21bdf5bf-fef2-419d-814d-22a508134ac0'
AND ((p.start_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date='2026-08-28'
 OR p.effective_date='2026-08-28');
WITH surfaces AS (
 SELECT ca.*,COALESCE(sl.geom,l.geom) AS surface_geom FROM crop_assignments ca
 JOIN lots l ON l.id=ca.lot_id AND l.company_id=ca.company_id
 LEFT JOIN sub_lots sl ON sl.id=ca.sub_lot_id AND sl.company_id=ca.company_id
 WHERE ca.company_id='2791ea15-7dad-48e2-945b-3791e2d44478'
)
SELECT a.id,b.id,a.lot_id,a.sub_lot_id,b.sub_lot_id FROM surfaces a
JOIN surfaces b ON a.id<b.id AND a.lot_id=b.lot_id
AND daterange(a.start_date,COALESCE(a.end_date,'infinity'::date),'[]')
 && daterange(b.start_date,COALESCE(b.end_date,'infinity'::date),'[]')
WHERE a.sub_lot_id IS NULL OR b.sub_lot_id IS NULL OR a.sub_lot_id=b.sub_lot_id
OR ST_Area(ST_CollectionExtract(ST_Intersection(
 ST_CollectionExtract(ST_MakeValid(a.surface_geom),3),
 ST_CollectionExtract(ST_MakeValid(b.surface_geom),3)),3)::geography)>1;
ROLLBACK;
```

En prepare comparar además ventana **propuesta** con todos los ciclos. Geometría NULL/inválida o pertenencia ajena bloquea, no significa cero solapamiento. Consultar cosechas sin vínculo, eventos por IDs de usos/ciclos/cosechas, imports y tablas entrantes descubiertas. Revisar movimientos por usage_id, operation_id y clave planning-product según esquema instalado; no concluir stock ausente por falta de un enlace.

Para probar invariancia, guardar snapshots completos ordenados antes/después de productos legacy, partidas/movimientos/balances/notificaciones, Planning y relaciones, usos, cosechas/repartos/cierres, ciclos ajenos y eventos previos. Counts/sumas solos no detectan cambios compensados; lecturas fuera de snapshot consistente tampoco prueban seguridad transaccional.

## Pruebas necesarias

- Bases descartables con captura anonimizada vigente; cuatro Trigo/usos/completions, T2 whole-lot, T3/T4, Alfalfa sin fecha, canal Sorgo/Soja, nombres duplicados y layouts cambiados.
- Inicio sin evidencia confirmada aborta sin fallback al período; los cuatro Trigos ya tienen confirmación operativa explícita y effective_date histórica NULL se conserva. Campaña/tenant/IDs/modo/evidencia incompatibles abortan sin auditoría parcial.
- Área estructural independiente de operativa (41.1 vs 41.0802, 68.713 vs 46.0932); redondeo real y cantidades/usos intactos.
- Idempotencia, payload diferente, fingerprint obsoleto, concurrencia siembra/cosecha/layout, timeouts y rollback ante triggers adversarios incluso posteriores a auditoría.
- T2 bloquea nuevo Trigo mientras conflicto vigente; ningún cierre inferido. Retractación, si se implementa, afecta todos los validadores sin borrar referencias/eventos.
- T3 solo traslada enlaces probados; usos indirectos/compartidos, cosechas y vínculos desconocidos bloquean; productos/completions intactos.
- Parcial mantiene implantado; cierre completo respaldado produce rastrojo; legacy/pérdida no. Nueva siembra sustituye estado sobre cobertura correcta.
- Declaraciones sin fecha agronómica, conflicto visible, importación tardía anterior, supersesión/retractación y cambio de layout; unknown distinto de barbecho.
- Admin/permisos efectivos, RLS y aislamiento multiempresa; usuarios ajenos no obtienen grafo ni confirman.
- PostGIS real y triggers vivos en staging: PGlite con geometría textual no prueba seguridad espacial.
- API/UI presentan los 17 estados, fechas desconocidas y discrepancias sin ciclos ficticios; stock y auditoría previa iguales al final.

El diagnóstico inicial fue documental. La implementación posterior agrega pruebas de reconciliación y regresión en bases descartables; resultados y límites están en reconcile-sowing-implementation.md. No se hicieron consultas productivas.

## Decisión

Las cuatro siembras Trigo cuentan con fecha de inicio confirmada y servicio local de corrección sin recompletar ni tocar usos/stock; **la reconciliación de estos cuatro casos ya fue ejecutada exitosamente en producción según confirmación del usuario, con stock intacto y cero movimientos**. T2/T3 requieren revisión integral; Alfalfa/Santos se pueden representar por declaración de estado; canal conserva Sorgo y expone Soja vigente con discrepancia. Rastrojos compatibles se derivan solo con cierre respaldado y cobertura probada.

Recomendación: hechos productivos + declaraciones auditadas no derivables, con un resolver único. Sin tabla duplicada editable de estado actual ni ciclos falsos. Despliegues y modificaciones de datos quedan fuera de esta tarea.
