import React,{useEffect,useState} from 'react';
import {Alert,Button,Form,Input,Modal,Spin} from 'antd';
import './profile.css';
import api from '../../services/apiClient';
import {roleLabel} from '../../constants/roles.mjs';
import {getUserFriendlyError} from '../../utils/userFriendlyErrors';
export default function UserProfileModal({onClose,onSaved}){
 const [form]=Form.useForm(),[profile,setProfile]=useState(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(null),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError(null);
  api.get('/users/me',{signal:controller.signal}).then(({data})=>{if(!controller.signal.aborted)setProfile(data);}).catch(e=>{if(!controller.signal.aborted)setError(getUserFriendlyError(e,'No pudimos cargar tu perfil. Intentá nuevamente.'));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[retry]);
 const save=async values=>{
  setSaving(true);setError(null);
  try{const {data}=await api.patch('/users/me/profile',{full_name:values.full_name.trim()});onSaved(data);}
  catch(e){setError(getUserFriendlyError(e,'No pudimos guardar tu nombre. Intentá nuevamente.'));}
  finally{setSaving(false);}
 };
 return <Modal className="gs-profile-modal" open title="Editar perfil" onCancel={saving?undefined:onClose} closable={!saving} maskClosable={!saving} keyboard={!saving} onOk={()=>form.submit()} okText="Guardar cambios" cancelText="Cancelar" confirmLoading={saving} okButtonProps={{disabled:loading||!profile}} cancelButtonProps={{disabled:saving}} width={480}>
  {error&&<Alert type="error" showIcon message={error} action={!profile?<Button size="small" onClick={()=>setRetry(n=>n+1)}>Reintentar</Button>:undefined}/>}
  {loading?<div className="gs-profile-loading" role="status"><Spin size="small"/> Cargando perfil…</div>:profile&&<Form form={form} layout="vertical" initialValues={{full_name:profile.full_name||''}} onFinish={save} disabled={saving}>
   <Form.Item name="full_name" label="Nombre y apellido" rules={[{required:true,whitespace:true,message:'Ingresá tu nombre y apellido.'},{validator:(_,value)=>typeof value==='string'&&value.trim().length>=2&&value.trim().length<=100&&!/[\u0000-\u001f\u007f]/.test(value)?Promise.resolve():Promise.reject(new Error('Usá entre 2 y 100 caracteres, sin caracteres de control.'))}]}><Input aria-label="Nombre y apellido" autoComplete="name"/></Form.Item>
   <Form.Item label="Correo electrónico"><Input aria-label="Correo electrónico" value={profile.email||''} readOnly/></Form.Item>
   <Form.Item label="Empresa"><Input aria-label="Empresa" value={profile.company_name||'No informada'} readOnly/></Form.Item>
   <Form.Item label="Rol"><Input aria-label="Rol" value={roleLabel(profile.role)} readOnly/></Form.Item>
  </Form>}
 </Modal>;
}
