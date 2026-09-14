# Auditoría cartográfica — inspección previa (2026-09-14)

## Alcance y evidencia
Inspección de frontend y lectura del código del backend; ninguna consulta SQL ni cambio de datos/backend. HEAD disponible: 95ca9d0. Fase 4 y Dashboard están en cambios locales sin commit: el diff de Lotes reemplaza MapSelector por LotsOverview/LotsOverviewMap. No se atribuye a un commit inexistente.

## Inventario
- MapSelector.jsx: MapContainer/Polygon/Marker/Tooltip/LayersControl, editor Geoman; legacy [[{lat,lng}]], fit selección/todos y recentrado; invalidateSize con 350ms, whenReady y eventos del Drawer. Centro regional heredado cuando falta ubicación.
- LotsOverviewMap.jsx (Fase 4): GeoJSON/circleMarker, lotes + divisiones activas, tres caminos de fitBounds (datos/selección, ResizeObserver y botón todos); invalidación en observer que se reinstala cuando cambia selección/datos. Centro regional fijo aunque no haya geometría. GeoJSON data no se actualiza con el mismo key.
- SubLotEditor.jsx: Polygon/Polyline y Geoman, snapshots de layout, ajuste inicial por layout y botón; tamaños 420/580px, sin observer de contenedor. Conserva su lógica de topología, escritura y versiones. Conversor toma el anillo exterior Polygon; centro regional heredado ante geometría ausente.
- LotMapPreview.jsx: Polygon de selecciones/productivo, conversores independientes legacy/GeoJSON, Polygon/MultiPolygon/FeatureCollection; invalidación 200ms y fit 300ms; altura 200px; no reajusta al resize posterior. Esri sin attribution visible.
- utils/leafletGeoman.js + hooks/useLeafletGeoman.jsx: instancia compartida de Leaflet y carga de Geoman. Sin cambios recientes en el diff. Phosphor solo suministra iconos de UI; no sustituye iconos cartográficos.
- Dashboard: fieldOverview usa buildLotRows; staticFieldGeometry añade otra validación y bounds propios; StaticFieldOverview usa ResizeObserver y SVG estático (180/160px).

## Contratos verificados en código
GET /lots?includeActiveLayout=true pagina 1000; devuelve location legacy del padre y ST_AsGeoJSON de sub_lots. JOIN solo status active y sub_lots enabled. Locked/archived/draft no corresponden al resumen vigente. No es necesario cambiar backend.
MapSelector guarda objetos lat/lng en JSON y actualmente cierra sus anillos. El render previo usaba Polygon (acepta anillos abiertos y valores numéricos convertibles por Leaflet). Los tests nuevos construyen fixtures cerrados numéricos y no cubren compatibilidad histórica.

## Hipótesis reproducibles antes de implementar
1. displayGeometry rechaza legacy de tres vértices y números en texto; puede lanzar excepción por puntos null. Dashboard además descarta anillos no cerrados aceptados por la vista Leaflet. Confirmar con tests; no se ha inspeccionado una sesión real ni se afirma que todos esos formatos existan en la empresa afectada.
2. Fase 4 deja un mapa regional cuando todo es rechazado; GeoJSON conserva capas viejas si cambia geometry sin cambiar key.
3. fitRequest > 0 queda activo en efecto dependiente de rows y puede competir con selección. ResizeObserver hace fit en cada paso de transición del sidebar.
4. CSS grilla de tres columnas usa breakpoint viewport 1200 aunque el shell resta 240 + padding. En tablet se reserva árbol de 180px, dejando mapa estrecho. Probar en shell realista.

## CSS/proveedores
No se encontró regla global max-width sobre imágenes/svg/canvas que altere tiles. App.css oculta overflow horizontal (puede esconder la grilla sobredimensionada). Reglas svg de Phosphor están acotadas a sidebar/cards/bottom-nav. .leaflet-pm-* oculta ayudas de Geoman con !important preexistente; no explica lotes desaparecidos.
Leaflet CSS importado por los cuatro mapas; gs-lots-map tiene altura real 560px/65dvh y aislamiento de z-index. Proveedores existentes: OSM https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png y Esri World_Imagery /tile/{z}/{y}/{x}. Disponibilidad de red aún por comprobar, sin proveedor nuevo.

## Plan mínimo
Helper de lectura puro: distinguir legacy vs GeoJSON, validar sin mutar, cerrar solo la representación legacy abierta al convertirla a GeoJSON, preservar holes/MultiPolygon, bounds compartidos sin fallback regional. Corregir mapa principal con empty state, encuadre único y actualización de geometrías. Dimensionar grilla según contenedor. Validar Lotes antes de adaptar proyección Dashboard. Tests geométricos, interacción y matriz responsive con fixtures sin operaciones reales; detallar límites de validación productiva.

# Resultado de la corrección

## Causa reproducida y alcance de la conclusión
Se reprodujo antes de editar: triángulo legacy abierto => null; anillo cerrado con números en texto => null; cuatro vértices null => excepción al leer lng; cuadrilátero legacy abierto => aceptado por Lotes, 0 polígonos en Dashboard. El refactor de consulta introdujo validación incompatible con el render legacy y el SVG agregó otro criterio. Los fixtures de Fase 4 estaban todos cerrados y con números y no lo detectaban.
Esto confirma fallos del código y su corrección con reproducciones controladas. **No confirma todavía el contenido del lote real denunciado por la usuaria**: no se contó con una instancia autenticada ni un ejemplo concreto. No se usaron credenciales ni consultas a DB para inferirlo.

## Archivos modificados/agregados por esta auditoría
- src/utils/mapGeometry.mjs (nuevo): parsing seguro, validación, adaptación legacy, extracción Polygon/MultiPolygon con huecos, bounds nombrados y conversión explícita a Leaflet, colección de features.
- src/components/MapViewport.jsx (nuevo): único lifecycle de medida/encuadre compartido por los cuatro mapas Leaflet.
- src/features/lots/lotsOverviewModel.mjs: delega parsing/validación; un geom no interpretable ya no oculta una location válida.
- src/features/lots/components/LotsOverviewMap.jsx: bounds de geometrías reales, empty state, actualiza GeoJSON cuando cambia el dato, separa Ver todos de selección posterior, conserva selección accesible/hover/labels y proveedores.
- src/features/lots/LotsOverview.jsx: revisión de selección para reenfocar incluso al volver a elegir el mismo nodo; mismo árbol/lista/filtros/active_layout.
- src/features/lots/lotsOverview.css: container queries según ancho disponible dentro del shell; árbol apilado en espacios estrechos, contexto debajo cuando corresponde; empty state dimensionado.
- src/features/dashboard/staticFieldGeometry.mjs: proyección SVG usa validación y bounds comunes. Dashboard conserva SVG estático; no incorpora Leaflet ni nuevas capas.
- src/components/MapSelector.jsx: lectura legacy común, bounds de lotes antes que ubicación del navegador, sin fallback regional; elimina timers de 250/350ms. Geolocalización solo en modo de dibujo; serialización, redondeo, área y Geoman no se alteran.
- src/features/lots/Lotes.jsx: elimina invalidateSize redundante del afterOpenChange del Drawer.
- src/features/lots/components/SubLotEditor.jsx: mide contenedor, sin centro regional. En consulta reencuadra al resize. Durante edición preserva zoom y encuadre inicial por layout; no toca cortes, snapping, edición, áreas, activaciones o snapshots.
- src/features/planning/components/LotMapPreview.jsx: reemplaza timers de 200/300ms con MapViewport; muestra atribución Esri. Conserva interpretación histórica de selecciones del módulo.
- tests/mapGeometry.test.mjs (nuevo): seis tests de regresión y bounds/selección/filtrado/ausencias.
- tests/lots-preview.jsx: agrega shell/sidebar real, escenarios legacy/invalid y carga opcional de proveedores.
- tests/maps-detail-preview.html y .jsx (nuevos): selector, consulta de divisiones y preview de planificación con datos ficticios y sin mutaciones.
- Este informe.

## CSS y Leaflet
No se cambió CSS global ni se agregaron !important. La grilla principal ahora responde al ancho del contenedor, no solo al viewport. Leaflet, Geoman, iconos cartográficos y proveedores permanecen.
MapViewport comprueba dimensiones no nulas. Datos/selección solicitan un solo ajuste por requestAnimationFrame; el ResizeObserver permanece instalado y agrupa 120ms de cambios reales de tamaño para evitar fit en cada frame de transición. Cancela observer, frame y temporizador al desmontar. No hay listeners arbitrarios sobre sidebar, Drawer o ViewSwitcher.
fitBounds combina lotes y divisiones vigentes; selección encuadra solo el elemento elegido; Ver todos encuadra toda la vista filtrada sin borrar selección y no vuelve a pisar futuras selecciones. Padding proporcional en contenedores angostos, maxZoom 16 (18 en planificación). Sin geometrías válidas no se monta el mapa principal. El detalle de divisiones conserva el fit de trabajo en edición.

## Geometrías y límites
Legacy documentado: objetos lat/lng, anidado por anillos o plano, con números o texto numérico. Se copia y cierra únicamente su representación de lectura al convertir a GeoJSON (equivale al cierre implícito de Leaflet Polygon); jamás se modifica el origen ni se persiste. GeoJSON conserva lng/lat; anillos no cerrados, coordenadas fuera de rango, NaN, null y anillos degenerados se rechazan. Se preservan huecos y piezas MultiPolygon; Point se mantiene para compatibilidad de consulta Leaflet y se excluye del SVG.
No se intenta reparación topológica ni validación completa de autointersecciones. Los conversores del editor Geoman conservan sus restricciones preexistentes a Polygon/anillo exterior para evitar un refactor de edición; los helpers compartidos de Lotes/Dashboard sí cubren MultiPolygon/huecos. La vista de planificación mantiene sus adaptadores históricos (incluido FeatureCollection) para no cambiar interpretación de selecciones guardadas en esta corrección.

## Pruebas manuales en navegador
Se probaron componentes reales con fixtures locales e inmemory, sin modificar registros:
- Lote sin subdivisiones: Lote Norte visible; árbol selecciona polígono y contexto; encuadre correcto.
- Lote subdividido: contorno padre y 15-A/15-B; click en división expande árbol y sincroniza contexto; labels/estilos de selección presentes.
- Ver todos: cuatro capas (dos padres + dos divisiones) dentro del mapa; no mezcla layouts históricos.
- Sidebar expandir/colapsar; Lista → Mapa; selección conservada al cambiar vista.
- Filtro sin ubicación: selección anterior descartada, lista/árbol coherentes, empty state en lugar de región genérica.
- Escenario legacy abierto y números en texto: mismos cuatro polígonos renderizados.
- Escenario con vértices null: mapa desmontado y empty state, sin crash.
- Mobile 390×844: selección abre bottom sheet; cerrar mantiene mapa de 308×549; sin errores.
- Detalle de divisiones: al pasar 1280→390 se reprodujo recorte; tras el ajuste de modo consulta, ambas divisiones quedan dentro del mapa (343×420).
- Selector de lotes (consulta): cuatro polígonos, 1248×500.
- Planificación (consulta de sublote con padre): dos polígonos, 358×200, atribución visible.
- Dashboard real en preview: dos polígonos SVG, 520×180 desktop y 302×160 en 375px mobile; sin errores de consola.

### Matriz de Lotes
Todos los casos siguientes verificaron polígonos dentro del mapa, dimensiones positivas, mapa dentro de página y ausencia de overflow horizontal. Anchos medidos incluyen scrollbar del navegador y padding de la preview.

| Viewport ancho | Mapa ancho × alto, sidebar expandido (alto 900) | Mapa ancho × alto, sidebar colapsado (alto 768) |
| --- | --- | --- |
| 320 | 238×585 (sin sidebar) | — |
| 375 | 293×585 (sin sidebar) | — |
| 390 | 308×585 (sin sidebar) | — |
| 768 | 446×560 | 606×560 |
| 1024 | 481×560 | 595×560 |
| 1280 | 658×560 | 577×560 |
| 1440 | 577×560 | 664×560 |
| 1680 | 707×560 | 765×560 |

En sidebar colapsado se comprobó el encuadre automático después del resize sin pulsar Ver todos. Cambiar número de columnas explica que algunos anchos de mapa no crezcan monótonamente.

## Tiles y consola
OSM: 9/9 imágenes cargadas (complete + naturalWidth>0) en zoom 15. Esri: 9/9 cargadas tras cambiar a Satélite. No hubo tiles fallidos ni errores/warnings de Leaflet, invalid LatLng, GeoJSON, ResizeObserver o claves React en esas sesiones. La consola no mostró 401/403/404 ni errores CORS. No se obtuvo una traza HTTP completa: la evidencia es carga efectiva en el navegador y consola, no una afirmación sobre disponibilidad global/futura.
Se verificaron defaults de la versión instalada en leaflet/src/layer/tile/TileLayer.js: minZoom 0, maxZoom 18, crossOrigin false. Se conservan URLs y proveedores; no se añaden claves ni servicios.

## Tests y build
- Suite completa frontend: 43/43 aprobados, incluyendo seis nuevos tests de mapGeometry y suites Lotes/Dashboard/SVG.
- Tests específicos: 10/10 geometría, fieldOverview y staticFieldOverview.
- Build producción aprobado en node_modules/.cache/maps-audit-build; evita sobrescribir dist con archivos bloqueados de otro contexto.
- Warnings preexistentes: ESM en vite.config.js, MODULE_TYPELESS_PACKAGE_JSON y bundles de más de 500kB. No dependencias nuevas.
- Comprobación visual adicional del ajuste final de detalle: dos polígonos dentro del viewport, consola sin errores; build repetido tras ese ajuste.

## Riesgos/pendientes explícitos
- Falta validar la instancia/empresa real reportada. Las reproducciones prueban los fallos y la solución, pero no permiten atribuir inequívocamente el incidente original a un formato concreto sin ver su respuesta API.
- No se ejecutaron altas, guardados, cortes, activaciones ni operaciones históricas. La preservación de esas reglas se revisó en el diff; prueba de edición manual con datos reales queda pendiente.
- Sin lotes ni ubicación real del navegador, dibujar el primer lote muestra un estado sin ubicación en vez de inventar una región. Requiere permiso de ubicación para iniciar ese caso; no se agregó un buscador/proveedor.
- Durante edición de divisiones, reducir mucho el contenedor puede dejar parte del dibujo fuera del encuadre por conservar el zoom de trabajo; el botón Centrar mapa está disponible. En consulta y mapa operativo sí se reajusta automáticamente.
- Las áreas de fixtures son valores de prueba y no corresponden necesariamente al área geodésica de sus rectángulos. No se modificó ni validó el negocio de hectáreas con esos fixtures.

**Cambios de base de datos: NINGUNO. Cambios de backend: NINGUNO.**

Comprobación final de selección repetida: tras Ver todos, click en el nombre del mismo nodo reencuadra el lote (ancho del polígono 140→280px en la preview).
