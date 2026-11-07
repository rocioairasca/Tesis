import React,{useEffect} from 'react';
import {Form,Select,InputNumber,Button,Tooltip,Alert} from 'antd';
import {EditOutlined,DeleteOutlined} from '../../../components/AppIcons';
import {normalizeQuantity,compatibleUnitOptions,exceedsAvailable} from '../../../utils/inventoryConversion';
import {normalizeUnit,quantityLabel} from '../../../utils/inventoryUnits';
import {calculateRecipeItem} from '../planningRecipe.mjs';
export default function PlanningFormProducts({form,products,area,completed,performed}) {
 const rows=Form.useWatch('products',form)||[];
 useEffect(()=>{
  for(const [index,item] of (form.getFieldValue('products')||[]).entries())if(item?.ui_dose!=null&&Number(area)>0){
   const p=products.find(p=>(p.id||p._id)===item.product_id);
   try{const total=calculateRecipeItem({dose_amount:item.ui_dose,dose_unit:item.unit,product_unit:p.unit,area_ha:String(area)});form.setFieldValue(['products',index,'amount'],total.amount);}catch{/* Field validation handles incomplete input. */}
  }
 },[area,form]);
 return <Form.List name="products">{(fields,{add,remove})=><>
  <div className="planning-form-products-toolbar"><Button onClick={()=>add({})} disabled={completed}>Agregar producto</Button></div>
  {performed&&fields.length>0&&<Alert type="info" message="Los productos se descontarán de partidas existentes y vigentes en la fecha efectiva. El stock se valida al guardar."/>}
  <div className="planning-form-products-head" aria-hidden="true"><span>Producto</span><span>Dosis / ha</span><span>Cantidad total</span><span>Unidad</span><span>Acciones</span></div>
  {fields.map(({key,name})=>{
   const item=rows[name]||{},p=products.find(p=>(p.id||p._id)===item.product_id),unit=normalizeUnit(p?.unit||item.unit);
   const calculate=dose=>{
    if(dose==null||!p||!area)return;
    try{form.setFieldValue(['products',name,'amount'],calculateRecipeItem({dose_amount:dose,dose_unit:unit,product_unit:p.unit,area_ha:String(area)}).amount);form.setFieldValue(['products',name,'unit'],unit);}catch{}
   };
   return <div key={key} className="planning-product-row planning-form-product-row">
    <Form.Item name={[name,'product_id']} label="Producto" rules={completed?[]:[{required:true,message:'Seleccioná un producto.'}]}>
     <Select showSearch optionFilterProp="label" disabled={completed} options={products.map(p=>({value:p.id||p._id,label:p.name}))}
      onChange={id=>{form.setFieldValue(['products',name,'unit'],normalizeUnit(products.find(p=>(p.id||p._id)===id)?.unit));form.setFieldValue(['products',name,'ui_dose'],null);}}/>
    </Form.Item>
    <Form.Item name={[name,'ui_dose']} label="Dosis / ha">
     <InputNumber stringMode decimalSeparator="," disabled={completed||!p||!area} min="0" onChange={calculate} placeholder={area&&item.amount!=null?String(Number(item.amount)/Number(area)):undefined}/>
    </Form.Item>
    <Form.Item name={[name,'amount']} label={performed?'Cantidad utilizada':'Cantidad'} rules={completed?[]:[{required:true,message:'Ingresá la cantidad.'},{validator:(_,v)=>{
     try{normalizeQuantity({quantity:v,inputUnit:item.unit||unit,productUnit:unit});if(!performed&&exceedsAvailable(v,item.unit||unit,unit,p?.available_quantity??0))throw Error('No hay stock suficiente.');return Promise.resolve();}catch(e){return Promise.reject(e);}
    }}]} extra={p?'Disponible: '+quantityLabel(p.available_quantity??0,unit):null}>
     <InputNumber stringMode decimalSeparator="," disabled={completed} onChange={()=>form.setFieldValue(['products',name,'ui_dose'],null)}/>
    </Form.Item>
    <Form.Item name={[name,'unit']} label="Unidad"><Select disabled={completed||!p} options={compatibleUnitOptions(unit)} onChange={()=>form.setFieldValue(['products',name,'ui_dose'],null)}/></Form.Item>
    <div className="planning-form-product-actions">
     <Tooltip title="Editar" trigger={['hover','focus']}><Button type="text" aria-label="Editar" icon={<EditOutlined/>} disabled={completed} onClick={()=>form.getFieldInstance(['products',name,'product_id'])?.focus()}/></Tooltip>
     <Tooltip title="Eliminar" trigger={['hover','focus']}><Button danger type="text" aria-label="Eliminar" icon={<DeleteOutlined/>} disabled={completed} onClick={()=>remove(name)}/></Tooltip>
    </div>
   </div>;
  })}
 </>}</Form.List>;
}
