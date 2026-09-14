# Inicio · rediseño Fase 3

## Inspección del Dashboard anterior

`Dashboard.jsx` concentraba consultas, estado, helpers meteorológicos y presentación: seis tarjetas CRUD de Ant Design (`Statistic`), clima con `Progress` y gráficos Recharts. Dependencias: cliente autenticado `apiClient`, `harvestService`, permisos existentes, Hugeicons y Recharts. No había consultas de trabajo del día ni alertas de inventario.

| Endpoint existente | Datos y comportamiento | Uso nuevo |
| --- | --- | --- |
| `GET /stats` | `{meta, kpis: {users, products, lots, usages, planning: {total, completed, canceled, delayed, active}}}`. Conteos de empresa. Planning usa últimos 30 días por defecto; antes se pedían deshabilitadas y canceladas. Lotes cuenta habilitados sin ese rango. | Solo `kpis.lots`, con permiso `lots.view`. |
| `GET /planning` | `{data, total, page, pageSize}`. Filas con `activity_type`, `status_effective`, `start_at/end_at`, `lots`, `crop_name`, `responsible_name`. El servidor calcula `en_demora`. Empresa desde la sesión. | Con `planning.view`: total de demoras sin rango; por separado, días de hoy a hoy+7, paginados, ordenados para mostrar seis planificaciones abiertas. |
| `GET /products` | `{data, total, page, pageSize, inventory_v1_enabled}`. Legacy: `available_quantity`, `expiration_date`. V1: `on_hand_quantity`, `next_expiration_date`. `minimum_stock` para umbral. | Con `inventory.view`: todas las páginas habilitadas; conteos de productos con excepciones, sin sumar unidades distintas. |
| `GET /harvest-records/stats/filters` | `{campaigns: string[], campaign_details: object[], crops: string[]}`. Empresa desde sesión. | Opciones de campaña/cultivo. |
| `GET /harvest-records/stats/summary` | `total_records`, `total_production_kg`, `total_area_ha`, `avg_yield_kg_ha`, etiquetas de unidad. Acepta campaña+cultivo+unidad. Los nombres terminados en kg contienen **la unidad solicitada**, no siempre kg. Rendimiento ponderado calculado en servidor. | Producción, superficie y rendimiento; sin recalcular ni reconvertir. |
| `GET /harvest-records/stats/by-crop` | Array `{crop, production_kg, area_ha, yield_kg_ha, ...}`. Acepta campaña+unidad, no cultivo. | Filtrar además el grupo de cultivo seleccionado en frontend. |
| `GET /harvest-records/stats/by-campaign` | Array `{campaign_id, campaign_name, campaign_start_date, campaign_end_date, campaign, production_kg, area_ha, yield_kg_ha, ...}`. Acepta cultivo+unidad, no campaña. | Filtrar además el grupo de campaña seleccionado en frontend. |
| `POST /weather/update` | Coordenadas del navegador en query. Devuelve temperatura, humedad, viento, código WMO, condición, fecha y metadatos. **Guarda la lectura**. | Conserva geolocalización y consulta existente; presentación compacta. |
| `GET /weather/latest` | Última fila de `weather`, o `{}` si no hay datos. **Sin empresa/ubicación verificable ni código WMO guardado**. | Respaldo ante error de ubicación/consulta; etiqueta explícita de registro guardado y ubicación no verificada; condición no informada. |

Las estadísticas de cosecha conservan su acceso anterior por `role >= 1`, igual que los endpoints. Los enlaces a Cosechas y Registro de lluvias respetan además sus permisos de módulo. No se modificó ninguna definición de permisos ni rutas.

El clima llama Open-Meteo únicamente desde el backend, sin claves ni librerías nuevas. El flujo original es geolocalización (`enableHighAccuracy`, timeout 10 segundos, sin caché) → actualización → último registro ante fallo. Se conservó. La API solicita temperatura, humedad, código y viento; **no solicita máxima/mínima ni precipitación y devuelve `rainfall: 0` fijo**. Por eso no se muestran esos datos como mediciones.

Antes el frontend normalizaba nulos a cero, formateaba decimales con `toFixed`, elegía iconos meteorológicos mediante códigos/textos/umbrales y coloreaba cada cultivo. Ahora el Dashboard distingue ausencia de dato, usa `Intl.NumberFormat('es-AR')`, conserva la presentación meteorológica y usa el token `info` para ambas series. El ID de la fila meteorológica no se interpreta como código del tiempo.

## Implementación

- `Dashboard.jsx`: consultas independientes, permisos existentes, protección ante respuestas tardías, desmontaje y cambios de selección/contexto.
- `DashboardView.jsx`: jerarquía atención → trabajo → clima → campo → producción, filtros inmediatos y navegación a módulos existentes.
- `dashboardSource.js`: adaptación de endpoints sin cambiar contratos ni enviar `company_id`; usa el cliente Bearer existente. Abort de lecturas directas; estadísticas de cosecha conservan sus servicios y sus respuestas obsoletas se descartan.
- `dashboardModel.mjs`: presentación, selección de grupos, fechas y paginación. Reutiliza `lowStock` y `stockQuantity` del inventario. No deriva demoras ni rendimientos.
- `weatherPresentation.jsx`: helpers/iconos extraídos del Dashboard anterior, con tratamiento de nulos e ID de fila corregido.
- `dashboard.css`: estilos acotados al Dashboard, tokens de Fase 1 y apilado bajo 768px.
- `tests/dashboard.test.mjs`: pruebas de adaptación/formatos/fechas/alertas/permisos/clima con cliente simulado/render de estados.
- `tests/dashboard-preview.html` y `.jsx`: fixture de desarrollo con datos en memoria, estados y navegación simulada; fuera del grafo de producción. No lee ni modifica almacenamiento, no usa geolocalización y no llama a la API.

Se reutilizan sin modificar `PageHeader`, `Metric`, `StatusBadge`, `CategoryTag`, `EntityLink`, `LoadingState`, `ErrorState` y `EmptyState`; también etiquetas y fechas existentes de Planificaciones. No se agregaron dependencias.

## Límites y mejoras futuras

- Clima guardado global: resolver su alcance por empresa/ubicación requiere otra fase de backend. Esta vista lo identifica como no verificado, nunca como clima del campo. No se probó el POST real para evitar escrituras; su flujo se verificó con mocks.
- Máxima/mínima y precipitación requieren datos reales del proveedor, no el cero actual. No se alteró Registro de lluvias.
- Cosechas sin superficie positiva: se muestra rendimiento no disponible, no el cero usado como fallback por el servidor. No se recalcula ningún rendimiento.
- Superficie total del campo, cultivos activos, campaña activa y mapa quedan pendientes de una fuente agregada confiable. La superficie cosechada no se presenta como superficie del campo.
- Las alertas de vencimiento usan la próxima fecha por producto (la mínima entre partidas con saldo en V1). No enumeran todas las partidas. Legacy sin fecha de vencimiento no genera una fecha inferida desde adquisición.
- Saldo bajo conserva el umbral actual de inventario (`minimum_stock`, fallback 5); sin stock se separa de stock bajo. V1 usa saldo físico, que puede incluir partidas vencidas. Un producto puede aparecer en stock bajo y vencimiento.
- Los listados completos paginados evitan conteos truncados. Para empresas muy grandes conviene un agregado autorizado de backend en otra fase; las páginas actuales no ofrecen un snapshot transaccional ni orden estable en empates.
- La navegación abre `/planificaciones`, `/inventario`, `/lotes`, `/harvest` y `/registro-lluvias`. No se simulan rutas de detalle ni filtros que esos módulos no aceptan.
- La separación por empresa de stats/planning/productos/cosechas fue verificada en código. La prueba visual es aislada; no valida una sesión productiva ni disponibilidad del proveedor en vivo.

## Validación realizada

- Suite completa de frontend: **25/25 tests aprobados**. Tras los últimos ajustes de estados sin superficie/clima, se repitieron los **6/6 tests de Dashboard**, también aprobados.
- Build de producción aprobado: `npm run build -- --outDir node_modules/.cache/dashboard-phase3-build`. Se usó una carpeta de caché para no reemplazar otros artefactos del workspace.
- Navegador, fixture aislada: escritorio 1280×900 y mobile 390×844; orden de secciones, apilado y ausencia de desborde horizontal; campaña+cultivo, kg/tn/qq, actualización de ambos gráficos y cambios rápidos de selección; vacío; fallo total de red; fallo de clima independiente con recuperación por reintento; permisos limitados y navegación de alerta a Inventario.
- Consola de la fixture en carga limpia sin errores ni warnings. El runner concurrente de tests emitió avisos de puerto HMR compartido, sin fallos. Build/Node conservan advertencias de configuración ESM y tamaño de bundles existentes, fuera de alcance.
- No se validó una sesión real ni se ejecutó la actualización climática en vivo. Multiempresa comprobado por inspección de los controladores; transporte, geolocalización, fallback y errores climáticos comprobados con cliente simulado.

## Base de datos

NINGÚN cambio de base de datos. Ningún SQL ejecutado ni creado; ningún archivo de migración. Backend, Auth0, GuardedRoute, rutas, permisos, roles, multiempresa y módulos operativos no fueron modificados en esta fase.

## Fase 3.1 — Alineación visual

Alcance exclusivamente de presentación. No se modificaron Dashboard.jsx, dashboardSource.js, dashboardModel.mjs, endpoints, cálculos, filtros, permisos ni otros módulos de negocio.

Archivos de esta corrección:
- `DashboardView.jsx`: saludo con nombre de sesión y fecha larga es-AR, alternativa «¡Hola!» si falta nombre; excepciones compactas ordenadas por severidad; oculta la sección cuando no hay excepciones; fila compartida Clima/Campo; rótulos de ejes abreviados a 16 caracteres con tooltip completo y ancho limitado.
- `dashboard.css`: espaciado medio, superficies conceptuales, alertas con ancho acotado incluso cuando hay una sola, trabajo compacto, vacíos sin ilustración dominante, KPIs y gráficos adaptables. Estilos limitados al Dashboard.
- `../../components/NavbarBottom.jsx`: elimina únicamente los textos visibles de botones; mantiene aria-label, selección, destinos, permisos y menú Más.
- `../../css/BottomNavigation.css`: barra de 56 px y botones de al menos 44 px.
- `../../layout/shell.css`: reserva inferior mobile ajustada a la nueva barra. Sidebar y header desktop intactos.
- `../../../tests/dashboard-preview.jsx`: añade escenarios de una alerta/trabajo vacío y nombres largos; utiliza el shell real con almacenamiento simulado exclusivo de esa página. No lee ni modifica la sesión real; no consulta APIs ni solicita geolocalización.
- Este README.

Reutilización: PageHeader, Metric (incluido su soporte de iconos), StatusBadge, CategoryTag, EntityLink, EmptyState, LoadingState y ErrorState. Tokens de Fase 1 y biblioteca existente de iconos; sin nueva paleta, assets ni dependencias del proyecto.

Responsive: en desktop Clima/Campo comparten fila, producción conserva tres KPIs y dos gráficos. Mobile mantiene el orden saludo, atención, trabajo, clima, campo y producción en una columna. Alertas apiladas, KPIs y gráficos a todo el ancho disponible. Bottom nav exclusivamente con iconos; textos del sidebar y del menú Más conservados.

Diferencias intencionales frente a la referencia: Campo conserva solo lotes activos porque es el dato disponible en /stats; no hay mini mapa ni métricas nuevas. Clima no agrega máximas, mínimas ni precipitación. Se conserva el horizonte real de vencimientos de 15 días. No se copian cifras del mockup, imágenes decorativas ni un carrusel. Los nombres «trigo» y «Trigo» permanecen como llegan; su eventual limpieza de datos queda fuera de esta corrección.

Validación: suite frontend 31/31; suite backend 55/55, incluida integración con PGlite en memoria (sin Supabase); repetición Dashboard/shell 8/8 tras los ajustes; build correcto. Se resolvió la dependencia temporal PGlite copiándola a caché ignorada, sin modificar package.json ni lockfiles. Los intentos iniciales de backend fallaron por resolución de esa dependencia, no por aserciones. Advertencias existentes de ESM/bundle; una ejecución paralela de tests reportó colisión del puerto HMR, aunque ambas suites finalizaron correctamente.

Revisión visual aislada: desktop 1440 con sidebar expandido/colapsado; mobile 320 y 375; una/varias alertas, trabajo con datos/vacío, widgets y producción. Tooltip de nombre largo completo mediante teclado sin overflow a 320 px; nombres del eje abreviados. Bottom nav sin texto, con aria-label y botones mayores a 44 px; menú Más conservado. Consola del preview sin errores ni advertencias. No se validaron operaciones sobre datos reales, dado el alcance visual.

CAMBIOS DE BASE DE DATOS: NINGUNO. No se crearon archivos SQL ni migraciones, ni se modificó Supabase. Las pruebas de integración usaron únicamente una base temporal en memoria.

## Ajuste final — referencia principal (posterior a Fase 3.1)

Esta revisión sustituye la composición anterior: saludo sobre el fondo suave; atención y clima en la primera fila; trabajo y campo en la segunda; producción debajo. Mobile conserva saludo, atención, trabajo, clima, campo y producción. La superficie exterior se vuelve transparente exclusivamente cuando contiene el Dashboard. Los paneles tienen tratamientos diferenciados y los gráficos conservan sus datos, con barras del token verde primario.

Se inspeccionó `/lots?includeActiveLayout=true`: ya devuelve ubicación, superficie y divisiones activas, pagina resultados y filtra empresa desde la sesión del backend. Se reutiliza `readLots(client, false, signal)`, sin incluir deshabilitados ni enviar company_id desde el frontend. No se modificó el endpoint ni la lógica de Lotes.

MiniFieldMap implementado: Leaflet directo, carga diferida, capa OpenStreetMap ya utilizada por GrowSync, límites ajustados a todos los polígonos activos utilizables. Sin Geoman, toolbar, edición, arrastre, zoom por rueda, doble click, gestos o teclado. Conserva atribución y el acceso separado «Ver lotes». Reajusta límites al cambiar el tamaño. Altura 180 px desktop y 160 px mobile. Los lotes sin geometría se indican expresamente; no se reparan ni inventan polígonos.

Campo mantiene el conteo existente de /stats y agrega, mediante lectura independiente y cancelable, la suma de superficies de padres y el número de divisiones vigentes. No suma superficies de sublotes a la superficie del padre. Área incompleta se muestra como «—». No incorpora cultivos activos porque requeriría otra lectura productiva. Un fallo del mapa no oculta el conteo existente. Los permisos y el descarte de respuestas obsoletas se conservan.

Sidebar: botón sin texto visible, mantiene tooltip, aria-label y comportamiento. SVG propio monocromático de surcos, galpón y molino, opacidad baja, aria-hidden, pointer-events none, posición absoluta; oculto al colapsar y con poca altura. No usa fotos ni assets descargados. El saludo prioriza full_name y utiliza el primer nombre.

Archivos modificados en este ajuste:
- Dashboard.jsx: solicitud independiente de la vista del campo bajo el permiso existente.
- DashboardView.jsx: composición, saludo, KPIs, mapa y tratamiento de gráficos.
- dashboardSource.js: lectura adicional mediante endpoint de lotes existente.
- dashboard.css: superficies, distribución y responsive.
- ../../layout/Sidebar.jsx y ../../layout/shell.css: decoración y botón icon-only.
- ../../../tests/dashboard-preview.jsx: geometrías simuladas y nombre completo.
- ../../../tests/dashboard.test.mjs: comprueba lectura del campo y full_name.
- Este README.

Archivos nuevos: MiniFieldMap.jsx, fieldOverview.mjs, ../../../tests/fieldOverview.test.mjs y ../../../public/sidebar-landscape.svg.

Validación: 32/32 pruebas frontend; 7/7 en la repetición de Dashboard y resumen cartográfico; build correcto. Desktop 1280/1440/1680 y mobile solicitado 320/333/375/390 (el motor redondeó 333 a 334 CSS px). Sin desbordamiento horizontal; tooltip completo comprobado a 320 px, botones mobile superiores a 44 px, decoración no interactiva y ausente al colapsar, trabajo con datos/vacío y alerta única comprobados. Consola del preview sin errores/advertencias. Las teselas externas se omiten en el preview; no se ejecutaron operaciones sobre datos reales. Persisten advertencias existentes de configuración ESM y tamaño del bundle.

Limitaciones: el mapa depende de la disponibilidad de teselas del proveedor existente; puede mostrar cobertura parcial cuando faltan geometrías. No hay pronóstico ni precipitación inventada, ni métricas copiadas del mockup. Se preservan los tipos y cálculos actuales de ambos gráficos. No se cambió backend, autenticación, rutas, permisos ni reglas de negocio. Sin nuevas dependencias.

CAMBIOS DE BASE DE DATOS: NINGUNO. No se creó ni ejecutó SQL, no se crearon migraciones y no se modificó Supabase.

## Pulido con Phosphor y gráficos de referencia

Se conserva la composición, MiniFieldMap, las consultas y el SVG agrícola del ajuste anterior. Esta revisión migra la iconografía visible del Dashboard y navegación a Phosphor y cambia la presentación de los gráficos.

Iconografía: dependencia oficial `@phosphor-icons/react` 2.1.10, necesaria para la familia solicitada. Importaciones individuales encapsuladas en `AppIcons`, siguiendo la [documentación oficial](https://github.com/phosphor-icons/react). Nuevo objeto conceptual `AppIcons` y catálogo `activityIcons`, todos con peso regular por defecto. Los alias antiguos continúan intactos para los módulos no intervenidos. No se migró masivamente la aplicación. Los iconos internos de controles Ant Design pueden permanecer temporalmente.

Conceptos usados: House, CalendarDots, MapPin, Package, ChartBar, Tractor, Users, Bell, CaretLeft, SignOut, ClipboardText y DotsThree en navegación; Plant genérico para todos los cultivos; Flask, Plant, Waves, Tractor y Wrench para actividades controladas; Sun/Cloud/CloudSun/CloudMoon/Moon/CloudRain/CloudLightning/CloudSnow/CloudFog/Wind/Drop/Thermometer y equivalentes para clima; Ruler y Stack para superficie/divisiones. Controles y metadatos 16 px, botones 18 px por defecto, navegación mobile 20 px, sidebar 22 px y KPIs destacados 24 px. Sin asignación de iconos o colores por especie.

Gráficos (Recharts existente):
- Rendimiento por cultivo: columnas verticales usando directamente `yield_kg_ha` ponderado que entrega la API. No divide, reconvierte ni promedia. La unidad sigue el filtro actual (kg/ha, qq/ha o tn/ha). Sin superficie se representa ausencia, no un rendimiento cero. Paleta cíclica derivada del verde/lima de tokens; valores superiores solo en desktop con hasta cinco barras.
- Producción por campaña: línea con puntos y área de opacidad 0.08. Usa `production_kg` ya convertido por la API. Actualizado por la regla global de campañas: se ordena por campaign_start_date, conservando campaign_name e ID. Sin fechas completas, muestra barras categóricas y una aclaración; nunca deduce cronología del nombre. Ver docs/campaigns-identity-chronology-2026-09-14.md.
- Ejes abreviados, tooltips completos y formato argentino. Los nombres trigo/Trigo permanecen como llegan. No cambia ningún filtro ni endpoint.

Archivos modificados en este pulido:
- package.json y package-lock.json: dependencia Phosphor.
- src/components/AppIcons.jsx: nueva abstracción conceptual y catálogo controlado.
- src/components/NavbarBottom.jsx y NotificationBell.jsx; src/layout/Sidebar.jsx y Header.jsx: consumen equivalentes Phosphor, preservando funcionalidad y permisos.
- src/layout/shell.css y src/css/BottomNavigation.css: tamaños de iconos.
- src/features/dashboard/DashboardView.jsx, weatherPresentation.jsx y dashboard.css: iconografía, metadatos y jerarquía de KPIs.
- tests/dashboard-preview.jsx: escenarios reproducibles mediante ?scenario=normal|single|long|empty, con datos simulados.
- Este README.

Creados: src/features/dashboard/DashboardChart.jsx, chartPresentation.mjs y tests/dashboardCharts.test.mjs.

MiniFieldMap: reutilizado sin cambios; GET /lots con includeActiveLayout=true, activos, todas las páginas, límites de todos los polígonos utilizables. Capa OpenStreetMap ya existente; no se agrega proveedor satelital ni API key. En preview se omiten teselas externas. SVG propio conservado en public/sidebar-landscape.svg, monocromático, sin interacción, oculto al colapsar y en alturas pequeñas. Botón de colapso mantiene tooltip/aria-label sin texto visible.

Validación de este pulido: 34/34 pruebas frontend (incluye Dashboard, nuevos tests de rendimiento/campañas, campo, permisos y shell), build correcto y consola del preview sin errores ni advertencias. Verificados 1280, 1440, 1680 y mobile 320, 333 solicitado (redondeado por el motor a 334), 375, 390. Sin scroll horizontal; botones mobile mayores a 44 px, icon-only. Verificados una/varias alertas, trabajo con datos/vacío (70 px en desktop), mapa, gráficos, tooltips largos y sidebar colapsado. No hubo operaciones sobre datos reales.

Diferencias y pendientes: sin datos ficticios adicionales, sin Actividades, sin pronóstico, sin cultivos activos añadidos. Se conserva OpenStreetMap en lugar de copiar el satélite del mockup. La evolución temporal no se infiere de nombres de campaña arbitrarios. Persisten warnings existentes de ESM y tamaño de chunks; la convivencia temporal con las familias antiguas añade peso al bundle hasta futuras migraciones por módulo. No se modificaron lógica meteorológica, reglas estadísticas, cálculos de negocio, backend, permisos, rutas, auth ni datos.

CAMBIOS DE BASE DE DATOS: NINGUNO.

## Corrección puntual — sidebar y StaticFieldOverview

Causa identificada de la ilustración invisible: `@media (max-height:760px)` la ocultaba por completo. La altura útil del navegador puede quedar por debajo de ese límite aun en una pantalla de 768 px. Además, la opacidad anterior era .13. Se eliminó esa ocultación: la ilustración se ancla a 80 px del fondo del sidebar fijo, con altura adaptable y opacidad .20. En poca altura se reduce, sin generar scroll ni empujar navegación. Se conserva el asset propio `public/sidebar-landscape.svg`. Sigue fuera del flujo, con pointer-events:none y aria-hidden; no existe al colapsar ni en mobile.

El control de colapso ya NO usa Tooltip. Solo conserva chevron Phosphor, aria-label, aria-expanded y teclado. Default/hover/active/focus comparten color accent y fondo transparente; focus-visible agrega contorno lime sin ocultar el icono. No usa tratamiento de selección de navegación.

StaticFieldOverview reemplaza MiniFieldMap en el Dashboard. Usa las mismas geometrías de lotes activos ya obtenidas mediante /lots, sin cambiar lectura, permisos, KPIs ni cálculos de negocio. Convierte Polygon/MultiPolygon a paths SVG, conserva huecos con evenodd y las posiciones relativas. Calcula bounds combinados, corrige la escala longitudinal por la latitud central y ajusta la representación al ancho real con ResizeObserver. Fondo agrícola abstracto derivado de tokens, relleno suave y bordes verdes uniformes. No hay tiles, proveedor, coordenadas regionales por defecto, controles, pan, zoom, popups ni cargas cartográficas externas. No modifica coordenadas almacenadas ni repara geometrías.

Sin polígonos válidos aparece el EmptyState compacto «No hay geometrías de lotes disponibles». El contador de lotes sin geometría sigue visible cuando corresponde. Las divisiones continúan en los KPIs; la vista dibuja los polígonos de padres que ya entrega el adaptador, sin agregar consultas para subdivisiones.

Archivos modificados: src/layout/Sidebar.jsx, src/layout/shell.css, src/features/dashboard/DashboardView.jsx, src/features/dashboard/dashboard.css y este README.
Creados: src/features/dashboard/StaticFieldOverview.jsx, src/features/dashboard/staticFieldGeometry.mjs y tests/staticFieldOverview.test.mjs.
Retirado: src/features/dashboard/MiniFieldMap.jsx y sus estilos ya sin consumidores. El editor Leaflet/Geoman de Lotes permanece intacto.

Validación: 37/37 tests frontend, incluidos bounds, orientación, Polygon/MultiPolygon, huecos, coordenadas inválidas, degeneradas y ausencia de geometrías; build correcto. Ilustración visible dentro del viewport en 1440×768, 1600×900 y 1920×1080; sin ilustración al colapsar o en mobile. Se comprobó el control mediante click y teclado, fondo transparente, icono opaco y ausencia de tooltip; hover/active tienen la misma regla CSS explícita de contraste. SVG responsive a 320/390, sin overflow ni contenedores Leaflet. Fallback vacío verificado. Consola del preview limpia. Persisten warnings existentes de ESM/chunks grandes.

No se modificaron producción, clima, filtros, endpoints, backend, autenticación, permisos, empresa ni base de datos. No se agregaron dependencias.

CAMBIOS DE BASE DE DATOS: NINGUNO.
