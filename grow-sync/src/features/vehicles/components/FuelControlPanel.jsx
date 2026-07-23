import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  notification,
} from "antd";
import api from "../../../services/apiClient";

const { Text } = Typography;

const FUEL_OPTIONS = [
  { value: "diesel", label: "Diesel" },
  { value: "nafta", label: "Nafta" },
  { value: "gnc", label: "GNC" },
  { value: "otro", label: "Otro" },
];

const localDateValue = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-AR");
};

const toLoadedAt = (value) => {
  if (!value) return new Date().toISOString();
  return new Date(`${value}T12:00:00`).toISOString();
};

const getApiErrorMessage = (error) =>
  error?.response?.data?.message ||
  error?.response?.data?.error ||
  error?.message ||
  "Error inesperado";

const FuelControlPanel = ({ vehicles, numberFmt, isMobile, canManageFuel }) => {
  const [form] = Form.useForm();
  const currentFuelValue = Form.useWatch("current_fuel", form);
  const litersValue = Form.useWatch("liters", form);
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fuelAfterLoadPreview = useMemo(() => {
    const currentFuel = Number(currentFuelValue);
    const liters = Number(litersValue);
    if (!Number.isFinite(currentFuel) || !Number.isFinite(liters)) return null;
    return currentFuel + liters;
  }, [currentFuelValue, litersValue]);

  const vehicleOptions = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        value: vehicle.id || vehicle._id,
        label: `${vehicle.name || "Vehiculo"}${vehicle.plate ? ` - ${vehicle.plate}` : ""}`,
      })).filter((option) => option.value),
    [vehicles]
  );

  useEffect(() => {
    if (!vehicleOptions.length) {
      setSelectedVehicleId(null);
      return;
    }

    const selectedExists = vehicleOptions.some((option) => option.value === selectedVehicleId);
    if (!selectedVehicleId || !selectedExists) {
      setSelectedVehicleId(vehicleOptions[0].value);
    }
  }, [selectedVehicleId, vehicleOptions]);

  const fetchFuelRecords = useCallback(async () => {
    if (!selectedVehicleId) {
      setRecords([]);
      setSummary({});
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.get(`/vehicles/${selectedVehicleId}/fuel-records`);
      setRecords(Array.isArray(data?.data) ? data.data : []);
      setSummary(data?.summary || {});
    } catch (error) {
      console.error("fuel records error:", error);
      notification.error({
        message: "Error al cargar combustible del vehiculo",
        description: getApiErrorMessage(error),
      });
      setRecords([]);
      setSummary({});
    } finally {
      setLoading(false);
    }
  }, [selectedVehicleId]);

  useEffect(() => {
    fetchFuelRecords();
  }, [fetchFuelRecords]);

  const handleSubmit = async (values) => {
    if (!selectedVehicleId) return;

    setSubmitting(true);
    try {
      await api.post(`/vehicles/${selectedVehicleId}/fuel-records`, {
        fuel_type: values.fuel_type,
        liters: values.liters,
        current_fuel: values.current_fuel,
        loaded_at: toLoadedAt(values.loaded_at),
      });

      notification.success({ message: "Carga de combustible registrada" });
      form.resetFields();
      form.setFieldsValue({ fuel_type: "diesel", loaded_at: localDateValue() });
      fetchFuelRecords();
    } catch (error) {
      console.error("save fuel record error:", error);
      notification.error({
        message: "Error al registrar combustible",
        description: getApiErrorMessage(error),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (recordId) => {
    if (!selectedVehicleId || !recordId) return;

    try {
      await api.delete(`/vehicles/${selectedVehicleId}/fuel-records/${recordId}`);
      notification.success({ message: "Carga de combustible eliminada" });
      fetchFuelRecords();
    } catch (error) {
      console.error("delete fuel record error:", error);
      notification.error({
        message: "Error al eliminar la carga",
        description: getApiErrorMessage(error),
      });
    }
  };

  const columns = [
    {
      title: "Fecha",
      dataIndex: "loaded_at",
      render: formatDate,
      width: 110,
    },
    {
      title: "Actual",
      dataIndex: "current_fuel",
      render: (value) => (value == null ? "-" : numberFmt(value)),
      align: "right",
      width: 110,
    },
    {
      title: "Carga",
      dataIndex: "liters",
      render: numberFmt,
      align: "right",
      width: 110,
    },
    {
      title: "Despues",
      dataIndex: "fuel_after_load",
      render: (value) => (value == null ? "-" : numberFmt(value)),
      align: "right",
      width: 110,
    },
    {
      title: "Tipo",
      dataIndex: "fuel_type",
      render: (value) => <Tag>{String(value || "-").toUpperCase()}</Tag>,
      width: 100,
    },
    canManageFuel && {
      title: "Acciones",
      key: "actions",
      align: "right",
      width: 110,
      render: (_, record) => (
        <Popconfirm
          title="Eliminar carga"
          description="Esta accion no se puede deshacer."
          okText="Eliminar"
          cancelText="Cancelar"
          onConfirm={() => handleDelete(record.id)}
        >
          <Button danger size="small">
            Eliminar
          </Button>
        </Popconfirm>
      ),
    },
  ].filter(Boolean);

  const summaryItems = [
    { label: "Combustible actual", value: summary.current_fuel == null ? "-" : numberFmt(summary.current_fuel) },
    { label: "Despues de carga", value: summary.fuel_after_load == null ? "-" : numberFmt(summary.fuel_after_load) },
    { label: "Fecha", value: formatDate(summary.last_loaded_at) },
  ];

  return (
    <section
      style={{
        border: "1px solid #f0f0f0",
        borderRadius: 8,
        padding: isMobile ? 12 : 16,
        marginBottom: 16,
        background: "#fff",
      }}
    >
      <Row gutter={[12, 12]} align="middle" justify="space-between">
        <Col xs={24} md={12}>
          <Space direction="vertical" size={2} style={{ width: "100%" }}>
            <Text strong>Control de combustible</Text>
            <Text type="secondary">Controla el combustible actual, la carga y el estado final.</Text>
          </Space>
        </Col>
        <Col xs={24} md={8}>
          <Select
            style={{ width: "100%" }}
            placeholder="Seleccionar vehiculo"
            value={selectedVehicleId}
            options={vehicleOptions}
            onChange={setSelectedVehicleId}
            showSearch
            optionFilterProp="label"
          />
        </Col>
      </Row>

      {!vehicleOptions.length ? (
        <Empty description="Todavia no hay vehiculos para controlar combustible" style={{ marginTop: 16 }} />
      ) : (
        <>
          <Row gutter={[8, 8]} style={{ marginTop: 16 }}>
            {summaryItems.map((item) => (
              <Col xs={24} md={8} key={item.label}>
                <div
                  style={{
                    border: "1px solid #f0f0f0",
                    borderRadius: 6,
                    padding: 10,
                    minHeight: 64,
                  }}
                >
                  <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                    {item.label}
                  </Text>
                  <Text strong style={{ fontSize: 16 }}>{item.value}</Text>
                </div>
              </Col>
            ))}
          </Row>

          {canManageFuel ? (
            <Form
              form={form}
              layout="vertical"
              onFinish={handleSubmit}
              initialValues={{ fuel_type: "diesel", loaded_at: localDateValue() }}
              style={{ marginTop: 16 }}
            >
              <Row gutter={[12, 0]}>
                <Col xs={24} sm={12} lg={4}>
                  <Form.Item name="fuel_type" label="Tipo" rules={[{ required: true }]}>
                    <Select options={FUEL_OPTIONS} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} lg={4}>
                  <Form.Item
                    name="current_fuel"
                    label="Combustible actual"
                    rules={[{ required: true, message: "Ingresar combustible actual" }]}
                  >
                    <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} lg={4}>
                  <Form.Item name="liters" label="Carga" rules={[{ required: true, message: "Ingresar carga" }]}>
                    <InputNumber min={0.01} step={0.01} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} lg={4}>
                  <Form.Item label="Despues de carga">
                    <InputNumber
                      disabled
                      value={fuelAfterLoadPreview}
                      formatter={(value) => (value == null ? "" : value)}
                      style={{ width: "100%" }}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} lg={4}>
                  <Form.Item name="loaded_at" label="Fecha" rules={[{ required: true }]}>
                    <Input type="date" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} lg={4}>
                  <Form.Item label=" ">
                    <Button type="primary" htmlType="submit" block loading={submitting}>
                      Registrar carga
                    </Button>
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          ) : (
            <Alert
              style={{ marginTop: 16 }}
              type="info"
              showIcon
              message="El historial es visible para todos los usuarios. Solo Supervisor o superior puede registrar cargas."
            />
          )}

          <Table
            style={{ marginTop: 8 }}
            rowKey="id"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={records}
            pagination={{ pageSize: 5, hideOnSinglePage: true }}
            scroll={{ x: 900 }}
          />
        </>
      )}
    </section>
  );
};

export default FuelControlPanel;
