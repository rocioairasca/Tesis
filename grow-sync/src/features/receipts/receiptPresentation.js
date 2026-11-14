export const statusLabels={draft:'Borrador',pending_validation:'Pendiente de revisión',rejected:'Rechazado'};
export const statusColors={draft:'default',pending_validation:'gold',rejected:'red'};
export const metadataFields=['supplier_name','supplier_tax_id','document_number','document_date','document_type','notes'];
export const lineFields=['raw_description','quantity','unit','presentation','supplier_batch','expiration_date','matched_product_id'];
export const metadataPayload=values=>Object.fromEntries(metadataFields.map(key=>[key,values[key]||null]));
export const linesPayload=lines=>({lines:lines.map(line=>Object.fromEntries(lineFields.map(key=>[key,line[key]===''?null:line[key]??null])))});
