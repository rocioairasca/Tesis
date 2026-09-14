# Lotes: composición del workspace (2026-09-14)

## Archivos de este cambio
- grow-sync/src/features/lots/LotsOverview.jsx
- grow-sync/src/features/lots/lotsOverview.css
- grow-sync/src/features/lots/components/LotOverviewContext.jsx
- grow-sync/src/features/lots/components/LotsOverviewMap.jsx
- grow-sync/src/features/lots/lotsMapViewport.mjs (nuevo)
- grow-sync/tests/lotsMapViewport.test.mjs (nuevo)
- grow-sync/tests/lots-preview.jsx
- docs/lots-composition-2026-09-14.md (este informe)

## Decisiones visuales
Se retira la gran superficie blanca envolvente solo en Lotes, conservando padding del shell. Encabezado con texto solicitado y una sola acción primaria + Nuevo lote (Phosphor). Toolbar blanca compacta con FilterBar y ViewSwitcher compartidos. Divisiones pasa a moreFilters del FilterBar existente, no a un componente paralelo; en móvil todos los filtros están en el drawer compartido.
Métricas secundarias en una fila flexible, sin cards individuales. Árbol, mapa y contexto son las tres superficies conceptuales. En ancho suficiente se reparten aproximadamente 22/56/22; altura del mapa ligada al viewport (380–620px). Se elimina la leyenda técnica permanente. Selección de árbol suave, jerarquía y nombres reales intactos; contexto vacío reducido y detalle compacto con enlace Ver detalle. Se conservan los roles visuales de los polígonos y no se asignan colores por cultivo.
No se copiaron datos, acciones, ubicaciones o polígonos de la referencia. No se añadieron fotografías, proveedores o iconos de cultivos específicos.

## Encuadre del lote distante
Nueva estrategia exclusivamente de viewport:
1. Calcula una extensión por lote (padre y sus divisiones cuentan una sola vez).
2. Agrupa por proximidad de sus centros. La tolerancia deriva de la mediana de distancia al vecino más cercano y de la mediana del tamaño de los lotes, multiplicadas por 4. No usa coordenadas ni una región fija.
3. Si hay un grupo con mayoría estricta, lo encuadra inicialmente. Un aviso discreto informa cuántos lotes quedaron fuera del encuadre inicial.
4. Si hay menos de tres lotes con geometría o no hay una mayoría clara, encuadra todos: no elige una zona arbitraria.
5. Seleccionar cualquier lote, incluso el distante, lo encuadra; Ver todos sigue incluyendo todos explícitamente, aunque el zoom resulte muy abierto. Ningún lote se elimina del árbol, lista o capa.

Los filtros y resize reutilizan esta estrategia salvo selección activa o petición explícita de Ver todos. Las geometrías y los helpers de interpretación no cambian.

## Responsive
Desktop amplio: tres áreas, mapa protagonista. Por debajo de 1050px de contenido disponible: árbol + mapa y contexto inferior. Por debajo de 620px de contenido: árbol compacto arriba y mapa debajo. Mobile: sin árbol, mapa a ancho disponible y bottom sheet de selección; Lista muestra registros compactos/expansión existentes. Controles táctiles de selección y acciones conservan 44px.
Matriz revisada en navegador: 320, 375, 390, 768, 1024, 1280, 1440 y 1680px. Contenedor Leaflet con dimensiones positivas, dentro de página, sin overflow horizontal. La preview incluye padding adicional de prueba; la pantalla real usa el padding principal existente del shell.

## Validación
- 3 tests nuevos de encuadre: mayoría cercana + distante, filtro por distante y estado vacío, sin exclusión arbitraria para pocos lotes; no mutación y orden de entrada independiente.
- 6 tests de mapGeometry: aprobados.
- 6 tests de lotsOverview: aprobados, incluyendo permisos, jerarquía, filtros, selección y lectura paginada.
- Total ejecutado: 15/15 aprobados.
- Build producción aprobado: npm --prefix grow-sync run build -- --outDir node_modules/.cache/lots-composition-build.
- Advertencias previas de Vite sobre ESM en config y bundles grandes; sin errores de build.
- Browser: grupo cercano conserva polígonos legibles (lote Norte 140px), seleccionar el distante muestra su polígono (~233px), Ver todos abre la extensión global.
- Árbol → mapa y polígono por teclado (Enter) → árbol/contexto; selección de sublote expande padre.
- Más filtros → Sin divisiones excluye sublotes y limpia selección; limpiar filtros restaura vista.
- Mapa/Lista excluyentes: cero contenedores Leaflet en Lista.
- Móvil: click en lote sin subdivisiones abre bottom sheet con datos y acciones existentes; lista separada y empty state de búsqueda comprobados.
- Consola sin errores/warnings nuevos en preview.

Pruebas con componentes reales y datos ficticios, sin operaciones productivas. El outlier real señalado en las capturas no fue consultado vía API; se reprodujo ese caso en fixture local con coordenadas de prueba.

## Alcance funcional
Solo cambió la estrategia de encuadre solicitada y la ubicación visual del filtro Divisiones. Se conservan callbacks, selección, permisos, rutas, acciones CRUD, tabla, estructura de datos y flujo del bottom sheet. El texto de acceso al detalle es más breve, con el mismo destino. No se tocaron Leaflet/Geoman de edición ni subdivisiones/versionado.

**Backend: sin cambios. Base de datos/Supabase: sin cambios. Geometrías almacenadas: sin cambios.**
