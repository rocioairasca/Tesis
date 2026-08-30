const { z } = require('zod');

const Name = z.string().trim().min(1, 'Ingresá el nombre del cultivo');

exports.createBody = z.object({
  body: z.object({
    name: Name,
  }),
});

exports.updateBody = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    name: Name.optional(),
    enabled: z.coerce.boolean().optional(),
  }),
});

exports.idParam = z.object({
  params: z.object({ id: z.string().uuid() }),
});
