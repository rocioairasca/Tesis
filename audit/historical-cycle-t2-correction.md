# Corrección histórica de soja T2 con ciclo vinculado

Trabajo local en `C:\Proyectos\Tesis`. Sin producción, sin modificar el backup, sin commit ni staging. Se preservó el cambio previo del usuario en `AddHistoricalProduct.jsx` (margen del botón).

## Identificación desde el backup

Fuente: `audit/don-santiago-pre-reset/20260916T175923749Z/data/`.

| Entidad | Identificación / datos |
| --- | --- |
| Planning | `fe4b75d4-84eb-4f4b-814e-3d06653e572e` |
| Período | 04/12/2025 al 05/12/2025; fecha efectiva 05/12/2025 |
| Lote T2 | `f992c02e-dd31-4d52-8d49-38fccc9b9d24`; sin sublote |
| planning_lots.area_ha | 70.9676 |
| Ciclo | `8b0241db-9ece-4ef4-86cc-1d86f81b2f88`; source_planning_id apunta a esa Planning |
| Área estructural del ciclo | 70.97; inicio 05/12/2025; fin y origen del cierre NULL |
| Cultivo | Soja, `3c63160d-4ad3-4594-823c-554271c73dd4` |
| Campaña | Gruesa 2025-2026 (Sorgo, soja, maiz), `2877e3ab-fd97-4e93-9f49-daf80b283f73` |
| Geografía del lote | lots.area = 71.02; lots.area_ha = 70.9676 |
| Productos / cantidades utilizadas / consumos | No existen filas asociadas en el backup original |
| Cosechas y cierres | No hay harvest_records de T2, vínculos de cosecha con este ciclo ni cierres asociados en el backup |

El producto agregado recientemente y el estado histórico informado por el usuario son posteriores al backup. Se reconstruyeron únicamente en la base de prueba: Planning y ciclo históricos, producto Semilla Soja y su cantidad planificada/utilizada 4613.05, agregados por el servicio histórico existente. No se consultó producción para obtener sus IDs actuales.

## Causa y reproducción

La validación anterior en `historicalMutation.mutate` preguntaba si el cuerpo incluía cualquiera de `start_at`, `end_at`, `effective_date` o `lot_selections`; si existía un crop_assignment asociado, rechazaba todo con el mensaje reportado. No distinguía un cambio de lote de una corrección de superficie dentro del mismo lote.

El constructor real del formulario, con los datos del backup y superficie solicitada 70.97, genera:

```json
{"lot_selections":[{"lot_id":"f992c02e-dd31-4d52-8d49-38fccc9b9d24","sub_lot_id":null,"area_ha":"70.97"}]}
```

No genera cambios de período, fecha efectiva o cantidades cuando permanecen iguales. Se ejecutó el servicio anterior obtenido de HEAD contra la fixture en memoria: este cuerpo devolvió 409 y exactamente «El antecedente tiene ciclos vinculados: requiere corrección histórica integral, sin reasignación automática.»

Esto reproduce y demuestra el bloqueo por `lot_selections.area_ha` (70.9676 → 70.97). No se dispone de la petición HTTP original de producción; no se afirma que ese intento no haya enviado algún otro campo adicional.

## Solución y semántica de superficie

Se conserva la ruta histórica existente de PATCH, que intercepta la operación antes del controlador normal. No llama a la sincronización de ciclos del completado normal.

La superficie trabajada ya tiene representación propia: `planning_lots.area_ha` (numeric con cuatro decimales). El área estructural se conserva en `crop_assignments.area_ha` (dos decimales) y la geografía del lote en `lots`/`sub_lots`. No hace falta inventar otro campo ni modificar superficies estructurales.

Con ciclos vinculados:

- Se exige que el conjunto de pares lote/sublote sea exactamente el existente. No se agregan, eliminan ni sustituyen relaciones.
- Solo se hace UPDATE del área trabajada; no se borran/reinsertan planning_lots ni se reescriben usage_lots.
- Los cambios reales de fechas se rechazan. Reenviar una fecha idéntica se trata como no-op y no se vuelve a escribir.
- Se permiten correcciones de cantidades en los productos históricos existentes, incluido el agregado sin consumo asociado. Cambiar cultivo, campaña, tipo o producto por un identificador enviado fuera del contrato sigue rechazándose.
- Se comparan snapshots de ciclos, cosechas, vínculos, cierres, lotes, sublotes, campañas y cultivos. También se comparan los campos estructurales de la Planning y las identidades de productos, cantidades utilizadas y lotes asociados.
- Se compara inventario completo de la empresa: productos, partidas, movimientos, notificaciones y balances. Cualquier diferencia protegida revierte la corrección y su auditoría.
- Los bloqueos transaccionales evitan cambios concurrentes y filas nuevas entre snapshots. Hay límites de espera y ejecución y mensaje funcional ante conflicto de concurrencia.
- historical_event conserva actor, Planning, petición y datos reales antes/después, incluidas superficies, productos y cantidades utilizadas, como JSON nativo de PostgreSQL.

No se desactivan ni modifican triggers. No se crea ni elimina un ciclo. No se recalculan cosechas ni se crean partidas o movimientos. **No requiere migración.**

La UI aclara «Superficie histórica trabajada» y que este valor no modifica la superficie del lote ni la del cultivo vinculado. Los cambios de fecha con cultivo vinculado siguen requiriendo revisión integral.

## Verificación

- Suite de backend de correcciones con ciclos, productos históricos, históricos y adopción: 41 aprobadas, 1 omitida por su configuración previa, 0 fallos.
- Después de preservar explícitamente los permisos de baja/restauración: suite final de T2, 6/6 aprobadas.
- Frontend `node --test tests/historicalPlanning.test.mjs`: 5/5 aprobadas.
- `npm run build`: correcto; advertencias existentes de configuración Vite y tamaño de bundles.
- `git diff --check`: correcto.

La regresión verifica 70.9676 → 70.97 y también 70.5 para demostrar independencia real respecto del ciclo de 70.97. Prueba cantidades 4613.05 y su corrección posterior. Compara todas las columnas protegidas, incluidos IDs y timestamps. Una variante sintética adicional tiene cosecha y cierre no vacíos: permanecen idénticos. Triggers adversarios que alteran cosechas o inventario fuerzan rollback completo, incluyendo el evento. Fechas, lote, sublote, campaña y cultivo incompatibles siguen bloqueados.

Las pruebas usan PostgreSQL/PGlite en memoria y definiciones de triggers ya capturadas en el repositorio; no realizan operaciones geométricas PostGIS. No se hizo una prueba manual contra un navegador autenticado ni se leyó/escribió producción.

## Archivos de esta corrección

- `growsync-backend/services/historicalMutation.js`
- `growsync-backend/services/historicalPlanningGuard.js` (nuevo)
- `growsync-backend/tests/historicalCycle.fixture.js` (nuevo)
- `growsync-backend/tests/historicalCycleCorrection.integration.test.js` (nuevo)
- `grow-sync/src/features/planning/components/HistoricalPlanningFields.jsx`
- `audit/historical-cycle-t2-correction.md` (este informe)