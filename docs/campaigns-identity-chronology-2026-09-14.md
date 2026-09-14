# Regla global: identidad y cronología de campañas

Implementada en el workspace el 14/09/2026. No desplegada. No requiere migración y no se modificaron datos reales.

## Contrato compartido

`grow-sync/src/utils/campaigns.mjs` centraliza presentación, período secundario, identidad de selectores y orden por fechas. Debe reutilizarse en futuras estadísticas y módulos.

- Nombre válido: se muestra el nombre real sin regenerarlo desde fechas.
- Nombre ausente o compuesto solo por espacios: período visual desde inicio/fin, por ejemplo `2026/27`. Sin fechas, se conserva el texto legacy disponible o `No informada`.
- Cronología: exclusivamente `campaign_start_date`, `campaign_start` o `start_date` de la entidad campaña. Nunca se interpreta el nombre como año. La fecha de inicio de un cultivo asociado no sustituye una fecha de campaña ausente.
- Gráficos: orden ascendente; selects: descendente. Fechas ausentes al final, empates estables en frontend. El servidor utiliza ID como desempate, nunca nombre.
- Se conservan ID, nombre y fechas en las filas; dos IDs con el mismo nombre siguen siendo campañas diferentes.
- Sin fechas completas, no se dibuja una tendencia temporal: Dashboard presenta barras categóricas y Cosechas un listado con aclaración.

## Lugares detectados y corregidos

| Lugar | Antes | Ahora |
| --- | --- | --- |
| Dashboard y Cosechas, `chartPresentation.mjs` | Extraía años del texto del nombre | Usa fechas canónicas y conserva nombre/ID |
| Estadísticas de Cosechas por campaña | GROUP BY y ORDER BY nombre | Agrupa por ID; ordena por inicio; conserva grupos legacy sin ID |
| Filtros de estadísticas | Nombres ordenados alfabéticamente | Metadatos de campañas ordenados por inicio descendente |
| Listado `/campaigns` | Estado, inicio y desempate por nombre | Inicio descendente, ID como desempate |
| Lotes, selector de campañas | `.sort()` sobre nombres | Metadatos del estado productivo, orden por fechas y selección por ID |
| Planificaciones | Nombre directo y fechas completas en opciones | Helper compartido, nombre principal y período secundario |

Tablas, detalles, formularios y vistas deshabilitadas de Cosechas reutilizan el helper. Planificaciones conserva las fechas explícitas en la administración de campañas y en ayudas de compatibilidad: allí son datos operativos editables o necesarios para entender el rango de trabajo. No se modificaron reglas de compatibilidad de fechas.

## API y compatibilidad

`controllers/harvestRecords.js` agrega `campaign_id`, `campaign_name`, `campaign_start_date` y `campaign_end_date` a las estadísticas y fechas al listado de registros. `/stats/filters` conserva `campaigns: string[]` y añade `campaign_details` para los clientes nuevos. Listado, resumen y estadísticas por cultivo aceptan ID en el parámetro existente `campaign`, manteniendo filtros legacy por texto.

Los filtros nuevos usan ID. Los consumidores antiguos que envíen nombre conservan su semántica anterior y pueden seleccionar varias campañas homónimas; no deben utilizarse para una selección inequívoca. Las cosechas legacy sin relación con una campaña permanecen agrupadas por su texto almacenado y sin fecha inferida.

`controllers/planning.js` y `controllers/lots/productiveState.js` agregan fechas de campaña a sus respuestas. No cambian rutas ni permisos. Se conserva el campo histórico `harvest_records.campaign` exigido por el modelo existente: no se lo utiliza para reemplazar el nombre real ni para inferir la cronología. No se reescribió ese historial ni `campaigns.name`.

## Validación

- 58 pruebas frontend aprobadas; cobertura de nombres libres, años aparentes sin fecha, fallback, fechas inválidas, empates, selectores por ID y cantidades intactas.
- 11 pruebas de integración PostgreSQL aislado aprobadas, incluyendo orden Gruesa/Especial, campañas homónimas separadas, filtro por ID y fallback sin persistir un nombre generado.
- Después del último ajuste se repitieron las pruebas específicas de campañas/gráficos/presentación de cosechas y el build: aprobados.
- Build Vite aprobado. Persisten avisos existentes de configuración ESM, chunks grandes y HMR compartido entre suites SSR.
- No se realizó validación contra la base real ni despliegue en esta tarea. Los clientes antiguos sin metadatos muestran categorías, sin inventar una tendencia a partir de sus etiquetas.
