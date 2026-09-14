# Header persistente del App Shell

El shell privado ocupa el viewport (`100dvh`, con fallback `100vh`). El header queda fuera de `.gs-shell-scroll`, único contenedor de desplazamiento del contenido y footer. Conserva sus 72 px en desktop/tablet y 64 px en mobile, fondo y borde existentes. El sidebar sigue fijo.

El contenedor desplazable aísla las capas de Leaflet. Los portales de Ant Design en `body` siguen por encima del header (z-index 900). No se modificaron los PageHeader, filtros, composición de Lotes ni módulos de negocio.

## Validación

- Fixture `grow-sync/tests/shell-preview.html`: usa AppLayout real, estilos globales reales, Leaflet real sin tiles externos y almacenamiento ficticio limitado al documento. No modifica la sesión del navegador.
- Desktop 1440×768, tablet 768×1024, mobile 390×844: header top=0 antes y después de scroll; alturas 72/72/64; documento scrollTop=0 mientras el contenedor avanza; encabezado interno sale de pantalla. Sin overflow horizontal ni contenido inicial bajo el header.
- Capturas desktop/mobile y hit testing: Leaflet queda recortado bajo el header. Menú de usuario, modal de confirmación (cancelado) y drawer de notificaciones funcionan sobre el shell.
- Revisión estática de App.jsx: Dashboard, Lotes, Planificaciones, Inventario, Cosechas, Vehículos, Usuarios y Registro de lluvias comparten PrivatePage → AppLayout. No se probaron operaciones ni datos autenticados de cada módulo; la prueba visual corresponde al shell compartido.
- `node --test grow-sync/tests/shell.test.mjs`: 2/2.
- Build Vite correcto, salida aislada `node_modules/.cache/shell-sticky-build`; avisos existentes de configuración ESM y tamaño de bundles.
