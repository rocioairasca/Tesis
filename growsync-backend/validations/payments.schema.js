const { z } = require('zod');

exports.createPayment = z.object({
  body: z.object({
    plan: z.enum(['basic', 'professional']),
    payment_method: z.enum(['qr', 'card', 'transfer']),
  }),
});

exports.idParam = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});
