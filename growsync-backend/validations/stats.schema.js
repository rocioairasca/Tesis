const { z } = require('zod');

const QuickRange = z.enum(['today','yesterday','last7','last30','mtd','qtd','ytd']).optional();

// Fechas ISO opcionales; si vienen, pisan al quick range
const Iso = z.string().datetime().optional();

// Agrupación tipica para series/agrupados
const GroupBy = z.enum(['day','week','month','lot','activity_type','vehicle']).optional();

exports.listQuery = z.object({
  query: z.object({
    // Rango temporal
    range: QuickRange,   // prioriza si no vienen from/to
    from: Iso,
    to: Iso,

    // Agregacion
    groupBy: GroupBy,

    // Soft delete flags 
    includeDisabled: z.coerce.boolean().optional().default(false),
    includeCanceled: z.coerce.boolean().optional().default(false),

    // filtros de contexto
    lotId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),

    // limites
    limit: z.coerce.number().int().min(1).max(10000).optional(),
  })
});
