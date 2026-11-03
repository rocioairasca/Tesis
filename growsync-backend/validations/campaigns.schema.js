const { campaignDateIssues } = require('../services/campaignWindow');
const { z } = require('zod');

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');

exports.createBody = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Nombre requerido'),
    work_start_date: YMD.nullable().optional(),
    start_date: YMD,
    end_date: YMD.nullable().optional(),
    work_end_date: YMD.nullable().optional(),
    status: z.enum(['active', 'closed']).optional(),
  }).superRefine((val, ctx) => {
    for (const issue of campaignDateIssues(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message, path: [issue.path] });
    }
  }),
});

exports.updateBody = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    name: z.string().trim().min(1, 'Nombre requerido').optional(),
    work_start_date: YMD.nullable().optional(),
    start_date: YMD.optional(),
    end_date: YMD.nullable().optional(),
    work_end_date: YMD.nullable().optional(),
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
