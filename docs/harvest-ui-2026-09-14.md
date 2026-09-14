# Cosechas — adaptación UI/UX

## Alcance

Adaptación visual de Cosechas a la referencia proporcionada: jerarquía de encabezado, resumen, filtros, tabla/analítica, detalle contextual y registro en cuatro pasos. Los datos de la referencia no se incorporaron a la aplicación. La fixture usa datos simulados exclusivamente para validación local.

**Cambios de base de datos: ninguno.** No se modificaron backend, SQL, endpoints, permisos, Auth0, multitenencia, geometrías, cálculo de rendimiento, validadores de superficie ni soft delete. Se conservaron las llamadas de alta/edición y sus payloads existentes.

## Hallazgos previos y decisiones

- El registro entrega `created_by`, sin un campo separado de responsable ni nombre del autor. La interfaz dice **Registrado por**; utiliza `full_name`, luego `email`, luego **No informado**. Se resuelve el usuario actual y, para administradores con acceso a Usuarios, se reutiliza el listado paginado `/users`, incluidos autores deshabilitados. El endpoint exige rol 3; no se consulta desde otros roles. No se agregó una relación ni se expone UUID. Los autores ajenos que el usuario no puede consultar quedan con fallback neutro.
- Las estadísticas existentes no entregan cantidad de lotes. Se muestran tres Metric: superficie cosechada, producción y rendimiento ponderado. Se reutilizan `dashboardSource.production` y sus adaptadores, sin recalcular promedios ni sumar superficies como superficie única de lotes.
- El resumen estadístico considera cosechas activas y acepta campaña/cultivo. Búsqueda, superficie, procedencia y estado aplican al listado; una aclaración discreta explicita esta diferencia. El acceso a estadísticas mantiene el mínimo de rol 1 impuesto por los endpoints existentes.
- `campaign_name` y el campo histórico `campaign` pueden representar nombres de catálogo o categorías estacionales. Se conserva la etiqueta real, priorizando el nombre de catálogo. “Gruesa” no se convierte en un año. La línea aparece solo si todas las campañas del conjunto tienen una cronología reconocible y existen al menos dos períodos; de lo contrario se muestran valores por categoría con explicación.
- La búsqueda y el filtro de sublote no existen en el endpoint. Se leen todas sus páginas (100 por solicitud) y se filtra/pagina en presentación. No se busca únicamente sobre diez registros visibles. La carga incompleta muestra error, no resultados parciales como definitivos.
- La vista móvil anterior usaba `Text` sin importarlo; al sustituirla por DataTable con tarjetas se elimina esa referencia.

## Implementación

Componentes compartidos reutilizados: PageHeader, Metric, FilterBar, ViewSwitcher, DataTable, RowActions, EntityLink, FormDrawer, ConfirmDialog, StatusBadge, EmptyState, LoadingState y ErrorState. Icono genérico Phosphor Plant para cultivos y tokens del Design System.

- Acción primaria a la derecha en desktop; histórico secundario. Deshabilitadas se consultan desde Estado dentro de Más filtros.
- Tabla sin auditoría expandida ni procedencia por fila. Acciones `⋯` con separación de Deshabilitar. Sublote primero y lote padre debajo; etiquetas extensas truncadas con texto completo al pasar el puntero.
- Donut de producción por cultivo, barras horizontales de rendimiento y línea por campaña cuando corresponde. Recharts existente; paleta por posición del conjunto, sin colores permanentes por especie. Los rendimientos provienen del servidor.
- Drawer de detalle con resultado, ubicación, contexto, autor, fecha de registro, procedencia y observaciones existentes. Miniatura estática reutiliza `projectField` y `mapGeometry`, respeta huecos/multipolígonos y no agrega proveedor, edición ni Geoman. Si falta la geometría del sublote histórico no se dibuja el lote padre como sustituto.
- Un mismo HarvestForm para actual, histórico y edición: Datos generales → Lote y superficie → Producción → Confirmación. Los campos y HarvestCycleFields permanecen montados; los pasos controlan su visibilidad y ejecutan las reglas existentes. El botón de confirmación tiene identidad distinta del botón Siguiente para evitar que el cambio de paso produzca un envío implícito.
- Desktop amplio: tabla y columna analítica. Anchos menores: tabla con desplazamiento horizontal interno y gráficos debajo. Mobile: tarjetas, filtros en drawer, analítica mediante switcher y formulario a pantalla completa. El shell y la navegación inferior permanecen intactos.

## Archivos de esta intervención

Modificados:

- `grow-sync/src/features/harvest/Harvest.jsx`
- `grow-sync/src/features/harvest/HarvestTable.jsx`
- `grow-sync/src/features/harvest/HarvestForm.jsx`
- `grow-sync/src/features/harvest/HarvestTrace.jsx`

Agregados:

- `grow-sync/src/features/harvest/HarvestCharts.jsx`
- `grow-sync/src/features/harvest/HarvestDetail.jsx`
- `grow-sync/src/features/harvest/harvestPresentation.mjs`
- `grow-sync/src/features/harvest/harvest.css`
- `grow-sync/tests/harvestPresentation.test.mjs`
- `grow-sync/tests/harvest-preview.jsx`
- `grow-sync/tests/harvest-preview.html`
- Este documento.

El repositorio tenía cambios previos en varios módulos y backend. Esos cambios no son parte de esta intervención.

## Validación

- Suite frontend: **54 tests aprobados, 0 fallidos**. Incluye cinco pruebas nuevas: autor/fallback, etiquetas y campañas reales, búsqueda de parciales repetidas, lectura de varias páginas con rechazo de respuestas incompletas y geometría exacta sin sustitución del sublote.
- Pruebas visuales con componentes reales y adaptador API en memoria: desktop 1920×1080 y 1536×960, tablet 1024×768 y mobile 390×844. Sin desborde horizontal de la página; la tabla tablet desplaza dentro de su panel.
- Verificados: varias cosechas por lote/campaña, lote entero y sublote, etiquetas largas, detalle y geometría, autor/fallback, estado vacío, deshabilitadas desde filtro, solo lectura sin creación/edición/deshabilitación, filtro de cultivo que actualiza estadísticas y evolución cronológica.
- Alta parcial móvil y edición desktop guardadas **solo en la fixture**, sin peticiones a la API real. Confirmación revisada antes del envío. Validaciones de producción vacía y de histórico sin fecha/motivo visibles, campos bloqueados de edición conservados.
- Build final: `npm --prefix grow-sync run build -- --outDir node_modules/.cache/harvest-ui-build`. Advertencias conocidas de configuración ESM de Vite y bundles grandes; sin errores de compilación.

## Límites y pendientes

- No se ejecutaron escrituras de integración sobre la base real. La regresión funcional completa con datos y sesión reales sigue siendo una verificación de aceptación posterior.
- Nombres de otros autores pueden faltar para roles sin acceso al listado de Usuarios; resolverlos para todos requeriría ampliar la respuesta autorizada del backend en una fase aparte.
- El conteo de lotes se omite por no existir en las estadísticas actuales.
- La búsqueda integral aumenta las solicitudes para historiales extensos. Si el volumen crece, conviene incorporar búsqueda/sublote/procedencia en el endpoint en una intervención funcional separada.
- La miniatura utiliza la geometría disponible; no reconstruye divisiones históricas que el listado actual no entregue.
- Se mantienen avisos preexistentes de Ant Design sobre InputNumber `addonAfter` y notificaciones estáticas.
