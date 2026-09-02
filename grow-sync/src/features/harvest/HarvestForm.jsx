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
  Typography,
  notification
} from 'antd';
import dayjs from 'dayjs';
import {
  MinusCircleOutlined,
  PlusOutlined,
  SaveOutlined,
  CloseOutlined
} from '../../components/AppIcons';

import { createHarvestRecord, updateHarvestRecord } from '../../services/harvestService';
import { calculateYieldKgHa, formatNumber } from '../../utils/harvestUtils';
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

const formatHa = (value) => `${Number(value || 0).toLocaleString('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})} ha`;

const getCropName = (crop) => crop?.name || crop?.crop_name || crop?.crop || '';

const HarvestForm = ({
  lots = [],
  loadingLots = false,
  crops = [],
  productiveStates = [],
  loadingProductiveStates = false,
  initialRecord = null,
  onHarvestDateChange,
  onSuccess,
  onCancel
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isAppliedRecord = !!initialRecord?.closes_productive_cycle;
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
          label: `${lot.name} · ${formatHa(lotArea)}`,
          area_ha: lotArea,
        };
      }

      return {
        label: lot.name,
        options: [
          {
            value: fullLotKey(lot.id),
            label: `Lote completo · ${formatHa(lotArea)}`,
            area_ha: lotArea,
          },
          ...subLots.map((subLot) => ({
            value: subLotKey(lot.id, subLot.id),
            label: `${subLot.name || subLot.code} · ${formatHa(subLot.area_ha)}`,
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
    selectedItems.forEach((item, index) => {
      if (!item?.surface_key) return;
      const cropId = getSurfaceState(item.surface_key)?.current_crop?.crop_id;
      if (cropId !== item.crop_id) {
        form.setFieldValue(['items', index, 'crop_id'], cropId || undefined);
      }
    });
  }, [form, productiveStateBySurface, selectedItems]);

  useEffect(() => {
    if (initialRecord) {
      const surfaceKey = initialRecord.sub_lot_id
        ? subLotKey(initialRecord.lot_id, initialRecord.sub_lot_id)
        : fullLotKey(initialRecord.lot_id);
      const legacyCrop = crops.find((crop) => (
        String(crop.name || '').trim().toLowerCase() === String(initialRecord.crop || '').trim().toLowerCase()
      ));

      form.setFieldsValue({
        harvest_date: initialRecord.harvest_date ? dayjs(initialRecord.harvest_date) : dayjs(),
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
      harvest_date: dayjs(),
      notes: '',
      items: [initialItem]
    });
  }, [crops, form, initialRecord]);

  const resetForm = () => {
    form.resetFields();
    form.setFieldsValue({
      harvest_date: dayjs(),
      notes: '',
      items: [initialItem]
    });
  };

  const handleSubmit = async (values) => {
    try {
      setSubmitting(true);

      const { harvest_date, notes, items } = values;

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
          harvest_date: dayjs(harvest_date).format('YYYY-MM-DD'),
          production_kg: item.production_kg,
          harvested_area_ha: item.harvested_area_ha,
          notes: item.notes || notes || null
        });
      } else {
        for (const item of items) {
          const surface = parseSurfaceKey(item.surface_key);
          await createHarvestRecord({
            ...surface,
            crop_id: item.crop_id,
            harvest_date: dayjs(harvest_date).format('YYYY-MM-DD'),
            production_kg: item.production_kg,
            harvested_area_ha: item.harvested_area_ha,
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

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
    >
      {isAppliedRecord ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Esta cosecha ya cerró un ciclo productivo. Podés corregir producción, superficie u observaciones; para cambiar lote, cultivo o fecha corregí primero el estado productivo."
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Form.Item
            label="Fecha de cosecha"
            name="harvest_date"
            rules={[{ required: true, message: 'Seleccioná la fecha' }]}
          >
            <DatePicker
              style={{ width: '100%' }}
              format="DD/MM/YYYY"
              disabled={isAppliedRecord}
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

      <Form.List name="items">
        {(fields, { add, remove }) => (
          <>
            <Space direction="vertical" style={{ width: '100%' }} size={16}>
              {fields.map((field, index) => {
                const { key, ...fieldProps } = field;

                return (
                <Card
                  key={key}
                  size="small"
                  title={`Registro ${index + 1}`}
                  extra={
                    !initialRecord && fields.length > 1 ? (
                      <Button
                        danger
                        type="text"
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    ) : null
                  }
                >
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
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

                    <Col xs={24} md={8}>
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

                    <Col xs={24} md={8}>
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
                              description={currentCrop.campaign_name ? `Campaña: ${currentCrop.campaign_name}` : null}
                            />
                          );
                        }}
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={8}>
                      <Form.Item
                        {...fieldProps}
                        label="Superficie cosechada (ha)"
                        name={[field.name, 'harvested_area_ha']}
                        rules={[{ required: true, message: 'Ingresá la superficie' }]}
                      >
                        <InputNumber
                          min={0.01}
                          step={0.01}
                          style={{ width: '100%' }}
                          placeholder="0.00"
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={8}>
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

                    <Col xs={24} md={8}>
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

                    <Col xs={24}>
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

      <div
        style={{
          marginTop: 24,
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 12,
          flexWrap: 'wrap'
        }}
      >
        <Button
          onClick={onCancel}
          icon={<CloseOutlined />}
        >
          Cancelar
        </Button>

        <Button
          type="primary"
          htmlType="submit"
          icon={<SaveOutlined />}
          loading={submitting}
          disabled={loadingProductiveStates}
        >
          Guardar cosecha
        </Button>
      </div>
    </Form>
  );
};

export default HarvestForm;
