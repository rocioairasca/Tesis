import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Button,
  Card,
  Col,
  Empty,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  notification,
} from "antd";
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
} from '../../components/AppIcons';

import dayjs from "dayjs";

import {
  disableHarvestRecord,
  enableHarvestRecord,
  getHarvestFilters,
  getHarvestRecords,
} from "../../services/harvestService";

import { formatCropLabel, formatNumber } from "../../utils/harvestUtils";
import { PERMISSIONS } from "../../constants/permissions";
import { hasPermission } from "../../utils/permissions";

const { Text } = Typography;

const formatDateDDMMYYYY = (date) => {
  if (!date) return "-";
  return dayjs(date).format("DD/MM/YYYY");
};

const HarvestTable = ({ refreshKey = 0, isMobile = false, onEdit }) => {
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
  const [filterOptions, setFilterOptions] = useState({ campaigns: [], crops: [] });
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");
  const canEdit = hasPermission(currentUser, PERMISSIONS.HARVEST_EDIT);
  const canDisable = hasPermission(currentUser, PERMISSIONS.HARVEST_DISABLE);
  const canEnable = hasPermission(currentUser, PERMISSIONS.HARVEST_ENABLE);
  const canViewDisabled = hasPermission(currentUser, PERMISSIONS.HARVEST_VIEW_DISABLED);

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

  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const data = await getHarvestFilters();
        setFilterOptions({
          campaigns: data?.campaigns || [],
          crops: data?.crops || [],
        });
      } catch (error) {
        console.error("Error al cargar filtros de cosecha:", error);
      }
    };

    fetchFilterOptions();
  }, [refreshKey]);

  const handleDisable = useCallback(async (id) => {
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
  }, [fetchRecords]);

  const handleEnable = useCallback(async (id) => {
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
  }, [fetchRecords]);

  const renderHarvestAction = useCallback((record, block = false) => {
    if (record.enabled && canDisable) {
      return (
        <Popconfirm
          title="Deshabilitar registro"
          description="¿Querés deshabilitar este registro de cosecha?"
          onConfirm={() => handleDisable(record.id)}
          okText="Sí"
          cancelText="No"
        >
          <Tooltip title="Deshabilitar">
            <Button
              danger
              type={block ? "default" : "text"}
              shape={block ? undefined : "circle"}
              icon={<DeleteOutlined />}
              block={block}
              aria-label="Deshabilitar"
            >
              {block ? "Deshabilitar" : null}
            </Button>
          </Tooltip>
        </Popconfirm>
      );
    }

    if (!record.enabled && canEnable) {
      return (
        <Popconfirm
          title="Habilitar registro"
          description="¿Querés volver a habilitar este registro de cosecha?"
          onConfirm={() => handleEnable(record.id)}
          okText="Sí"
          cancelText="No"
        >
          <Tooltip title="Habilitar">
            <Button
              type={block ? "default" : "text"}
              shape={block ? undefined : "circle"}
              icon={<CheckCircleOutlined />}
              block={block}
              aria-label="Habilitar"
            >
              {block ? "Habilitar" : null}
            </Button>
          </Tooltip>
        </Popconfirm>
      );
    }

    return null;
  }, [canDisable, canEnable, handleDisable, handleEnable]);

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
      (canEdit || canDisable || canEnable) && {
        title: "Acciones",
        key: "actions",
        width: 96,
        render: (_, record) => (
          <Space size="small">
            {record.enabled && canEdit && (
              <Tooltip title="Editar">
                <Button
                  type="text"
                  shape="circle"
                  icon={<EditOutlined />}
                  onClick={() => onEdit?.(record)}
                  aria-label={`Editar cosecha ${record.crop || ""}`}
                />
              </Tooltip>
            )}
            {renderHarvestAction(record)}
          </Space>
        ),
      },
    ].filter(Boolean);
  }, [canDisable, canEnable, canEdit, onEdit, renderHarvestAction]);

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
                  <Space direction="vertical" style={{ width: "100%" }}>
                    {record.enabled && canEdit && (
                      <Button
                        block
                        icon={<EditOutlined />}
                        onClick={() => onEdit?.(record)}
                      >
                        Editar
                      </Button>
                    )}
                    {renderHarvestAction(record, true)}
                  </Space>
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
        <Row justify="space-between" align="middle" gutter={[12, 12]}>
          <Col xs={24} md={16}>
            <Space wrap size={12}>
              <Select
                style={{ width: 180 }}
                placeholder="Filtrar por campaña"
                allowClear
                showSearch
                optionFilterProp="label"
                value={filters.campaign || undefined}
                onChange={(value) => {
                  setPagination((prev) => ({ ...prev, page: 1 }));
                  setFilters((prev) => ({
                    ...prev,
                    campaign: value || null,
                  }));
                }}
                options={filterOptions.campaigns.map((campaign) => ({
                  value: campaign,
                  label: campaign,
                }))}
              />

              <Select
                style={{ width: 180 }}
                placeholder="Filtrar por cultivo"
                allowClear
                showSearch
                optionFilterProp="label"
                value={filters.crop || undefined}
                onChange={(value) => {
                  setPagination((prev) => ({ ...prev, page: 1 }));
                  setFilters((prev) => ({
                    ...prev,
                    crop: value || null,
                  }));
                }}
                options={filterOptions.crops.map((crop) => ({
                  value: crop,
                  label: formatCropLabel(crop),
                }))}
              />
            </Space>
          </Col>

          <Col xs={24} md={8} style={{ textAlign: isMobile ? "left" : "right" }}>
            {canViewDisabled && (
              <Button
                style={{ width: isMobile ? "100%" : 180 }}
                type={filters.includeDisabled ? "primary" : "default"}
                onClick={() => {
                  setPagination((prev) => ({ ...prev, page: 1 }));
                  setFilters((prev) => ({
                    ...prev,
                    includeDisabled: !prev.includeDisabled,
                  }));
                }}
              >
                {filters.includeDisabled ? "Ver solo activos" : "Ver deshabilitados"}
              </Button>
            )}
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
            position: ["bottomCenter"],
            showSizeChanger: false,
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
