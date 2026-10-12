import React from 'react';
import {Button,Form,Input,Select} from 'antd';
import {PlusOutlined,DeleteOutlined} from '../../../components/AppIcons';
import {hasFieldContext} from '../../planning/fieldContext.mjs';
import {doseUnitOptions,RECIPE_ACTIVITIES,RECIPE_CONTEXTS} from '../recipeModel.mjs';
function ItemFields({field,form,products,remove,busy}){
  const productId=Form.useWatch(['items',field.name,'product_id'],form);
  const product=products.find(p=>p.id===productId);
  return <div className="recipe-item-row">
    <Form.Item name={[field.name,'product_id']} label="Producto" rules={[{required:true,message:'Seleccioná un producto.'},
      {validator:(_,id)=>id&&(form.getFieldValue('items')||[]).filter(i=>i?.product_id===id).length>1?Promise.reject(new Error('El producto ya está en la receta.')):Promise.resolve()}]}>
      <Select aria-label={`Producto ${field.name+1}`} showSearch optionFilterProp="label" placeholder="Seleccionar producto" disabled={busy}
        options={products.map(p=>({value:p.id,label:p.name+(p.enabled===false?' (deshabilitado)':'')}))}
        onChange={id=>form.setFieldValue(['items',field.name,'dose_unit'],doseUnitOptions(products.find(p=>p.id===id)?.unit)[0]?.value)} />
    </Form.Item>
    <Form.Item name={[field.name,'dose_amount']} label="Dosis" rules={[{required:true,message:'Ingresá una dosis.'}]}>
      <Input aria-label={`Dosis ${field.name+1}`} inputMode="decimal" placeholder="2,5" disabled={busy} />
    </Form.Item>
    <Form.Item name={[field.name,'dose_unit']} label="Unidad /ha" rules={[{required:true,message:'Seleccioná la unidad.'}]}>
      <Select aria-label={`Unidad de dosis ${field.name+1}`} options={doseUnitOptions(product?.unit)} disabled={busy||!product} placeholder="Unidad /ha" />
    </Form.Item>
    <Button aria-label={`Eliminar producto ${field.name+1}`} danger icon={<DeleteOutlined />} disabled={busy} onClick={()=>remove(field.name)} />
  </div>;
}
export default function RecipeForm({form,products,crops,busy,onFinish}){
  const activity=Form.useWatch('activity_type',form);
  return <Form form={form} layout="vertical" onFinish={onFinish} disabled={busy}>
    <Form.Item name="name" label="Nombre" rules={[{required:true,whitespace:true,message:'Ingresá un nombre.'},{max:200,message:'Usá hasta 200 caracteres.'}]}><Input maxLength={200} /></Form.Item>
    <Form.Item name="activity_type" label="Actividad" rules={[{required:true,message:'Seleccioná una actividad.'}]}>
      <Select options={RECIPE_ACTIVITIES} onChange={value=>{if(!hasFieldContext(value))form.setFieldValue('field_context',null);}} />
    </Form.Item>
    {hasFieldContext(activity)&&<Form.Item name="field_context" label="Contexto"><Select allowClear placeholder="Sin contexto específico" options={RECIPE_CONTEXTS} /></Form.Item>}
    <Form.Item name="crop_id" label="Cultivo relacionado"><Select allowClear showSearch optionFilterProp="label" placeholder="General, sin cultivo específico" options={crops.map(c=>({value:c.id,label:c.name+(c.enabled===false?' (deshabilitado)':'')}))} /></Form.Item>
    <h3>Productos</h3>
    <Form.List name="items" rules={[{validator:(_,items)=>items?.length?Promise.resolve():Promise.reject(new Error('Agregá al menos un producto.'))}]}>
      {(fields,{add,remove},{errors})=><>
        {fields.map(field=><ItemFields key={field.key} field={field} form={form} products={products} remove={remove} busy={busy} />)}
        <Form.ErrorList errors={errors} />
        <Button block icon={<PlusOutlined />} disabled={busy||fields.length>=100} onClick={()=>add({})}>Agregar producto</Button>
      </>}
    </Form.List>
  </Form>;
}
