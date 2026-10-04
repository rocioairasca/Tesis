# Adopción histórica de siembras con cosecha vinculada

Implementación local del 04/10/2026. No se consultó ni modificó producción ni se adoptaron registros reales. Sin commit ni staging.

## Arquitectura y alcance

Se extienden las funciones SQL de preparación y confirmación existentes; se conservan endpoints y servicio. La confirmación convierte en una sola transacción Planning, usos existentes vinculados, ciclos productivos vinculados y cosechas vinculadas. Solo cambia inventory_impact_mode a HISTORICAL_NO_STOCK y asigna el mismo historical_import_id. No crea usos ni relaciones.

La preparación valida empresa, referencias, fechas anteriores al inicio del inventario y ausencia de movimientos. Mantiene Admin, planning.edit e history.import. Los cierres explícitos siguen bloqueados. También se bloquean cosechas compartidas con ciclos de otra Planning, incluso si se seleccionan ambas: esa adopción conjunta requiere otro alcance.

Los permisos privados de transacción autorizan explícitamente cada fila de harvest_records. Un trigger específico conserva updated_at únicamente durante esa conversión autorizada; no se desactiva ningún trigger. El rendimiento generado se compara después de guardar, porque PostgreSQL todavía no lo calcula en BEFORE UPDATE. Fuera de la operación autorizada siguen prohibidos los cambios directos de modo/procedencia.

Se compara cada fila persistida y luego el conjunto completo de registros y vínculos, admitiendo únicamente los dos campos autorizados. Se vuelve a comparar después de escribir auditoría y resultado, para detectar efectos secundarios tardíos. El snapshot completo de inventario existente se verifica antes/después. Cualquier diferencia provoca rollback de todo el lote, incluidos importación y eventos. Se mantienen los bloqueos transaccionales, límites de espera y reintentos idempotentes existentes.

La auditoría conserva before completo y agrega after completo, las entidades convertidas, actor e importación; no altera eventos anteriores. Sigue disponible la corrección histórica posterior de Planning.

## Migración requerida

Aplicar mediante el procedimiento habitual, después de revisar:

- growsync-backend/migrations/20261006_adopt_historical_cycles_with_harvest.sql

Requiere previamente 20261004_adopt_existing_history.sql, 20261005_historical_adoption_diagnostics.sql y 20261005_preserve_adopted_planning_timestamp.sql. Instala funciones y un trigger; no convierte datos al instalar. Solo fue aplicada en bases descartables PGlite durante las pruebas.

## UI

El modal compartido por escritorio, vista compacta y calendario incorpora Cosechas relacionadas: lote/sublote, fecha DD/MM/YYYY, superficie cosechada y producción. Avisa que siembra, ciclo productivo y cosecha se conservarán como históricos sin modificar inventario. La confirmación incluye las cosechas y la advertencia irreversible se refiere al conjunto. No muestra identificadores ni nombres internos. No cambian las acciones del flujo normal.

## Archivos modificados o agregados

- growsync-backend/migrations/20261006_adopt_historical_cycles_with_harvest.sql
- growsync-backend/tests/historicalHarvestAdoption.fixture.js
- growsync-backend/tests/historicalHarvestAdoption.integration.test.js
- growsync-backend/tests/historicalAdoption.integration.test.js
- grow-sync/src/features/planning/components/HistoricalHarvestPreview.jsx
- grow-sync/src/features/planning/components/AdoptExistingModal.jsx
- grow-sync/tests/historicalAdoption.test.mjs
- docs/historical-harvest-adoption.md

## Pruebas ejecutadas

Backend: node --test --test-reporter=spec tests/historicalHarvestAdoption.integration.test.js tests/historicalAdoption.integration.test.js

25 aprobadas. Incluyen los tres casos del backup, conservación exacta de campos y vínculos, mismo import, stock sin cambios, idempotencia, corrección posterior, rollback por fallo en cada entidad, efectos secundarios sobre inventario/relaciones/auditoría, fecha en el corte, cierre explícito, tenant ajeno, permisos, APIs existentes y funciones privadas inaccesibles.

Frontend: node --test tests/historicalAdoption.test.mjs

8 aprobadas. Incluyen integración de acciones en las tres vistas y renderizado del preview de cosecha, formato de fechas/números y ausencia de identificadores visibles. No se realizó recorrido visual interactivo en navegador.

Build: npm run build -- --outDir .tmp-harvest-adoption-build, correcto. El primer intento en dist falló por permisos del sandbox al limpiar un archivo; se compiló con permiso de escritura local en una carpeta temporal nueva, eliminada al terminar. Quedan avisos de configuración ESM y tamaño de chunks existentes. git diff --check correcto.

## Diferencias y límites de la fixture

Los datos productivos proceden del backup local. Se anonimiza la identidad de empresa/usuarios en la base descartable y se agrega inventario sintético no vacío para detectar cualquier cambio. Las superficies exactas de planning_lots son 46.0932, 92.6495 y 19.8314 ha; los ciclos guardan 46.09, 92.65 y 19.83 ha. No se redondean ni igualan. Las cosechas conservan 45/92/19.83 ha y 89640/315700/45000 kg, junto con sus rendimientos originales.

La fixture usa PostgreSQL embebido PGlite; representa geometría como texto y no ejecuta PostGIS. Reutiliza definiciones de triggers de Planning/ciclos capturadas previamente en archivos locales. La captura disponible no contiene definiciones de triggers productivos de harvest_records: se agregó un trigger sintético de timestamp para probar esa protección. No se afirma equivalencia completa con todos los triggers de producción. Cualquier efecto adicional no autorizado queda sujeto a las comparaciones completas y cancela la operación, en lugar de aceptar cambios silenciosos.
