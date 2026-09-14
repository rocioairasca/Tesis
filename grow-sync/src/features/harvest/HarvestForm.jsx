import { campaignLabel } from '../../utils/campaigns.mjs';
import { calendarDateKey, parseCalendarDate } from '../../utils/calendarDate';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Steps,
  Typography,
  notification
} from 'antd';
import dayjs from 'dayjs';
import HarvestTrace, { retroactiveReasons } from './HarvestTrace';
import HarvestCycleFields from './HarvestCycleFields';
import {
  MinusCircleOutlined,
  PlusOutlined,
  SaveOutlined,
  CloseOutlined
} from '../../components/AppIcons';

import { createHarvestRecord, updateHarvestRecord } from '../../services/harvestService';
import { calculateYieldKgHa, formatNumber, formatHectares, parseHectaresInput } from '../../utils/harvestUtils';
import { getUserFriendlyError } from '../../utils/userFriendlyErrors';

const { Text } = Typography;

const fullLotKey = (lotId) => `lot:${lotId}`;
const subLotKey = (lotId, subLotId) => `sub:${lotId}:${subLotId}`;

const initialItem = {
  surface_key: undefined,
  crop_id: undefined,
  harvested_area_ha: null,
  production_kg: null,
  notes: ''
};

const parseSurfaceKey = (key) => {
  const [type, lotId, subLotId] = String(key || '').split(':');
  if (type === 'lot' && lotId) return { lot_id: lotId, sub_lot_id: null };
  if (type === 'sub' && lotId && subLotId) return { lot_id: lotId, sub_lot_id: subLotId };
  return { lot_id: null, sub_lot_id: null };
};

const getActiveSubLots = (lot) => (
  Array.isArray(lot?.active_layout?.sub_lots) ? lot.active_layout.sub_lots : []
);

const getCropName = (crop) => crop?.name || crop?.crop_name || crop?.crop || '';

const HarvestForm = ({
  lots = [],
  loadingLots = false,
  crops = [],
  productiveStates = [],
  loadingProductiveStates = false,
  initialRecord = null,
  registrationMode = "current",
  onHarvestDateChange,
  onSuccess,
  onCancel
}) => {
  const [form] = Form.useForm();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState(registrationMode);
  const chosenDate = Form.useWatch('harvest_date', form);
  const historicalReason = Form.useWatch('retroactive_reason', form);
  const today = dayjs().format('YYYY-MM-DD');
  const clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const needsHistorical = !initialRecord && mode === 'current' && calendarDateKey(chosenDate) < today;
  const [submitting, setSubmitting] = useState(false);
  const isAppliedRecord = !!initialRecord?.has_productive_cycle;
  const selectedItems = Form.useWatch('items', form) || [];

  const productiveStateBySurface = useMemo(() => {
    const map = new Map();
    productiveStates.forEach((lotState) => {
      (lotState.units || []).forEach((unit) => {
        const key = unit.sub_lot_id
          ? subLotKey(unit.lot_id, unit.sub_lot_id)
          : fullLotKey(unit.lot_id);
        map.set(key, unit);
      });
    });
    return map;
  }, [productiveStates]);

  const surfaceOptions = useMemo(() => (
    lots.map((lot) => {
      const subLots = getActiveSubLots(lot);
      const lotArea = lot.area_ha ?? lot.area;

      if (!subLots.length) {
        return {
          value: fullLotKey(lot.id),
          label: `${lot.name} · ${formatHectares(lotArea)}`,
          area_ha: lotArea,
        };
      }

      return {
        label: lot.name,
        options: [
          {
            value: fullLotKey(lot.id),
            label: `Lote completo · ${formatHectares(lotArea)}`,
            area_ha: lotArea,
          },
          ...subLots.map((subLot) => ({
            value: subLotKey(lot.id, subLot.id),
            label: `${subLot.name || subLot.code} · ${formatHectares(subLot.area_ha)}`,
            area_ha: subLot.area_ha,
          })),
        ],
      };
    })
  ), [lots]);

  const getSurfaceState = (surfaceKey) => productiveStateBySurface.get(surfaceKey) || null;

  const syncCurrentCropForItem = (fieldName, surfaceKey) => {
    const unit = getSurfaceState(surfaceKey);
    const cropId = unit?.current_crop?.crop_id;
    if (cropId) {
      form.setFieldValue(['items', fieldName, 'crop_id'], cropId);
    } else {
      form.setFieldValue(['items', fieldName, 'crop_id'], undefined);
    }
  };

  useEffect(() => {
    if (initialRecord) return;
    selectedItems.forEach((item, index) => {
      if (!item?.surface_key) return;
      if (!getSurfaceState(item.surface_key)) return;
      const cropId = getSurfaceState(item.surface_key)?.current_crop?.crop_id;
      if (cropId !== item.crop_id) {
        form.setFieldValue(['items', index, 'crop_id'], cropId || undefined);
      }
    });
  }, [form, productiveStateBySurface, selectedItems, initialRecord]);

  useEffect(() => {
    if (initialRecord) {
      const surfaceKey = initialRecord.sub_lot_id
        ? subLotKey(initialRecord.lot_id, initialRecord.sub_lot_id)
        : fullLotKey(initialRecord.lot_id);
      const legacyCrop = crops.find((crop) => (
        String(crop.name || '').trim().toLowerCase() === String(initialRecord.crop || '').trim().toLowerCase()
      ));

      form.setFieldsValue({
        harvest_date: initialRecord.harvest_date ? parseCalendarDate(initialRecord.harvest_date) : dayjs(),
        notes: initialRecord.notes || '',
        items: [{
          surface_key: surfaceKey,
          crop_id: initialRecord.crop_id || legacyCrop?.id,
          harvested_area_ha: initialRecord.harvested_area_ha,
          production_kg: initialRecord.production_kg,
          notes: initialRecord.notes || ''
        }]
      });
      return;
    }

    form.setFieldsValue({
      harvest_date: registrationMode === 'historical' ? null : dayjs(),
      notes: '',
      items: [initialItem]
    });
  }, [crops, form, initialRecord]);

  const resetForm = () => {
    form.resetFields();
    form.setFieldsValue({
      harvest_date: registrationMode === 'historical' ? null : dayjs(),
      notes: '',
      items: [initialItem]
    });
  };

  const handleSubmit = async (values) => {
    try {
      setSubmitting(true);

      const { harvest_date, notes, items } = values;
      const trace = { registered_retroactively: mode === 'historical',
        retroactive_reason: mode === 'historical' ? values.retroactive_reason : null,
        retroactive_notes: mode === 'historical' ? values.retroactive_notes || null : null,
        registration_timezone: clientTimezone };

      if (!items || items.length === 0) {
        notification.error({
          message: 'Faltan registros',
          description: 'Debés agregar al menos un registro de cosecha'
        });
        return;
      }

      if (initialRecord) {
        const item = items[0];
        const surface = parseSurfaceKey(item.surface_key);
        await updateHarvestRecord(initialRecord.id, {
          ...surface,
          crop_id: item.crop_id,
          client_timezone: clientTimezone,
          harvest_date: calendarDateKey(harvest_date),
          production_kg: item.production_kg,
          harvested_area_ha: parseHectaresInput(item.harvested_area_ha),
          notes: item.notes || notes || null
        });
      } else {
        for (const item of items) {
          const surface = parseSurfaceKey(item.surface_key);
          await createHarvestRecord({
            ...trace,
            ...surface,
            crop_id: item.crop_id,
            harvest_date: calendarDateKey(harvest_date),
            production_kg: item.production_kg,
            harvested_area_ha: parseHectaresInput(item.harvested_area_ha),
            notes: item.notes || notes || null
          });
        }
      }

      notification.success({
        message: initialRecord ? 'Cosecha actualizada correctamente' : 'Cosecha registrada correctamente'
      });

      resetForm();
      onSuccess?.();
    } catch (error) {
      console.error('Error al guardar la cosecha:', error);

      notification.error({
        message: 'No se pudo guardar la cosecha',
        description: getUserFriendlyError(error, 'Revisá los datos ingresados e intentá nuevamente.')
      });
    } finally {
      setSubmitting(false);
    }
  };

  const nextStep = async () => {
    const fields = step === 0 ? ['harvest_date', ...(mode === 'historical' && !initialRecord ? ['retroactive_reason', 'retroactive_notes'] : [])]
      : selectedItems.flatMap((_, index) => (step === 1 ? ['surface_key', 'crop_id', 'harvested_area_ha'] : ['production_kg']).map(key => ['items', index, key]));
    try { await form.validateFields(fields); setStep(value => value + 1); } catch { /* Existing field errors remain visible. */ }
  };
  const showInvalidStep = ({ errorFields }) => {
    const name = errorFields[0]?.name || [];
    setStep(name[0] !== 'items' ? 0 : name.at(-1) === 'production_kg' ? 2 : 1);
  };
  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={values => step === 3 ? handleSubmit(values) : nextStep()}
      onFinishFailed={showInvalidStep}
      className={`gs-harvest-form gs-harvest-step-${step}`}
    >
      <Steps size="small" current={step} items={['Datos generales','Lote y superficie','Producción','Confirmación'].map(title=>({title}))}/>
      <h2>{['Datos generales','Lote y superficie','Producción','Confirmación'][step]}</h2>
      <div className="gs-harvest-general">
      {initialRecord ? <HarvestTrace record={initialRecord} /> : <>
        <Space style={{ marginBottom: 16 }}>
          <Button type={mode === 'current' ? 'primary' : 'default'} onClick={() => setMode('current')}>Cosecha actual</Button>
          <Button type={mode === 'historical' ? 'primary' : 'default'} onClick={() => setMode('historical')}>Cosecha histórica</Button>
        </Space>
        {needsHistorical && <Alert type="info" showIcon message="Seleccionaste una fecha pasada."
          action={<Button onClick={() => setMode('historical')}>Cambiar a histórica</Button>} />}
        {mode === 'historical' && <>
          <Form.Item name="retroactive_reason" label="Motivo del registro retroactivo" rules={[{ required: true, message: 'Seleccioná el motivo' }]}><Select options={retroactiveReasons} /></Form.Item>
          <Form.Item name="retroactive_notes" label="Observación del registro retroactivo" rules={[{ required: historicalReason === 'other', whitespace: true, message: 'Describí el motivo Otro' }]}><Input.TextArea maxLength={2000} /></Form.Item>
        </>}
      </>}
      {isAppliedRecord ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Esta cosecha está vinculada a un ciclo productivo. Las correcciones de superficie recalculan su pendiente. Lote, cultivo y fecha se conservan."
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Form.Item
            label="Fecha de cosecha"
            name="harvest_date"
            rules={[{ required: true, message: 'Seleccioná la fecha' }, { validator: (_, value) => {
              const key = calendarDateKey(value);
              if (!key || key > today) return Promise.reject(new Error('Seleccioná una fecha válida, no futura.'));
              if (!initialRecord && mode === 'historical' && key >= today) return Promise.reject(new Error('Seleccioná una fecha pasada.'));
              if (!initialRecord && mode === 'current' && key < today) return Promise.reject(new Error('Cambiá al modo histórico para conservar esta fecha.'));
              return Promise.resolve();
            } }]}
          >
            <DatePicker
              style={{ width: '100%' }}
              format="DD/MM/YYYY"
              disabled={isAppliedRecord || initialRecord?.registered_retroactively != null}
              disabledDate={value => calendarDateKey(value) > today}
              onChange={onHarvestDateChange}
            />
          </Form.Item>
        </Col>

        <Col xs={24} md={12}>
          <Form.Item label="Observaciones generales" name="notes">
            <Input placeholder="Opcional" />
          </Form.Item>
        </Col>
      </Row>

      </div>
      <Form.List name="items">
        {(fields, { add, remove }) => (
          <>
            <Space direction="vertical" style={{ width: '100%' }} size={16}>
              {fields.map((field, index) => {
                const { key, ...fieldProps } = field;

                return (
                <Card
                  key={key}
                  className="gs-harvest-item"
                  size="small"
                  title={`Registro ${index + 1}`}
                  extra={
                    !initialRecord && fields.length > 1 && step === 1 ? (
                      <Button
                        danger
                        type="text"
                        aria-label={`Quitar registro ${index + 1}`}
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    ) : null
                  }
                >
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12} className="gs-harvest-surface-fields">
                      <Form.Item
                        {...fieldProps}
                        label="Lote o sublote"
                        name={[field.name, 'surface_key']}
                        rules={[{ required: true, message: 'Seleccioná una superficie' }]}
                      >
                        <Select
                          placeholder="Seleccionar superficie"
                          loading={loadingLots}
                          showSearch
                          optionFilterProp="label"
                          options={surfaceOptions}
                          disabled={isAppliedRecord}
                          onChange={(value) => syncCurrentCropForItem(field.name, value)}
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12} className="gs-harvest-surface-fields">
                      <Form.Item
                        {...fieldProps}
                        label="Cultivo"
                        name={[field.name, 'crop_id']}
                        rules={[{ required: true, message: 'Seleccioná el cultivo' }]}
                      >
                        <Select
                          placeholder="Seleccionar cultivo"
                          showSearch
                          optionFilterProp="label"
                          disabled={isAppliedRecord}
                          options={crops.map((crop) => ({
                            value: crop.id,
                            label: crop.name,
                          }))}
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12} className="gs-harvest-surface-fields">
                      <Form.Item
                        noStyle
                        shouldUpdate={(prev, current) => (
                          prev?.items?.[field.name]?.surface_key !== current?.items?.[field.name]?.surface_key
                          || prev?.items?.[field.name]?.crop_id !== current?.items?.[field.name]?.crop_id
                        )}
                      >
                        {({ getFieldValue }) => {
                          const item = getFieldValue(['items', field.name]) || {};
                          const unit = getSurfaceState(item.surface_key);
                          const currentCrop = unit?.current_crop;
                          const selectedCrop = crops.find((crop) => crop.id === item.crop_id);
                          const mismatch = currentCrop?.crop_id && item.crop_id && currentCrop.crop_id !== item.crop_id;

                          if (!item.surface_key) {
                            return <Text type="secondary">Seleccioná una superficie para ver su cultivo vigente.</Text>;
                          }

                          if (loadingProductiveStates) {
                            return <Text type="secondary">Cargando estado productivo...</Text>;
                          }

                          if (!currentCrop) {
                            return <Alert type="warning" showIcon message="No hay cultivo vigente en esta superficie." />;
                          }

                          return (
                            <Alert
                              type={mismatch ? 'warning' : 'success'}
                              showIcon
                              message={mismatch
                                ? `Cultivo vigente: ${currentCrop.crop_name}. Seleccionaste ${getCropName(selectedCrop)}.`
                                : `Cultivo vigente: ${currentCrop.crop_name}`}
                              description={currentCrop.campaign_name ? `Campaña: ${campaignLabel(currentCrop)}` : null}
                            />
                          );
                        }}
                      </Form.Item>
                    </Col>

                    <Col xs={24} className="gs-harvest-surface-fields">
                      <HarvestCycleFields form={form} fieldName={field.name} initialRecord={initialRecord} onFinalized={onSuccess} />
                    </Col>

                    <Col xs={24} md={12} className="gs-harvest-production-fields">
                      <Form.Item
                        {...fieldProps}
                        label="Producción (kg)"
                        name={[field.name, 'production_kg']}
                        rules={[{ required: true, message: 'Ingresá la producción' }]}
                      >
                        <InputNumber
                          min={0}
                          step={1}
                          style={{ width: '100%' }}
                          placeholder="0"
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12} className="gs-harvest-production-fields">
                      <Form.Item label="Rendimiento">
                        <Form.Item
                          noStyle
                          shouldUpdate={(prev, current) => {
                            const prevItem = prev?.items?.[field.name];
                            const currentItem = current?.items?.[field.name];

                            return (
                              prevItem?.production_kg !== currentItem?.production_kg ||
                              prevItem?.harvested_area_ha !== currentItem?.harvested_area_ha
                            );
                          }}
                        >
                          {({ getFieldValue }) => {
                            const item = getFieldValue(['items', field.name]) || {};
                            const yieldValue = calculateYieldKgHa(
                              item.production_kg,
                              item.harvested_area_ha
                            );

                            return (
                              <Input
                                value={`${formatNumber(yieldValue)} kg/ha`}
                                disabled
                              />
                            );
                          }}
                        </Form.Item>
                      </Form.Item>
                    </Col>

                    <Col xs={24} className="gs-harvest-production-fields">
                      <Form.Item
                        {...fieldProps}
                        label="Observaciones del registro"
                        name={[field.name, 'notes']}
                      >
                        <Input.TextArea
                          rows={2}
                          placeholder="Opcional"
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
                );
              })}
            </Space>

            <Button
              className="gs-harvest-add"
              style={{ marginTop: 16 }}
              type="dashed"
              onClick={() => add(initialItem)}
              icon={<PlusOutlined />}
              block
              disabled={!!initialRecord}
            >
              Agregar otro registro
            </Button>
          </>
        )}
      </Form.List>

      {step === 3 && <section className="gs-harvest-confirmation">
        <p>Fecha: {chosenDate?.format('DD/MM/YYYY')} · {initialRecord ? (initialRecord.registered_retroactively === true ? 'Registro histórico' : initialRecord.registered_retroactively === false ? 'Registro actual' : 'Procedencia no documentada') : mode === 'historical' ? 'Registro histórico' : 'Registro actual'}</p>
        {selectedItems.map((item,index)=>{
          const surface = surfaceOptions.flatMap(option=>option.options || [option]).find(option=>option.value===item.surface_key);
          return <Card key={index} size="small" title={`Registro ${index+1}`}>
            <strong>{surface?.label || 'Superficie seleccionada'}</strong>
            <p>{crops.find(crop=>crop.id===item.crop_id)?.name || initialRecord?.crop_name || initialRecord?.crop}</p>
            <p>{formatHectares(item.harvested_area_ha)} · {formatNumber(item.production_kg)} kg · {formatNumber(calculateYieldKgHa(item.production_kg,item.harvested_area_ha))} kg/ha</p>
            {(item.notes || form.getFieldValue('notes')) && <p>{item.notes || form.getFieldValue('notes')}</p>}
          </Card>;
        })}
      </section>}
      <div className="gs-harvest-form-actions">
        {step > 0 && <Button disabled={submitting} onClick={()=>setStep(value=>value-1)}>Anterior</Button>}
        <Button
          onClick={onCancel}
          disabled={submitting}
          icon={<CloseOutlined />}
        >
          Cancelar
        </Button>

        {step < 3 ? <Button key="next" htmlType="button" type="primary" disabled={loadingProductiveStates} onClick={nextStep}>Siguiente</Button> : <Button
          key="confirm"
          type="primary"
          htmlType="submit"
          icon={<SaveOutlined />}
          loading={submitting}
          disabled={loadingProductiveStates}
        >
          Confirmar y guardar cosecha
        </Button>}
      </div>
    </Form>
  );
};

export default HarvestForm;
