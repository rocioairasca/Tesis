# Patrones compartidos de GrowSync

Importar desde `components/ui` para cargar también `patterns.css`. Requieren el
ConfigProvider y los tokens de Fase 1. No hacen requests, deciden permisos,
traducen estados de negocio ni modifican registros. Todavía no se usan en módulos.

## Contratos

- `PageHeader`: `title`, `description`, `breadcrumb` (items de Ant Design),
  `primaryAction` y `secondaryActions`. Cada acción tiene `key`, `label`,
  `onClick`, `disabled`, `hidden` e `icon` opcionales. El caller filtra permisos.
  Sólo una acción primaria; varias secundarias pasan a overflow en mobile.
- `FilterBar`: `search: {value,onChange,label,placeholder}`, `filters` y
  `moreFilters` como controles React **controlados**. `activeFilters` contiene
  `{key,label,onRemove}`; `onClear` define qué limpiar. No mantiene borradores:
  los cambios se aplican por callbacks y “Ver resultados” sólo cierra el drawer.
  Los controles necesitan sus propios labels accesibles. No usar campos sin
  estado controlado, porque cambian de ubicación al cruzar el breakpoint.
- `StatusBadge`: contenido textual y `tone` (`success`, `warning`, `danger`/
  `error`, `info`, `neutral`); los módulos proporcionan el mapa estado→tono.
  `CategoryTag` identifica clasificación con tratamiento neutro rectangular.
- `Metric`: `label`, `value` ya formateado, `helper`, `icon`,
  `status: {tone,label}`, `compact`, `onClick`, `disabled`. Un KPI interactivo
  es un botón nativo; no anidar otros botones dentro de él.
- `ViewSwitcher`: `options`, `value`, `onChange`, `disabled`, `label` accesible.
  Usa Segmented; representa vistas del mismo conjunto, no navegación entre rutas.
- `EmptyState`: `title` contextual obligatorio, `description`, `icon`,
  `action: {label,onClick,disabled}`. Diferenciar colección vacía de filtros sin
  resultados desde el caller.
- `EntityLink`: `to` para rutas ya existentes o `onClick` para abrir detalle;
  `disabled` evita interacción. Nunca inventa destinos.
- `LoadingState`: skeleton por defecto, `rows`; `variant="action"` usa spinner.
  `ErrorState`: `error`, `message` de fallback, `onRetry`, `retrying`. Reutiliza
  el sanitizador existente; no mostrar stack traces ni respuestas crudas.

## Tabla

`DataTable` se basa en Ant Design Table; `columns`, `dataSource` y `rowKey`
identifican el contenido. Columnas numéricas: `align: 'right'`. `ellipsis` es
true por defecto y puede desactivarse para contenido complejo. Filas de ~56 px,
cabecera sutil, hover y selección diferenciados.

- `paginationMode="local"` (default): recibe **todos** los registros filtrados.
- `paginationMode="server"`: recibe únicamente la página actual; el caller
  aporta `pagination: {current,pageSize,total,onChange}` y hace la consulta.
- `pagination={false}`: sin paginación. Tamaño fijo por defecto, sin selector.
- Reiniciar `current` desde el caller al cambiar filtros.
- `loading` muestra skeleton; `error` y `onRetry` muestran error recuperable.
- `empty: {title,description,action}` define un mensaje contextual.
- `actions(row)` devuelve acciones para `RowActions`. `danger` las separa con
  divisor. Abrir una confirmación desde `onClick` para operaciones sensibles.
- `rowLabel(row)` da un nombre accesible a cada registro.
- Mobile usa registros verticales; `mobileColumns` permite elegir campos o
  `renderMobile(row)` personalizar el contenido. No desplaza la tabla entera.
- Selección compartida: checkbox **controlado** con
  `rowSelection: {selectedRowKeys,onChange,getCheckboxProps}`. En paginación de
  servidor, los objetos seleccionados disponibles son sólo los de la página;
  usar las claves como fuente de verdad. No habilitar radio/selección jerárquica
  ni selección global sin extender y probar ambos modos.
- Sorting/filter menus avanzados de Ant Table no tienen equivalente automático
  en los registros mobile. Usar controles externos comunes antes de integrarlos.

## Overlays y confirmación

`FocusModal` es para operaciones breves; `FormDrawer` para contexto largo.
Drawer: 500 px normal, 680 px `wide`, ancho completo en mobile. Ambos aceptan
`children`, `footer` y `busy`; durante busy bloquean cierre por máscara, Escape
y botón. El footer queda fuera del área desplazable.

`ConfirmDialog`: `open`, `title`, `description`, `consequences`, `confirmLabel`,
`destructive`, `onConfirm`, `onCancel`, `onSuccess`. `onConfirm` puede devolver
una promesa; debe rechazar en caso de error. El componente evita doble envío,
presenta errores sanitizados y no se cierra hasta que el caller lo haga en
`onSuccess`. Montarlo con `{selected && <ConfirmDialog ... />}` para que cada
operación tenga estado propio. No añade idempotencia de servidor ni decide
autorización; esas responsabilidades siguen en cada módulo.

## Preview y validación

Con Vite activo: `/tests/ui-preview.html`. Datos sintéticos en memoria, sin
sesión, endpoints ni ruta en App.jsx. No está en el grafo de producción y el
montaje requiere `import.meta.env.DEV`.

Tests: desde la raíz del repositorio,
`node --test grow-sync/tests/uiPatterns.test.mjs`.

La siguiente fase puede adoptar estos patrones módulo por módulo, conservando
handlers, permisos, paginación y reglas existentes. No migrar todas las tablas
ni formularios en una sola operación.
