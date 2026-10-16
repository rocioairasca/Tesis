const {z}=require('zod'),{date}=require('./soilAnalysis.schema');
const text=z.string().max(4000).nullable();
const result=z.strictObject({parameter_name:z.string().min(1).max(200).nullable(),method:text,unit:z.string().max(100).nullable(),raw_value:text,numeric_value:z.number().finite().nullable(),result_status:z.enum(['measured','not_requested','qualitative']),sort_order:z.number().int().min(0).max(10000)});
const sample=z.strictObject({sample_date:date.nullable(),depth_from_cm:z.number().min(0).max(999999.99).nullable(),depth_to_cm:z.number().min(0).max(999999.99).nullable(),sample_name:text,position_description:text,sampled_by:text,notes:text,results:z.array(result).max(100)});
const extraction=z.strictObject({report_number:z.string().max(200).nullable(),laboratory:z.string().max(200).nullable(),received_date:date.nullable(),notes:text,samples:z.array(sample).max(20),warnings:z.array(z.string().max(300)).max(30)});
const jsonSchema=z.toJSONSchema(extraction);delete jsonSchema.$schema;
module.exports={extraction,jsonSchema};
