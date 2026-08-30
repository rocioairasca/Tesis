import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Col, Empty, Row, Table, Tag, Tooltip, notification } from "antd";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";

import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckOutlined,
  HarvestOutlined,
  MapPin,
  Package,
  Ruler,
} from "../../components/AppIcons";
import useIsMobile from "../../hooks/useIsMobile";
import {
  enableHarvestRecord,
  getDisabledHarvestRecords,
} from "../../services/harvestService";
import { formatCropLabel, formatNumber } from "../../utils/harvestUtils";
import { PERMISSIONS } from "../../constants/permissions";
import { hasPermission } from "../../utils/permissions";
import { getUserFriendlyError } from "../../utils/userFriendlyErrors";

const getId = (record) => record?.id ?? record?._id;
const rowKey = (record) => getId(record) ?? `${record?.lot_id}-${record?.harvest_date}`;

const formatDateDDMMYYYY = (date) => {
  if (!date) return "-";
  return dayjs(date).format("DD/MM/YYYY");
};

const getCropDisplay = (record) => record?.crop_name || record?.crop;
const getCampaignDisplay = (record) => record?.campaign_name || record?.campaign;
const getSurfaceDisplay = (record) => (
  record?.sub_lot_name ? `${record.lot_name || "-"} / ${record.sub_lot_name}` : record?.lot_name || "-"
);

const DisabledHarvest = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");
  const canEnable = hasPermission(currentUser, PERMISSIONS.HARVEST_ENABLE);

  const fetchDisabledHarvest = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getDisabledHarvestRecords({ pageSize: 100 });
      setRecords(response?.data || []);
    } catch (error) {
      console.error("-> disabled harvest list error:", error);
      notification.error({ message: "Error al cargar cosechas deshabilitadas" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDisabledHarvest();
  }, [fetchDisabledHarvest]);

  const handleEnable = async (id) => {
    try {
      await enableHarvestRecord(id);
      notification.success({ message: "Cosecha habilitada" });
      fetchDisabledHarvest();
    } catch (error) {
      console.error("-> enable harvest error:", error);
      notification.error({
        message: getUserFriendlyError(error, "No se pudo habilitar el registro de cosecha."),
      });
    }
  };

  const columns = useMemo(() => [
    { title: "#", dataIndex: "index", width: 56, render: (_, __, index) => index + 1 },
    {
      title: "Fecha",
      dataIndex: "harvest_date",
      render: (value) => formatDateDDMMYYYY(value),
    },
    { title: "Lote", key: "lot_name", render: (_, record) => getSurfaceDisplay(record) },
    { title: "Cultivo", key: "crop", render: (_, record) => formatCropLabel(getCropDisplay(record)) },
    { title: "Campana", key: "campaign", render: (_, record) => getCampaignDisplay(record) || "-" },
    {
      title: "Produccion",
      dataIndex: "production_kg",
      render: (value) => `${formatNumber(value, 0)} kg`,
    },
    {
      title: "Superficie",
      dataIndex: "harvested_area_ha",
      render: (value) => `${formatNumber(value)} ha`,
    },
    {
      title: "Rendimiento",
      dataIndex: "yield_kg_ha",
      render: (value) => `${formatNumber(value)} kg/ha`,
    },
    {
      title: "Estado",
      dataIndex: "enabled",
      render: () => <Tag color="default">Deshabilitada</Tag>,
    },
    canEnable && {
      title: "Acciones",
      key: "actions",
      width: 72,
      render: (_, record) => (
        <Tooltip title="Habilitar">
          <Button
            type="text"
            shape="circle"
            aria-label="Habilitar"
            icon={<CheckOutlined style={{ color: "#52c41a" }} />}
            onClick={() => handleEnable(getId(record))}
          />
        </Tooltip>
      ),
    },
  ].filter(Boolean), [canEnable]);

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Cosechas Deshabilitadas</h2>
        </Col>
        <Col>
          {!isMobile ? (
            <Button onClick={() => navigate("/harvest")}>Volver a Cosechas</Button>
          ) : (
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate("/harvest")}
              shape="circle"
              type="default"
              style={{ borderColor: "#95ba56" }}
            />
          )}
        </Col>
      </Row>

      {!isMobile && (
        <Table
          scroll={{ x: "max-content" }}
          columns={columns}
          dataSource={records}
          loading={loading}
          pagination={{ pageSize: 8, position: ["bottomCenter"] }}
          rowKey={rowKey}
        />
      )}

      {isMobile && (
        records.length ? (
          <div className="inventory-cards-container">
            {records.map((record) => (
              <div className="inventory-card" key={rowKey(record)}>
                <div className="card-header">
                  <h3>{formatCropLabel(getCropDisplay(record))} - {getCampaignDisplay(record) || "-"}</h3>
                </div>

                <p className="flex-row">
                  <CalendarOutlined size={18} /> <strong>Fecha:</strong> {formatDateDDMMYYYY(record.harvest_date)}
                </p>
                <p className="flex-row">
                  <MapPin size={18} /> <strong>Lote:</strong> {getSurfaceDisplay(record)}
                </p>
                <p className="flex-row">
                  <Package size={18} /> <strong>Produccion:</strong> {formatNumber(record.production_kg, 0)} kg
                </p>
                <p className="flex-row">
                  <Ruler size={18} /> <strong>Superficie:</strong> {formatNumber(record.harvested_area_ha)} ha
                </p>
                <p className="flex-row">
                  <HarvestOutlined size={18} /> <strong>Rendimiento:</strong> {formatNumber(record.yield_kg_ha)} kg/ha
                </p>
                <p>
                  <strong>Estado:</strong> <Tag color="default">Deshabilitada</Tag>
                </p>

                {canEnable && (
                  <div style={{ marginTop: 12 }}>
                    <Button type="primary" block onClick={() => handleEnable(getId(record))}>
                      Habilitar Cosecha
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty description="No hay cosechas deshabilitadas" />
        )
      )}
    </div>
  );
};

export default DisabledHarvest;
