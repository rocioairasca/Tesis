import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Button,
  Card,
  Col,
  Empty,
  Input,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  notification,
} from "antd";
import {
  CheckCircleOutlined,
  StopOutlined,
} from '../../components/AppIcons';

import dayjs from "dayjs";

import {
  disableHarvestRecord,
  enableHarvestRecord,
  getHarvestRecords,
} from "../../services/harvestService";

import { formatCropLabel, formatNumber } from "../../utils/harvestUtils";

const { Text } = Typography;
const { Option } = Select;

const formatDateDDMMYYYY = (date) => {
  if (!date) return "-";
  return dayjs(date).format("DD/MM/YYYY");
};

const HarvestTable = ({ refreshKey = 0, isMobile = false }) => {
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState([]);

  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 0,
  });

  const [filters, setFilters] = useState({
    campaign: null,
    crop: null,
    includeDisabled: false,
  });

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);

      const response = await getHarvestRecords({
        page: pagination.page,
        pageSize: pagination.pageSize,
        campaign: filters.campaign || undefined,
        crop: filters.crop || undefined,
        includeDisabled: filters.includeDisabled ? "true" : "false",
      });

      setRecords(response?.data || []);
      setPagination((prev) => ({
        ...prev,
        ...(response?.pagination || {}),
      }));
    } catch (error) {
      console.error("Error al cargar cosechas:", error);
      notification.error({
        message: "Error al cargar los registros de cosecha",
      });
    } finally {
      setLoading(false);
    }
  }, [
    pagination.page,
    pagination.pageSize,
    filters.campaign,
    filters.crop,
    filters.includeDisabled,
  ]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords, refreshKey]);

  const handleDisable = async (id) => {
    try {
      await disableHarvestRecord(id);
      notification.success({
        message: "Registro deshabilitado",
      });
      fetchRecords();
    } catch (error) {
      console.error(error);
      notification.error({
        message:
          error?.response?.data?.message ||
          "No se pudo deshabilitar el registro",
      });
    }
  };

  const handleEnable = async (id) => {
    try {
      await enableHarvestRecord(id);
      notification.success({
        message: "Registro habilitado",
      });
      fetchRecords();
    } catch (error) {
      console.error(error);
      notification.error({
        message:
          error?.response?.data?.message ||
          "No se pudo habilitar el registro",
      });
    }
  };

  const columns = useMemo(() => {
    return [
      {
        title: "Fecha",
        dataIndex: "harvest_date",
        key: "harvest_date",
        render: (value) => formatDateDDMMYYYY(value),
      },
      {
        title: "Lote",
        dataIndex: "lot_name",
        key: "lot_name",
        render: (value) => value || "-",
      },
      {
        title: "Cultivo",
        dataIndex: "crop",
        key: "crop",
        render: (value) => formatCropLabel(value),
      },
      {
        title: "Campaña",
        dataIndex: "campaign",
        key: "campaign",
        render: (value) => value || "-",
      },
      {
        title: "Producción",
        dataIndex: "production_kg",
        key: "production_kg",
        render: (value) => `${formatNumber(value, 0)} kg`,
      },
      {
        title: "Superficie",
        dataIndex: "harvested_area_ha",
        key: "harvested_area_ha",
        render: (value) => `${formatNumber(value)} ha`,
      },
      {
        title: "Rendimiento",
        dataIndex: "yield_kg_ha",
        key: "yield_kg_ha",
        render: (value) => `${formatNumber(value)} kg/ha`,
      },
      {
        title: "Estado",
        dataIndex: "enabled",
        key: "enabled",
        render: (value) =>
          value ? (
            <Tag color="success">Activo</Tag>
          ) : (
            <Tag color="default">Deshabilitado</Tag>
          ),
      },
      {
        title: "Acciones",
        key: "actions",
        render: (_, record) => (
          <Space>
            {record.enabled ? (
              <Popconfirm
                title="Deshabilitar registro"
                description="¿Querés deshabilitar este registro de cosecha?"
                onConfirm={() => handleDisable(record.id)}
                okText="Sí"
                cancelText="No"
              >
                <Button icon={<StopOutlined />} danger />
              </Popconfirm>
            ) : (
              <Popconfirm
                title="Habilitar registro"
                description="¿Querés volver a habilitar este registro de cosecha?"
                onConfirm={() => handleEnable(record.id)}
                okText="Sí"
                cancelText="No"
              >
                <Button icon={<CheckCircleOutlined />} />
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ];
  }, []);

  const renderMobileCards = () => {
    if (!records.length) {
      return <Empty description="No hay registros de cosecha" />;
    }

    return (
      <Row gutter={[16, 16]}>
        {records.map((record) => (
          <Col xs={24} key={record.id}>
            <Card
              size="small"
              title={`${formatCropLabel(record.crop)} - ${record.campaign || "-"}`}
              extra={
                record.enabled ? (
                  <Tag color="success">Activo</Tag>
                ) : (
                  <Tag color="default">Deshabilitado</Tag>
                )
              }
            >
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                <Text>
                  <strong>Fecha:</strong> {formatDateDDMMYYYY(record.harvest_date)}
                </Text>
                <Text>
                  <strong>Lote:</strong> {record.lot_name || "-"}
                </Text>
                <Text>
                  <strong>Producción:</strong> {formatNumber(record.production_kg, 0)} kg
                </Text>
                <Text>
                  <strong>Superficie:</strong> {formatNumber(record.harvested_area_ha)} ha
                </Text>
                <Text>
                  <strong>Rendimiento:</strong> {formatNumber(record.yield_kg_ha)} kg/ha
                </Text>
                {record.notes ? (
                  <Text>
                    <strong>Notas:</strong> {record.notes}
                  </Text>
                ) : null}

                <div style={{ marginTop: 8 }}>
                  {record.enabled ? (
                    <Popconfirm
                      title="Deshabilitar registro"
                      description="¿Querés deshabilitar este registro de cosecha?"
                      onConfirm={() => handleDisable(record.id)}
                      okText="Sí"
                      cancelText="No"
                    >
                      <Button danger icon={<StopOutlined />} block>
                        Deshabilitar
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Popconfirm
                      title="Habilitar registro"
                      description="¿Querés volver a habilitar este registro de cosecha?"
                      onConfirm={() => handleEnable(record.id)}
                      okText="Sí"
                      cancelText="No"
                    >
                      <Button icon={<CheckCircleOutlined />} block>
                        Habilitar
                      </Button>
                    </Popconfirm>
                  )}
                </div>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    );
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Input
              placeholder="Filtrar por campaña"
              value={filters.campaign || ""}
              onChange={(e) => {
                setPagination((prev) => ({ ...prev, page: 1 }));
                setFilters((prev) => ({
                  ...prev,
                  campaign: e.target.value || null,
                }));
              }}
            />
          </Col>

          <Col xs={24} md={8}>
            <Input
              placeholder="Filtrar por cultivo"
              value={filters.crop || ""}
              onChange={(e) => {
                setPagination((prev) => ({ ...prev, page: 1 }));
                setFilters((prev) => ({
                  ...prev,
                  crop: e.target.value || null,
                }));
              }}
            />
          </Col>

          <Col xs={24} md={8}>
            <Select
              value={filters.includeDisabled ? "all" : "enabled"}
              style={{ width: "100%" }}
              onChange={(value) => {
                setPagination((prev) => ({ ...prev, page: 1 }));
                setFilters((prev) => ({
                  ...prev,
                  includeDisabled: value === "all",
                }));
              }}
            >
              <Option value="enabled">Solo activos</Option>
              <Option value="all">Activos y deshabilitados</Option>
            </Select>
          </Col>
        </Row>
      </Card>

      {isMobile ? (
        <>
          {renderMobileCards()}
          <Card>
            <Row justify="space-between" align="middle">
              <Col>
                <Text>
                  Página {pagination.page} de {pagination.totalPages || 1}
                </Text>
              </Col>

              <Col>
                <Space>
                  <Button
                    disabled={pagination.page <= 1}
                    onClick={() =>
                      setPagination((prev) => ({
                        ...prev,
                        page: prev.page - 1,
                      }))
                    }
                  >
                    Anterior
                  </Button>

                  <Button
                    disabled={pagination.page >= (pagination.totalPages || 1)}
                    onClick={() =>
                      setPagination((prev) => ({
                        ...prev,
                        page: prev.page + 1,
                      }))
                    }
                  >
                    Siguiente
                  </Button>
                </Space>
              </Col>
            </Row>
          </Card>
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
            showSizeChanger: true,
            onChange: (page, pageSize) => {
              setPagination((prev) => ({
                ...prev,
                page,
                pageSize,
              }));
            },
          }}
          locale={{ emptyText: "No hay registros de cosecha" }}
        />
      )}
    </Space>
  );
};

export default HarvestTable;