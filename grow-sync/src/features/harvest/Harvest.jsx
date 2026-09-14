import { calendarDateKey } from '../../utils/calendarDate';
import { useState, useCallback, useEffect, useRef } from "react";
import { notification } from "antd";
import { PageHeader, FormDrawer } from "../../components/ui";
import "./harvest.css";
import dayjs from "dayjs";
import { PlusOutlined } from "../../components/AppIcons";


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
  const [registrationMode, setRegistrationMode] = useState("current");
  const [editingRecord, setEditingRecord] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [lots, setLots] = useState([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [crops, setCrops] = useState([]);
  const [productiveStates, setProductiveStates] = useState([]);
  const [loadingProductiveStates, setLoadingProductiveStates] = useState(false);
  const [productiveStateDate, setProductiveStateDate] = useState(dayjs().format("YYYY-MM-DD"));
  const productiveStatesRequestId = useRef(0);

  const openDrawer = (record = null, mode = "current") => {
    setRegistrationMode(mode);
    setProductiveStateDate(record?.harvest_date ? calendarDateKey(record.harvest_date) : dayjs().format("YYYY-MM-DD"));
    setEditingRecord(record);
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingRecord(null);
  };

  const handleSuccess = () => {
    setRefreshKey((prev) => prev + 1);
    fetchProductiveStates(productiveStateDate);
    closeDrawer();
  };

  const fetchLots = useCallback(async () => {
    setLoadingLots(true);

    try {
      const { data } = await api.get("/lots", {
        params: {
          enabled: true,
          pageSize: 1000,
          includeActiveLayout: true,
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

  const fetchCrops = useCallback(async () => {
    try {
      const { data } = await api.get("/crops");
      setCrops(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch (error) {
      console.error("→ crops list error:", error);
      notification.error({
        message: "No se pudieron cargar los cultivos",
      });
    }
  }, []);

  const fetchProductiveStates = useCallback(async (date) => {
    const requestId = ++productiveStatesRequestId.current;
    setLoadingProductiveStates(true);
    setProductiveStates([]);

    try {
      const { data } = await api.get("/lots/productive-states", {
        params: { date },
      });
      if (requestId !== productiveStatesRequestId.current) return;
      setProductiveStates(Array.isArray(data) ? data : data?.data || []);
    } catch (error) {
      if (requestId !== productiveStatesRequestId.current) return;
      console.error("→ productive states error:", error);
      setProductiveStates([]);
      notification.error({
        message: "No se pudo cargar el estado productivo",
      });
    } finally {
      if (requestId === productiveStatesRequestId.current) {
        setLoadingProductiveStates(false);
      }
    }
  }, []);

  const handleHarvestDateChange = useCallback((date) => {
    setProductiveStateDate(date ? calendarDateKey(date) : dayjs().format("YYYY-MM-DD"));
  }, []);

  useEffect(() => {
    fetchLots();
    fetchCrops();
  }, [fetchLots, fetchCrops]);

  useEffect(() => {
    fetchProductiveStates(productiveStateDate);
  }, [fetchProductiveStates, productiveStateDate]);

  return (
    <div className="gs-harvest">
      <PageHeader title="Cosechas" description="Registrá y analizá el rendimiento de tus lotes por campaña."
        primaryAction={{label:'Registrar cosecha',icon:<PlusOutlined/>,onClick:()=>openDrawer(),hidden:!canCreate}}
        secondaryActions={[{key:'historical',label:'Registrar cosecha histórica',onClick:()=>openDrawer(null,'historical'),hidden:!canCreate}]}/>
      <HarvestTable refreshKey={refreshKey} isMobile={isMobile} onEdit={openDrawer} lots={lots}/>
      <FormDrawer title={editingRecord ? 'Editar registro de cosecha' : 'Nuevo registro de cosecha'} open={isDrawerOpen} onClose={closeDrawer} wide destroyOnHidden>
        <HarvestForm
          lots={lots}
          loadingLots={loadingLots}
          crops={crops}
          productiveStates={productiveStates}
          loadingProductiveStates={loadingProductiveStates}
          registrationMode={registrationMode}
          initialRecord={editingRecord}
          onHarvestDateChange={handleHarvestDateChange}
          onSuccess={handleSuccess}
          onCancel={closeDrawer}
        />
      </FormDrawer>
    </div>
  );
};

export default Harvest;
