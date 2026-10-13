# Storage privado para análisis de suelo — preparación manual

Este documento no ejecuta ninguna operación. No crear el bucket ni aplicar SQL desde esta tarea. No subir el PDF de ejemplo ni datos reales.

## Prerrequisitos

Revisar y aplicar, en un despliegue autorizado posterior, la migración PostgreSQL completa de `growsync-backend/migrations/20261013_soil_analysis.sql`. No contiene creación de buckets, datos de laboratorio, cambios de Lotes, inventario ni estado productivo.

## Bucket

En el proyecto correcto de Supabase, crear manualmente un bucket **privado** llamado **soil-reports**. Configurar límite de archivo **10485760 bytes (10 MiB)** y tipos permitidos **application/pdf**. No habilitar Public ni agregar políticas de lectura/subida directa desde el navegador.

Alternativa SQL para revisión y ejecución manual autorizada, separada de la migración de tablas:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('soil-reports', 'soil-reports', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'soil-reports';
```

Si el bucket ya existe, revisar su configuración y políticas; este SQL no lo modifica. Debe devolver public=false y los límites indicados. El backend consulta esa condición antes de subir o firmar un documento y rechaza un bucket público. Revisar también políticas globales de storage.objects para que no concedan acceso directo a este bucket. Las operaciones del módulo se realizan solamente con la credencial privilegiada del backend.

## Variables del backend

- SUPABASE_URL: URL del proyecto.
- SUPABASE_SERVICE_ROLE_KEY: credencial secreta de servidor. Es obligatoria para la integración de Storage de este módulo; el fallback anon del cliente existente no habilita uploads.
- SUPABASE_DB_URL o DATABASE_URL: conexión SQL privilegiada existente.

No copiar la service role al frontend ni usar prefijos VITE_. El frontend envía el PDF al API autenticado, no a Supabase directamente. No se necesitan nuevas variables del frontend.

## Documentos y acceso

El objeto usa el path determinista generado por servidor: {company_id}/{report_id}/report.pdf. El nombre original se conserva como metadata saneada, nunca controla la ruta. MIME y firma inicial %PDF- se validan en servidor. No se guarda base64, contenido del PDF ni URLs en PostgreSQL.

GET /api/soil-analysis/:id/file-url valida pertenencia y permisos, consulta que el bucket siga siendo privado y genera una URL de 300 segundos. Responde con Cache-Control: no-store. El frontend mantiene la URL solo en memoria, la renueva antes de vencer y cancela timers/peticiones al cerrar. No se puede revocar individualmente una URL ya emitida: su exposición está acotada a esos cinco minutos. Deshabilitar impide nuevas firmas a usuarios sin permiso de ver deshabilitados.

La creación valida datos y referencias antes del upload, revalida referencias bajo bloqueo en la transacción SQL y compensa borrando el objeto si esa operación falla. Si la limpieza también falla, se conserva el error original y se registra el fallo para recuperación operativa. Deshabilitar/restaurar conserva el PDF y sus muestras/resultados. No hay reemplazo ni borrado físico de PDF en Fase 1.
