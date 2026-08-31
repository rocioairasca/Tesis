const { z } = require('zod');

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');

exports.createBody = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Nombre requerido'),
    start_date: YMD,
    end_date: YMD.nullable().optional(),
    status: z.enum(['active', 'closed']).optional(),
  }).superRefine((val, ctx) => {
    if (val.end_date && val.start_date > val.end_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La fecha de finalización no puede ser anterior a la fecha de inicio.',
        path: ['end_date'],
      });
    }
  }),
});

exports.updateBody = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    name: z.string().trim().min(1, 'Nombre requerido').optional(),
    start_date: YMD.optional(),
    end_date: YMD.nullable().optional(),
    status: z.enum(['active', 'closed']).optional(),
  }),
});

exports.idParam = z.object({
  params: z.object({ id: z.string().uuid() }),
});

exports.listQuery = z.object({
  query: z.object({
    includeClosed: z.coerce.boolean().optional(),
    status: z.enum(['active', 'closed']).optional(),
  }),
});
