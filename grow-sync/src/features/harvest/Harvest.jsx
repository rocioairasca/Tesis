import { useState, useCallback, useEffect } from "react";
import { Button, Col, Drawer, Dropdown, Row, Space, notification } from "antd";
import { MoreOutlined, PlusOutlined } from "../../components/AppIcons";
import { useNavigate } from "react-router-dom";

import useIsMobile from "../../hooks/useIsMobile";
import HarvestTable from "./HarvestTable";
import HarvestForm from "./HarvestForm";

import api from "../../services/apiClient";
import { PERMISSIONS } from "../../constants/permissions";
import { hasPermission } from "../../utils/permissions";

const Harvest = () => {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");
  const canCreate = hasPermission(currentUser, PERMISSIONS.HARVEST_CREATE);
  const canViewDisabled = hasPermission(currentUser, PERMISSIONS.HARVEST_VIEW_DISABLED);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [lots, setLots] = useState([]);
  const [loadingLots, setLoadingLots] = useState(false);

  const openDrawer = (record = null) => {
    setEditingRecord(record);
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingRecord(null);
  };

  const handleSuccess = () => {
    setRefreshKey((prev) => prev + 1);
    closeDrawer();
  };

  const fetchLots = useCallback(async () => {
    setLoadingLots(true);

    try {
      const { data } = await api.get("/lots", {
        params: {
          enabled: true,
          pageSize: 1000,
        },
      });

      const list = Array.isArray(data)
        ? data
        : data?.items || data?.data || [];

      setLots(list);
    } catch (error) {
      console.error("→ lots list error:", error);

      notification.error({
        message: "Error al cargar los lotes",
      });
    } finally {
      setLoadingLots(false);
    }
  }, []);

  useEffect(() => {
    fetchLots();
  }, [fetchLots]);

  const disabledMenu = [
    canViewDisabled && {
      key: "disabled",
      label: (
        <span onClick={() => navigate("/harvest-deshabilitadas")}>
          Ver cosechas deshabilitadas
        </span>
      ),
    },
  ].filter(Boolean);

  return (
    <div style={{ padding: 12 }}>
      <Row
        justify="space-between"
        align="middle"
        style={{ marginBottom: 12, marginTop: isMobile ? 8 : 24 }}
      >
        <Col>
          <h2>Gestión de Cosecha</h2>
        </Col>

        <Col>
          {isMobile ? (
            disabledMenu.length > 0 ? (
              <Dropdown menu={{ items: disabledMenu }} placement="bottomRight" arrow>
                <MoreOutlined style={{ fontSize: 24, cursor: "pointer" }} />
              </Dropdown>
            ) : null
          ) : (
            <Space>
              {canViewDisabled && (
                <Button onClick={() => navigate("/harvest-deshabilitadas")}>
                  Ver cosechas deshabilitadas
                </Button>
              )}
              {canCreate && (
                <Button type="primary" onClick={() => openDrawer()}>
                  Agregar Cosecha
                </Button>
              )}
            </Space>
          )}
        </Col>
      </Row>

      <HarvestTable refreshKey={refreshKey} isMobile={isMobile} onEdit={openDrawer} />

      <Drawer
        title={editingRecord ? "Editar registro de cosecha" : "Nuevo registro de cosecha"}
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDrawer}
        open={isDrawerOpen}
        height={isMobile ? "90vh" : undefined}
        width={isMobile ? "100%" : 760}
        styles={{
          header: { borderBottom: "1px solid #f0f0f0" },
          body: { paddingBottom: 80, background: "#fafafa" },
        }}
        destroyOnClose
      >
        <HarvestForm
          lots={lots}
          loadingLots={loadingLots}
          initialRecord={editingRecord}
          onSuccess={handleSuccess}
          onCancel={closeDrawer}
        />
      </Drawer>

      {isMobile && !isDrawerOpen && canCreate && (
        <button
          type="button"
          className="fab-button"
          aria-label="Agregar registro de cosecha"
          onClick={() => openDrawer()}
        >
          <PlusOutlined />
        </button>
      )}
    </div>
  );
};

export default Harvest;
