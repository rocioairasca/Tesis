const { z } = require('zod');

// Enums
const ActivityType = z.enum(['fumigacion','siembra','cosecha','fertilizacion','riego','mantenimiento','otro']);
const EditableStatus = z.enum(['planificado','pendiente','en_progreso','completado']);
const StatusFilter = z.enum(['planificado','pendiente','en_progreso','completado','en_demora','cancelado']);
const ACTIVITIES_REQUIRING_CROP = new Set(['fumigacion', 'siembra', 'cosecha', 'fertilizacion']);

// Helpers
const Title = z.string().trim().min(1, 'Título requerido').optional().nullable();
const Description = z.string().trim().optional().nullable();

// Validador de array de UUIDs sin duplicados
const uuidArrayNoDup = (fieldLabel = 'IDs') =>
  z.array(z.string().uuid()).refine(
    (arr) => new Set(arr).size === arr.length,
    { message: `${fieldLabel} duplicados` }
  );

const LotSelectionItem = z.object({
  lot_id: z.string().uuid(),
  sub_lot_id: z.string().uuid().optional().nullable(),
});

const lotSelectionArrayNoDup = z.array(LotSelectionItem).refine(
  (arr) => {
    const keys = arr.map(item => `${item.lot_id}:${item.sub_lot_id || 'full'}`);
    return new Set(keys).size === keys.length;
  },
  { message: 'Lotes o sublotes duplicados' }
);

const requireLotSelection = (val, ctx) => {
  const hasLegacyLots = Array.isArray(val.lot_ids) && val.lot_ids.length > 0;
  const hasSelections = Array.isArray(val.lot_selections) && val.lot_selections.length > 0;

  if (!hasLegacyLots && !hasSelections) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Debes seleccionar al menos un lote o sublote',
      path: ['lot_selections'],
    });
  }
};

// Products item
const ProductItem = z.object({
  product_id: z.string().uuid(),
  amount: z.coerce.number().positive().optional().nullable(),
  unit: z.string().trim().optional().nullable(),
});

const ActualProductItem = z.object({
  planning_product_id: z.string().uuid(),
  actual_amount: z.union([z.number(), z.string()]),
});

// Body base (CREATE)
const baseBody = z.object({
  title: Title,
  description: Description,
  activity_type: ActivityType,
  start_at: z.string().datetime({ message: 'start_at debe ser fecha/hora ISO' }),
  end_at: z.string().datetime({ message: 'end_at debe ser fecha/hora ISO' }),
  responsible_user: z.string().uuid(),
  status: EditableStatus,
  vehicle_id: z.string().uuid().optional().nullable(),
  campaign_id: z.string().uuid(),
  crop_id: z.string().uuid().optional().nullable(),
  lot_ids: uuidArrayNoDup('Lotes').optional(),
  lot_selections: lotSelectionArrayNoDup.optional(),
  products: z.array(ProductItem).optional(),
  created_by: z.string().uuid().optional().nullable(),
})
.superRefine((val, ctx) => {
  requireLotSelection(val, ctx);

  if (ACTIVITIES_REQUIRING_CROP.has(val.activity_type) && !val.crop_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Seleccioná un cultivo.',
      path: ['crop_id'],
    });
  }

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
    lot_selections: lotSelectionArrayNoDup.optional(),
    campaign_id: z.string().uuid().optional().nullable(),
    crop_id: z.string().uuid().optional().nullable(),
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
exports.completeSowingSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD'),
    actual_products: z.array(ActualProductItem).optional(),
  }),
});

exports.completeWorkSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD'),
    actual_products: z.array(ActualProductItem).optional(),
  }),
});

exports.listQuery = z.object({
  query: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    type: ActivityType.optional(),
    status: StatusFilter.optional(),
    responsible: z.string().uuid().optional(),
    lotId: z.string().uuid().optional(),
    subLotId: z.string().uuid().optional(),
    cropId: z.string().uuid().optional(),
    campaignId: z.string().uuid().optional(),
    search: z.string().optional(),

    // Paginado con coercion a numero
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(1000).optional(),

    // Flags para incluir ocultas/canceladas
    includeCanceled: z.coerce.boolean().optional(),
    includeDisabled: z.coerce.boolean().optional(),
  })
});
