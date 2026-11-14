# Remitos P2A — contrato y seguridad

## Alcance
Captura manual/documento → borrador → pendiente de revisión → corrección o rechazo.
No existen aprobación, IA/OCR, generación de productos, partidas, movimientos ni costos oficiales.
No se cambiaron roles ni permisos predeterminados. Se usan `custom_permissions` y `all` existentes.
Un usuario con solo `receipts.capture` puede usar `/remitos` y su buscador operativo sin `inventory.*`.
La navegación desktop y mobile incorpora Remitos; la ruta y la API verifican permisos.

## Migración
`growsync-backend/migrations/20261114_receipt_submissions.sql` crea cabecera, líneas y economía separada.
Incluye RLS y revocación de acceso directo de `anon`/`authenticated`. La aplicación accede por el backend autenticado.
La migración solo se prueba en PGlite desechable: NO se ejecutó en Supabase.
Los campos económicos son preparación para fases futuras, sin endpoints de escritura en P2A.

## Permisos
- `receipts.capture`: creación, listado propio, lectura propia, modificación de borrador propio, documento y envío propio.
- `receipts.review`: bandeja de empresa, lectura, corrección operativa de borradores/pendientes y rechazo de pendientes.
- `receipts.view_economics`: junto a review permite consultar la sección económica del detalle si existe.
- `receipts.approve`: reservado; no habilita rutas ni transiciones en P2A.
Rechazados son inmutables en P2A. Correcciones y rechazo registran reviewed_by/reviewed_at; abrir el detalle no marca una revisión completada.

## Endpoints /api/receipts
- POST `/`: crear borrador (capture).
- GET `/mine`: lista propia (capture).
- GET `/review`: bandeja de empresa (review).
- GET `/products?search=`: exclusivamente id/name/unit de hasta 50 productos activos propios (capture o review).
- GET `/:id`: detalle propio o de empresa para review.
- PATCH `/:id`: datos operativos; creator/draft o reviewer/draft|pending.
- PUT `/:id/lines`: `{lines: [...]}`; reemplazo transaccional, mismo control de edición.
- POST `/:id/submit`: cuerpo `{}`; creador/draft → pending_validation. Requiere una línea, no exige match ni documento.
- POST `/:id/reject`: `{reason: string}`; reviewer/pending → rejected.
- PUT `/:id/document`: multipart con un único `file`; capture, borrador propio.
- GET `/:id/document-url`: autorización propia/review antes de generar URL privada por 60 segundos.

Filtros de listas: `page`, `pageSize` (máximo 100), `status`, `document_date`, `supplier_name`.
Respuesta: `{data: [cabecera], total_count: number, page: number, pageSize: number}`.
`total_count` es cantidad de registros; no existe clave monetaria `total` en el DTO operativo.

## DTO operativo exacto
POST, PATCH, PUT de líneas/documento y submit/reject responden el detalle operativo. GET detalle puede añadir economía solo con review + view_economics.
La lista contiene exactamente las mismas claves de cabecera, sin `lines` ni `warnings`.

```json
{
  "id": "uuid",
  "company_id": "uuid",
  "created_by": "uuid",
  "status": "draft | pending_validation | rejected",
  "supplier_name": null,
  "supplier_tax_id": null,
  "document_number": null,
  "document_type": null,
  "source_filename": null,
  "source_mime_type": null,
  "source_storage_key": null,
  "notes": null,
  "submitted_at": null,
  "reviewed_at": null,
  "reviewed_by": null,
  "rejected_at": null,
  "rejected_by": null,
  "rejection_reason": null,
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp",
  "document_date": null,
  "created_by_name": "nombre o email",
  "line_count": 1,
  "lines": [{
    "id": "uuid",
    "receipt_id": "uuid",
    "line_number": 1,
    "raw_description": "Descripción documental",
    "quantity": "2.123456",
    "unit": "kg",
    "presentation": null,
    "supplier_batch": null,
    "expiration_date": null,
    "matched_product_id": null,
    "match_status": "unmatched | proposed",
    "created_at": "ISO timestamp",
    "updated_at": "ISO timestamp"
  }],
  "warnings": []
}
```
Campos de texto/fechas opcionales pueden ser string o null; quantity es string decimal o null.
No hay objeto economics ni claves económicas con null para captura/review sin permiso económico.
El origen del nombre del cargador está filtrado por la misma empresa.

## Escritura y garantías
Metadata permitida: supplier_name, supplier_tax_id, document_number, document_date, document_type, notes.
Línea permitida: raw_description, quantity, unit, presentation, supplier_batch, expiration_date, matched_product_id.
Todos los objetos usan Zod strict. Campos económicos y de control/archivo forjados se rechazan con 400 sin reflejar valores en errores.
Los metadatos de documento se generan exclusivamente por el endpoint de upload.
Cantidad opcional positiva, hasta 6 decimales; unidad del catálogo compartido; match exige producto activo propio y unidad compatible.
La referencia de producto solo es propuesta; no genera stock.
Se bloquea la cabecera con FOR UPDATE al editar/enviar/rechazar, y el reemplazo de líneas se revierte por completo ante fallo.
Consultas operativas: columnas explícitas, sin SELECT *, sin joins/lecturas de receipt_submission_economics.
Solo GET detalle con review + view_economics ejecuta la consulta económica separada; raw_extraction no se expone.
Todas las lecturas/escrituras filtran company_id; captura además limita por created_by.
Posibles duplicados se advierten sin bloquear: empresa + proveedor (CUIT, o nombre cuando falta CUIT) + número, trim/case-insensitive, excluyendo rechazados. La advertencia no expone IDs ni contenido ajeno.

## Documentos
Se reutilizan multer y el cliente Storage privado existente de Supabase; no hay nuevas dependencias.
Bucket privado `receipt-submissions`, claves generadas por servidor empresa/remito/UUID, máximo 10 MB, PDF/JPEG/PNG con verificación de firma.
La migración prepara el bucket y agrega política restrictiva para impedir acceso de anon/authenticated incluso si hay políticas previas permisivas.
No hay URLs públicas, base64 en DB, OCR ni procesamiento de imagen. La descarga es del original documental, sin transformación/redacción.
Si el bucket/credenciales no están disponibles o el bucket es público, upload falla cerrado; se puede quitar el archivo y guardar manualmente.
Las fallas de subida/SQL intentan limpiar el objeto nuevo; reemplazos limpian el anterior después de confirmar la transacción.
No se consultó ni modificó Storage real; los tests inyectan un adaptador sintético.

## Evidencias reproducibles
- `growsync-backend/tests/receipts.integration.test.js`: HTTP + SQL PGlite, DTO exacto, ausencia recursiva de claves económicas, instrumentación de SELECT, aislamiento de empleados/empresa, permisos, rollback, estados, duplicados, Storage y RLS.
- Cada prueba P2A verifica cero filas en stock_batches/stock_movements y ausencia de consultas al inventario oficial.
- `grow-sync/tests/receipts.test.mjs`: paridad de permisos, selección de campos del payload, protección de ruta y ausencia de uso de stockService.
- `grow-sync/tests/receipts.browser.mjs`: captura, líneas, edición/eliminación, documento, envío, bloqueo de cambios, bandeja/rechazo, menú y responsive 1440/1024/390 con datos sintéticos.
