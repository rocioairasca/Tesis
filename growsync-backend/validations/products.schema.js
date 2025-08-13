const { z } = require('zod');

const Categories = z.enum(['semillas','agroquimicos','fertilizantes','combustible']);

const Name   = z.string().trim().min(1, 'Nombre requerido');
const Unit   = z.string().trim().min(1, 'Unidad requerida');           // ej: kg, L, bolsas
const Money  = z.coerce.number().nonnegative().optional().nullable();  // cost/price
const Qty    = z.coerce.number().nonnegative().optional().nullable();
const YMD    = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD').optional().nullable();

exports.createBody = z.object({
  body: z.object({
    name: Name,
    category: Categories,
    unit: Unit,
    expiration_date: YMD,       // '2025-12-31'
    cost: Money,
    price: Money,
    total_quantity: Qty,
    available_quantity: Qty,
    acquisition_date: YMD,
    // enabled no se toca en create (queda true por defecto en BD)
  }),
});

exports.updateBody = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: exports.createBody.shape.body.partial().extend({
    enabled: z.coerce.boolean().optional(), 
  }),
});

exports.idParam = z.object({
  params: z.object({ id: z.string().uuid() }),
});

exports.listQuery = z.object({
  query: z.object({
    q: z.string().optional(),                 // busqueda por nombre
    category: Categories.optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(1000).optional(),
    includeDisabled: z.coerce.boolean().optional(), // para traer tambien enabled=false
  }),
});
