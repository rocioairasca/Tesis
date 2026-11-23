import { calendarDateKey } from '../../utils/calendarDate';
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Button, Tabs, notification } from "antd";
import { PageHeader, FormDrawer, ViewSwitcher } from "../../components/ui";
import "./harvest.css";
import dayjs from "dayjs";
import { PlusOutlined } from "../../components/AppIcons";


import HarvestTable from "./HarvestTable";
import HarvestResults from "./HarvestResults.jsx";
import HarvestCostForm from "./HarvestCostForm";
import HarvestFilters from "./HarvestFilters";
import { getHarvestFilters } from "../../services/harvestService";
import { campaignFilterOptions } from "../../utils/campaigns.mjs";
import { YIELD_UNIT_OPTIONS, mergeOptions, surfaceOptionsFromLots } from "./harvestResults.mjs";
import HarvestForm from "./HarvestForm";

import api from "../../services/apiClient";
import { PERMISSIONS } from "../../constants/permissions";
import { hasPermission } from "../../utils/permissions";

const Harvest = () => {
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");
  const canCreate = hasPermission(currentUser, PERMISSIONS.HARVEST_CREATE);
  // UX only: the server enforces planning.view + inventory.view + planning.edit + inventory.edit on every cost write.
  const canEditCosts = [PERMISSIONS.PLANNING_VIEW, PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.PLANNING_EDIT, PERMISSIONS.INVENTORY_EDIT].every((key) => hasPermission(currentUser, key));
  const [costDrawer, setCostDrawer] = useState({ open: false, preset: null });

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [registrationMode, setRegistrationMode] = useState("current");
  const [editingRecord, setEditingRecord] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Shared by "Registros" and "Resultados por lote": switching views, opening a record or coming back never resets them.
  const defaultFilters = { campaign: undefined, crop: undefined, surface: undefined, search: "", state: "active", origin: undefined };
  const [tab, setTab] = useState("records");
  const [filters, setFilters] = useState(defaultFilters);
  const [keyFilter, setKeyFilter] = useState(null);
  const [recordsPage, setRecordsPage] = useState(1);
  const [resultsPage, setResultsPage] = useState(1);
  const [expanded, setExpanded] = useState([]);
  const [selectedResult, setSelectedResult] = useState(null);
  const [unit, setUnit] = useState("kg");
  const [chartsOpen, setChartsOpen] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1440);
  const [filterData, setFilterData] = useState({ campaigns: [], crops: [] });
  const [seenSurfaces, setSeenSurfaces] = useState([]);
  const canStats = Number(currentUser?.role) >= 1;
  const canDisabled = hasPermission(currentUser, PERMISSIONS.HARVEST_VIEW_DISABLED);

  const [lots, setLots] = useState([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [crops, setCrops] = useState([]);
  const [productiveStates, setProductiveStates] = useState([]);
  const [loadingProductiveStates, setLoadingProductiveStates] = useState(false);
  const [productiveStateDate, setProductiveStateDate] = useState(dayjs().format("YYYY-MM-DD"));
  const productiveStatesRequestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    getHarvestFilters().then((data) => { if (!cancelled) setFilterData({ ...data, campaigns: data.campaigns || [], crops: data.crops || [] }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [refreshKey]);

  const campaignList = useMemo(() => campaignFilterOptions(filterData), [filterData]);
  const options = useMemo(() => ({
    campaigns: campaignList,
    crops: [...new Set(filterData.crops)].filter(Boolean).map((value) => ({ value, label: value })),
    surfaces: mergeOptions(surfaceOptionsFromLots(lots), seenSurfaces),
  }), [campaignList, filterData.crops, lots, seenSurfaces]);

  // "Resultados por lote" always needs a campaign: preselect the most recent one without touching an explicit choice.
  useEffect(() => {
    if (tab === "results" && !filters.campaign && campaignList.length) setFilters((previous) => ({ ...previous, campaign: campaignList[0].value }));
  }, [tab, filters.campaign, campaignList]);

  const changeFilter = (key, value) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setRecordsPage(1); setResultsPage(1); setExpanded([]); setKeyFilter(null); setSelectedResult(null);
  };
  const clearFilters = () => { setFilters(defaultFilters); setRecordsPage(1); setResultsPage(1); setExpanded([]); setKeyFilter(null); setSelectedResult(null); };
  const addSurfaces = useCallback((list) => setSeenSurfaces((previous) => mergeOptions(previous, list)), []);
  const labelOf = (list, value) => list.find((item) => item.value === value)?.label;
  const activeFilters = Object.entries(filters)
    .filter(([key, value]) => value && !(key === "state" && value === "active") && !(key === "search" && !String(value).trim()))
    .map(([key, value]) => ({
      key,
      label: key === "state" ? (value === "disabled" ? "Deshabilitadas" : "Todos los estados")
        : key === "campaign" ? labelOf(options.campaigns, value) || value
        : key === "surface" ? labelOf(options.surfaces, value) || "Superficie seleccionada"
        : key === "origin" ? ({ historical: "Histórica", current: "Actual", unknown: "Sin procedencia documentada" }[value])
        : value,
      onRemove: () => changeFilter(key, defaultFilters[key]),
    }));
  const viewRecords = (filter) => { setKeyFilter(filter); setRecordsPage(1); setTab("records"); };
  const backToResults = () => { setKeyFilter(null); setTab("results"); };
  const changeTab = (key) => { if (key === "results") setKeyFilter(null); setTab(key); };

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
        secondaryActions={[{key:'historical',label:'Registrar cosecha histórica',onClick:()=>openDrawer(null,'historical'),hidden:!canCreate},
          {key:'cost',label:'Registrar gasto',onClick:()=>setCostDrawer({open:true,preset:null}),hidden:!canEditCosts}]}/>
      <div className="gs-harvest-viewbar">
        <Tabs className="gs-harvest-tabs" activeKey={tab} onChange={changeTab} items={[{ key: "records", label: "Registros" }, { key: "results", label: "Resultados por lote" }]} />
        <div className="gs-harvest-viewtools">
          <ViewSwitcher label="Rendimiento en" options={YIELD_UNIT_OPTIONS} value={unit} onChange={setUnit} />
          {tab === "records" && canStats && <Button aria-pressed={chartsOpen} onClick={() => setChartsOpen((open) => !open)}>{chartsOpen ? "Ocultar gráficos" : "Gráficos"}</Button>}
        </div>
      </div>
      <HarvestFilters tab={tab} filters={filters} onChange={changeFilter} onClear={clearFilters} options={options} canDisabled={canDisabled} activeFilters={activeFilters} />
      {tab === "records"
        ? <HarvestTable refreshKey={refreshKey} onEdit={openDrawer} lots={lots} filters={filters} keyFilter={keyFilter} onClearKeyFilter={() => setKeyFilter(null)}
            onBack={keyFilter ? backToResults : undefined} page={recordsPage} onPage={setRecordsPage} unit={unit} chartsOpen={chartsOpen} onSurfaces={addSurfaces} />
        : <HarvestResults refreshKey={refreshKey} filters={filters} page={resultsPage} onPage={setResultsPage} expanded={expanded} onExpanded={setExpanded}
            unit={unit} onViewRecords={viewRecords} onSurfaces={addSurfaces} selected={selectedResult} onSelect={setSelectedResult}
            onRegisterExpense={canEditCosts ? (preset) => setCostDrawer({ open: true, preset }) : undefined} onChanged={() => setRefreshKey((prev) => prev + 1)} />}
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
      <FormDrawer title="Registrar gasto" open={costDrawer.open} onClose={() => setCostDrawer({ open: false, preset: null })} wide destroyOnHidden>
        <HarvestCostForm lots={lots} crops={crops} preset={costDrawer.preset}
          onSuccess={() => { setCostDrawer({ open: false, preset: null }); setRefreshKey((prev) => prev + 1); notification.success({ message: "Gasto registrado" }); }}
          onCancel={() => setCostDrawer({ open: false, preset: null })} />
      </FormDrawer>
    </div>
  );
};

export default Harvest;
