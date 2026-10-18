# Permisos propios de Recetas

Recetas usa `recipes.view`, `recipes.create`, `recipes.edit`, `recipes.disable`,
`recipes.enable` y `recipes.view_disabled`. La URL de interfaz sigue siendo
`/usage`; la API de Recetas sigue siendo `/api/recipes`.

`/api/usage` conserva exclusivamente sus permisos `usage.*`: dar permisos de
Recetas no autoriza lecturas ni modificaciones de registros de uso, históricos
o stock a través de esos endpoints.

## Compatibilidad legacy transitoria

`getEffectivePermissions` en backend y frontend agrega el permiso `recipes.*`
equivalente por cada uno de los seis permisos `usage.*` existentes. La regla es
unidireccional, por acción exacta y sin modificar el array persistido. No existe
un alias inverso ni un comodín para acciones desconocidas.

Los arrays `custom_permissions` siguen reemplazando los defaults del rol,
incluso para Admin. Un array vacío no concede permisos; `null` utiliza defaults.
La compatibilidad permite desplegar sin reescribir permisos personalizados.
Su eliminación futura requiere revisar previamente los perfiles legacy.

## Defaults y editor

- Rol 0: agrega `recipes.create`, conserva `usage.create`.
- Rol 1: agrega `recipes.view/create/edit`, conserva sus equivalentes `usage.*`.
- Rol 2: agrega los seis permisos de Recetas, conserva los seis de uso.
- Rol 3: conserva `all`.

El editor presenta grupos independientes «Recetas» y «Registros de uso».
Las casillas editan permisos explícitos; no materializan aliases al guardar.
Una nota explica la compatibilidad temporal. Para un asesor que solo gestione
recetas se pueden seleccionar `recipes.view/create/edit` sin ningún `usage.*`.
Mientras conserve `usage.*`, quitar solo la casilla equivalente de Recetas no
revoca el acceso heredado.

## Uso desde Planning

`/api/planning/recipe-options` ya permite `planning.create` o `planning.edit`.
Se conserva esa autorización acotada: utilizar una receta no requiere editarla
ni administrar registros de uso. Se prueba explícitamente el perfil
`planning.create + recipes.view` en HTTP y navegador.

No hay cambios de esquema, migraciones, datos operativos ni snapshots.
