# Lotes · Fase 4: mapa, árbol y lista

## Inspección previa

- `Lotes.jsx` cargaba `/lots?includeActiveLayout=true` (solo la primera página por defecto) y `/lots/productive-states`. Presentaba `MapSelector` junto a `LotTable`; en mobile mostraba también mapa y `LotListMobile` simultáneamente. No había filtros ni selección bidireccional: «Ubicación → Ver» cambiaba únicamente `selectedLocation`.
- `LotTable.jsx` y `LotListMobile.jsx` mostraban las divisiones de `active_layout.sub_lots`, estado productivo y áreas. Sus permisos se leían al importar el módulo. Se mantienen como archivos existentes sin modificarlos; la pantalla principal ya usa los patrones compartidos.
- `DisabledLotes.jsx` tenía otro listado y restauraba por `PUT /lots/enable/:id`. Su ruta se conserva como entrada al mismo filtro Estado, sin otra tabla.
- `MapSelector.jsx` combina lectura y edición. Convierte la representación legacy `[[{lat,lng},...]]`, usa Leaflet, Turf y el adaptador `leafletGeoman`; el editor redondea coordenadas, cierra anillos y calcula hectáreas con Turf. La nueva consulta no reutiliza esa parte editable ni altera sus cálculos.
- `LotDivisions.jsx`, `SubLotEditor.jsx`, `layouts.js` del backend y las reglas de base de datos mantienen versiones `draft`, `active`, `locked`, `archived`, áreas, contención, validación, activación única, historial y snapshots. Solo `active_layout.status === 'active'` se muestra como división vigente en esta pantalla. No se consultan ni editan borradores/historial desde el resumen.
- No hay otra ruta de ficha individual. La ruta existente `/lotes/:lotId/divisiones` requiere `lots.view` y ofrece el contexto y editor actuales. El nuevo acceso se llama «Ver detalle y divisiones». No se crearon rutas ni acciones de planificación precompletada.

## Datos reutilizados

| Contrato existente | Uso |
| --- | --- |
| `GET /lots`, `includeActiveLayout=true`, páginas de 1000 | `{data,page,pageSize,total}`; `id,name,area,area_ha,location,enabled,active_layout`. Se completan las páginas para no omitir lotes del mapa/total. |
| `includeDisabled=true` | Se solicita únicamente con `lots.view_disabled`; el filtro local determina activos/deshabilitados/todos. A diferencia de `/lots/disabled`, esta variante trae las divisiones vigentes. |
| `active_layout.sub_lots` | `id,code,name,area_ha,geom,sort_order`. Se preserva el orden del servidor y la relación con el padre. |
| `GET /lots/productive-states` | `{date,data:[{lot_id,mode,units:[{sub_lot_id,area_ha,current_crop,previous_crops}]}]}`. Se usan los nombres de cultivo/campaña actuales, sin recalcular asignaciones ni utilizar historial como cultivo vigente. Solo incluye lotes habilitados. |
| `POST /lots`, `PUT /lots/:id` | Formulario actual, mismo payload `name,area,location`. |
| `DELETE /lots/:id`, `PUT /lots/enable/:id` | Soft delete/restauración existentes; confirmación compartida y errores visibles. |

El cliente autenticado existente inyecta Bearer. El frontend no envía ni modifica `company_id`. Los controladores leídos filtran por la empresa de la sesión. No hubo consultas a Supabase desde herramientas ni pruebas con mutaciones reales.

## Archivos de esta fase

Modificados:

- `src/features/lots/Lotes.jsx`: conecta la consulta con el formulario y operaciones existentes; se conserva el formulario/editor.
- `src/features/lots/DisabledLotes.jsx`: adaptador de la ruta anterior al filtro Deshabilitados.
- `src/features/dashboard/dashboardModel.mjs`: solo importa/reexporta el formato numérico extraído sin cambiar su comportamiento.

Creados:

- `src/utils/numberFormat.js`: helper genérico de números argentinos usado por Dashboard y Lotes.
- `src/features/lots/LotsOverview.jsx`: consultas, filtros, selección única, Mapa/Lista, confirmaciones y panel mobile.
- `src/features/lots/lotsOverviewModel.mjs`: adaptación para visualización, jerarquía, filtros y acciones según permisos.
- `src/features/lots/lotsOverviewSource.js`: lectura paginada y estado productivo existentes.
- `src/features/lots/components/LotsOverviewMap.jsx`: mapa de consulta Leaflet, selección accesible y ajuste de encuadre.
- `src/features/lots/components/LotsOverviewTree.jsx`: árbol navegable por teclado, expansión y seguimiento de selección.
- `src/features/lots/components/LotOverviewContext.jsx`: resumen del seleccionado, sin ficha completa.
- `src/features/lots/lotsOverview.css`: estilos acotados, tokens y breakpoints.
- `src/features/lots/OVERVIEW.md`: esta documentación.
- `tests/lotsOverview.fixtures.mjs`, `tests/lots-preview.html`, `tests/lots-preview.jsx`: geometrías y operaciones ficticias en memoria; fuera de las rutas de producción, sin almacenamiento de sesión, geolocalización, API ni cartografía externa.
- `tests/lotsOverview.test.mjs`: jerarquía, geometría, filtros, selección, superficies, permisos, paginación, árbol/contexto y carga.

Reutilizados sin modificar: PageHeader, FilterBar, Metric, ViewSwitcher, StatusBadge, CategoryTag, EntityLink, DataTable/RowActions, LoadingState, ErrorState, EmptyState y ConfirmDialog. Leaflet/React Leaflet, Ant Tree/Drawer, tokens, rutas y cliente API existentes. Sin dependencias nuevas.

## Decisiones de UX y preservación espacial

- Mapa por defecto. Desktop muestra árbol/mapa/contexto; tablet mueve el contexto debajo; mobile oculta árbol y panel lateral, y abre un panel inferior al seleccionar. Lista usa DataTable y cards mobile con divisiones expandibles.
- Una sola clave de selección identifica lote o división. El mapa, árbol y contexto derivan de ella y de los mismos lotes filtrados. Si el seleccionado queda fuera, se elimina también el resaltado/contexto. Seleccionar una división expande su padre.
- Búsqueda por nombre de lote o división, estado, cultivo, campaña y presencia de divisiones. Una coincidencia mantiene visible el lote completo con sus divisiones para no falsear su estructura. Cultivo+campaña deben coincidir en la misma unidad productiva. No se aplican silenciosamente filtros productivos si falla su consulta.
- Colores por función: lote normal, división, borde del padre discontinuo, seleccionado grueso y deshabilitado atenuado. Se añade texto «Seleccionado», foco y atributos accesibles; no se comunica solo con color. Las etiquetas permanentes se limitan por zoom/cantidad y se evita superponer la etiqueta del padre con las divisiones.
- Conversión de geometrías solo para representación: legacy, GeoJSON Polygon (incluidos huecos), MultiPolygon y Point. No se repara ni modifica geometría, precisión, CRS, superficie ni topología. Las ubicaciones no representables siguen en lista/árbol; esto no sustituye la validación geométrica del editor.
- Las métricas suman áreas **ya devueltas** de padres, nunca las vuelven a calcular ni suman sus divisiones. Si falta área no se presenta un total parcial como completo. Las métricas se etiquetan como pertenecientes a la vista filtrada.
- Los lotes deshabilitados no se etiquetan «sin cultivo»: el endpoint no devuelve su contexto y se muestra «No disponible». Se respeta cada permiso de acciones; editar deshabilitados aparece desactivado con explicación cuando corresponde. Las divisiones no reciben acciones CRUD del lote padre.
- Al elegir Deshabilitados se limpian y desactivan cultivo/campaña, explicando que no están disponibles para ese estado.
- La lista evita que Ant Table interprete `children` como una segunda jerarquía automática; las divisiones se presentan mediante una expansión explícita dentro del nombre.

## Riesgos y pendientes para Fase 5

- Ficha individual y editor de divisiones permanecen intactos. El acceso al detalle de una división abre la ruta de su lote padre: no hay una ruta estable que preseleccione ese sublote.
- El estado productivo de lotes deshabilitados requiere soporte de backend si se desea ampliarlo. No se inventa ni deriva de asignaciones históricas.
- Solo se conoce la división vigente; explorar borradores y versiones históricas sigue siendo responsabilidad del editor existente.
- Los endpoints actuales de mutaciones tienen control de rol 2 además de la política de permisos de UI. No se cambió esa política ni se intentó ampliar permisos desde frontend.
- La paginación completa puede resultar costosa para empresas grandes; un agregado o endpoint espacial dedicado requiere otra fase. Los listados actuales no ofrecen un snapshot transaccional durante todas las páginas.
- OpenStreetMap/Esri se conservan como proveedores de base del mapa. La preview no descarga sus tiles: comprueba geometrías, encuadre e interacciones, no disponibilidad externa.
- El editor conserva sus limitaciones preexistentes y cálculos de área. No se rediseñaron geometrías, constraints, transacciones ni reglas de layouts/sub_lots.

## Validación

- Suite existente más nueva de frontend: **31/31 tests aprobados** (`node --test --test-reporter=spec --test-concurrency=1`). Los **6 tests de Lotes** también se repitieron después de adaptar la lista y pasaron.
- Build de producción aprobado con salida en `node_modules/.cache/lots-phase4-build`, para conservar otros artefactos del workspace. Se mantienen advertencias existentes de ESM y tamaño de bundles; sin dependencias nuevas.
- Preview aislada: escritorio 1440×1000, tablet 1024×900, mobile 390×844. Se verificaron mapa→árbol, árbol→mapa, selección por teclado, contexto debajo del mapa en tablet, panel inferior mobile, lista/cards, divisiones expandibles, filtros coherentes, selección eliminada por filtros, sin ubicaciones, deshabilitados, confirmación simulada, permisos de solo lectura y ruta de detalle existente.
- Error de red y reintento; fallo productivo sin perder geometrías; empresa sin lotes y búsqueda sin resultados diferenciados. Sin desborde horizontal general en los tamaños comprobados.
- Consola de la preview sin errores ni advertencias al finalizar; tamaño de navegador restaurado después de las pruebas responsive.
- No se ejecutaron altas, ediciones, habilitaciones ni deshabilitaciones reales. Las pruebas no accedieron a Supabase ni a la cartografía externa. La conservación de las operaciones/editor y del alcance por empresa se verificó en código, no mediante una sesión productiva.

## Base de datos

NINGÚN cambio. No SQL, migraciones, tablas, constraints ni escrituras en Supabase. Sin cambios en backend, Auth0, GuardedRoute, rutas globales, roles/permisos, multiempresa ni otros módulos operativos.
