import { useState, useCallback, useEffect } from "react";
import { Button, Col, Drawer, Row, Space, notification } from "antd";
import { PlusOutlined } from '../../components/AppIcons';

import useIsMobile from "../../hooks/useIsMobile";
import HarvestTable from "./HarvestTable";
import HarvestForm from "./HarvestForm";

import api from "../../services/apiClient";

const Harvest = () => {
    const isMobile = useIsMobile();

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
            {!isMobile && (
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

      {isMobile && !isDrawerOpen && (
        <div className="fab-button" onClick={openDrawer}>
          <PlusOutlined />
        </div>
      )}
    </div>
  );
};

export default Harvest;