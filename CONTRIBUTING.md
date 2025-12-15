# Contribuir a GrowSync

Gracias por querer contribuir. Este archivo describe normas mínimas para colaborar en el proyecto.

1. Abrir un issue si el cambio es no trivial o afecta la arquitectura.
2. Crear una rama descriptiva: `feat/<descripción>`, `fix/<descripción>`, `docs/<descripción>`.
3. Mantener commits pequeños y atómicos; usar mensajes en inglés o castellano claro.

Checklist para Pull Requests
- [ ] Título claro y descripción de los cambios
- [ ] Issue asociado (si aplica)
- [ ] Tests añadidos o pasos para validar manualmente
- [ ] Documentación actualizada (`docs/` o `README.md`) si aplica
- [ ] No incluir credenciales ni secretos

Convenciones de código
- JavaScript: usar `camelCase` para variables y `PascalCase` para componentes React
- Mantener lógica de negocio en `controllers/` / `services/` y UI en `grow-sync/src/features`

Pruebas y formato
- Ejecutar linters y tests locales antes de enviar PR (si hay configurados)
- Mantener mensajes de commit claros y referenciar issues con `#<número>`

Buenas prácticas para documentación
- Actualiza `docs/` cuando añadas o cambies endpoints, jobs o scripts
- Usa `docs/backend/endpoint-template.md` para agregar nuevos endpoints

Contacto / dudas
- Abrir un issue o mencionar a los mantenedores en la PR.
