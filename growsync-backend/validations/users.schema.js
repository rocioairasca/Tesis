const { z } = require('zod');

exports.listQuery = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(1000).optional(),
    includeDisabled: z.coerce.boolean().optional(),
    q: z.string().min(2).optional(),
  })
});

exports.emailParam = z.object({
  params: z.object({
    email: z.string().trim().toLowerCase().email('Email inválido'),
  })
});

exports.updateRole = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    role: z.coerce.number().int().min(0).max(3), // 0..3
  }),
});
