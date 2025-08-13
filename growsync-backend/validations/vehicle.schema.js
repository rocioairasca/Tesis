const { z } = require('zod');

// Enums
const VehicleType = z.enum(['tractor','camioneta','camion','cosechadora','fumigadora','otro']);
const VehicleStatus = z.enum(['activo','mantenimiento','inactivo']);

// Helpers
const Name = z.string().trim().min(1, 'Nombre requerido');
const Brand = z.string().trim().optional().nullable();
const Model = z.string().trim().optional().nullable();
// Patente generica: letras/numeros/guiones (evita espacios y simbolos raros)
const Plate = z.string().regex(/^[A-Za-z0-9-]+$/).optional().nullable();
// Capacidad en numero (coerce desde string), debe ser > 0 si se envia
const Capacity = z.coerce.number().positive().optional().nullable();
const Notes = z.string().trim().optional().nullable();

exports.createSchema = z.object({
  body: z.object({
    name: Name,
    type: VehicleType.optional().default('otro'),
    brand: Brand,
    model: Model,
    plate: Plate,
    capacity: Capacity,
    notes: Notes,
    status: VehicleStatus.optional().default('activo'),
    responsible_user: z.string().uuid().optional().nullable(),
    created_by: z.string().uuid().optional().nullable(),
    // enabled no se toca en create (queda true por defecto en la BD)
  }),
});

exports.updateSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: exports.createSchema.shape.body.partial().extend({
    // Permite soft delete / restore desde PATCH
    enabled: z.coerce.boolean().optional(),
  }),
});

exports.idParam = z.object({ params: z.object({ id: z.string().uuid() }) });

// Listado con filtros + paginado + includeDisabled (soft delete)
exports.listQuery = z.object({
  query: z.object({
    q: z.string().min(2).optional(),                   // busqueda minima 2 chars
    type: VehicleType.optional(),
    status: VehicleStatus.optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(1000).optional(),
    includeDisabled: z.coerce.boolean().optional(),    // <- para traer tambien enabled=false
  }),
});

