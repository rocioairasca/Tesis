const { z } = require('zod');

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
const RainMm = z.coerce.number().min(0, 'rain_mm debe ser mayor o igual a 0');
const Source = z.enum(['api', 'manual', 'edited_api']).optional();
const Uuid = z.string().uuid();
const Latitude = z.coerce.number().min(-90).max(90);
const Longitude = z.coerce.number().min(-180).max(180);

exports.createBody = z.object({
  body: z.object({
    date: YMD,
    rain_mm: RainMm,
    source: Source,
    notes: z.string().trim().optional().nullable(),
  }),
});

exports.updateBody = z.object({
  params: z.object({ id: Uuid }),
  body: z.object({
    date: YMD,
    rain_mm: RainMm,
    notes: z.string().trim().optional().nullable(),
  }),
});

exports.idParam = z.object({
  params: z.object({ id: Uuid }),
});

exports.listQuery = z.object({
  query: z.object({
    from: YMD.optional(),
    to: YMD.optional(),
    source: z.enum(['api', 'manual', 'edited_api']).optional(),
    includeDisabled: z.coerce.boolean().optional(),
    onlyDisabled: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(1000).optional(),
  }),
});

exports.syncTodayBody = z.object({
  body: z.object({
    latitude: Latitude,
    longitude: Longitude,
  }),
});
