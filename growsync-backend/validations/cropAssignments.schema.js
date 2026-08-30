const { z } = require('zod');

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');

const validateDateRange = (val, ctx) => {
  if (val.start_date && val.end_date && val.start_date > val.end_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'La fecha de inicio no puede ser posterior a la fecha de finalización',
      path: ['end_date'],
    });
  }
};

exports.createBody = z.object({
  body: z.object({
    campaign_id: z.string().uuid(),
    lot_id: z.string().uuid(),
    sub_lot_id: z.string().uuid().optional().nullable(),
    crop_id: z.string().uuid(),
    start_date: YMD,
    end_date: YMD.optional().nullable(),
  }).superRefine(validateDateRange),
});

exports.updateBody = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    crop_id: z.string().uuid().optional(),
    start_date: YMD.optional(),
    end_date: YMD.optional().nullable(),
  }).superRefine(validateDateRange),
});

exports.idParam = z.object({
  params: z.object({ id: z.string().uuid() }),
});

exports.listQuery = z.object({
  query: z.object({
    campaignId: z.string().uuid().optional(),
    lotId: z.string().uuid().optional(),
  }),
});
