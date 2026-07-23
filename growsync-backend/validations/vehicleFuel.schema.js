const { z } = require('zod');

const FuelType = z.enum(['diesel', 'nafta', 'gnc', 'otro']);

const OptionalText = z.string().trim().max(255).optional().nullable();
const OptionalLongText = z.string().trim().max(1000).optional().nullable();

exports.listByVehicle = z.object({
  params: z.object({
    vehicleId: z.string().uuid(),
  }),
});

exports.createSchema = z.object({
  params: z.object({
    vehicleId: z.string().uuid(),
  }),
  body: z.object({
    fuel_type: FuelType.optional().default('diesel'),
    liters: z.coerce.number().positive('Los litros deben ser mayores a 0'),
    current_fuel: z.coerce.number().min(0, 'El combustible actual no puede ser negativo'),
    fuel_after_load: z.coerce.number().min(0).optional().nullable(),
    unit_price: z.coerce.number().min(0).optional().nullable(),
    odometer: z.coerce.number().min(0).optional().nullable(),
    supplier: OptionalText,
    loaded_at: z.coerce.date().optional(),
    notes: OptionalLongText,
  }),
});

exports.recordParam = z.object({
  params: z.object({
    vehicleId: z.string().uuid(),
    recordId: z.string().uuid(),
  }),
});
