const { z } = require('zod');

const Email = z.string().trim().toLowerCase().email('Email invalido');

exports.createCompanyInvitation = z.object({
  body: z.object({
    companyName: z.string().trim().min(2, 'Nombre de empresa requerido'),
    email: Email,
    plan: z.enum(['basic', 'professional']),
  }),
});
