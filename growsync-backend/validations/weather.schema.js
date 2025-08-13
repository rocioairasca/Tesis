const { z } = require('zod');

// Unidades y lenguaje soportados por OpenWeather
const Units = z.enum(['standard', 'metric', 'imperial']).optional().default('metric');
const Lang  = z.enum(['es','en','pt','fr','it']).optional().default('es');

// Coordenadas: latitud y longitud
const Coord = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  city: z.string().trim().min(1).optional(),
});

// Regla: o bien (lat y lon), o bien city, o nada
const CoordRefined = Coord.refine(
  (v) => (v.lat != null && v.lon != null) || !!v.city || (v.lat == null && v.lon == null && !v.city),
  { message: 'Debes enviar (lat y lon) o city, o ninguno para usar la ubicación por defecto.' }
);

exports.updateQuery = z.object({
  // admitimos params tanto en query (GET) como en body (POST); aquí solo modelamos query
  query: CoordRefined.extend({
    units: Units,
    lang: Lang,
  })
});

// Query para obtener el último clima registrado
exports.latestQuery = z.object({
  query: z.object({
    city: z.string().trim().min(1).optional(),
  })
});
