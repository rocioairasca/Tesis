import {normalizeUnit} from '../../utils/inventoryUnits';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Drawer, Dropdown, Empty, Form, Input, Modal, Row, Select, Space, Statistic, Table, Tag, notification } from 'antd';
import { MoreOutlined, PlusOutlined } from '../../components/AppIcons';
import api from '../../services/apiClient';
import useIsMobile from '../../hooks/useIsMobile';
import { PERMISSIONS } from '../../constants/permissions';
import { hasPermission } from '../../utils/permissions';
import { getUserFriendlyError } from '../../utils/userFriendlyErrors';
import ProductIdentityForm from './components/ProductIdentityForm';
import ReceiptModal from './components/ReceiptModal';
import ProductDetailDrawer from './components/ProductDetailDrawer';
import AdjustmentModal from './components/AdjustmentModal';
import { categories, categoryLabel, expiration, expirationLabel, identityPayload, lowStock, productState, quantityLabel, soon, stockQuantity } from './inventoryModel.mjs';

export default function Inventory() {
  const [products, setProducts] = useState([]), [enabled, setEnabled] = useState(false), [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState(null), [revision, setRevision] = useState(0);
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all'), [state, setState] = useState('all');
  const [identity, setIdentity] = useState(null), [receipt, setReceipt] = useState(null), [detailId, setDetailId] = useState(null);
  const [saving, setSaving] = useState(false), [created, setCreated] = useState(null);
  const [adjustment,setAdjustment]=useState(null),[similarDetail,setSimilarDetail]=useState(null);
  const [page, setPage] = useState(1);
  const [form] = Form.useForm();
  const busy = useRef(false), fetchVersion = useRef(0);
  const mobile = useIsMobile();
  const user = useMemo(() => JSON.parse(localStorage.getItem('user') || 'null'), []);
  const canView = hasPermission(user, PERMISSIONS.INVENTORY_VIEW);
  // Match existing backend role floor as well as custom permissions.
  const canCreate = Number(user?.role) >= 2 && hasPermission(user, PERMISSIONS.INVENTORY_CREATE);
  const canEdit = Number(user?.role) >= 2 && hasPermission(user, PERMISSIONS.INVENTORY_EDIT);
  const canDisable = Number(user?.role) >= 2 && hasPermission(user, PERMISSIONS.INVENTORY_DISABLE);
  const canViewDisabled = hasPermission(user, PERMISSIONS.INVENTORY_VIEW_DISABLED);
  const fetchProducts = useCallback(async () => {
    const version = ++fetchVersion.current;
    setLoading(true); setError(null);
    try {
      const all = []; let currentPage = 1; let mode = false;
      // Load every page so search, selectors and metrics include the whole inventory.
      while (true) {
        const { data } = await api.get('/products', { params: { page: currentPage, pageSize: 1000 } });
        if (version !== fetchVersion.current) return;
        mode = data.inventory_v1_enabled === true;
        all.push(...data.data);
        if (all.length >= data.total || !data.data.length) break;
        currentPage++;
      }
      setProducts(all); setEnabled(mode); setReady(true); setRevision(r => r + 1);
    } catch (e) { if (version === fetchVersion.current) { setReady(false); setError(getUserFriendlyError(e, 'No se pudo cargar el inventario.')); } }
    finally { if (version === fetchVersion.current) setLoading(false); }
  }, []);
  useEffect(() => { if (canView) fetchProducts(); return () => { fetchVersion.current++; }; }, [fetchProducts, canView]);
  const openIdentity = product => {
    form.resetFields(); form.setFieldsValue(product ? {...identityPayload(product),unit:normalizeUnit(product.unit)} : {});
    setIdentity({ product });
  };
  const saveIdentity = async values => {
    if (busy.current || !(identity.product ? canEdit : canCreate)) return;
    busy.current = true; setSaving(true);
    try {
      const payload = identityPayload(values);
      const { data } = identity.product ? await api.put(`/products/${identity.product.id}`, payload) : await api.post('/products', payload);
      if (!identity.product) setCreated(data.product);
      notification.success({ message: identity.product ? 'Producto actualizado' : 'Producto creado' });
      setIdentity(null); await fetchProducts();
    } catch (e) { notification.error({ message: getUserFriendlyError(e, 'No se pudo guardar el producto.') }); }
    finally { busy.current = false; setSaving(false); }
  };
  const disable = product => {
    if(enabled&&stockQuantity(product,true)>0){
      Modal.warning({title:`Este producto todavía tiene ${quantityLabel(stockQuantity(product,true),product.unit)} disponibles.`,content:'Para deshabilitar este producto, primero ajustá su stock o resolvé las existencias pendientes.'});return;
    }
    Modal.confirm({ title: `¿Deshabilitar ${product.name}?`, content: 'El producto conservará su historial y dejará de aparecer en el inventario activo.', okText: 'Deshabilitar', cancelText: 'Cancelar', onOk: async () => {
    try { await api.delete(`/products/${product.id}`); if (detailId === product.id) setDetailId(null); await fetchProducts(); }
    catch (e) { notification.error({ message: getUserFriendlyError(e, 'No se pudo deshabilitar el producto.') }); throw e; }
  } });};
  const actions = p => <Dropdown trigger={['click']} menu={{ items: [
    { key: 'detail', label: 'Ver detalle', onClick: () => setDetailId(p.id) },
    ...(canEdit ? [{ key: 'receipt', label: 'Registrar ingreso', disabled: !ready, onClick: () => setReceipt({ product: p }) },
      { key: 'edit', label: 'Editar producto', disabled: !ready, onClick: () => openIdentity(p) },
      { key: 'adjust', label: 'Ajustar stock', disabled: !enabled||!ready, onClick:()=>setAdjustment(p) }] : []),
    ...(canDisable ? [{ key: 'disable', label: 'Deshabilitar', disabled: !ready, onClick: () => disable(p) }] : []),
  ] }}><Button aria-label={`Acciones de ${p.name}`} icon={<MoreOutlined />} /></Dropdown>;
  const filtered = products.filter(p => (!search || p.name.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')))
    && (category === 'all' || p.category === category)
    && (state === 'all' || (state === 'Disponible' && stockQuantity(p, enabled) > 0)
      || (state === 'Sin stock' && stockQuantity(p, enabled) <= 0)
      || (state === 'Stock bajo' && lowStock(p, enabled))
      || (state === 'Próximo a vencer' && soon(expiration(p, enabled)))))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const detail = products.find(p => p.id === detailId)|| (similarDetail?.id===detailId?similarDetail:null);
  const name = p => <Button type="link" style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => setDetailId(p.id)}>{p.name}</Button>;
  if (!canView) return <Alert type="warning" message="No tenés permiso para ver el inventario." />;
  return <div style={{ padding: mobile ? 12 : 24 }}>
    <Row justify="space-between" align="middle" gutter={[12, 12]} style={{ marginBottom: 20 }}>
      <Col><h2 style={{ margin: 0 }}>Inventario</h2></Col>
      <Col><Space wrap>
        {canEdit && <Button type="primary" icon={<PlusOutlined />} disabled={!ready} onClick={() => setReceipt({ product: null })}>Registrar ingreso</Button>}
        {canCreate && <Button icon={<PlusOutlined />} disabled={!ready} onClick={() => openIdentity(null)}>Nuevo producto</Button>}
        {canViewDisabled && <Button onClick={() => { window.location.href = '/productos-deshabilitados'; }}>Ver deshabilitados</Button>}
      </Space></Col>
    </Row>
    {error && <Alert type="error" message={error} action={<Button onClick={fetchProducts}>Reintentar</Button>} style={{ marginBottom: 16 }} />}
    {created && <Alert type="success" message={`${created.name}: producto creado sin stock`} closable onClose={() => setCreated(null)} style={{ marginBottom: 16 }} action={canEdit && <Button disabled={!ready} onClick={() => setReceipt({ product: created })}>Registrar primer ingreso</Button>} />}
    <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
      {[
        ['Productos', products.length], ['Stock bajo', products.filter(p => lowStock(p, enabled)).length],
        ['Próximos a vencer', products.filter(p => soon(expiration(p, enabled))).length], ['Sin stock', products.filter(p => stockQuantity(p, enabled) <= 0).length],
      ].map(([title, value]) => <Col xs={12} lg={6} key={title}><Card size="small"><Statistic title={title} value={value} loading={loading} /></Card></Col>)}
    </Row>
    <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
      <Col xs={24} md={12}><Input.Search placeholder="Buscar productos..." aria-label="Buscar productos" allowClear value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></Col>
      <Col xs={12} md={6}><Select aria-label="Categoría" style={{ width: '100%' }} value={category} onChange={v => { setCategory(v); setPage(1); }} options={[{ value: 'all', label: 'Todas las categorías' }, ...categories]} /></Col>
      <Col xs={12} md={6}><Select aria-label="Estado" style={{ width: '100%' }} value={state} onChange={v => { setState(v); setPage(1); }} options={[{ value: 'all', label: 'Todos los estados' }, ...['Disponible', 'Stock bajo', 'Sin stock', 'Próximo a vencer'].map(value => ({ value, label: value }))]} /></Col>
    </Row>
    {mobile ? <Space direction="vertical" style={{ width: '100%' }}>
      {!filtered.length && <Empty description={loading ? 'Cargando productos...' : 'No hay productos para estos filtros.'} />}
      {filtered.map(p => <Card size="small" key={p.id} title={name(p)} extra={actions(p)}>
        <p><strong>Stock disponible: {quantityLabel(stockQuantity(p, enabled), p.unit)}</strong></p>
        <Tag>{productState(p, enabled)}</Tag><p>Próximo vencimiento: {expirationLabel(expiration(p, enabled))}</p>
      </Card>)}
    </Space> : <Table rowKey="id" loading={loading} dataSource={filtered} pagination={{ current: page, pageSize: 10, showSizeChanger: false, onChange: setPage }} columns={[
      { title: 'Producto', key: 'name', render: (_, p) => name(p) }, { title: 'Categoría', dataIndex: 'category', render: categoryLabel },
      { title: 'Stock disponible', key: 'stock', render: (_, p) => quantityLabel(stockQuantity(p, enabled), p.unit) },
      { title: 'Estado', key: 'state', render: (_, p) => <Tag>{productState(p, enabled)}</Tag> },
      { title: 'Próximo vencimiento', key: 'expiration', render: (_, p) => expirationLabel(expiration(p, enabled)) },
      { title: 'Acciones', key: 'actions', render: (_, p) => actions(p) },
    ]} />}
    <Drawer open={!!identity} title={identity?.product ? 'Editar producto' : 'Nuevo producto'} width={mobile ? '100%' : 460} onClose={() => !saving && setIdentity(null)} closable={!saving} maskClosable={!saving}>
      {identity && <ProductIdentityForm form={form} editing={identity.product} enabled={enabled} saving={saving} onFinish={saveIdentity} canEdit={canEdit} canViewDisabled={canViewDisabled}
        onUse={p=>{setIdentity(null);setSimilarDetail(p);setDetailId(p.id);}}
        onReceipt={p=>{setIdentity(null);setProducts(list=>list.some(x=>x.id===p.id)?list:[...list,p]);setReceipt({product:p});}} />}
    </Drawer>
    {receipt && <ReceiptModal products={products} product={receipt.product} enabled={enabled} canEdit={canEdit && ready} canCreate={canCreate} onCreate={() => { setReceipt(null); openIdentity(null); }} onClose={() => setReceipt(null)} onSaved={fetchProducts} />}
    {detail && <ProductDetailDrawer product={detail} enabled={enabled} canEdit={canEdit && ready&&detail.enabled!==false} mobile={mobile} onClose={() => setDetailId(null)} onReceipt={p => setReceipt({ product: p })} onAdjust={setAdjustment} revision={revision} />}
    {adjustment&&<AdjustmentModal product={adjustment} enabled={enabled} canEdit={canEdit&&ready} onClose={()=>setAdjustment(null)} onSaved={p=>{setProducts(list=>list.map(x=>x.id===p.id?p:x));fetchProducts();}}/>}
  </div>;
}
