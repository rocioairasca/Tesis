import React, {useEffect,useRef,useState} from 'react';
import {Alert,Button,Form,Input,InputNumber,Modal,Select} from 'antd';
import {getUserFriendlyError} from '../../../utils/userFriendlyErrors';
import api from '../../../services/apiClient';

export default function AddHistoricalProduct({planning,onAdded}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(null);
  const [form]=Form.useForm();
  const pending=useRef(false);
  const [products,setProducts]=useState([]),[loading,setLoading]=useState(false);
  useEffect(()=>{
    if(!open)return;
    let active=true;setLoading(true);setProducts([]);
    api.get(`/history/planning/${planning.id||planning._id}/product-options`)
      .then(({data})=>{if(active)setProducts(data);})
      .catch(e=>{if(active)setError(getUserFriendlyError(e,'No pudimos cargar los productos. Cerrá este formulario e intentá nuevamente.'));})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[open,planning.id,planning._id]);
  const selected=Form.useWatch('product_id',form);
  const product=products.find(p=>(p.id||p._id)===selected);
  const available=products.filter(p=>!(planning.products||[]).some(item=>item.product_id===(p.id||p._id)));
  const submit=async()=>{
    if(pending.current)return;
    let values;
    try {values=await form.validateFields();} catch {return;}
    if(pending.current)return;
    pending.current=true;setBusy(true);setError(null);
    try {
      const {data}=await api.post(`/history/planning/${planning.id||planning._id}/products`,values);
      onAdded(data.product);setOpen(false);form.resetFields();
    } catch(e) {
      setError(getUserFriendlyError(e,'No pudimos agregar el producto. Intentá nuevamente.'));
    } finally {pending.current=false;setBusy(false);}
  };
  return <>
    <Button onClick={()=>{setError(null);setOpen(true);}}>Agregar producto histórico</Button>
    <Modal title="Agregar producto histórico" open={open} onCancel={()=>setOpen(false)} onOk={submit}
      okText="Agregar producto" cancelText="Cancelar" confirmLoading={busy} okButtonProps={{disabled:loading || !products.length}}
      closable={!busy} maskClosable={!busy} keyboard={!busy} cancelButtonProps={{disabled:busy}}>
      <Alert type="info" showIcon style={{marginBottom:16}}
        message="Este producto se agregará únicamente al registro histórico. Las existencias del inventario no se modificarán." />
      {error && <Alert type="error" showIcon message={error} style={{marginBottom:16}} />}
      <Form form={form} layout="vertical" disabled={busy}>
        <Form.Item name="product_id" label="Producto" rules={[{required:true,message:'Seleccioná un producto.'}]}>
          <Select loading={loading} disabled={loading} showSearch optionFilterProp="label" options={available.map(p=>({value:p.id||p._id,label:p.name}))} />
        </Form.Item>
        <Form.Item name="amount" label="Cantidad utilizada" extra="También se registrará como cantidad planificada."
          rules={[{required:true,message:'Ingresá una cantidad positiva.'},{validator:(_,v)=>Number.isFinite(Number(v)) && Number(v)>0
            ? Promise.resolve():Promise.reject(new Error('Ingresá una cantidad positiva.'))}]}>
          <InputNumber stringMode min="0.000001" precision={6} style={{width:'100%'}} />
        </Form.Item>
        <Form.Item label="Unidad"><Input readOnly value={product?.unit||''} /></Form.Item>
      </Form>
    </Modal>
  </>;
}