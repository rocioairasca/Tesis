import React, { useState } from 'react';
import { Alert, Button, Form, Input, Space, Tooltip } from 'antd';
import dayjs from 'dayjs';
import esES from 'antd/locale/es_ES';
import { DeleteOutlined, PlusOutlined } from '../../../components/AppIcons';
import { FocusModal } from '../../../components/ui/Overlays';
import QuantityUnitFields from '../../../components/QuantityUnitFields';
import { MonthlyExpirationPicker } from './MonthlyExpirationInput';
import { normalizeUnit } from '../../../utils/inventoryUnits';
import { quantityLabel } from '../inventoryModel.mjs';
import { initialProductTotal, validateInitialProductEntries } from '../stockInitialGroups.mjs';

export function InitialExpirationField({ name }) {
  return <Form.Item name={name} label="Vencimiento">
    <MonthlyExpirationPicker picker="month" format="MM/YYYY" placeholder="MM/AAAA" locale={(esES.default ?? esES).DatePicker}
      minDate={dayjs('2000-01-01')} maxDate={dayjs('2100-12-31')} allowClear style={{ width: '100%' }} />
  </Form.Item>;
}

export function InitialStockTotal({ product, rows }) {
  try { return <>{quantityLabel(initialProductTotal(rows, product), normalizeUnit(product?.unit))}</>; }
  catch { return <>Revisá las cantidades</>; }
}

export default function StockExpirationEditor({ product, entries, onCancel, onSave }) {
  const [form] = Form.useForm();
  const [error, setError] = useState(null);
  const rows = Form.useWatch('entries', form) || entries;
  const save = async () => {
    try {
      await form.validateFields();
      const next = form.getFieldValue('entries');
      validateInitialProductEntries(next, product);
      onSave(next);
    } catch (failure) {
      setError(failure.errorFields ? 'Revisá las cantidades indicadas.' : failure.message);
    }
  };
  return <FocusModal open title="Stock por vencimiento" width={660} rootClassName="stock-expiration-modal" onCancel={onCancel}
    footer={<Space><Button onClick={onCancel}>Cancelar</Button><Button type="primary" className="stock-expiration-save" onClick={save}>Guardar</Button></Space>}>
    <h3 className="stock-expiration-product">{product.name}</h3>
    <div className="stock-expiration-summary">Stock total <strong><InitialStockTotal product={product} rows={rows} /></strong></div>
    {error && <Alert showIcon type="error" message={error} />}
    <Form name="stock-expiration" form={form} layout="vertical" initialValues={{ entries: entries.map(entry => ({ ...entry })) }} onSubmitCapture={event => event.preventDefault()}>
      <Form.List name="entries">{(fields, { add, remove }) => <>
        <div className="stock-expiration-table-scroll">
          <table className="stock-expiration-table">
            <colgroup><col /><col style={{ width: 108 }} /><col style={{ width: 155 }} /><col style={{ width: 44 }} /></colgroup>
            <thead><tr><th scope="col">Cantidad</th><th scope="col">Unidad</th><th scope="col">Vencimiento</th><th scope="col"><span className="stock-expiration-sr-only">Eliminar</span></th></tr></thead>
            <tbody>{fields.map(field => <tr key={field.key}>
              <td colSpan={2}><Form.Item hidden name={[field.name, 'product_id']}><Input /></Form.Item>
                <QuantityUnitFields quantityName={[field.name, 'quantity']} unitName={[field.name, 'unit']} watchPrefix={['entries']}
                  baseUnit={product.unit} showBaseUnit={false} />
              </td>
              <td><InitialExpirationField name={[field.name, 'expiration_period']} /></td>
              <td><Tooltip title="Quitar registro"><Button type="text" danger shape="circle" icon={<DeleteOutlined />}
                aria-label="Quitar registro" onClick={() => remove(field.name)} /></Tooltip></td>
            </tr>)}</tbody>
          </table>
        </div>
        <Button type="text" className="stock-expiration-add" icon={<PlusOutlined />}
          onClick={() => add({ product_id: product.id, quantity: '', unit: normalizeUnit(product.unit) })}>Agregar vencimiento</Button>
      </>}</Form.List>
    </Form>
  </FocusModal>;
}
