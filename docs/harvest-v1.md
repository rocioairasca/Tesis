# Cosechas V1

Implementación preparada; la migración `growsync-backend/migrations/20260909_harvest_registration_trace.sql` NO se ejecutó en Supabase. Aplicarla con autorización antes de desplegar este backend y frontend juntos: los SELECT/INSERT de trazabilidad requieren las columnas nuevas. No ejecutar nuevamente las migraciones anteriores.

## Contrato y procedencia

- Se reutilizan POST/PUT/GET `/harvest-records`, GET `/harvest-records/context`, POST `/harvest-records/cycles/:assignmentId/finalize` y GET `/lots/:lotId/history`.
- Crear requiere `registered_retroactively` booleano; histórico requiere `retroactive_reason` y, para `other`, `retroactive_notes`. Se admite hasta 2000 caracteres. Los motivos son `pending_record`, `historical_regularization`, `information_correction`, `other`.
- `registration_timezone` es la zona IANA del navegador. El servidor calcula hoy usando su propio reloj en esa zona; no acepta una fecha “hoy” enviada por el cliente. El valor se conserva para explicar el modo elegido. Si falta la zona, se usa Argentina por compatibilidad.
- Actual exige fecha de hoy; histórica exige fecha anterior; ninguna admite futuro. En edición, fecha y procedencia documentadas se preservan. Los legacy sin procedencia conservan NULL, incluso al corregir cantidades: no se infieren ni reclasifican automáticamente.
- `created_by` sale del usuario autenticado y `created_at` del default de PostgreSQL; no se aceptan cambios por payload de edición. `harvest_date` continúa siendo un DATE efectivo. La UI muestra usuario por ID estable, sin consultar usuarios de otras empresas.
- Las cuatro columnas nuevas son nullable, sin defaults y sin backfill. Los CHECK preservan NULL legacy y exigen una combinación coherente para registros nuevos documentados.

## Contexto y finalización

Se muestran todas las asignaciones devueltas por el resolver existente, incluyendo cultivo, campaña, inicio, fecha efectiva, días, total, acumulado y pendiente. El guardado vuelve a resolver y validar bajo los locks/transacción existentes. No se agrega un calendario agronómico ni un umbral: no hay una regla confiable documentada en el proyecto. Los errores temporales estructurales se muestran y siguen bloqueándose; no existen advertencias orientativas que puedan omitirse, por lo que no se agrega un campo de justificación sin uso.

Finalizar usa la ruta con permiso HARVEST_EDIT, el mismo ledger/snapshot y bloqueo por empresa/lote/ciclo. Verifica fecha no futura, motivo, pendiente, cierre previo y ausencia de solapamiento con otros ciclos. No guarda la jornada que está aún en el formulario; el modal lo aclara y confirma el pendiente que quedará en el historial. El snapshot histórico es inmutable.

## Validación funcional pendiente

Tras autorizar/aplicar la migración y desplegar, probar en el escenario temporal aislado: modo actual, cambiar a histórica conservando datos, Otro, rechazo de futuro, varias asignaciones, 20,00 + 20,00 + 8,03 ha y cierre automático. Para probar finalización manual usar un ciclo temporal diferente o un escenario reiniciado con autorización, porque un ciclo completo no puede cerrarse manualmente. Verificar móviles, detalle e historial, usuario, timestamps y procedencia legacy. No crear nuevas cosechas productivas para estas pruebas.
