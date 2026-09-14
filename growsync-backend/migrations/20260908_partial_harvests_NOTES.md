# Cosechas parciales: despliegue y conciliación

## Estado

Las migraciones están preparadas y probadas en PostgreSQL embebido, no ejecutadas
en Supabase. El backend y el frontend nuevos requieren la migración base.
No desplegar el backend nuevo contra el esquema antiguo ni mantener escritores
antiguos después de retirar el índice único.

## Orden seguro

1. Respaldar las tres tablas y repetir el preflight de lectura.
2. Pausar escrituras de cosechas y ciclos durante el cambio coordinado.
3. Aplicar `20260908_add_partial_harvests.sql` y desplegar el backend nuevo.
   La migración aborta ante repartos legacy múltiples desconocidos. Copia los
   vínculos uno a uno, marca cierres preexistentes como `legacy`, sin tocar
   `end_date`, geometrías ni cantidades originales. Las seis cosechas sin vínculo
   permanecen sin vínculo.
4. Verificar nueva jornada parcial, acumulado y finalización; habilitar escrituras.
5. NO aplicar `20260908_normalize_harvest_area_precision.sql` hasta conciliar los
   excesos. Su precondición aborta la transacción completa si persisten. El único
   cambio de cantidad previsto es `round(crop_assignments.area_ha, 2)`.

No se necesita cambiar `harvest_records.harvested_area_ha`: ya es NUMERIC(10,2).
Su rendimiento es una columna generada dependiente de esa superficie y se conserva.
El preflight real encontró sólo el CHECK positivo como dependencia declarada de
`crop_assignments.area_ha`; los CHECK y el rendimiento dependen de la superficie
de cosecha. No se modifican Planning, campañas, inventario ni superficies geométricas.
Las áreas geométricas conservan su precisión; los importes operativos del ciclo
se redondean a dos decimales. Mientras el cambio de tipo está bloqueado, un trigger
normaliza únicamente áreas nuevas/modificadas y el cálculo normaliza la lectura.

## Casos reales que bloquean la normalización

Preflight SELECT del 08/09/2026 (transaction_read_only=on):

| Asignación | Área original | Normalizada | Cosechado |
|---|---:|---:|---:|
| `1a1a4674-0b77-45fb-b411-21fd449ac00f` | 49.9421 | 49.94 | 50.00 |
| `f5376999-22cf-4d7c-ad0c-98854832ce02` | 19.8314 | 19.83 | 20.00 |

El tercer exceso previamente detectado (27 / 26.9964) deja de ser exceso frente
al área normalizada 27.00; no se corrigió ni se cambió su cierre. Los diez casos
antes inferiores también conservan sus cierres. No se deduce la procedencia de
ningún cierre por coincidencia de fechas o superficie.

## Contrato operativo

- Hectáreas: aritmética en centésimas enteras y redondeo decimal; DB NUMERIC(...,2)
  para vínculos y snapshots. No hay truncamiento ni tolerancia que admita excesos.
- Total: área de la asignación redondeada; acumulado: suma de vínculos de cosechas
  `enabled=true`; pendiente: total menos acumulado, sin ocultar diferencias legacy.
- Una asignación se imputa automáticamente; varias requieren `allocations` con
  `crop_assignment_id` y `harvested_area_ha`. Se puede inferir el reparto sólo al
  completar exactamente todos los pendientes. UI mínima: parciales por sublote.
- La identidad de una cosecha vinculada se conserva al editar. La API soporta
  modificar repartos existentes, pero no cambiar el conjunto de asignaciones.
- `harvest_closure_source`: NULL abierto, `automatic` completo, `manual` finalización
  explícita, `legacy` cierre preexistente o externo de procedencia desconocida.
- Un cierre automático se recalcula usando la última jornada cronológica válida
  cuando el acumulado iguala el total. Si vuelve a quedar pendiente, se reabre sólo
  si no se superpone con otro ciclo. Todas las modificaciones se revierten si falla.
- Un cierre manual mantiene fecha y snapshot original incluso si se corrigen o
  deshabilitan jornadas después: el snapshot expresa el estado al finalizar, no
  un saldo actual. No permite nuevas jornadas; las correcciones/rehabilitaciones
  siguen sujetas al máximo. No existe borrado físico ni edición del snapshot.
- Los cierres legacy no se recalculan: cambios de hectáreas, reparto o habilitación
  requieren conciliación; producción y notas pueden corregirse sin alterar cierre.
- Los bloqueos de asignaciones y el bloqueo por lote serializan escrituras. Un
  trigger protege identidad/área y cierres contra modificaciones externas y comprueba
  ciclos nuevos frente a ciclos con cosechas después de adquirir el bloqueo.

## Rutas nuevas

- GET `/harvest-records/context`: consulta informativa de saldos por fecha/superficie,
  o por `harvest_id` al editar. El guardado vuelve a validar con bloqueo.
- POST `/harvest-records/cycles/:assignmentId/finalize`: requiere `harvest.edit`;
  fecha, motivo permitido y notas obligatorias para `other`. Guarda usuario desde
  la sesión, fecha y tres superficies en `harvest_cycle_closures`.
- Historial de lote: evento separado de finalización con la diferencia original.

## Pruebas reproducibles sin Supabase

Instalar `@electric-sql/pglite` en una carpeta temporal, y definir
`HARVEST_TEST_PGLITE` con la ruta absoluta del módulo; no se agrega al package.json.

`node --test tests/harvestAreas.test.js tests/partialHarvests.integration.test.js`

El fixture ejecuta las migraciones y los controladores contra PostgreSQL embebido.
Simula funciones espaciales para una superficie controlada: no prueba geometría
PostGIS real ni carreras entre conexiones PostgreSQL independientes. Esas pruebas
de concurrencia/geométricas deben completarse en staging antes del despliegue.
