import {unitLabel} from '../../../utils/inventoryUnits';
import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Space, Spin, Tabs, Tag, Typography } from 'antd';
import { getStockBatches, getStockMovements } from '../../../services/stockService';
import { getUserFriendlyError } from '../../../utils/userFriendlyErrors';
import { batchState, categoryLabel, expiration, expirationLabel, movementTypes, origins, productState, quantityLabel, receivedLabel, stockQuantity } from '../inventoryModel.mjs';

function History({ product, tab, mobile }) {
  const [rows, setRows] = useState([]), [page, setPage] = useState(1), [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState(null), [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    (tab === 'batches' ? getStockBatches : getStockMovements)(product.id, { page, pageSize: 25 }).then(data => {
      if (active) { setRows(data.data); setMore(data.data.length === 25); }
    }).catch(e => { if (active) setError(getUserFriendlyError(e, 'No se pudo cargar el historial.')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [product.id, tab, page, attempt]);
  if (error) return <Alert type="error" message={error} action={<Button onClick={() => setAttempt(x => x + 1)}>Reintentar</Button>} />;
  return <Spin spinning={loading}>
    {!rows.length && !loading && <Empty description={tab === 'batches' ? 'Todavía no hay partidas registradas.' : 'Todavía no hay movimientos registrados.'} />}
    <Space direction="vertical" style={{ width: '100%' }}>
      {rows.map(r => <Card size="small" key={r.id}>
        {tab === 'batches' ? <>
          <Space wrap><Typography.Text strong>Partida {r.id.slice(0, 8)}</Typography.Text><Tag>{batchState(r)}</Tag></Space>
          <p>{receivedLabel(r.received_date)}</p>
          <p>Inicial: {quantityLabel(r.initial_quantity, r.unit)} · Disponible: {quantityLabel(r.available_quantity, r.unit)}</p>
          <p>{expirationLabel(r.expiration_date)} · {r.supplier || 'Proveedor no registrado'}</p>
          <Button size="small" onClick={() => setDetail(r)}>Ver partida</Button>
        </> : <>
          <Space wrap><Typography.Text strong>{movementTypes[r.movement_type] || 'Movimiento'}</Typography.Text>
            <Tag color={Number(r.quantity) > 0 ? 'green' : 'orange'}>{Number(r.quantity) > 0 ? '+' : ''}{quantityLabel(r.quantity, r.unit)}</Tag></Space>
          <p>{new Date(r.occurred_at).toLocaleString('es-AR')}</p>
          <p>Partida {r.batch_id.slice(0, 8)} · {r.batch_reference || 'Sin referencia'} · {receivedLabel(r.batch_received_date)}</p>
          <p>{(r.usage_id || r.usage_record_id) ? 'Registro de uso' : origins[r.batch_origin] || 'Inventario'}{r.batch_supplier ? ` · ${r.batch_supplier}` : ''}</p>
          <Typography.Text type="secondary">{r.notes || 'Sin observaciones'}</Typography.Text>
        </>}
      </Card>)}
      <Space><Button disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>Anterior</Button><span>Página {page}</span><Button disabled={!more || loading} onClick={() => setPage(p => p + 1)}>Siguiente</Button></Space>
    </Space>
    <Drawer open={!!detail} onClose={() => setDetail(null)} title="Detalle de partida" width={mobile ? '100%' : 460}>
      {detail && <Descriptions column={1} items={[
        ['Cantidad inicial', quantityLabel(detail.initial_quantity, detail.unit)], ['Disponible', quantityLabel(detail.available_quantity, detail.unit)],
        ['Fecha de ingreso', receivedLabel(detail.received_date)], ['Vencimiento', expirationLabel(detail.expiration_date)],
        ['Precio unitario', detail.unit_price], ['Moneda', detail.currency], ['Tipo de cambio', detail.exchange_rate],
        ['Total original', detail.total_original], ['Total ARS', detail.total_ars], ['Proveedor', detail.supplier],
        ['Comprobante / referencia', detail.reference], ['Observaciones', detail.notes], ['Origen', origins[detail.origin]],
      ].map(([label, children]) => ({ key: label, label, children: children ?? 'No registrado' }))} />}
    </Drawer>
  </Spin>;
}

export default function ProductDetailDrawer({ product, enabled, canEdit, mobile, onClose, onReceipt, onAdjust, revision }) {
  return <Drawer open onClose={onClose} width={mobile ? '100%' : 680} title={<><div>{product.name}</div><Typography.Text type="secondary">{categoryLabel(product.category)} · {unitLabel(product.unit)}</Typography.Text></>}>
    <Space wrap style={{ marginBottom: 20 }}><Tag>{productState(product, enabled)}</Tag><strong>{quantityLabel(stockQuantity(product, enabled), product.unit)}</strong><span>{expirationLabel(expiration(product, enabled))}</span></Space>
    <Tabs destroyOnHidden items={[
      { key: 'summary', label: 'Resumen', children: <>
        <Descriptions column={1} items={[
          ['Nombre comercial', product.name], ['Categoría', categoryLabel(product.category)], ['Unidad base', unitLabel(product.unit)],
          ['Principio activo / composición', product.active_ingredient], ['Concentración / formulación', product.formulation],
          ['Marca / fabricante', product.manufacturer], ['Stock disponible', quantityLabel(stockQuantity(product, enabled), product.unit)],
          ['Stock mínimo', product.minimum_stock == null ? 'No registrado' : quantityLabel(product.minimum_stock, product.unit)],
          ['Próximo vencimiento', expirationLabel(expiration(product, enabled))], ['Observaciones', product.notes],
        ].map(([label, children]) => ({ key: label, label, children: children ?? 'No registrado' }))} />
        {product.enabled===false&&<Tag>Deshabilitado</Tag>}
        {canEdit && <Space wrap><Button type="primary" onClick={() => onReceipt(product)}>Registrar ingreso</Button><Button disabled={!enabled} onClick={()=>onAdjust(product)}>Ajustar stock</Button></Space>}
      </> },
      ...['batches', 'movements'].map(tab => ({ key: tab, label: tab === 'batches' ? 'Partidas' : 'Movimientos', children: enabled
        ? <History key={`${product.id}:${tab}:${revision}`} product={product} tab={tab} mobile={mobile} />
        : <Empty description="El historial detallado de ingresos estará disponible al actualizar el inventario." /> })),
    ]} />
  </Drawer>;
}
