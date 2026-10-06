# Declaraciones auditadas de estado productivo

Implementación local en `C:\Proyectos\Tesis`, sin commit/staging. **No se conectó a Supabase, no se aplicó la migración a producción, no se insertaron declaraciones reales ni se ejecutaron endpoints productivos.** T2, T3, canal, Alfalfa e inventario reales permanecen sin modificaciones por esta tarea.

## Hechos y declaraciones

Un crop_assignment expresa un hecho productivo con fecha inicial; harvest_records, sus repartos y cierres expresan cosecha/finalización según el modelo existente. Una declaración expresa un estado **observado**, sin crear ni reparar esos hechos.

`observed_on` es fecha de observación/confirmación. `recorded_at` es fecha de registro técnico. Ninguna es siembra, cosecha ni cierre. Declarar Trigo implantado con observación 06/10 no afirma que se sembró ese día. Declarar rastrojo Soja no fabrica la cosecha faltante.

## Migración y garantías DB

Archivo autoritativo con **SQL completo**: [20261006_productive_state_declarations.sql](../growsync-backend/migrations/20261006_productive_state_declarations.sql). Instala solo esquema; no contiene datos de Don Santiago.

Tabla `productive_state_declarations`: id, company_id, lot_id, sub_lot_id, layout_id, kind, crop_id, observed_on, recorded_at, actor_id, source, evidence, reason, supersedes_id y coverage JSONB. No agrega enabled ni fecha de siembra. recorded_at cumple la función de created_at; no se duplica ese timestamp.

- PK UUID y FKs individuales a companies/lots/sub_lots/lot_layouts/crops/users y declaración anterior. No se suponen claves compuestas ausentes del esquema.
- CHECK de tipos: growing_crop/stubble requieren cultivo; fallow/unknown lo rechazan. CHECK de textos no vacíos, self-supersession y sublote con layout obligatorio.
- Índice por empresa/lote/unidad/observación e índice único parcial en supersedes_id para impedir bifurcación.
- RLS habilitado, sin políticas abiertas a clientes. Backend administrativo usa el rol SQL autorizado existente; permisos de UPDATE/DELETE/TRUNCATE revocados a PUBLIC/anon/authenticated/service_role.
- `validate_productive_declaration` + trigger BEFORE INSERT: actor/lote habilitados y cultivo existente de empresa coherente; layout activo exacto; sublote pertenece al lote/layout/empresa. Se toman locks de lectura y advisory lock empresa/lote. Construye/verifica snapshot de cobertura (IDs, geometría y área estructural).
- `protect_productive_declaration`: triggers bloquean UPDATE, DELETE y TRUNCATE, incluso para el propietario bajo operación ordinaria. Una corrección inserta otra fila; jamás altera la anterior.

### Cobertura y whole-lot

Sublote: layout_id obligatorio y activo al crear. Whole-lot: sub_lot_id NULL; layout_id identifica el layout activo **solo si no hay sublotes habilitados**. Sin layout activo, layout_id NULL. Si hay unidades activas, declarar cada una por separado; no insertar declaración whole-lot que las invada silenciosamente.

coverage congela IDs, geometría y área estructural observada; se compara mediante su representación JSONB textual canónica de PostgreSQL, sin redondeo numérico en JavaScript; no área operativa ni fecha agronómica. Un cambio de layout, unidad, geometría o área impide aplicar una declaración vieja a la cobertura nueva. Queda evidencia y conflicto `declaration_coverage_changed`; no se transfieren observaciones por intersección ni por nombres.

### Supersesión

supersedes_id debe existir, pertenecer a la misma empresa/unidad/layout y tener exactamente la misma cobertura. La nueva observed_on no puede retroceder respecto de la anterior. Un único sucesor por declaración. FK inmediata, fila anterior inmutable, CHECK contra sí misma y búsqueda recursiva impiden ciclos.

Para referencia anterior a observed_on del sucesor, la declaración previa sigue aplicando. En la fecha del sucesor, la previa queda sustituida en resolución sin borrarse. Una declaración de cobertura distinta es nueva evidencia independiente, no una corrección del antiguo polígono. Correcciones que necesitan retroceder la observación requieren otra decisión administrativa; este contrato no las realiza implícitamente.

El indicador `crops.enabled` regula la disponibilidad del catálogo para nuevas operaciones; **no invalida una realidad productiva observada**. Tanto growing_crop como stubble pueden referenciar un cultivo deshabilitado si existe y pertenece a la misma empresa. La DB y prepare/confirm conservan los rechazos de cultivo inexistente o de otra empresa. Las reglas de Planning y creación de actividades permanecen intactas.

Verificación de este ajuste: **98 tests backend aprobados, 0 fallos y 0 omitidos** (32 declaraciones, 44 reconcile-sowing, 6 corrección histórica con ciclos y 16 adopción histórica), en PostgreSQL descartable. Los cuatro casos nuevos comprueban cultivos deshabilitados para growing_crop/stubble y el rechazo de cultivos ajenos/inexistentes, tanto en DB como en el servicio. No se modificó ni se volvió a compilar el frontend para este ajuste.

## Resolver único

`services/productiveState.js` es el único resolver de `state`, usado tanto por los GET de Lotes como por prepare de declaraciones. `readUnits`, carga de ciclos/cosechas/cierres/declaraciones y `resolveUnit` no escriben. GET y prepare leen dentro de transacción repeatable read read only. La fecha predeterminada es el día argentino; fechas imposibles se rechazan.

`services/productiveStateLegacy.js` contiene la SQL espacial existente, extraída del controlador. Solo produce current_crop/previous_crops para compatibilidad; no decide state ni precedencia de declaraciones. No se copió otra implementación de resolución al servicio administrativo: el preview añade una observación transitoria al **mismo** resolver, sin persistirla.

Los GET mantienen rutas `/api/lots/productive-states` y `/api/lots/:lotId/productive-state`, agregando `state` por unidad. current_crop sigue siendo el assignment real seleccionado por la proyección antigua; puede seguir mostrar Soja cuando state representa Trigo declarado. Nunca se crea un current_crop sintético con ID falso. previous_crops continúa siendo antecedente espacial, no prueba de rastrojo.

### Fechas efectivas y precedencia

| Evidencia | Fecha usada | Resultado |
|---|---|---|
| Assignment | start_date | Cultivo implantado mientras su ventana corresponde |
| Cosecha parcial habilitada | harvest_date | Hecho real posterior, conserva cultivo; no rastrojo completo |
| Cierre automático completo | Última harvest_date, igual a end_date y balance completo | Rastrojo desde después del último día activo inclusivo |
| Finalización explícita por pérdida/otros motivos | harvest_cycle_closures.finalized_date | unknown; no prueba rastrojo |
| Fin legacy/sin respaldo | end_date como límite registrado, evidencia insuficiente | unknown; no se convierte en hecho de cosecha |
| Declaración | observed_on | Estado confirmado, fecha agronómica desconocida |

1. Solo declaraciones observed_on <= referencia, de exactamente la unidad/layout/cobertura evaluada. recorded_at y created_at **nunca** dan precedencia.
2. Declaración posterior domina hechos antiguos aplicables; ciclo viejo sigue íntegro. El estado declarado indica conflictos si contradice un ciclo vigente.
3. Hecho real posterior a observed_on sustituye la declaración. Importación en noviembre de siembra de septiembre no vence observación de octubre. Una siembra posterior seguida de fin sin respaldo deja unknown después de ese límite, sin simular cultivo perpetuo.
4. Sin hecho real posterior, un fin legacy no demuestra cosecha y no borra una observación confirmada. Ausencia de assignment no es barbecho.
5. Supersesión válida elimina al predecesor solo para fechas en que sucesor observado ya es aplicable. Observaciones posteriores independientes tienen prioridad temporal. Empate incompatible de declaraciones o hechos devuelve unknown/ambiguous con evidencia de ambos. Empate observación/hecho expone same_day_fact_conflict y conserva el estado declarado explícito; no se inventa una hora para desempatar.
6. Múltiples ciclos vigentes se exponen como overlapping_cycles. Una declaración growing_crop del mismo cultivo y cobertura no contradice por sí sola ese cultivo; stubble/fallow/unknown sí contradicen un cultivo todavía abierto.

Rastrojo automático exige fuente de cierre `automatic`, balance de hectáreas cosechadas completo usando `cycleBalance` existente, última cosecha igual al fin y ausencia de cierre manual. Cosechas deshabilitadas/futuras no se cuentan. Cierres legacy, pérdida o fin sin cosecha no se reinterpretan. No se modifican cantidades para hacer coincidir balance.

### Límite espacial explícito

La primera versión aplica hechos whole-lot a sus unidades actuales y hechos de identidad exacta del sublote. Si existe un ciclo de otro sublote/layout del mismo lote cuya cobertura no puede probarse por identidad, expone `coverage_requires_review` y mantiene derivación conservadora unknown; una declaración exacta puede mostrar el estado confirmado con esa discrepancia. No calcula transferencia espacial entre layouts.

La SQL legacy espacial se conserva, con prueba opcional **PostGIS real** en `productiveState.postgis.test.js`, restringida a localhost y tablas temporales. No se ejecutó aquí porque no hay URL PostGIS local configurada. Las pruebas PGlite de identidad **no prueban geometría ni todas las funciones ST instaladas**. Antes de habilitar derivación entre polígonos/versiones se requiere verificación PostGIS real y diseño de cobertura completa/parcial. Un lector histórico evalúa fecha sobre las unidades del layout actualmente activo; no reconstruye cuál layout estaba activo en aquella fecha.

## Shape final de state

```json
{
  "kind": "growing_crop",
  "crop": { "id": "2f9aabe7-d74d-400c-92c7-8b2b4f8fed8f", "name": "Trigo" },
  "source": "declaration",
  "observed_on": "2026-10-06",
  "effective_date": null,
  "quality": "confirmed",
  "conflict": true,
  "conflicts": [
    {
      "type": "open_cycle_conflict",
      "assignment_id": "8b0241db-9ece-4ef4-86cc-1d86f81b2f88",
      "crop_id": "3c63160d-4ad3-4594-823c-554271c73dd4",
      "crop_name": "Soja"
    }
  ],
  "evidence_ids": ["<UUID de la declaración efectivamente creada>"]
}
```

Ejemplo conceptual, **no declaración insertada**. kind: growing_crop/stubble/fallow/unknown; crop en stubble es cultivo del residuo, null para fallow/unknown. source: derived/declaration. quality: evidenced/confirmed/insufficient/ambiguous. effective_date es fecha del hecho o límite documentado de evidencia insuficiente, nunca observación declarada. conflicts es array tipado con IDs de evidencia; evidence_ids conserva vínculos sin fingir assignment.

## Endpoints administrativos

- `POST /api/history/productive-state-declarations/prepare`
- `POST /api/history/productive-state-declarations/confirm`

Montaje real bajo history.js, checkJwt/userData/requireTenant existentes; Admin habilitado + planning.edit + history.import efectivos, reconsultados en DB. Modelo y servicio no hardcodean empresa/cultivo/lote de Don Santiago. Actor/empresa salen exclusivamente de sesión.

Prepare: body `{ "declarations": [...] }`, 1–20 unidades únicas. Campos por unidad: lot_id, sub_lot_id, layout_id, kind, crop_id, observed_on, source, evidence, reason, supersedes_id opcional. Referencias y combinaciones se validan; body extra/id/actor/company/recorded_at/coverage no aceptados.

Devuelve persisted=false, can_confirm=true, fingerprint, items con unidad/cultivo, cobertura, before/after del mismo resolver y advertencia funcional si hay conflicto. IDs `preview:...` son marcadores transitorios de observación hipotética, **no IDs persistidos**. Read only real en DB: ningún evento/import/permiso/declaración ni clave se crea.

Confirm: mismo body más fingerprint hexadecimal de 64 caracteres, confirmed=true y encabezado Idempotency-Key no vacío (máximo 200). Primera respuesta 201; replay 200. Mismo key/payload canónico: devuelve original. Mismo key y otro contenido/fingerprint: 409. Falta de campos: 400. Permisos: 403. Cobertura/estado/esquema cambiado: 409. Migración ausente: 503.

Locks y snapshot conservador reutilizan los helpers de reconcile-sowing, **sin su autorización ni lista de empresa/IDs**. Se exportaron solamente catalog/snapshot; reconciliación original y sus validadores siguen intactos. Confirm bloquea tablas públicas ordinarias en orden estable y lotes por advisory lock, revalida permisos/esquema/precondiciones/fingerprint, y compara snapshot final contra deltas permitidos. El guard también exige triggers de declaraciones habilitados.

Fingerprint incluye datos públicos, esquema, actor y payload normalizado; cambios ajenos también pueden vencerlo. Este soporte ocasional toma locks globales (espera 5s, sentencias 30s), exige rol SQL con visibilidad completa/privilegios necesarios y row_security=off para rechazar snapshots ocultos. Revisar costo en staging/ventana de baja actividad. Esquemas privados, particiones públicas y referencias entrantes externas requieren revisión, no protección inferida.

### Auditoría y no mutación histórica

Deltas permitidos: declaraciones nuevas, historical_events append-only y un recibo en historical_imports con source=`productive-state-declarations`. Eventos registran actor/empresa, estado anterior, fila completa creada, observación, motivo/evidencia, fingerprint y referencia de idempotencia. El trigger construye coverage en DB; la fila creada se incorpora al evento como JSONB textual nativo, preservando precisión. Las filas originales de ciclos, Planning/relaciones/usos/productos/stock/cosechas/cierres/eventos permanecen exactas; no se llama a servicios de completado/stock/cierre.

Revalidación y escrituras en una sola stock.transaction. Validación de filas realmente persistidas y auditoría después de triggers; constraints diferidos forzados antes de comparar todas las tablas contra allowlist. Error o delta inesperado revierte declaraciones/eventos/recibo/key completos. No desactiva triggers, no agrega enabled=false ni excepciones al guard histórico general.

Declaraciones **no autorizan** nueva siembra, cosecha, stock ni reconciliación histórica. No entran en sus validadores. T2 sigue devolviendo conflicto en reconcile-sowing aunque se declare Trigo.

## Ejemplo T2 — SOLO plantilla no ejecutada

Después del deploy, un Admin de Don Santiago podría preparar:

```json
{
  "declarations": [
    {
      "lot_id": "f992c02e-dd31-4d52-8d49-38fccc9b9d24",
      "sub_lot_id": "c92a023d-226e-41b8-a37d-720b16d15dd9",
      "layout_id": "f4d98a16-9b69-4d60-9397-7b58a34a7558",
      "kind": "growing_crop",
      "crop_id": "2f9aabe7-d74d-400c-92c7-8b2b4f8fed8f",
      "observed_on": "2026-10-06",
      "source": "operational_confirmation",
      "evidence": "T2-A = Trigo, estado vigente confirmado al 06/10/2026",
      "reason": "Representar estado confirmado; Soja whole-lot permanece pendiente de revisión histórica"
    },
    {
      "lot_id": "f992c02e-dd31-4d52-8d49-38fccc9b9d24",
      "sub_lot_id": "de3c01bd-023a-42de-aa6c-f6019979e1ff",
      "layout_id": "f4d98a16-9b69-4d60-9397-7b58a34a7558",
      "kind": "stubble",
      "crop_id": "3c63160d-4ad3-4594-823c-554271c73dd4",
      "observed_on": "2026-10-06",
      "source": "operational_confirmation",
      "evidence": "T2-B = Rastrojo de Soja, confirmado al 06/10/2026",
      "reason": "Estado observado; fecha de cosecha/cierre de Soja no documentada"
    }
  ]
}
```

Estado resultante conceptual: A Trigo declarado, B Rastrojo de Soja declarado; ambos conflict=true identificando la Soja whole-lot abierta desde 05/12/2025. Assignment original 70.97 ha/fin NULL intacto. Planning Trigo 25–26/05/2026, 41.1 ha, Semilla 4521 kg/Fertilizante 2184.05 kg, productos/usos/fechas/crop_id/selección whole-lot intactos. No se crea ciclo Trigo T2-A.

## Frontend

Lotes prioriza state en tabla/lista mobile, overview/mapa/árbol/contexto y detalles. Etiquetas: Trigo; Rastrojo de Soja; Barbecho; Estado no determinado. Conflicto: “Estado confirmado con historial pendiente de revisar”, discreto y con ajuste de línea. Detalles: “Confirmado el 06/10/2026”; no “sembrado el”. No mezcla la campaña legacy de Soja con una declaración de Trigo. Datos antiguos sin state siguen funcionando mediante fallback a current_crop real.

Las acciones de finalización de ciclo no se ofrecen desde una presentación declarada que podría referirse a otro cultivo; no se reemplaza el assignment ni su validación operacional. Inicios agronómicos desconocidos no se rellenan. La presentación compartida permite wrapping y conserva containers responsive existentes.

## Pruebas y resultados

- `node --test --test-reporter=spec growsync-backend/tests/productiveStateDeclarations.integration.test.js`: migración en PGlite descartable, restricciones DB, tenant, layout/cobertura, tipos, supersesión, read-only, idempotencia, stale fingerprint, precedencia, T2 e invariancia, HTTP y rollback adversario.
- Regresión: `growsync-backend/tests/reconcileSowing.integration.test.js`, 44 aprobadas junto a la suite nueva; T2/T3 bloqueados, stock/usos históricos protegidos.
- Frontend: `node --test grow-sync/tests/productiveStatePresentation.test.mjs grow-sync/tests/lotsOverview.test.mjs`: etiquetas, fechas, compatibilidad/filtros, renderizado real SSR y vistas existentes.
- `npm --prefix grow-sync run build -- --outDir .tmp-productive-declarations-build`: build correcto; advertencias existentes de ESM/chunks. Carpeta temporal eliminada después de revisar.
- `productiveState.postgis.test.js`: omitida porque PRODUCTIVE_STATE_LOCAL_POSTGIS_URL no está configurada. Acepta solo host localhost/127.0.0.1/::1, crea tablas temporales, rollback/cierre. No lee .env ni URL Supabase; no instala extensión. Para habilitarla, proveer una base **local** con PostGIS instalado y ejecutar el archivo. No usar producción.

Las fixtures usan geografía opaca únicamente para identidad y detección de cambio de snapshot, **no para demostrar intersecciones**. No se realizó recorrido visual de navegador con sesión real ni prueba de locks con dos conexiones PostgreSQL externas. La suite HTTP usa identidad sintética y pool inyectado; no inicializa Supabase.

Resultado final de verificaciones: **32 pruebas de declaraciones backend aprobadas**, **44 de regresión reconcile-sowing aprobadas**, **14 pruebas frontend aprobadas** entre suite nueva (8) y Lotes existente (6). Sin fallos. **1 prueba PostGIS real omitida** por falta de conexión local configurada; no se afirma cobertura espacial probada. Build y controles de sintaxis correctos; diff --check correcto. La migración se aplicó exclusivamente en fixtures descartables.

## Desplegar sin crear todavía declaraciones T2

1. Revisar SQL completo, código y resultados. Probar migración limpia y aceptación PostGIS en staging/local, junto con permisos del rol SQL y costo de snapshot.
2. En un despliegue futuro autorizado, aplicar **solo** la migración de esquema con el procedimiento habitual; verificar tabla vacía, FKs/checks/RLS y los tres triggers habilitados. Backend debe poder SELECT/INSERT en nueva tabla; no abrir políticas a usuarios finales ni otorgar UPDATE/DELETE/TRUNCATE.
3. Desplegar backend y frontend después del esquema. No hay seed de T2 ni tarea automática al iniciar. Los GET requieren la nueva tabla: respetar ese orden o conservar backend anterior hasta terminar migración.
4. Validar GET de lectura. Para preview futuro, autenticarse como Admin y hacer POST prepare con body autorizado; revisar persisted=false, fingerprint y advertencia T2. Prepare no crea nada.
5. **Detenerse. No hacer confirm T2 en este despliegue.** Una creación futura requiere autorización separada: mismo body, fingerprint reciente, confirmed=true e Idempotency-Key estable. Conservar key/payload para reintento; conflicto exige nuevo prepare/revisión, no cambiar historia para forzarlo.
6. No cerrar Soja, no crear Trigo T2-A, no modificar Planning, no corregir T3/canal ni registrar Alfalfa. Esta tarea termina con artefactos locales listos para revisión.

## Inventario de archivos de esta implementación

Backend: `controllers/lots/productiveState.js`, `services/productiveState.js`, `services/productiveStateLegacy.js`, `services/productiveStateDeclarations.js`, `services/reconcileSowing.js` (solo exportar helpers), `routes/history.js`, `routes/productiveStateDeclarations.js`, migración y tests `productiveStateDeclarations.integration.test.js` / `productiveState.postgis.test.js`.

Frontend: `productiveStatePresentation.mjs`, `components/ProductiveStateLabel.jsx`, `LotDivisions.jsx`, `LotsOverview.jsx`, `lotsOverviewModel.mjs`, `components/LotTable.jsx`, `components/LotListMobile.jsx`, `components/LotOverviewContext.jsx`, test `productiveStatePresentation.test.mjs`.

Documentos: este archivo y `productive-state-reconciliation.md`, actualizado con cuatro Trigos productivos confirmados por el usuario y sin atribuir reparación a otros lotes.

## SQL completo para revisión

```sql
-- Schema only. No company data, declarations or agronomic mutations.
BEGIN;
CREATE TABLE public.productive_state_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  lot_id uuid NOT NULL REFERENCES public.lots(id) ON DELETE RESTRICT,
  sub_lot_id uuid REFERENCES public.sub_lots(id) ON DELETE RESTRICT,
  layout_id uuid REFERENCES public.lot_layouts(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('growing_crop','stubble','fallow','unknown')),
  crop_id uuid REFERENCES public.crops(id) ON DELETE RESTRICT,
  observed_on date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (length(btrim(source)) BETWEEN 1 AND 200),
  evidence text NOT NULL CHECK (length(btrim(evidence)) BETWEEN 1 AND 4000),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 4000),
  supersedes_id uuid REFERENCES public.productive_state_declarations(id) ON DELETE RESTRICT,
  coverage jsonb NOT NULL,
  CHECK ((kind IN ('growing_crop','stubble') AND crop_id IS NOT NULL)
    OR (kind IN ('fallow','unknown') AND crop_id IS NULL)),
  CHECK (supersedes_id IS NULL OR supersedes_id<>id),
  CHECK (sub_lot_id IS NULL OR layout_id IS NOT NULL)
);
CREATE INDEX productive_declarations_unit_date ON public.productive_state_declarations
 (company_id,lot_id,sub_lot_id,observed_on DESC);
CREATE UNIQUE INDEX productive_declarations_one_successor ON public.productive_state_declarations(supersedes_id)
 WHERE supersedes_id IS NOT NULL;
ALTER TABLE public.productive_state_declarations ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.validate_productive_declaration() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
DECLARE l public.lots; sl public.sub_lots; ll public.lot_layouts; prior public.productive_state_declarations;
  active_layout uuid; expected jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text||':'||NEW.lot_id::text,0));
  SELECT * INTO l FROM public.lots WHERE id=NEW.lot_id AND company_id=NEW.company_id AND enabled=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot/company unavailable' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.users WHERE id=NEW.actor_id AND company_id=NEW.company_id AND enabled=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Actor/company unavailable' USING ERRCODE='23514'; END IF;
  IF NEW.crop_id IS NOT NULL THEN
    PERFORM 1 FROM public.crops WHERE id=NEW.crop_id AND company_id=NEW.company_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Crop/company unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT id INTO active_layout FROM public.lot_layouts WHERE lot_id=l.id AND company_id=NEW.company_id AND status='active' FOR SHARE;
  IF NEW.layout_id IS DISTINCT FROM active_layout THEN RAISE EXCEPTION 'Current active layout required' USING ERRCODE='23514'; END IF;
  IF NEW.sub_lot_id IS NOT NULL THEN
    SELECT * INTO sl FROM public.sub_lots WHERE id=NEW.sub_lot_id AND lot_id=l.id AND company_id=NEW.company_id
      AND layout_id=NEW.layout_id AND enabled=true FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sublot/lot/layout/company mismatch' USING ERRCODE='23514'; END IF;
    expected=jsonb_build_object('lot_id',l.id,'sub_lot_id',sl.id,'layout_id',sl.layout_id,'geom',to_jsonb(sl)->'geom','area_ha',sl.area_ha);
  ELSE
    IF EXISTS (SELECT 1 FROM public.sub_lots WHERE layout_id=active_layout AND lot_id=l.id AND company_id=NEW.company_id AND enabled=true) THEN
      RAISE EXCEPTION 'Declare each active sublot separately' USING ERRCODE='23514';
    END IF;
    expected=jsonb_build_object('lot_id',l.id,'sub_lot_id',NULL,'layout_id',active_layout,'geom',to_jsonb(l)->'geom','area_ha',l.area_ha);
  END IF;
  IF NEW.coverage IS NOT NULL AND NEW.coverage<>expected THEN RAISE EXCEPTION 'Coverage changed' USING ERRCODE='23514'; END IF;
  NEW.coverage=expected;
  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT * INTO prior FROM public.productive_state_declarations WHERE id=NEW.supersedes_id FOR SHARE;
    IF NOT FOUND OR (prior.company_id,prior.lot_id,prior.sub_lot_id,prior.layout_id) IS DISTINCT FROM
      (NEW.company_id,NEW.lot_id,NEW.sub_lot_id,NEW.layout_id) OR prior.coverage<>expected OR NEW.observed_on<prior.observed_on THEN
      RAISE EXCEPTION 'Invalid supersession coverage/company/date' USING ERRCODE='23514';
    END IF;
    -- An existing immutable predecessor plus FK and self-check cannot form a future cycle.
    IF EXISTS (WITH RECURSIVE chain AS (SELECT id,supersedes_id FROM public.productive_state_declarations WHERE id=NEW.supersedes_id
      UNION SELECT p.id,p.supersedes_id FROM public.productive_state_declarations p JOIN chain c ON p.id=c.supersedes_id)
      SELECT 1 FROM chain WHERE id=NEW.id) THEN RAISE EXCEPTION 'Supersession cycle' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER productive_declaration_validate BEFORE INSERT ON public.productive_state_declarations
 FOR EACH ROW EXECUTE FUNCTION public.validate_productive_declaration();
CREATE FUNCTION public.protect_productive_declaration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Productive declarations are append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER productive_declaration_append_only BEFORE UPDATE OR DELETE ON public.productive_state_declarations
 FOR EACH ROW EXECUTE FUNCTION public.protect_productive_declaration();
CREATE TRIGGER productive_declaration_no_truncate BEFORE TRUNCATE ON public.productive_state_declarations
 FOR EACH STATEMENT EXECUTE FUNCTION public.protect_productive_declaration();
REVOKE UPDATE,DELETE,TRUNCATE ON public.productive_state_declarations FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
```
