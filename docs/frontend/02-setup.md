# Setup y ejecución

## Instalar
```bash
npm install
```

## Configurar env
Crear `.env` con la URL del backend:
- REACT_APP_API_URL

## Correr
```bash
npm start
```

## Problemas comunes
- **CORS:** revisar backend allowed origins
- **.env no toma cambios:** reiniciar `npm start`
- **401/403:** revisar token/headers en `services` y guards en `routes`