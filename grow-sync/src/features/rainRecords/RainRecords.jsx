import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  notification,
} from "antd";
import {
  CalendarOutlined,
  CheckCircleOutlined,
  CloudOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SyncOutlined,
} from "../../components/AppIcons";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import useIsMobile from "../../hooks/useIsMobile";
import { PERMISSIONS } from "../../constants/permissions";
import { hasPermission } from "../../utils/permissions";
import {
  createRainRecord,
  disableRainRecord,
  enableRainRecord,
  getMonthlyRainStats,
  getRainRecords,
  syncTodayRainRecord,
  updateRainRecord,
} from "../../services/rainRecordsService";

const { Text } = Typography;

const SOURCE_LABELS = {
  api: { label: "API", color: "blue" },
  manual: { label: "Manual", color: "green" },
  edited_api: { label: "API corregida", color: "gold" },
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-AR");
};

const toDateInput = (value) => {
  if (!value) return "";
  return String(value).slice(0, 10);
};

const formatRain = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
};

const getBrowserLocation = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) {
    reject(new Error("Tu navegador no permite obtener la ubicacion actual."));
    return;
  }

  navigator.geolocation.getCurrentPosition(
    ({ coords: { latitude, longitude } }) => resolve({ latitude, longitude }),
    (error) => reject(error),
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
});

const RainRecords = () => {
  const isMobile = useIsMobile();
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");
  const canCreate = hasPermission(currentUser, PERMISSIONS.RAIN_RECORDS_CREATE);
  const canEdit = hasPermission(currentUser, PERMISSIONS.RAIN_RECORDS_EDIT);
  const canDisable = hasPermission(currentUser, PERMISSIONS.RAIN_RECORDS_DISABLE);
  const canEnable = hasPermission(currentUser, PERMISSIONS.RAIN_RECORDS_ENABLE);

  const [form] = Form.useForm();
  const [records, setRecords] = useState([]);
  const [monthlyStats, setMonthlyStats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [includeDisabled, setIncludeDisabled] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 0,
  });

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getRainRecords({
        page: pagination.page,
        pageSize: pagination.pageSize,
        includeDisabled,
      });

      setRecords(response?.data || []);
      setPagination((prev) => ({
        ...prev,
        ...(response?.pagination || {}),
      }));
    } catch (error) {
      console.error("Error al cargar registros de lluvia:", error);
      notification.error({
        message: error?.response?.data?.message || "Error al cargar registros de lluvia",
      });
    } finally {
      setLoading(false);
    }
  }, [includeDisabled, pagination.page, pagination.pageSize]);

  const fetchMonthlyStats = useCallback(async () => {
    try {
      const data = await getMonthlyRainStats();
      setMonthlyStats((data || []).map((item) => ({
        month: item.month,
        rain_mm: Number(item.rain_mm || 0),
      })));
    } catch (error) {
      console.error("Error al cargar acumulado mensual de lluvia:", error);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    fetchMonthlyStats();
  }, [fetchMonthlyStats]);

  const refreshAll = () => {
    fetchRecords();
    fetchMonthlyStats();
  };

  const openDrawer = (record = null) => {
    setEditingRecord(record);
    form.setFieldsValue({
      date: toDateInput(record?.date) || new Date().toISOString().slice(0, 10),
      rain_mm: record?.rain_mm ?? undefined,
      notes: record?.notes || "",
    });
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingRecord(null);
    form.resetFields();
  };

  const handleSubmit = async (values) => {
    try {
      const payload = {
        date: values.date,
        rain_mm: Number(values.rain_mm),
        notes: values.notes || null,
      };

      if (editingRecord?.id) {
        await updateRainRecord(editingRecord.id, payload);
        notification.success({ message: "Registro de lluvia actualizado" });
      } else {
        await createRainRecord({ ...payload, source: "manual" });
        notification.success({ message: "Registro de lluvia creado" });
      }

      closeDrawer();
      refreshAll();
    } catch (error) {
      console.error("Error al guardar registro de lluvia:", error);
      notification.error({
        message: error?.response?.data?.message || "Error al guardar registro de lluvia",
      });
    }
  };

  const handleDisable = async (id) => {
    try {
      await disableRainRecord(id);
      notification.success({ message: "Registro de lluvia deshabilitado" });
      refreshAll();
    } catch (error) {
      notification.error({
        message: error?.response?.data?.message || "No se pudo deshabilitar el registro",
      });
    }
  };

  const handleEnable = async (id) => {
    try {
      await enableRainRecord(id);
      notification.success({ message: "Registro de lluvia habilitado" });
      refreshAll();
    } catch (error) {
      notification.error({
        message: error?.response?.data?.message || "No se pudo habilitar el registro",
      });
    }
  };

  const handleSyncToday = async () => {
    setSyncing(true);
    try {
      const coords = await getBrowserLocation();
      const response = await syncTodayRainRecord(coords);

      if (response?.skipped) {
        notification.warning({
          message: "Sincronizacion omitida",
          description: response.message,
        });
      } else {
        notification.success({
          message: "Lluvia sincronizada",
          description: response?.message,
        });
      }

      refreshAll();
    } catch (error) {
      const permissionDenied = error?.code === 1;
      notification.error({
        message: permissionDenied
          ? "Permiso de ubicacion denegado"
          : error?.response?.data?.message || "No se pudo sincronizar la lluvia de hoy",
      });
    } finally {
      setSyncing(false);
    }
  };

  const renderSource = (source) => {
    const meta = SOURCE_LABELS[source] || { label: source || "-", color: "default" };
    return <Tag color={meta.color}>{meta.label}</Tag>;
  };

  const renderActions = useCallback((record, block = false) => (
    <Space size="small" direction={block ? "vertical" : "horizontal"} style={block ? { width: "100%" } : undefined}>
      {record.enabled && canEdit && (
        <Tooltip title="Editar">
          <Button
            type={block ? "default" : "text"}
            shape={block ? undefined : "circle"}
            icon={<EditOutlined />}
            onClick={() => openDrawer(record)}
            block={block}
            aria-label="Editar registro de lluvia"
          >
            {block ? "Editar" : null}
          </Button>
        </Tooltip>
      )}

      {record.enabled && canDisable && (
        <Popconfirm
          title="Deshabilitar registro"
          description="Queres deshabilitar este registro de lluvia?"
          okText="Si"
          cancelText="No"
          onConfirm={() => handleDisable(record.id)}
        >
          <Tooltip title="Deshabilitar">
            <Button
              danger
              type={block ? "default" : "text"}
              shape={block ? undefined : "circle"}
              icon={<DeleteOutlined />}
              block={block}
              aria-label="Deshabilitar registro de lluvia"
            >
              {block ? "Deshabilitar" : null}
            </Button>
          </Tooltip>
        </Popconfirm>
      )}

      {!record.enabled && canEnable && (
        <Tooltip title="Habilitar">
          <Button
            type={block ? "default" : "text"}
            shape={block ? undefined : "circle"}
            icon={<CheckCircleOutlined />}
            onClick={() => handleEnable(record.id)}
            block={block}
            aria-label="Habilitar registro de lluvia"
          >
            {block ? "Habilitar" : null}
          </Button>
        </Tooltip>
      )}
    </Space>
  ), [canDisable, canEdit, canEnable]);

  const columns = useMemo(() => [
    {
      title: "Fecha",
      dataIndex: "date",
      key: "date",
      render: formatDate,
    },
    {
      title: "Lluvia (mm)",
      dataIndex: "rain_mm",
      key: "rain_mm",
      render: (value) => `${formatRain(value)} mm`,
    },
    {
      title: "Fuente",
      dataIndex: "source",
      key: "source",
      render: renderSource,
    },
    {
      title: "Notas",
      dataIndex: "notes",
      key: "notes",
      render: (value) => value || "-",
    },
    {
      title: "Estado",
      dataIndex: "enabled",
      key: "enabled",
      render: (value) => value ? <Tag color="success">Activo</Tag> : <Tag>Deshabilitado</Tag>,
    },
    (canEdit || canDisable || canEnable) && {
      title: "Acciones",
      key: "actions",
      width: 110,
      render: (_, record) => renderActions(record),
    },
  ].filter(Boolean), [canDisable, canEdit, canEnable, renderActions]);

  const renderMobileCards = () => {
    if (!records.length) return <Empty description="No hay registros de lluvia" />;

    return (
      <div className="inventory-cards-container">
        {records.map((record) => (
          <div className="inventory-card" key={record.id}>
            <div className="card-header">
              <h3>{formatDate(record.date)}</h3>
              <div className="card-icons">{renderActions(record)}</div>
            </div>

            <p className="flex-row">
              <CloudOutlined size={18} /> <strong>Lluvia:</strong> {formatRain(record.rain_mm)} mm
            </p>
            <p className="flex-row">
              <CalendarOutlined size={18} /> <strong>Fuente:</strong> {renderSource(record.source)}
            </p>
            <p>
              <strong>Estado:</strong>{" "}
              {record.enabled ? <Tag color="success">Activo</Tag> : <Tag>Deshabilitado</Tag>}
            </p>
            {record.notes ? <p><strong>Notas:</strong> {record.notes}</p> : null}
            <div style={{ marginTop: 8 }}>{renderActions(record, true)}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ padding: 12 }}>
      <Row justify="space-between" align="middle" gutter={[12, 12]} style={{ marginBottom: 12, marginTop: isMobile ? 8 : 24 }}>
        <Col>
          <h2>Registro de lluvias</h2>
        </Col>
        <Col>
          <Space wrap>
            <Button
              icon={<SyncOutlined />}
              loading={syncing}
              onClick={handleSyncToday}
              disabled={!canCreate}
            >
              Sincronizar lluvia de hoy
            </Button>
            {canCreate && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer()}>
                Nuevo registro
              </Button>
            )}
          </Space>
        </Col>
      </Row>

      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card title="Lluvia acumulada por mes">
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={monthlyStats}>
                <CartesianGrid stroke="#d9d9d9" strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <RechartsTooltip formatter={(value) => [`${formatRain(value)} mm`, "Lluvia"]} />
                <Bar dataKey="rain_mm" name="Lluvia" fill="#437118" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <Row justify="space-between" align="middle" gutter={[12, 12]} style={{ marginBottom: 12 }}>
            <Col>
              <Checkbox
                checked={includeDisabled}
                onChange={(event) => {
                  setPagination((prev) => ({ ...prev, page: 1 }));
                  setIncludeDisabled(event.target.checked);
                }}
              >
                Incluir deshabilitados
              </Checkbox>
            </Col>
          </Row>

          {isMobile ? (
            <>
              {renderMobileCards()}
              <Row justify="space-between" align="middle" style={{ marginTop: 12 }}>
                <Col>
                  <Text>Pagina {pagination.page} de {pagination.totalPages || 1}</Text>
                </Col>
                <Col>
                  <Space>
                    <Button
                      disabled={pagination.page <= 1}
                      onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
                    >
                      Anterior
                    </Button>
                    <Button
                      disabled={pagination.page >= (pagination.totalPages || 1)}
                      onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                    >
                      Siguiente
                    </Button>
                  </Space>
                </Col>
              </Row>
            </>
          ) : (
            <Table
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={records}
              pagination={{
                current: pagination.page,
                pageSize: pagination.pageSize,
                total: pagination.total,
                position: ["bottomCenter"],
                showSizeChanger: false,
                onChange: (page, pageSize) => setPagination((prev) => ({ ...prev, page, pageSize })),
              }}
              locale={{ emptyText: "No hay registros de lluvia" }}
            />
          )}
        </Card>
      </Space>

      <Drawer
        title={editingRecord ? "Editar registro de lluvia" : "Nuevo registro de lluvia"}
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDrawer}
        open={isDrawerOpen}
        height={isMobile ? "90vh" : undefined}
        width={isMobile ? "100%" : 420}
        styles={{ body: { paddingBottom: 80 } }}
        destroyOnClose
      >
        <Form layout="vertical" form={form} onFinish={handleSubmit}>
          {editingRecord?.source === "api" && (
            <Tag color="gold" style={{ marginBottom: 16 }}>
              Al editar este registro, la fuente pasara a API corregida.
            </Tag>
          )}

          <Form.Item
            name="date"
            label="Fecha"
            rules={[{ required: true, message: "Ingresa la fecha." }]}
          >
            <Input type="date" />
          </Form.Item>

          <Form.Item
            name="rain_mm"
            label="Lluvia (mm)"
            rules={[{ required: true, message: "Ingresa los milimetros de lluvia." }]}
          >
            <InputNumber min={0} step={0.1} precision={2} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item name="notes" label="Notas">
            <Input.TextArea rows={4} placeholder="Observaciones o correcciones" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editingRecord ? "Actualizar registro" : "Guardar registro"}
            </Button>
          </Form.Item>
        </Form>
      </Drawer>

      {isMobile && !isDrawerOpen && canCreate && (
        <button
          type="button"
          className="fab-button"
          aria-label="Agregar registro de lluvia"
          onClick={() => openDrawer()}
        >
          <PlusOutlined />
        </button>
      )}
    </div>
  );
};

export default RainRecords;
