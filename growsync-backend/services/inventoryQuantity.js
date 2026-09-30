// Quantity precision is independent from the UI's decimal formatting.
const {z}=require('zod');
const validQuantity = value => {try {require('./stock').decimal(value);return true;}catch{return false;}};
const quantitySchema=z.coerce.number().finite().refine(validQuantity,'La cantidad admite hasta 6 decimales.');
// Keep decimal strings intact before converting operational quantities.
const inputQuantitySchema=z.union([z.string(),z.number()]).transform((value,ctx)=>{
  try {return require('./inventoryConversion').decimalText(value);}
  catch(error){ctx.addIssue({code:'custom',message:error.message});return z.NEVER;}
}).refine(value=>require('./stock').decimal(value)>0n,'La cantidad debe ser > 0');
module.exports={validQuantity,quantitySchema,inputQuantitySchema};
