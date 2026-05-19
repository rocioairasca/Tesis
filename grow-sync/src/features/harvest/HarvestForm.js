import React, { useEffect, useState } from 'react';
import {
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
  notification
} from 'antd';
import dayjs from 'dayjs';
import {
  MinusCircleOutlined,
  PlusOutlined,
  SaveOutlined,
  CloseOutlined
} from '../../components/AppIcons';

import { createHarvestRecord } from '../../services/harvestService';
import { calculateYieldKgHa, formatNumber } from '../../utils/harvestUtils';

const { Option } = Select;
const campaignRegex = /^\d{4}-\d{4}$/;

const initialItem = {
  lot_id: undefined,
  crop: '',
  harvested_area_ha: null,
  production_kg: null,
  notes: ''
};

const HarvestForm = ({
  lots = [],
  loadingLots = false,
  onSuccess,
  onCancel
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    form.setFieldsValue({
      harvest_date: dayjs(),
      campaign: '',
      notes: '',
      items: [initialItem]
    });
  }, [form]);

  const resetForm = () => {
    form.resetFields();
    form.setFieldsValue({
      harvest_date: dayjs(),
      campaign: '',
      notes: '',
      items: [initialItem]
    });
  };

  const handleSubmit = async (values) => {
    try {
      setSubmitting(true);

      const { harvest_date, campaign, notes, items } = values;

      if (!campaignRegex.test(campaign)) {
        notification.error({
          message: 'Campaña inválida',
          description: 'La campaña debe tener formato YYYY-YYYY'
        });
        return;
      }

      if (!items || items.length === 0) {
        notification.error({
          message: 'Faltan registros',
          description: 'Debés agregar al menos un registro de cosecha'
        });
        return;
      }

      for (const item of items) {
        await createHarvestRecord({
          lot_id: item.lot_id,
          crop: item.crop,
          campaign,
          harvest_date: dayjs(harvest_date).format('YYYY-MM-DD'),
          production_kg: item.production_kg,
          harvested_area_ha: item.harvested_area_ha,
          notes: item.notes || notes || null
        });
      }

      notification.success({
        message: 'Cosecha registrada correctamente'
      });

      resetForm();
      onSuccess?.();
    } catch (error) {
      console.error('Error completo:', error);
      console.error('Response data:', error?.response?.data);
      console.error('Response status:', error?.response?.status);

      const backendMessage =
        error?.response?.data?.message || 'Error al registrar la cosecha';

      notification.error({
        message: 'No se pudo guardar la cosecha',
        description: backendMessage
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
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Form.Item
            label="Fecha de cosecha"
            name="harvest_date"
            rules={[{ required: true, message: 'Seleccioná la fecha' }]}
          >
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
        </Col>

        <Col xs={24} md={8}>
          <Form.Item
            label="Campaña"
            name="campaign"
            rules={[
              { required: true, message: 'Ingresá la campaña' },
              {
                pattern: campaignRegex,
                message: 'Usá formato YYYY-YYYY, por ejemplo 2024-2025'
              }
            ]}
          >
            <Input placeholder="Ej: 2024-2025" />
          </Form.Item>
        </Col>

        <Col xs={24} md={8}>
          <Form.Item label="Observaciones generales" name="notes">
            <Input placeholder="Opcional" />
          </Form.Item>
        </Col>
      </Row>

      <Form.List name="items">
        {(fields, { add, remove }) => (
          <>
            <Space direction="vertical" style={{ width: '100%' }} size={16}>
              {fields.map((field, index) => (
                <Card
                  key={field.key}
                  size="small"
                  title={`Registro ${index + 1}`}
                  extra={
                    fields.length > 1 ? (
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
                    <Col xs={24} md={6}>
                      <Form.Item
                        {...field}
                        label="Lote"
                        name={[field.name, 'lot_id']}
                        rules={[{ required: true, message: 'Seleccioná un lote' }]}
                      >
                        <Select
                          placeholder="Seleccionar lote"
                          loading={loadingLots}
                          showSearch
                          optionFilterProp="label"
                        >
                          {lots.map((lot) => (
                            <Option
                              key={lot.id}
                              value={lot.id}
                              label={lot.name}
                            >
                              {lot.name} ({lot.area} ha)
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={6}>
                      <Form.Item
                        {...field}
                        label="Cultivo"
                        name={[field.name, 'crop']}
                        rules={[{ required: true, message: 'Ingresá el cultivo' }]}
                      >
                        <Input placeholder="Ej: soja" />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={4}>
                      <Form.Item
                        {...field}
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

                    <Col xs={24} md={4}>
                      <Form.Item
                        {...field}
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

                    <Col xs={24} md={4}>
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
                        {...field}
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
              ))}
            </Space>

            <Button
              style={{ marginTop: 16 }}
              type="dashed"
              onClick={() => add(initialItem)}
              icon={<PlusOutlined />}
              block
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
        >
          Guardar cosecha
        </Button>
      </div>
    </Form>
  );
};

export default HarvestForm;