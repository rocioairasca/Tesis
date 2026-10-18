# Análisis de Suelo — Fase 2

## Alcance y configuración
La carga manual de Fase 1 y el POST/PUT definitivo no cambian. No hay migraciones.
La extracción está verificada con **Node.js 20.20.2**. Se fija unpdf 1.7.0 (PDF.js 5.6.205 incluido).
La versión anterior unpdf 1.9.0 declaraba engines.node >=22; esa era la causa del requisito, no un SDK de OpenAI.
unpdf 1.7.0 no declara engines ni dependencias transitivas; no se presupone compatibilidad por esa ausencia: el worker y el parser real se ejecutaron con Node 20.20.2.
El peer opcional @napi-rs/canvas no está instalado ni se necesita para leer texto. No se agregó el paquete openai: la integración usa fetch y AbortController nativos del servidor.
Variables exclusivamente del backend:
- OPENAI_API_KEY: clave del proyecto autorizado de OpenAI. No usar prefijo VITE_ ni exponerla al navegador.
- SOIL_EXTRACTION_MODEL: opcional, por defecto gpt-4.1-mini; debe admitir Responses + Structured Outputs.
Sin clave/configuración válida, la extracción falla de forma controlada y la carga manual permanece disponible.
No se hicieron llamadas reales al proveedor ni se modificó configuración productiva.

## Arquitectura y contrato
POST /api/soil-analysis/extract, multipart/form-data con un único campo file, permiso soil_analysis.create.
Comparte multer y validateFile con la carga definitiva: MIME application/pdf, 1–10 MiB, magic %PDF-.
No acepta metadata ni IDs de empresa/lote. No accede al pool ni a Storage.
Respuesta 200, Cache-Control no-store:
{ report_number, laboratory, received_date, notes, samples, warnings }.
Cada muestra contiene sample_date, depth_from_cm, depth_to_cm, sample_name,
position_description, sampled_by, notes y results. No devuelve lot_id/sub_lot_id.
Resultados: parameter_name, method, unit, raw_value, numeric_value, result_status, sort_order.
Todos los campos documentales ausentes son null; las fechas completas se expresan YYYY-MM-DD.
JSON estricto con campos obligatorios y additionalProperties=false en cada objeto.
Zod valida nuevamente toda respuesta; se rechazan propiedades extra, IDs sugeridos, fechas inválidas y tipos incorrectos.

soilPdfText ejecuta PDF.js/unpdf en un worker efímero (128 MiB de heap), sin renderizar ni ejecutar JavaScript del PDF.
Lee como máximo 50 páginas / 100000 caracteres; timeout de lectura 15 s, total 45 s.
El worker se termina al completar, cancelar o exceder límites. No escribe archivos temporales.
Solo la capa de texto útil se envía a OpenAI Responses vía fetch del backend con store:false,
sin herramientas ni subida de archivos al proveedor. La respuesta se valida y adapta en soilAnalysisExtraction.
No se registran texto, PDF, respuesta del proveedor, URLs firmadas ni credenciales.
store:false evita guardar un recurso Responses; no sustituye las políticas de tratamiento de datos del proveedor.

El lector está separado para poder incorporar posteriormente lectura visual/OCR controlada.
Hoy no hay OCR ni envío visual automático: sin texto útil se devuelve 422 y se ofrece carga manual.
Esto evita introducir dependencias OCR o costos de lectura visual sin una necesidad validada.

## Reglas documentales
Los valores textuales se conservan sin traducir unidades, métodos ni denominaciones.
Se verifica presencia textual de los datos propuestos; datos no verificables se dejan null con advertencia.
Las fechas requieren fecha completa documentada; no se usan metadata ni inferencia de años.
La profundidad requiere un rango explícito verificable; la ausencia queda null.
numeric_value se deriva conservadoramente de raw_value, nunca de una cifra arbitraria del proveedor:
7,1 -> 7.1; N.R. y <0,1 -> null. Separadores con tres decimales se consideran ambiguos y quedan sin valor numérico.
N.R. se omite de results solo cuando la leyenda del propio informe lo define como análisis no requerido. El prompt pide omitirlo y el backend filtra defensivamente después de validar la propuesta y su respaldo documental. Sin definición, se conserva como qualitative con advertencia. Otros resultados cualitativos reales se conservan. El texto enviado y el PDF original no se recortan ni modifican. Si una muestra queda sin resultados, se advierte para revisión manual; no se inventan filas.
Los campos opcionales ausentes no generan advertencias. Profundidad NO CONSIGNA / NO CONSIGNADO / NO INFORMADO queda vacía y se explica como información solo cuando puede asociarse al campo y a la muestra. En documentos con varias muestras se usan secciones identificadas; si no se puede asociar con seguridad, se pide revisión. Un valor propuesto que contradice esa ausencia se descarta y requiere revisión. Los textos del modelo se normalizan para no exponer nombres internos.
El contrato warnings sigue siendo string[] y el schema del proveedor no cambia: el backend identifica sus avisos informativos con el prefijo legible Información:; la UI lo retira al agruparlos. Todo aviso sin esa marca, incluidos mensajes anteriores, exige revisión. Nunca se acepta una marca de información del modelo sin validación documental.
Estas verificaciones no garantizan asociación semántica perfecta entre filas: siempre hay revisión humana.

## UX
Nuevo análisis ofrece Cargar desde PDF (principal) y Completar manualmente.
El archivo permanece solo en memoria hasta guardar.
Tras analizar aparece Datos extraídos del PDF · Revisá antes de guardar. Al final, Información detectada en el PDF presenta ausencias documentadas y N.R. omitidos en tono informativo; Revisá estos datos antes de guardar presenta ambigüedades y valores no confirmados.
Todas las muestras extraídas empiezan sin lote ni división, incluso desde una ruta contextual.
El usuario selecciona cada lote/división. Al final de todas las muestras y resultados, después de las advertencias e inmediatamente antes de las acciones, confirma que revisó los datos contra el PDF. La carga manual no muestra esa confirmación.
Editar valores del informe, muestras o resultados, cambiar el PDF o volver a analizar reinicia la confirmación. Expandir tarjetas no la reinicia.
Solo entonces puede guardar usando el mismo multipart final con PDF original + metadata confirmada.
Cambiar archivo invalida la propuesta; cancelar cierra/aborta y descarta datos sin persistir nada.
Si falla: No pudimos leer automáticamente este PDF. Podés volver a intentarlo o completar el análisis manualmente.
Desktop/tablet usan una tabla de Parámetro, Método, Unidad, Resultado y Acción; mobile usa tarjetas expandibles con los mismos datos. Resultado muestra numeric_value en es-AR sin ceros sobrantes, o raw_value cuando no hay valor numérico. El detalle y los destacados usan la misma presentación.
La edición de Resultado conserva el texto escrito en raw_value y actualiza numeric_value/result_status: decimal completo con coma o punto → measured; texto/comparaciones → qualitative, numeric_value null. Los decimales que exceden la precisión de Number se conservan como string decimal en el payload admitido por el backend. Al enfocar no se alteran datos; al editar se invalida la revisión. No hay selector de estado ni campo numérico adicional. Los registros históricos no editados conservan sus tres valores internos, incluido not_requested.
Se mantienen validaciones de parámetros/resultados mínimos; errores de validación expanden las tarjetas mobile.

## Pruebas y fixtures
IA y Storage están simulados. El PDF de laboratorio real no fue adjuntado:
se genera un PDF válido sintético con campos de referencia S26-0385 / fechas / profundidad / valores,
sustituyendo denominaciones personales por texto sintético. No se descargaron documentos productivos.
Las pruebas ejecutan el parser real sobre este PDF y simulan respuestas/errores/refusal/timeout de OpenAI.
Las pruebas de navegador cubren carga manual, revisión, corrección, lote manual, confirmación, cancelación
y 20 resultados a 1440/1024/390 px. Cubren la omisión documental de N.R., la conservación de cualitativos reales y la invalidación de la revisión ante cambios de datos, archivo o reanálisis.

## Archivos de esta fase
Modificados:
- growsync-backend/package.json
- growsync-backend/package-lock.json
- growsync-backend/routes/soilAnalysis.js
- grow-sync/src/features/lots/soilAnalysis/SoilAnalysis.jsx
- grow-sync/src/features/lots/soilAnalysis/SoilAnalysisForm.jsx
- grow-sync/src/features/lots/soilAnalysis/soilAnalysisModel.mjs
- grow-sync/src/features/lots/soilAnalysis/soilAnalysis.css
- grow-sync/tests/soilAnalysis.test.mjs
- grow-sync/tests/soilAnalysis.browser.mjs
- grow-sync/tests/soilAnalysis.fixture.jsx

Creados:
- growsync-backend/services/soilAnalysisExtraction.js
- growsync-backend/services/soilPdfText.js
- growsync-backend/services/soilPdfText.worker.js
- growsync-backend/services/soilExtractionMessages.js
- growsync-backend/validations/soilAnalysisExtraction.schema.js
- growsync-backend/tests/soilExtraction.fixture.js
- growsync-backend/tests/soilAnalysisExtraction.test.js
- growsync-backend/tests/soilAnalysisExtraction.integration.test.js
- grow-sync/src/features/lots/soilAnalysis/SoilExtractionEntry.jsx
- grow-sync/src/features/lots/soilAnalysis/SoilResultsEditor.jsx
- docs/soil-analysis-phase-2.md

Referencias de implementación:
https://developers.openai.com/api/docs/guides/structured-outputs
https://developers.openai.com/api/docs/models/gpt-4.1-mini
https://github.com/unjs/unpdf

## Validación ejecutada
66 tests relacionados (55 backend / 11 frontend) y 20 de navegador aprobados con Node 20.20.2. Responsive comprobado en 1440, 1024 y 390 px.
Build frontend correcto (advertencias existentes de Vite/chunks); git diff --check sin errores.
Sin producción, migraciones en bases reales, commit, push ni deploy.

## Resumen en el detalle del lote
En /lotes/:lotId/divisiones, Análisis de suelo aparece después del estado productivo y antes del editor. LotSoilAnalysisSummary consulta una sola vez GET /soil-analysis con lot_id y enabled=true; historyRows filtra las muestras del lote (también dentro de informes compartidos), ordena por fecha y limita la presentación a tres. Las fechas ausentes quedan al final; los empates conservan el orden estable del endpoint. Se reutilizan depthText y highlights, que usa resultText. No hay interpretaciones agronómicas.
El endpoint actual devuelve los informes completos y sus resultados en una consulta: no se agregaron paginación, endpoints ni llamadas por muestra. El límite de tres es de presentación, no de descarga.
La sección solo se monta con soil_analysis.view y muestra carga, error con reintento, vacío o resultados. Nuevo análisis/Cargar análisis exige soil_analysis.create. Su carga es independiente del estado productivo y las divisiones. La navegación respeta los cambios pendientes del editor.
Ver todos abre el historial contextual. Ver análisis usa ?reportId para abrir el modal ya existente, verificando que el informe esté en el historial del lote. Nuevo análisis usa ?new=true y el editor existente con contexto de lote; la carga manual lo preselecciona y la extracción conserva su revisión de ubicación explícita. Los parámetros de entrada se consumen sin persistirlos ni reabrir el modal al cerrarlo.
Validación de esta integración con Node 20.20.2: 21 tests frontend relacionados (soilAnalysis, lotsOverview y lotsMapViewport) y 24 tests de navegador aprobados; responsive 1440/1024/390. Build correcto con aviso de tamaño de bundles; git diff --check sin errores. Backend sin cambios.
