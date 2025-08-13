// validations/lots.schema.js
const { z } = require('zod');

const Name = z.string().trim().min(1, 'Nombre requerido');
const Area = z.coerce.number().positive('Área debe ser > 0');
const Location = z.any().optional().nullable(); 

exports.createBody = z.object({
  body: z.object({
    name: Name,
    area: Area,
    location: Location,         // opcional
    created_by: z.string().uuid().optional().nullable(),
  }),
});

exports.updateBody = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    name: Name.optional(),
    area: Area.optional(),
    location: Location,
    enabled: z.coerce.boolean().optional(), 
  }),
});

exports.idParam = z.object({
  params: z.object({ id: z.string().uuid() }),
});

exports.listQuery = z.object({
  query: z.object({
    q: z.string().optional(),                 // busqueda por nombre
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(1000).optional(),
    includeDisabled: z.coerce.boolean().optional(), 
  }),
});
