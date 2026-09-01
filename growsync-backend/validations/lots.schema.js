// validations/lots.schema.js
const { z } = require('zod');

const Name = z.string().trim().min(1, 'Nombre requerido');
const Area = z.coerce.number().positive('Área debe ser > 0');
const Location = z.any().optional().nullable(); 
const LayoutStatus = z.enum(['draft', 'active', 'locked', 'archived']);
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');

const GeoJsonPolygon = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(
    z.array(
      z.tuple([
        z.coerce.number().min(-180).max(180),
        z.coerce.number().min(-90).max(90),
      ])
    ).min(4)
  ).min(1),
}).passthrough();

const ToleranceHa = z.coerce.number().min(0).max(100).optional().nullable();

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

exports.lotIdParam = z.object({
  params: z.object({ lotId: z.string().uuid() }),
});

exports.productiveStateParam = z.object({
  params: z.object({ lotId: z.string().uuid() }),
  query: z.object({
    date: YMD.optional(),
  }),
});

exports.lotHistoryParam = z.object({
  params: z.object({ lotId: z.string().uuid() }),
  query: z.object({
    subLotId: z.string().uuid().optional(),
  }),
});

exports.productiveStateQuery = z.object({
  query: z.object({
    date: YMD.optional(),
  }),
});

exports.layoutParam = z.object({
  params: z.object({
    lotId: z.string().uuid(),
    layoutId: z.string().uuid(),
  }),
});

exports.subLotParam = z.object({
  params: z.object({
    lotId: z.string().uuid(),
    layoutId: z.string().uuid(),
    subLotId: z.string().uuid(),
  }),
});

exports.createLayoutBody = z.object({
  params: z.object({ lotId: z.string().uuid() }),
  body: z.object({
    name: z.string().trim().min(1).optional().nullable(),
    tolerance_ha: ToleranceHa,
  }),
});

exports.updateLayoutBody = z.object({
  params: z.object({
    lotId: z.string().uuid(),
    layoutId: z.string().uuid(),
  }),
  body: z.object({
    name: z.string().trim().min(1).optional().nullable(),
    tolerance_ha: ToleranceHa,
    status: LayoutStatus.optional(),
  }).refine(
    (body) => Object.keys(body).length > 0,
    { message: 'Debes enviar al menos un campo para actualizar' }
  ),
});

exports.createSubLotBody = z.object({
  params: z.object({
    lotId: z.string().uuid(),
    layoutId: z.string().uuid(),
  }),
  body: z.object({
    code: z.string().trim().min(1).max(50),
    name: z.string().trim().min(1).max(255),
    geom: GeoJsonPolygon,
    sort_order: z.coerce.number().int().min(0).optional(),
    enabled: z.coerce.boolean().optional(),
  }),
});

exports.updateSubLotBody = z.object({
  params: z.object({
    lotId: z.string().uuid(),
    layoutId: z.string().uuid(),
    subLotId: z.string().uuid(),
  }),
  body: z.object({
    code: z.string().trim().min(1).max(50).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    geom: GeoJsonPolygon.optional(),
    sort_order: z.coerce.number().int().min(0).optional(),
    enabled: z.coerce.boolean().optional(),
  }).refine(
    (body) => Object.keys(body).length > 0,
    { message: 'Debes enviar al menos un campo para actualizar' }
  ),
});

const SubLotSnapshotItem = z.object({
  id: z.string().uuid().nullable().optional(),
  clientId: z.string().trim().min(1).max(120).nullable().optional(),
  client_id: z.string().trim().min(1).max(120).nullable().optional(),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(255),
  geom: GeoJsonPolygon,
  sort_order: z.coerce.number().int().min(0).optional(),
  enabled: z.coerce.boolean().optional(),
});

exports.replaceSubLotsBody = z.object({
  params: z.object({
    lotId: z.string().uuid(),
    layoutId: z.string().uuid(),
  }),
  body: z.object({
    subLots: z.array(SubLotSnapshotItem).max(1000),
  }),
});

exports.listQuery = z.object({
  query: z.object({
    q: z.string().optional(),                 // busqueda por nombre
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(1000).optional(),
    includeDisabled: z.coerce.boolean().optional(), 
    includeActiveLayout: z.coerce.boolean().optional(),
  }),
});
