const { z } = require('zod');

// Helpers
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
const Qty = z.coerce.number().positive('La cantidad debe ser > 0');
const Area = z.coerce.number().positive('El área total debe ser > 0').optional().nullable();
const Text = z.string().trim();

const uuidArrayNoDup = (label = 'IDs') =>
  z.array(z.string().uuid()).refine(
    (arr) => new Set(arr).size === arr.length,
    { message: `${label} duplicados` }
  );

// CREATE
exports.createBody = z.object({
  body: z.object({
    date: YMD,                              // usage_records.date
    product_id: z.string().uuid(),          // FK a products
    amount_used: Qty,                       // cantidad usada
    unit: Text.min(1, 'Unidad requerida'),  // ej: kg, L
    total_area: Area,                       // ha/ha_equiv
    previous_crop: Text.optional().nullable(),
    current_crop: Text.optional().nullable(),
    user_id: z.string().uuid().optional().nullable(), // operario responsable 
    created_by: z.string().uuid().optional().nullable(),

    // Relación con lotes (usage_lots)
    lot_ids: uuidArrayNoDup('Lotes').min(1, 'Seleccioná al menos un lote'),
  })
});

// UPDATE (parcial)
exports.updateBody = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    date: YMD.optional(),
    product_id: z.string().uuid().optional(),
    amount_used: z.coerce.number().positive().optional(),
    unit: Text.optional(),
    total_area: z.coerce.number().positive().optional().nullable(),
    previous_crop: Text.optional().nullable(),
    current_crop: Text.optional().nullable(),
    user_id: z.string().uuid().optional().nullable(),

    // Lotes
    lot_ids: uuidArrayNoDup('Lotes').optional(),

    // Soft toggle opcional
    enabled: z.coerce.boolean().optional(),
  })
});

// ID param
exports.idParam = z.object({
  params: z.object({ id: z.string().uuid() })
});

// LIST query (filtros + paginado + includeDisabled)
exports.listQuery = z.object({
  query: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    product_id: z.string().uuid().optional(),
    lotId: z.string().uuid().optional(),
    user_id: z.string().uuid().optional(),
    q: z.string().optional(),               // busca por cultivo previo/actual, unidad, etc.

    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(1000).optional(),
    includeDisabled: z.coerce.boolean().optional(),
  })
});
