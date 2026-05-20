import { useState, useCallback, useEffect } from "react";
import { Button, Col, Drawer, Row, Space, notification } from "antd";
import { PlusOutlined } from '../../components/AppIcons';

import useIsMobile from "../../hooks/useIsMobile";
import HarvestTable from "./HarvestTable";
import HarvestForm from "./HarvestForm";

import api from "../../services/apiClient";
import { PERMISSIONS } from "../../constants/permissions";
import { hasPermission } from "../../utils/permissions";

const Harvest = () => {
    const isMobile = useIsMobile();
    const currentUser = JSON.parse(localStorage.getItem("user") || "null");
    const canCreate = hasPermission(currentUser, PERMISSIONS.HARVEST_CREATE);

    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    const [lots, setLots] = useState([]);
    const [loadingLots, setLoadingLots] = useState(false);

    const openDrawer = () => {
        setIsDrawerOpen(true);
    };

    const closeDrawer = () => {
        setIsDrawerOpen(false);
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
                enabled: true,   // importante: solo activos
                pageSize: 1000,  // para traer todos
            },
            });

            const list =
            Array.isArray(data)
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
          <Space>
            {!isMobile && canCreate && (
              <Button type="primary" onClick={openDrawer}>
                Agregar Registro
              </Button>
            )}
          </Space>
        </Col>
      </Row>

      <HarvestTable refreshKey={refreshKey} isMobile={isMobile} />

      <Drawer
        title="Agregar Registro de Cosecha"
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDrawer}
        open={isDrawerOpen}
        height={isMobile ? "90vh" : undefined}
        width={isMobile ? "100%" : 520}
        styles={{ body: { paddingBottom: 80 } }}
        destroyOnClose
      >
        <HarvestForm 
            lots={lots}
            loadingLots={loadingLots}
            onSuccess={handleSuccess} 
            onCancel={closeDrawer} 
        />
      </Drawer>

      {isMobile && !isDrawerOpen && canCreate && (
        <button
          type="button"
          className="fab-button"
          aria-label="Agregar registro de cosecha"
          onClick={openDrawer}
        >
          <PlusOutlined />
        </button>
      )}
    </div>
  );
};

export default Harvest;
