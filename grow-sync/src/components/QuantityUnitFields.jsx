import React from 'react';
import { Form, InputNumber, Select } from 'antd';
import { compatibleUnitOptions, conversionPreview, exceedsAvailable, quantityInput } from '../utils/inventoryConversion.js';
import { normalizeUnit, unitLabel } from '../utils/inventoryUnits.js';

const UnitSelect = ({ value, baseUnit, ...props }) => <Select {...props} value={value || normalizeUnit(baseUnit)} />;

// Names are relative to Form.List; watchPrefix supplies its absolute path.
export default function QuantityUnitFields({ quantityName, unitName, watchPrefix = [], baseUnit, label = 'Cantidad',
  available, allowZero = false, allowConversion = true, disabled = false, previewPrefix = 'Equivale a', extra, showBaseUnit = true, formatPreview }) {
  const form = Form.useFormInstance();
  const quantityPath = [...watchPrefix, ...[].concat(quantityName)];
  const unitPath = [...watchPrefix, ...[].concat(unitName)];
  // Form.List indices move on insertion/removal; selector watches follow the
  // current path without rc-field-form's unsupported dynamic-namePath mode.
  const watchedQuantity = Form.useWatch(values => quantityPath.reduce((value, key) => value?.[key], values), form);
  const watchedUnit = Form.useWatch(values => unitPath.reduce((value, key) => value?.[key], values), form);
  const quantity = watchedQuantity ?? form.getFieldValue(quantityPath);
  const unit = watchedUnit ?? form.getFieldValue(unitPath) ?? normalizeUnit(baseUnit);
  let preview = '';
  try { preview = conversionPreview(quantity, unit, baseUnit, previewPrefix, allowZero); } catch { /* validation displays the error */ }
  const validate = async (_, value) => {
    if (!baseUnit) throw new Error('Seleccioná un producto.');
    const selectedUnit = form.getFieldValue(unitPath) || normalizeUnit(baseUnit);
    quantityInput(value, selectedUnit, baseUnit, allowZero);
    if (available != null && exceedsAvailable(value, selectedUnit, baseUnit, available, allowZero)) throw new Error('No hay stock suficiente.');
  };
  return <Form.Item label={label} extra={<>
    {baseUnit && showBaseUnit && <div>Unidad base: {unitLabel(baseUnit)}</div>}
    {preview && <div aria-live="polite">{formatPreview ? formatPreview(quantity, unit, preview) : preview}</div>}
    {extra}
  </>}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <Form.Item name={quantityName} style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
        dependencies={[unitPath]} rules={disabled ? [] : [{ required: true, message: 'Ingresá la cantidad.' }, { validator: validate }]}>
        <InputNumber aria-label={label} stringMode changeOnBlur={false} decimalSeparator="," disabled={disabled}
          style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name={unitName} style={{ width: 100, flexShrink: 0, marginBottom: 0 }}>
        <UnitSelect baseUnit={baseUnit} aria-label={`Unidad de ${label.toLowerCase()}`} disabled={disabled || !baseUnit}
          options={compatibleUnitOptions(baseUnit, allowConversion)}
          placeholder={baseUnit ? unitLabel(baseUnit) : 'Unidad'}
          onChange={() => form.validateFields([quantityPath]).catch(() => {})} />
      </Form.Item>
    </div>
  </Form.Item>;
}
