const { z } = require('zod');

// Enums
const ActivityType = z.enum(['fumigacion','siembra','cosecha','fertilizacion','riego','mantenimiento','otro']);
const Status = z.enum(['planificado','pendiente','en_progreso','completado','en_demora','cancelado']);

// Helpers
const Title = z.string().trim().min(1, 'Título requerido');
const Description = z.string().trim().optional().nullable();

// Validador de array de UUIDs sin duplicados
const uuidArrayNoDup = (fieldLabel = 'IDs') =>
  z.array(z.string().uuid()).refine(
    (arr) => new Set(arr).size === arr.length,
    { message: `${fieldLabel} duplicados` }
  );

// Products item
const ProductItem = z.object({
  product_id: z.string().uuid(),
  amount: z.coerce.number().positive().optional().nullable(),
  unit: z.string().trim().optional().nullable(),
});

// Body base (CREATE)
const baseBody = z.object({
  title: Title,
  description: Description,
  activity_type: ActivityType,
  start_at: z.string().datetime({ message: 'start_at debe ser fecha/hora ISO' }),
  end_at: z.string().datetime({ message: 'end_at debe ser fecha/hora ISO' }),
  responsible_user: z.string().uuid(),
  status: Status, // Nota: "en_demora" suele ser derivado, pero se acepta si se envia
  vehicle_id: z.string().uuid().optional().nullable(),
  lot_ids: uuidArrayNoDup('Lotes').min(1, 'Debes seleccionar al menos un lote'),
  products: z.array(ProductItem).optional(),
  created_by: z.string().uuid().optional().nullable(),
})
.superRefine((val, ctx) => {
  // start <= end
  const start = Date.parse(val.start_at);
  const end = Date.parse(val.end_at);
  if (Number.isFinite(start) && Number.isFinite(end) && start > end) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'start_at no puede ser mayor que end_at', path: ['end_at'] });
  }

  // products sin duplicados por product_id
  if (val.products && val.products.length) {
    const ids = val.products.map(p => p.product_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'products contiene product_id duplicados', path: ['products'] });
    }
  }
});

// Schemas exportados
exports.createSchema = z.object({ body: baseBody });

exports.updateSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: baseBody.partial().extend({
    // En PATCH, lot_ids/products pueden venir omitidos o vacios; seguimos validando duplicados si vienen
    lot_ids: uuidArrayNoDup('Lotes').optional(),
    products: z.array(ProductItem).optional(),
    // Opcional: permitir togglear enabled desde PATCH para soft delete/restore
    enabled: z.coerce.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    // Si vienen ambas fechas, validar orden
    if (val.start_at && val.end_at) {
      const start = Date.parse(val.start_at);
      const end = Date.parse(val.end_at);
      if (Number.isFinite(start) && Number.isFinite(end) && start > end) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'start_at no puede ser mayor que end_at', path: ['end_at'] });
      }
    }
    // Duplicados en products si vienen
    if (val.products && val.products.length) {
      const ids = val.products.map(p => p.product_id);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'products contiene product_id duplicados', path: ['products'] });
      }
    }
  }),
});

exports.idParam = z.object({ params: z.object({ id: z.string().uuid() }) });

exports.listQuery = z.object({
  query: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    type: ActivityType.optional(),
    status: Status.optional(),
    responsible: z.string().uuid().optional(),
    lotId: z.string().uuid().optional(),
    search: z.string().optional(),

    // Paginado con coercion a numero
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(1000).optional(),

    // Flags para incluir ocultas/canceladas
    includeCanceled: z.coerce.boolean().optional(),
    includeDisabled: z.coerce.boolean().optional(),
  })
});
