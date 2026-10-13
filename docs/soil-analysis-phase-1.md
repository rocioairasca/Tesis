# Análisis de suelo — Fase 1

Dominio Lotes. Entrada contextual Análisis de suelo en acciones de lote y división; ambas navegan al padre /lotes/:lotId/analisis-suelo. La división usa subLotId como filtro/preselección. No se agrega navegación principal ni se cambia Ver detalle y divisiones.

## Arquitectura y modelo

soil_reports identifica el PDF original y sus metadatos; soil_samples admite varias muestras de lotes/divisiones de la empresa, fechas y profundidades; soil_sample_results guarda parámetro, método, unidad, raw_value exacto, numeric_value opcional y status. La migración tiene controles de tenant en DB, profundidad, valores NaN, N.R., PDF/ruta inmutables, índices y RLS sin acceso directo del navegador. No incluye datos, backfill ni bucket.

Los endpoints usan company_id del usuario autenticado. Metadata estricta rechaza company_id, URLs, rutas de Storage, IDs y campos no soportados del cliente. Las consultas siempre filtran tenant. El helper decimal admite coma explícitamente, valida tamaño/precisión sin aritmética float y conserva raw_value sin trim. No deriva numeric_value del resultado original: debe cargarlo el usuario. No requerido requiere numeric_value=null; cero es un valor medido diferente. Cualitativo admite valores como <0,1 sin número.

Crear valida archivo/metadata/referencias, sube a bucket privado y guarda las tres tablas en una transacción; errores disparan compensación Storage. Editar recibe metadata completa y reemplaza muestras/resultados atómicamente (sus IDs se regeneran), conservando ID del informe, creador y PDF. Soft delete modifica solo enabled/updated_at y conserva documentos y filas hijas.

## API autenticada

- GET /api/soil-analysis: lot_id, sub_lot_id, from, to; enabled=true|false|all. includeDisabled=true es alias de all si no se envió enabled. Las fechas filtran sample_date de la misma muestra que coincide con lote/división. Informes ordenados por la fecha más reciente de las muestras coincidentes; pantalla ordena cada muestra descendente.
- GET /api/soil-analysis/lot-context/:lotId: nombres de lote/divisiones de la empresa para esta pantalla y formulario; permite permisos personalizados de suelo sin depender de lots.edit/view. No devuelve geometría ni datos productivos.
- GET /api/soil-analysis/:id: informe y todas sus muestras/resultados de la empresa.
- POST /api/soil-analysis: multipart/form-data, un file PDF y metadata JSON.
- PUT /api/soil-analysis/:id: metadata JSON completa. No admite reemplazo de PDF.
- DELETE /api/soil-analysis/:id: deshabilita.
- POST /api/soil-analysis/:id/enable: restaura.
- GET /api/soil-analysis/:id/file-url: URL temporal del documento propio; exige view, y view_disabled si está deshabilitado.

Sin archivo, MIME incorrecto, firma incorrecta, PDF vacío, metadata/referencias inválidas o intento de campos privados: rechazo antes de Storage. Exceso de 10 MiB: 413. Falta de permisos: 403. Registro ajeno o deshabilitado sin permiso de lectura: 404. Fallos de Storage: 503. Los errores técnicos pasan por el handler existente.

## Permisos

soil_analysis.view, create, edit, disable, enable, view_disabled. Empleado ninguno; Supervisor view/create; Dueño los seis; Admin all. Los custom_permissions sustituyen defaults como antes. Editor de permisos muestra el nuevo grupo con textos en español. API de creación/edición/baja/restauración requiere su permiso específico y no reutiliza lots.edit.

## UI

Historial por lote con filtro de división/lote completo, período y estado (con permiso). Formulario manual permite múltiples muestras y resultados libres. No inventa profundidad ni fecha por defecto. Detalle con metadata/resultados y PDF a dos columnas cuando hay ancho; mobile muestra Ver PDF y preview debajo. N.R. se presenta como No requerido, con texto original en tooltip. Los destacados solo coinciden exactamente con pH, Materia Orgánica, Fósforo y N-NO3, configurados en soilAnalysisModel.mjs. Otros parámetros aparecen en resultados sin equivalencias ni interpretación.

PDF nativo en iframe, link Abrir PDF con noopener/noreferrer, URL en memoria, cancelación/renovación y fallback si el navegador o servicio no permite preview. Se usa Axios multipart mediante el API autenticado; no se importan credenciales privilegiadas.

## Dependencias y alcance

Multer 2.4.0 (memoryStorage, un archivo, límite 10 MiB; metadata 2 MiB). No se incorpora librería pesada de PDF. No hay IA, OCR, extracción, interpretación, recomendaciones, equivalencias automáticas, notificaciones, exportación ni datos reales cargados.

La migración completa está en growsync-backend/migrations/20261013_soil_analysis.sql. Setup privado, SQL manual y variables: docs/soil-analysis-storage-setup.md. Ambos quedan preparados sin aplicarse ni crear bucket.

Las muestras solo se vinculan a divisiones active/locked/archived. Los borradores se excluyen del selector y se rechazan en API/DB para conservar el flujo existente de edición, reemplazo y eliminación de borradores. No se modifica ningún controlador de divisiones.

## Archivos de entrega

Modificados:
- grow-sync/src/App.jsx
- grow-sync/src/components/users/UserTable.jsx
- grow-sync/src/constants/permissions.jsx
- grow-sync/src/features/lots/LotsOverview.jsx
- growsync-backend/constants/permissions.js
- growsync-backend/index.js
- growsync-backend/package.json
- growsync-backend/package-lock.json

Creados:
- growsync-backend/migrations/20261013_soil_analysis.sql
- growsync-backend/routes/soilAnalysis.js
- growsync-backend/services/soilAnalysis.js
- growsync-backend/validations/soilAnalysis.schema.js
- growsync-backend/tests/soilAnalysis.integration.test.js
- grow-sync/src/features/lots/soilAnalysis/SoilAnalysis.jsx
- grow-sync/src/features/lots/soilAnalysis/SoilAnalysisForm.jsx
- grow-sync/src/features/lots/soilAnalysis/SoilPdfPreview.jsx
- grow-sync/src/features/lots/soilAnalysis/soilAnalysisModel.mjs
- grow-sync/src/features/lots/soilAnalysis/soilAnalysis.css
- grow-sync/tests/soilAnalysis.test.mjs
- grow-sync/tests/soilAnalysis.browser.mjs
- grow-sync/tests/soilAnalysis.fixture.jsx
- docs/soil-analysis-storage-setup.md
- docs/soil-analysis-phase-1.md

## Verificación

Backend completo: 512 tests, 507 aprobados, 5 omitidos condicionales por recursos externos de backup/PostgreSQL/PostGIS, 0 fallos. Suite suelo: 21 aprobados (incluida en el total; comprobada nuevamente tras ajustar mensajes de validación al español). PGlite descartable y Storage mockeado, sin Supabase real.
Frontend relacionado: 15 aprobados, 0 fallos (suelo, Lotes, encuadre y patrones compartidos). Browser suelo: 5 aprobados, 0 fallos, con APIs sintéticas, URLs externas bloqueadas y 1440/1024/390 px. Incluye navegación desde división, múltiples muestras, multipart, N.R., fallback/preview, edición sin PDF, soft delete/restauración y permisos.
Build frontend correcto; revisión de diff completo y archivos nuevos, git diff --check correctos. Los archivos temporales de prueba se eliminan. Sin commit, push, deploy, aplicación de migración, creación de bucket, uploads reales ni cambios de datos productivos.
