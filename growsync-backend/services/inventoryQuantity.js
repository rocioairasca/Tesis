// Quantity precision is independent from the UI's decimal formatting.
const {z}=require('zod');
const validQuantity = value => {try {require('./stock').decimal(value);return true;}catch{return false;}};
const quantitySchema=z.coerce.number().finite().refine(validQuantity,'La cantidad admite hasta 6 decimales.');
module.exports={validQuantity,quantitySchema};
