import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { readInitialDraft, saveInitialDraft, clearInitialDrafts, changeInitialDraftDate } from '../stockInitialDraft.mjs';
import StockExpirationEditor, { InitialExpirationField, InitialStockTotal } from './StockExpirationEditor';
import { initialProductGroups, replaceInitialProductEntries } from '../stockInitialGroups.mjs';
import { Alert, Button, Card, DatePicker, Dropdown, Empty, Form, Input, Select, Space, Tooltip, notification, theme } from 'antd';
import { DeleteOutlined, MoreOutlined } from '../../../components/AppIcons';
import { FocusModal, ConfirmDialog } from '../../../components/ui/Overlays';
import './StockInitial.css';
import QuantityUnitFields from '../../../components/QuantityUnitFields';
import api from '../../../services/apiClient';
import { hasPermission } from '../../../utils/permissions';
import { normalizeUnit } from '../../../utils/inventoryUnits';
import { getUserFriendlyError } from '../../../utils/userFriendlyErrors';
import { expirationLabel, quantityLabel, receivedLabel } from '../inventoryModel.mjs';
import { initialApi, initialManifest, confirmationAttempt, enabledProducts, canOpenInitial, canConfirmInitial, initialBlockers } from '../stockInitialModel.mjs';

const service = initialApi(api);
export function initialErrorMessage(error, fallback) {
  const message = getUserFriendlyError(error, fallback);
  return /partida|batch|\bentry\b|manifest|preview_hash|idempot|Inventory V1|unidad base|STOCK_INITIAL/i.test(message) ? fallback : message;
}
export function InitialPreview({ preview, products, manifest }) {
  return <Space direction="vertical" style={{ width: '100%' }}>
    <p>Revisá las cantidades antes de confirmar.</p>
    <p>Fecha de inicio: {receivedLabel(preview.date)} · {initialSummary(preview.entries)}</p>
    {preview.entries.map((entry, index) => <Card size="small" key={index} title={products.find(p => p.id === entry.product_id)?.name || 'Producto'}>
      <p>{quantityLabel(manifest.entries[index].quantity, manifest.entries[index].unit)} → se registrarán {quantityLabel(entry.quantity, entry.unit)}</p>
      <p>Vencimiento: {expirationLabel(entry)}</p>
    </Card>)}
  </Space>;
}

export const availableInitialProducts = (products, rows) => enabledProducts(products).filter(p => !rows.some(row => row?.product_id === p.id));
export const initialSummary = rows => {
  const count = new Set(rows.map(row => row?.product_id).filter(Boolean)).size;
  return `${count} productos${rows.length > count ? ` · ${rows.length} registros` : ''}`;
};
export const newInitialRow = product => ({ product_id: product.id, unit: normalizeUnit(product.unit), quantity: '' });

export function addInitialProduct(selection, products, add, reset, restoreFocus) {
  const product = products.find(p => p.id === selection.current);
  if (!product) return;
  // Clear synchronously so repeated key/click events cannot insert twice.
  selection.current = null;
  add(newInitialRow(product), 0);
  reset();
  restoreFocus();
}
export function initialSearchKeyDown(event, selection, add, keyboardSelection) {
  if (event.key !== 'Enter' || event.nativeEvent?.isComposing) return;
  event.preventDefault();
  if (event.repeat) { event.stopPropagation(); return; }
  if (selection.current != null) { event.stopPropagation(); add(); return; }
  // Select resolves the highlighted option later in this same key event.
  if (keyboardSelection) {
    keyboardSelection.current = true;
    setTimeout(() => { keyboardSelection.current = false; }, 0);
  }
}
export function initialSearchSelect(value, keyboardSelection, selection, add) {
  if (!keyboardSelection.current) return;
  keyboardSelection.current = false;
  selection.current = value;
  add();
}
export function restoreInitialSearch(search, select) {
  search?.closest('.ant-modal-body')?.scrollTo({ top: 0, behavior: 'instant' });
  select?.focus({ preventScroll: true });
}

function GroupTotal({ product, indices }) {
  const form = Form.useFormInstance();
  const totalRows = Form.useWatch(values => indices.map(index => values.entries?.[index]), { form, preserve: true });
  return <InitialStockTotal product={product} rows={(totalRows || indices.map(index => form.getFieldValue(['entries', index]))).filter(Boolean)} />;
}

const EntryFields = memo(function EntryFields({ field, product, remove, edit, indicesKey }) {
  const indices = useMemo(() => JSON.parse(indicesKey), [indicesKey]);
  const multiple = indices.length > 1;
  return <div className="stock-initial-row">
    <div className="stock-initial-product">{product?.name || 'Producto no disponible'}</div>
    <Form.Item name={[field.name, 'product_id']} hidden><Input /></Form.Item>
    <div className="stock-initial-quantity">{multiple
      ? <div className="stock-initial-total"><GroupTotal product={product} indices={indices} /></div>
      : <QuantityUnitFields quantityName={[field.name, 'quantity']} unitName={[field.name, 'unit']} watchPrefix={['entries']} baseUnit={product?.unit} allowZero showBaseUnit={false} previewPrefix="se registrarán" formatPreview={(quantity, unit, preview) => `${quantityLabel(quantity, unit)} → ${preview}`} />}
    </div>
    <div className="stock-initial-expiry">{multiple
      ? <Button type="text" className="stock-initial-expiry-pill" onClick={() => edit(product)} disabled={!product}
          aria-label={`${indices.length} vencimientos de ${product?.name || 'producto'}`}>{indices.length} vencimientos</Button>
      : <InitialExpirationField name={[field.name, 'expiration_period']} />}
    </div>
    <div className="stock-initial-actions">
      <Dropdown trigger={['click']} menu={{ items: [{ key: 'split', label: 'Dividir por vencimiento', onClick: () => edit(product) }] }} disabled={!product}>
        <Button size="small" type="text" icon={<MoreOutlined />} aria-label={`Más acciones de ${product?.name || 'producto'}`} />
      </Dropdown>
      <Tooltip title="Quitar producto">
        <Button type="text" danger shape="circle" aria-label="Quitar producto" icon={<DeleteOutlined />}
          style={{ minWidth: 40, minHeight: 40 }} onClick={() => remove(indices)} />
      </Tooltip>
    </div>
  </div>;
}, (a, b) => a.field.key === b.field.key && a.field.name === b.field.name && a.product === b.product
  && a.indicesKey === b.indicesKey && a.edit === b.edit && a.remove === b.remove);

export function InitialEntries({ products, rows, onChanged }) {
  const form = Form.useFormInstance();
  const [editing, setEditing] = useState(null);
  const editProduct = useCallback(product => setEditing({ product,
    entries: (form.getFieldValue('entries') || []).filter(row => row.product_id === product.id).map(row => ({ ...row })) }), [form]);
  const saveProduct = entries => {
    form.setFieldValue('entries', replaceInitialProductEntries(form.getFieldValue('entries') || [], editing.product.id, entries));
    onChanged?.();
    setEditing(null);
  };
  const [selected, setSelected] = useState(null);
  const [searchValue, setSearchValue] = useState('');
  const selection = useRef(null), selectRef = useRef(null), searchRef = useRef(null);
  const keyboardSelection = useRef(false);
  const operations = useRef(null);
  const removeRow = useCallback((...args) => operations.current.remove(...args), []);
  const { token } = theme.useToken();
  const ids = JSON.stringify(rows.map(row => row?.product_id));
  const groups = useMemo(() => initialProductGroups(JSON.parse(ids).map(product_id => ({ product_id }))), [ids]);
  const counts = useMemo(() => {
    const result = new Map();
    for (const id of JSON.parse(ids)) result.set(id, (result.get(id) || 0) + 1);
    return result;
  }, [ids]);
  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const options = useMemo(() => enabledProducts(products).filter(p => !counts.has(p.id)), [products, counts]);
  const selectOptions = useMemo(() => options.map(p => ({ value: p.id, label: p.name })), [options]);
  return <><Form.List name="entries">{(fields, { add, remove }) => {
    operations.current = { add, remove };
    const addSelected = () => addInitialProduct(selection, options, add,
      () => { setSelected(null); setSearchValue(''); },
      () => requestAnimationFrame(() => restoreInitialSearch(searchRef.current, selectRef.current)));
    return <>
    <div ref={searchRef} className="stock-initial-search" style={{ background: token.colorBgElevated, borderColor: token.colorBorderSecondary }}
      onKeyDownCapture={event => initialSearchKeyDown(event, selection, addSelected, keyboardSelection)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); } }}>
      <Select ref={selectRef} showSearch optionFilterProp="label" placeholder="Buscar producto" aria-label="Buscar producto" allowClear
        searchValue={searchValue} onSearch={setSearchValue}
        onSelect={value => initialSearchSelect(value, keyboardSelection, selection, addSelected)}
        value={selected} onChange={value => { selection.current = value; setSelected(value); }} options={selectOptions} />
      <Button htmlType="button" disabled={!options.some(p => p.id === selected)} onClick={addSelected}>Agregar</Button>
    </div>
    {!fields.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<>
      <div>Todavía no agregaste productos</div><small>Agregá los productos que tenían existencias al inicio del control.</small>
    </>} /> : <>
      <div className="stock-initial-columns" aria-hidden="true"><span>Producto</span><span className="stock-initial-quantity-head"><span>Cantidad</span><span>Unidad</span></span><span>Vencimiento</span><span>Acciones</span></div>
      {groups.map(group => {
        const field = fields[group.indices[0]];
        return field && <EntryFields key={group.product_id} field={field} product={productMap.get(group.product_id)} remove={removeRow}
          edit={editProduct} indicesKey={JSON.stringify(group.indices)} />;
      })}
    </>}
  </>; }}</Form.List>
    {editing && <StockExpirationEditor product={editing.product} entries={editing.entries} onCancel={() => setEditing(null)} onSave={saveProduct} />}
  </>;
}

export default function StockInitial(props) {
  return <StockInitialSession key={props.user?.company_id || 'no-company'} {...props} />;
}

function StockInitialSession({ user, products, ready, onSaved }) {
  const allowed = hasPermission(user, 'history.import');
  const [status, setStatus] = useState(null), [error, setError] = useState(null);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [dialog, setDialog] = useState(false);
  const [date, setDate] = useState(null), [review, setReview] = useState(null);
  const [editingDate, setEditingDate] = useState(false), [dateDialog, setDateDialog] = useState(false);
  const [form] = Form.useForm();
  // Subscribe only to list structure; typing is handled by each field.
  const rowIds = Form.useWatch(values => JSON.stringify((values.entries || []).map(row => row?.product_id)), { form, preserve: true });
  const rows = useMemo(() => JSON.parse(rowIds || '[]').map(product_id => ({ product_id })), [rowIds]);
  const [recovered, setRecovered] = useState(false), [draftError, setDraftError] = useState(false);
  const scope = useRef(null);
  const companyId = user?.company_id;
  const persistDraft = useCallback(() => {
    if (!scope.current || scope.current.closed) return;
    const { company, date } = scope.current;
    setDraftError(!saveInitialDraft(company, date, form.getFieldValue('entries') || []));
  }, [form]);
  useEffect(() => {
    if (!status || !companyId) return;
    if (status.opening?.exists) {
      scope.current = { closed: true };
      clearInitialDrafts(companyId);
      return;
    }
    const date = status.inventory_control_start_date;
    if (!date || (scope.current?.company === companyId && scope.current?.date === date)) return;
    const restored = readInitialDraft(companyId, date);
    scope.current = { company: companyId, date };
    form.setFieldsValue({ entries: restored || [] });
    setRecovered(!!restored?.length);
  }, [status, companyId, form]);
  const lock = useRef(false), attempt = useRef(null);
  const catalog = useMemo(() => enabledProducts(products), [products]);
  const refresh = async () => { const next = await service.status(); setStatus(next); return next; };
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    service.status().then(value => { if (active) setStatus(value); }).catch(e => { if (active) setError(e); });
    return () => { active = false; };
  }, [allowed, companyId]);
  const run = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await action(); } catch (e) { setError(e); } finally { lock.current = false; setBusy(false); }
  };
  const start = () => run(async () => {
    const next = await refresh();
    if (!canOpenInitial(allowed, next)) return;
    // Keep an uncertain confirmation intact even if the modal was closed.
    if (!review && !form.getFieldValue('entries')) form.setFieldsValue({ entries: [] });
    setOpen(true);
  });
  const prepare = () => run(async () => {
    const next = await refresh();
    if (!next.can_prepare || next.opening.exists) throw new Error('No se puede cargar el inventario inicial. Revisá el estado del inventario.');
    const manifest = initialManifest(next.inventory_control_start_date, form.getFieldValue('entries'), catalog);
    const preview = await service.prepare(manifest);
    setReview({ manifest, preview }); attempt.current = null;
  });
  const dateStep = editingDate || !status?.inventory_control_start_date;
  const canEditDate = !status?.opening?.exists && !status?.stock?.batches && !status?.stock?.movements && !attempt.current;
  const backToDate = () => {
    setDate(status?.inventory_control_start_date ? dayjs(status.inventory_control_start_date) : null);
    setEditingDate(true);
  };
  const saveDate = async () => {
    if (!date || !canEditDate) return;
    setBusy(true);
    try {
      const nextDate = date.format('YYYY-MM-DD');
      await changeInitialDraftDate({ company: companyId, previousDate: status.inventory_control_start_date,
        date: nextDate, rows: form.getFieldValue('entries') || [], setDate: value => service.setDate(value) });
      if (!(form.getFieldValue('entries') || []).length) form.setFieldsValue({ entries: readInitialDraft(companyId, nextDate) || [] });
      // Preserve form values and switch scope before status effects can restore it.
      scope.current = { company: companyId, date: nextDate };
      setStatus(previous => ({ ...previous, inventory_control_start_date: nextDate }));
      setReview(null); setEditingDate(false); setDateDialog(false);
      await refresh();
    } finally { setBusy(false); }
  };
  const continueDate = () => {
    if (rows.length && status.inventory_control_start_date && date?.format('YYYY-MM-DD') !== status.inventory_control_start_date) setDateDialog(true);
    else run(saveDate);
  };
  const confirm = async () => {
    if (!canConfirmInitial(status, review?.preview)) throw new Error('Todavía no se puede confirmar el inventario inicial.');
    if (!attempt.current) attempt.current = confirmationAttempt(review.manifest, review.preview);
    setBusy(true);
    try {
      await service.confirm(attempt.current);
      scope.current = { closed: true };
      clearInitialDrafts(companyId);
      // Hide immediately even if the subsequent status refresh fails.
      setStatus(previous => ({ ...previous, opening: { ...previous.opening, exists: true }, can_prepare: false, can_confirm: false }));
      setOpen(false); setDialog(false); setReview(null); attempt.current = null;
      notification.success({ message: 'Inventario inicial registrado' });
      onSaved();
      try { await refresh(); } catch (e) { setError(e); }
    } catch (e) {
      throw new Error(initialErrorMessage(e, 'No se pudo registrar el inventario inicial. Podés volver a intentarlo sin cambiar los datos.'));
    } finally { setBusy(false); }
  };
  const footer = dateStep ? <Space>
    {status?.inventory_control_start_date && <Button disabled={busy} onClick={() => setEditingDate(false)}>Volver a la carga</Button>}
    <Button type="primary" loading={busy} disabled={!date || busy || !canEditDate} onClick={continueDate}>Continuar</Button>
  </Space> : review ? <Space wrap>
    <Button disabled={busy || !!attempt.current} onClick={() => setReview(null)}>Volver</Button>
    <Button disabled={busy} onClick={() => run(refresh)}>Actualizar estado</Button>
    <Button type="primary" disabled={busy || !canConfirmInitial(status, review.preview)} onClick={() => setDialog(true)}>Confirmar inventario inicial</Button>
  </Space> : <div className="stock-initial-footer">
    <span>{initialSummary(rows)}</span><Space wrap>
      <Button disabled={busy || !canEditDate} onClick={backToDate}>Volver a Fecha</Button>
      <Button disabled={busy || !rows.length} onClick={() => { clearInitialDrafts(companyId, status?.inventory_control_start_date); form.setFieldsValue({ entries: [] }); setRecovered(false); }}>Descartar carga</Button>
      <Button disabled={busy} onClick={() => setOpen(false)}>Cerrar</Button>
      {status?.inventory_control_start_date && <Button type="primary" loading={busy} disabled={busy || !status.can_prepare || !rows.length} onClick={prepare}>Revisar inventario inicial</Button>}
    </Space>
  </div>;
  if (!allowed) return null;
  return <>
    {canOpenInitial(allowed, status) && <Button disabled={!ready || busy} onClick={start}>Configurar inventario inicial</Button>}
    {error && !open && <Alert type="error" message={initialErrorMessage(error, 'No se pudo consultar el inventario inicial.')} action={<Button onClick={() => run(refresh)}>Reintentar</Button>} />}
    <FocusModal open={open} title="Configurar inventario inicial" width={1160} rootClassName="stock-initial-modal" footer={footer} busy={busy || dialog || dateDialog} onCancel={() => setOpen(false)}>
      {error && <Alert type="error" message={initialErrorMessage(error, 'No se pudo completar la operación.')} />}
      {(status?.blockers || []).map(code => <Alert key={code} type="warning" showIcon message={initialBlockers[code] || 'No se puede cargar el inventario inicial.'} style={{ marginBottom: 12 }} />)}
      {status?.opening.exists ? null : dateStep ? <Space direction="vertical">
        <label>Fecha de inicio del control de inventario</label>
        <p>Indicá desde qué fecha GrowSync empezará a controlar el inventario.</p>
        <DatePicker aria-label="Fecha de inicio del control de inventario" placeholder="Seleccioná una fecha" format="DD/MM/YYYY" value={date} onChange={setDate} disabled={busy} />
      </Space> : review ? <>
        <InitialPreview {...review} products={catalog} />
        {attempt.current && <Alert type="info" message="Hay un intento de confirmación pendiente. Reintentá sin cambiar los datos." />}
      </> : <>
        {recovered && <Alert type="info" showIcon message="Recuperamos la carga de inventario inicial que estabas completando." />}
        {draftError && <Alert type="warning" message="No pudimos guardar la carga en este dispositivo. Mantené esta ventana abierta para conservarla." />}
        <p>Fecha de inicio: {receivedLabel(status.inventory_control_start_date)} <Button type="text" size="small" disabled={busy || !canEditDate} onClick={backToDate}>Cambiar</Button></p>
        <p>Cargá las existencias que había al {receivedLabel(status.inventory_control_start_date)}. Agregá únicamente los productos que tenían stock en esa fecha.</p>
        <Form form={form} layout="vertical" disabled={busy} onValuesChange={persistDraft} onSubmitCapture={event => event.preventDefault()}>
          <InitialEntries products={catalog} rows={rows} onChanged={persistDraft} />
        </Form>
      </>}
    </FocusModal>
    {dateDialog && <ConfirmDialog open title="Cambiar fecha de inicio" confirmLabel="Cambiar fecha" onCancel={() => setDateDialog(false)} onConfirm={saveDate}
      description="Ya cargaste productos para el inventario inicial. Si cambiás la fecha, revisá que esas cantidades correspondan a la nueva fecha." />}
    {dialog && <ConfirmDialog open title="Confirmar inventario inicial" confirmLabel="Confirmar inventario inicial" onCancel={() => setDialog(false)} onConfirm={confirm}
      description="Después de registrar el inventario inicial, cualquier diferencia deberá corregirse mediante un ingreso o un ajuste de stock." />}
  </>;
}
