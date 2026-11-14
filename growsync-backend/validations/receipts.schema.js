const {z}=require('zod');
const {inputUnitSchema}=require('../services/inventoryUnits');
const text=max=>z.string().trim().max(max).nullable().optional();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
 const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
},'Fecha inválida.').nullable().optional();
const metadata=z.object({supplier_name:text(500),supplier_tax_id:text(40),document_number:text(150),document_date:date,document_type:text(80),notes:text(2000)}).strict();
const quantity=z.union([z.string(),z.number()]).transform(String).refine(value=>/^\d{1,14}(\.\d{1,6})?$/.test(value)&&Number(value)>0,'Cantidad positiva con hasta 6 decimales.').nullable().optional();
const line=z.object({raw_description:z.string().trim().min(1).max(500),quantity,unit:inputUnitSchema.nullable().optional(),presentation:text(200),supplier_batch:text(200),expiration_date:date,matched_product_id:z.string().uuid().nullable().optional()}).strict();
const lines=z.object({lines:z.array(line).max(200)}).strict();
const query=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25),status:z.enum(['draft','pending_validation','rejected']).optional(),document_date:date,supplier_name:text(500)}).strict();
const reject=z.object({reason:z.string().trim().min(1).max(2000)}).strict();
const empty=z.object({}).strict();
function parse(schema,body){
 const result=schema.safeParse(body);if(result.success)return result.data;
 // Do not echo unexpected keys, nested objects or supplied values in errors/logs.
 throw Object.assign(new Error('Revisá los campos permitidos y los datos del remito.'),{status:400});
}
module.exports={metadata,lines,query,reject,empty,parse,id:value=>parse(z.string().uuid(),value)};
