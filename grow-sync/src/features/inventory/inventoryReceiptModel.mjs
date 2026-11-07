import {normalizeUnit} from '../../utils/inventoryUnits.js';
import {normalizeQuantity} from '../../utils/inventoryConversion.js';
import {receiptExpirationPayload,validateReceipt} from './inventoryModel.mjs';
export function inventoryReceiptPayload(values,products) {
  if(!values.items?.length || values.items.length>100)throw new Error('Agregá entre 1 y 100 productos.');
  const seen=new Set();
  const items=values.items.map(item=>{
    const product=products.find(p=>p.id===item?.product_id && p.enabled!==false);
    if(!product)throw new Error('Seleccioná un producto disponible.');
    if(seen.has(product.id))throw new Error('No se puede repetir un producto en el mismo ingreso.');
    seen.add(product.id);
    const unit=normalizeUnit(product.unit);
    const {normalized_quantity:quantity}=normalizeQuantity({quantity:item.quantity,inputUnit:unit,productUnit:unit});
    validateReceipt({product_id:product.id,quantity,received_date:values.received_date},true);
    return {product_id:product.id,quantity,unit,...receiptExpirationPayload(item.expiration_period)};
  });
  return {received_date:values.received_date,supplier:values.supplier?.trim()||null,
    document_type:values.document_type||null,reference:values.reference?.trim()||null,notes:values.notes?.trim()||null,items};
}
