const { z } = require('zod');

const Latitude = z.coerce.number().min(-90).max(90);
const Longitude = z.coerce.number().min(-180).max(180);

const LocationQuery = z.object({
  latitude: Latitude.optional(),
  longitude: Longitude.optional(),
  lat: Latitude.optional(),
  lon: Longitude.optional(),
}).refine(
  (v) => (
    (v.latitude != null && v.longitude != null)
    || (v.lat != null && v.lon != null)
  ),
  { message: 'Debes enviar latitude y longitude para obtener el clima actual.' }
);

exports.updateQuery = z.object({
  query: LocationQuery,
});

// Query para obtener el ultimo clima registrado como fallback historico
exports.latestQuery = z.object({
  query: z.object({}),
});
