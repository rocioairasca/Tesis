import React, {useRef, useState} from 'react';
import {Form, Modal, notification} from 'antd';
import api from '../../../services/apiClient';
import {getUserFriendlyError} from '../../../utils/userFriendlyErrors';
import {identityPayload} from '../inventoryModel.mjs';
import ProductIdentityForm from './ProductIdentityForm';

export default function QuickProductModal({initialName,canCreate,canViewDisabled,onUse,onClose}) {
  const [form]=Form.useForm(),[saving,setSaving]=useState(false);
  const busy=useRef(false);
  const close=()=>{if(!busy.current)onClose();};
  const useExisting=product=>{if(!busy.current)onUse(product);};
  const create=async values=>{
    if(busy.current||!canCreate)return;
    busy.current=true;setSaving(true);
    try {
      const {data}=await api.post('/products',identityPayload(values));
      notification.success({message:'Producto creado'});
      onUse(data.product);
    } catch(error) {
      notification.error({message:getUserFriendlyError(error,'No se pudo guardar el producto.')});
    } finally {busy.current=false;setSaving(false);}
  };
  return <Modal open centered title="Crear nuevo producto" width={540} className="inventory-quick-product-modal"
    footer={null} onCancel={close} closable={!saving} maskClosable={!saving} keyboard={!saving}>
    <p className="inventory-quick-product-help">Se creará el producto y se agregará automáticamente al ingreso.</p>
    <ProductIdentityForm quick form={form} initialValues={{name:initialName}} saving={saving} onFinish={create}
      canViewDisabled={canViewDisabled} onUse={useExisting} onCancel={close}/>
  </Modal>;
}
