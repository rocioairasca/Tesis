const { z } = require('zod');

const Categories = z.enum(['semillas','agroquimicos','fertilizantes','combustible']);

const Name   = z.string().trim().min(1, 'Nombre requerido');
const Unit   = require('../services/inventoryUnits').unitSchema;           // ej: kg, L, bolsas
const Money  = z.coerce.number().nonnegative().optional().nullable();  // cost/price
const Qty    = require('../services/inventoryQuantity').quantitySchema.nonnegative().optional().nullable();
const YMD = z.string().refine(value => { try { require('../services/stock').calendarDate(value); return true; } catch { return false; } }, 'Fecha calendario inválida').optional().nullable();

exports.createBody = z.object({
  body: z.object({
    active_ingredient: z.string().max(500).nullable().optional(),
    formulation: z.string().max(500).nullable().optional(),
    manufacturer: z.string().max(500).nullable().optional(),
    minimum_stock: require('../services/inventoryQuantity').quantitySchema.nonnegative().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
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

exports.addStockBody = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    quantity: require('../services/inventoryQuantity').quantitySchema.positive('quantity debe ser mayor a 0'),
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
    includeDisabled: z.union([z.boolean(),z.enum(['true','false','1','0'])]).transform(v=>v===true||v==='true'||v==='1').optional(), // para traer tambien enabled=false
  }),
});
