# Fallo de adopción histórica: Siembra Trigo / T1

Investigación del 04/10/2026. Checkout local: `C:\Proyectos\Tesis`. Sin commits.

## Causa comprobada

`trg_planning_updated_at` ejecuta `planning_set_updated_at()` antes de cada UPDATE de Planning y asigna `NEW.updated_at := now()` sin excepción. PostgreSQL ejecuta los triggers del mismo tipo en orden alfabético: `protect_inventory_impact_mode` preserva el timestamp primero; después `trg_planning_updated_at` lo vuelve a modificar. `confirm_history_adoption` detecta correctamente la diferencia al comparar el resultado de UPDATE con el grafo original y revierte la transacción.

Se reprodujo primero con la función original sin instrumentación (preview válido, confirmación rechazada). Luego se agregó únicamente DETAIL al error para obtener el diff. Resultado de una ejecución aislada en UTC:

| Tabla | ID | Campo | Antes | Después |
| --- | --- | --- | --- | --- |
| planning | b71d0fad-659e-493b-8127-104b93844983 | updated_at | 2026-08-31T20:30:22.275648+00:00 | 2026-10-04T14:20:06.334+00:00 |

El valor posterior es la hora de **esa reproducción local**, no una lectura de datos productivos ni el timestamp del intento original de producción. Fue el único campo no autorizado que difirió en esa comparación. Al preservar ese timestamp, la adopción completa pasó y todas las entidades se compararon íntegramente.

## Evidencia y alcance de la reconstrucción

- Datos originales: `audit/don-santiago-pre-reset/20260916T175923749Z/data/`. Se seleccionó la Planning exacta y se conservaron sus timestamps con microsegundos, productos, cantidades, 68.8447 ha y dos completions. Los usuarios se reconstruyeron con emails de prueba. No se insertó ningún ciclo ni relación ausente.
- `usage_lots` y `crop_assignments` están vacíos para el caso. Las aplicaciones del backup tienen fecha 01/06/2026; la fecha de realización de la Planning se obtiene de su finalización, 02/06/2026. No se corrigió ni reinterpretó esta diferencia.
- `schema/schema.json` documenta columnas, restricciones e índices, pero **no contiene triggers ni funciones**. Las pruebas verifican los tipos, precisión y expresión generated de las seis tablas relevantes contra ese archivo.
- `audit/local-postgis-validation/schema-check.json` es una captura de una base local de validación. Tampoco incluye `trg_planning_updated_at`. No prueba la ausencia de ese trigger en producción.
- Con autorización explícita del usuario, se leyeron exclusivamente definiciones en `pg_catalog`, con `default_transaction_read_only=on` y `BEGIN READ ONLY`, finalizando con ROLLBACK. La captura está en `audit/historical-adoption-schema-readonly.json`. No se consultaron registros de negocio ni se ejecutó adopción o migración en producción.
- La reproducción usa PGlite/PostgreSQL aislado en memoria con las funciones de adopción y los triggers de las tablas involucradas obtenidos de esa captura. No simula operaciones geométricas de PostGIS; el caso no las ejecuta porque no tiene ciclos y no cambia lotes.
- Se agregó inventario de prueba no vacío para comprobar igualdad completa de partidas, movimientos, productos, notificaciones y balances. No pretende reconstruir el inventario actual de producción.

## Por qué no lo detectaron las 16 pruebas anteriores

La fixture incluía las columnas y el rango generado, pero solo agregaba explícitamente el trigger de timestamp de `crop_assignments`. Faltaba el trigger real de Planning. Los datos por sí solos no reproducían el error; al instalar el trigger capturado apareció inmediatamente, sin cambiar valores del backup.

## Corrección

`20261005_preserve_adopted_planning_timestamp.sql` reemplaza solamente la función del trigger de timestamp. Conserva `OLD.updated_at` únicamente para la transición NORMAL → HISTORICAL_NO_STOCK con importación y permiso privado que coincide en transacción, proceso, tabla, registro e importación. En cualquier otra edición sigue asignando `now()`.

El acceso al permiso privado usa SECURITY DEFINER con search_path fijo. La función no queda invocable por PUBLIC ni por roles de aplicación. No se elimina ni desactiva ningún trigger, no se amplía la lista de campos aceptados y no se alteran datos existentes al aplicar la migración.

`20261005_historical_adoption_diagnostics.sql` conserva las condiciones originales de rechazo y añade DETAIL JSON con etapa, tabla y diferencias antes/después. El servicio conserva ese diagnóstico en una propiedad no enumerable; el middleware lo registra exclusivamente en logs. La respuesta HTTP no lo incluye. La UI no cambió.

**Requiere migraciones SQL y el cambio de código del backend para los logs. No alcanza con desplegar el backend.** Las dos migraciones nuevas están preparadas para revisión después de `20261004_adopt_existing_history.sql`; no se aplicaron en producción. El trigger existente debe permanecer instalado.

## Pruebas

Comando ejecutado desde `growsync-backend`:

```text
node --test tests/historicalAdoptionBackup.integration.test.js tests/historicalAdoption.integration.test.js tests/historicalNoStock.integration.test.js tests/stockInitial.integration.test.js
```

Resultado: 46 pruebas, 45 aprobadas, 1 omitida por su configuración previa (aceptación integral del backup), 0 fallos. La nueva regresión del caso específico **sí se ejecutó**.

Después de reforzar la reconstrucción para cargar también las funciones capturadas del esquema instalado, se repitió `historicalAdoptionBackup.integration.test.js`: 4/4 aprobadas.

Comprobaciones nuevas: reproducción previa del fallo; diff exacto; éxito corregido en UTC y Buenos Aires; igualdad de todos los campos de Planning y Usage salvo los dos cambios autorizados; igualdad de relaciones, timestamps, rango generado e inventario; reintento idempotente; timestamp actualizado en ediciones ordinarias; cambio de modo por vía ordinaria rechazado; alteración deliberada de cantidad bloqueada con diagnóstico exacto y rollback completo; diagnóstico presente en logs y ausente en respuesta HTTP.

## Archivos modificados o agregados

- `growsync-backend/migrations/20261005_preserve_adopted_planning_timestamp.sql`
- `growsync-backend/migrations/20261005_historical_adoption_diagnostics.sql`
- `growsync-backend/services/historicalAdoption.js`
- `growsync-backend/middleware/errorHandler.js`
- `growsync-backend/tests/historicalAdoption.integration.test.js`
- `growsync-backend/tests/historicalAdoptionBackup.integration.test.js`
- `audit/historical-adoption-schema-readonly.json`
- `audit/historical-adoption-t1-diagnosis.md`