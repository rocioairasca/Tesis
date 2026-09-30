# Backup pre-reset — Don Santiago SRL

ESTE BACKUP REPRESENTA EL ESTADO PREVIO AL RESET.

NO ES UNA NORMALIZACIÓN DE LOS DATOS.

Empresa: 2791ea15-7dad-48e2-945b-3791e2d44478. Captura UTC: 2026-09-16 18:01:40.932802+00.

## Alcance

Todos los registros públicos con company_id de Don Santiago y tablas dependientes descubiertas mediante claves foráneas, sin filtrar enabled ni status. Ver schema/selections.json y schema/schema.json. Los catálogos globales no son datos de la empresa; se incluyen las definiciones de SRID utilizadas. Exclusiones y excepciones se documentan, no se corrigen.

## Corte y contexto

Inicio de inventario definido: 31/08/2026. Es la fecha de inicio del control físico declarado; NO fecha de compra. No usar created_at como fecha de compra o fecha operativa. Hay actividades históricas anteriores al corte. Planning.title y Planning.description contienen información agronómica, unidades, variedades, tratamientos y referencias espaciales solo en texto libre. Se conservan literalmente, incluidos NULL y saltos de línea.

Se incluyen lotes deshabilitados, ambos T3, 5-6 bajo, 5-6-7, 5-6-7 completo, layouts locked/active/draft y sublotes. No se infieren vigencias físicas de created_at/activated_at. Las actividades al lote completo no reciben un layout nuevo.

## Formato recuperable

Cada data/*.json es un array de filas con todas las columnas, producido como texto JSON por PostgreSQL. Números NUMERIC conservan su precisión decimal en los bytes del archivo; NO reserializar con Number de JavaScript para una restauración. Usar parser decimal/lossless o procesamiento JSON de PostgreSQL. Se preservan UUID, NULL, timestamps con microsegundos, unidades y textos. Las columnas geometry/geography se codifican como cadena hexadecimal EWKB NDR (o NULL). Para restaurarlas se requiere ST_GeomFromEWKB(decode(valor,'hex')), con el tipo original indicado en schema/schema.json.

Geometries/*.json incluye EWKB exacto, SRID, EWKT y GeoJSON de consulta; EWKB es la representación autoritativa de restauración. No se simplificaron ni corrigieron geometrías. location, area y area_ha permanecen en las filas originales.

## Tablas

| Tabla | Filas actuales | Esperadas previamente |
|---|---:|---:|
| campaigns | 3 | 3 |
| companies | 1 | 1 |
| crop_assignments | 13 | 13 |
| crops | 6 | 6 |
| fuel | 0 | sin conteo previo |
| harvest_crop_assignments | 11 | 11 |
| harvest_cycle_closures | 0 | 0 |
| harvest_records | 11 | 11 |
| invitations | 2 | sin conteo previo |
| lot_layouts | 21 | 21 |
| lots | 18 | 18 |
| notifications | 82 | sin conteo previo |
| planning | 25 | 25 |
| planning_lots | 25 | 25 |
| planning_product_completions | 24 | 24 |
| planning_products | 25 | 25 |
| plans | 0 | sin conteo previo |
| products | 55 | 55 |
| rain_records | 24 | sin conteo previo |
| stock_batches | 0 | 0 |
| stock_movements | 0 | 0 |
| sub_lots | 8 | 8 |
| usage_lots | 14 | 14 |
| usage_records | 24 | 24 |
| users | 2 | 2 |
| vehicle_fuel_records | 0 | sin conteo previo |
| vehicles | 0 | 0 |

## Verificaciones

Ver verification.json: comparación exacta de archivos con una SEGUNDA transacción READ ONLY, conteos, FK, relaciones semánticas, pertenencia de empresa, 25 textos Planning y roundtrip EWKB. Resultado de controles requeridos: CORRECTO. No se restauró sobre producción ni se creó infraestructura.

## Recuperación futura

Este es un backup lógico de datos de la empresa, no una imagen completa del servidor. Requiere un esquema compatible, PostGIS y las definiciones de tipos/constraints registradas. Preservar IDs explícitos. Revisar columnas generated/identity y triggers antes de restaurar; no ejecutar rutas funcionales que descuenten stock. Hay ciclos entre planning/usage/completions: un futuro procedimiento deberá planificar el orden y el tratamiento de constraints en un entorno de recuperación autorizado. No se incluye un restaurador ni se ejecuta SQL de escritura. Verificar nuevamente checksums antes de usar. Las credenciales y secretos de conexión no están incluidos.

## Ambigüedades conocidas

Duplicados y unidades problemáticas de inventario se conservan; las cantidades actuales no certifican saldos originales. Las modificaciones legacy no tienen movimientos completos. Hay una cosecha declarada el 11/09 cargada el 02/09; no se clasifica como prueba. No convertir dosis textuales en Usage. No reasignar historia a divisiones actuales.

## Evidencia complementaria

- D:\Proyectos\Tesis\audit\inventory-data-2026-09-13.json → evidence/audit/inventory-data-2026-09-13.json
- D:\Proyectos\Tesis\audit\inventory-schema-2026-09-13.json → evidence/audit/inventory-schema-2026-09-13.json
- D:\Proyectos\Tesis\audit\inventory-audit-2026-09-13.md → evidence/audit/inventory-audit-2026-09-13.md
- D:\Proyectos\Tesis\audit\harvest-reconciliation\2026-09-09T01-19-54-058Z-before.json → evidence/audit/harvest-reconciliation/2026-09-09T01-19-54-058Z-before.json
- D:\Proyectos\Tesis\audit\harvest-reconciliation\2026-09-09T01-19-54-058Z-result.json → evidence/audit/harvest-reconciliation/2026-09-09T01-19-54-058Z-result.json

Son copias byte por byte de archivos anteriores, no sustituyen esta captura de DB y pueden describir estados previos o metadata global. Los informes de esta conversación que no existen como archivos del repositorio no se presentan como archivos exportados.

## Integridad de archivos

manifest.json registra tamaños y SHA-256 de los archivos de contenido. SHA256SUMS.txt cubre también manifest.json. SHA256SUMS.txt no se autohashea: es el índice raíz. Esta convención evita referencias circulares.

CAMBIOS EN BASE DE DATOS: NINGUNO.
CAMBIOS FUNCIONALES EN CÓDIGO: NINGUNO.
RESET: NO EJECUTADO.

No ejecutar el reset sin confirmación explícita.
