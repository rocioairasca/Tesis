// React
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// Librerías
import {
  Alert,
  Button,
  Calendar as AntCalendar,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Dropdown,
  Form,
  Input,
  List,
  Modal,
  Pagination,
  Popconfirm,
  Popover,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  notification,
} from "antd";
import dayjs from "dayjs";
import isBetween from "dayjs/plugin/isBetween";
import { useNavigate, useSearchParams } from "react-router-dom";

// Servicios y configuración
import api from "../../services/apiClient";
import { PERMISSIONS } from "../../constants/permissions";

// Componentes globales
import {
  CalendarOutlined,
  DeleteOutlined,
  DollarOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  Leaf,
  MoreOutlined,
  Package,
  PlusOutlined,
  UserOutlined,
} from "../../components/AppIcons";
import QuantityUnitFields from "../../components/QuantityUnitFields";
import { renderUserOption } from "../../components/users/UserOption";

// Hooks globales
import useIsMobile from "../../hooks/useIsMobile";

// Utilidades globales
import {
  campaignLabel,
  campaignPeriod,
  campaignWorkEnd,
  campaignContainsWorkDate,
  campaignContainsWorkRange,
  campaignWindowWarning,
  orderCampaignsForRange,
  planningCampaignDatesChanged,
  sortCampaigns,
} from "../../utils/campaigns.mjs";
import {
  actualProductPayload,
  exceedsAvailable,
  planningProductPayload,
} from "../../utils/inventoryConversion";
import {
  normalizeUnit,
  quantityLabel,
} from "../../utils/inventoryUnits";
import {
  formatCalendarDate,
  parseCalendarDate,
} from "../../utils/calendarDate";
import { hasPermission } from "../../utils/permissions";
import {
  userDisplayName,
  userOptions,
} from "../../utils/userDisplay.mjs";
import { getUserFriendlyError } from "../../utils/userFriendlyErrors";

// Componentes de Planning
import AdoptExistingModal from "./components/AdoptExistingModal";
import ExecutionEconomicFields from "./components/ExecutionEconomicFields";
import HistoricalPlanningFields from "./components/HistoricalPlanningFields";
import LotMapPreview from "./components/LotMapPreview";
import PlanningActualCost from "./components/PlanningActualCost";
import PlanningCostEstimate from "./components/PlanningCostEstimate";
import PlanningDateFields from "./components/PlanningDateFields";
import PlanningFormProducts from "./components/PlanningFormProducts";
import PlanningFormSection from "./components/PlanningFormSection";
import PlanningListMobile from "./components/PlanningListMobile";
import PlanningLocationSection from "./components/PlanningLocationSection";
import PlanningRecipeFields from "./components/PlanningRecipeFields";
import PlanningRegistrationType from "./components/PlanningRegistrationType";
import PlanningTable from "./components/PlanningTable";

// Hooks de Planning
import usePlanningLayout from "./usePlanningLayout";
import usePlanningList from "./usePlanningList";

// Lógica de Planning
import { canAdoptExisting } from "./historicalAdoption.mjs";
import {
  effectiveArea,
  partialAreaAllowed,
  selectionAreaLabel,
} from "./effectiveArea.mjs";
import {
  FIELD_CONTEXT_OPTIONS,
  cropRequired,
  hasFieldContext,
} from "./fieldContext.mjs";
import {
  buildHistoricalPayload,
  canEditPlanning,
  isHistoricalPlanning,
} from "./historicalPlanning.mjs";
import {
  economicEditPermissions,
  executionEconomicPayload,
} from "./planningEconomics.mjs";
import {
  canExecutePlanning,
  completionEndpoint,
  executionDeniedMessage,
  primaryExecutionAction,
} from "./planningExecution.mjs";
import {
  clearPlanningFilters,
  planningFilterKey,
  readPlanningFilters,
  readPlanningListState,
  updatePlanningFilters,
  updatePlanningPage,
} from "./planningFilters.mjs";
import {
  activityChangeFields,
  durationMode,
  registrationModeFields,
  validatedDateRange,
} from "./planningFormFlow.mjs";
import {
  MANUAL_RECIPE,
  recipeId as getRecipeId,
  registeredRecipeActualProducts,
  totalLabel,
} from "./planningRecipe.mjs";
import {
  ACTIVITY_EVENT_STYLES,
  STATUS_COLORS,
  formatActivity,
  formatPlanningPeriod,
  getCropDisplayName,
  getPlanningContextLabel,
  getPlanningDatePart,
  getPlanningDisplayName,
  getPlanningEventLabel,
  getPlanningLotName,
  statusLabel,
  summarizePlanningLotsShort,
} from "./planningDisplay";
import { formatHa } from "./planningFormat.mjs";

// Recetas
import { doseLabel } from "../recipes/recipeModel.mjs";

// Estilos
import "./planning.css";

dayjs.extend(isBetween);

const { RangePicker } = DatePicker;
const CAMPAIGN_HELP_TEXT = "La campaña representa un ciclo productivo completo. Distintas campañas pueden desarrollarse al mismo tiempo.";
const CAMPAIGN_WORK_START_HELP_TEXT = "Permite incluir trabajos realizados antes del inicio de la campaña. Si no se indica, se usará la fecha de inicio.";

// --- helpers ---
const getId = (r) => r?.id ?? r?._id;
const rowKey = (r) => getId(r) ?? r?.title ?? String(Math.random());
const fullLotKey = (lotId) => `lot:${lotId}`;
const subLotKey = (lotId, subLotId) => `sub:${lotId}:${subLotId}`;
const getLotArea = (lot) => Number(lot?.area_ha ?? lot?.area ?? 0);
const getActiveSubLots = (lot) => (
  Array.isArray(lot?.active_layout?.sub_lots) ? lot.active_layout.sub_lots : []
);
const getPlanningLotArea = effectiveArea;
const getPlanningArea = (row) => {
  const plannedArea = Number(row?.planned_area_ha || 0);
  if (plannedArea > 0) return plannedArea;
  return (row?.lots || []).reduce((sum, lot) => sum + getPlanningLotArea(lot), 0);
};
const getEffectiveSowingDate = (row) => {
  const source = row?.end_at || row?.start_at;
  const datePart = getPlanningDatePart(source);
  return datePart ? dayjs(datePart) : dayjs();
};
const getEffectiveWorkDate = getEffectiveSowingDate;
const getPlanningDayjs = (value) => {
  const datePart = getPlanningDatePart(value);
  return datePart ? dayjs(datePart) : null;
};
const formatDate = (value) => {
  if (!value) return "—";
  return formatCalendarDate(value, "—");
};
const formatQuantity = (value) => (
  Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 6 })
);
const getProductId = (product) => product?.id ?? product?._id;
const getCampaignWorkStartValue = (campaign) => campaign?.work_start_date ?? campaign?.start_date;
const formatCampaignWorkStart = (campaign) => formatDate(getCampaignWorkStartValue(campaign));
const getCampaignStartDate = (campaign) => (
  campaign?.start_date ? parseCalendarDate(campaign.start_date).startOf("day") : null
);
const formatCampaignOptionMeta = (campaign) => (
  `Oficial: ${formatDate(campaign?.start_date)} – ${campaign?.end_date ? formatDate(campaign.end_date) : "Sin fin definido"} · Trabajos: ${formatCampaignWorkStart(campaign)} – ${campaignWorkEnd(campaign) ? formatDate(campaignWorkEnd(campaign)) : "Sin fin definido"}`
);
const renderCampaignOptionLabel = (campaign, suffix = null) => (
  <div>
    <div>{campaignLabel(campaign)}{suffix ? ` ${suffix}` : ""}</div>
    <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "normal" }}>
      {campaignPeriod(campaign)}
    </div>
  </div>
);
const renderCampaignDropdownOption = (campaign, suffix = null) => (
  <div style={{ padding: "4px 0", lineHeight: 1.35 }}>
    <div>{campaignLabel(campaign)}{suffix ? ` ${suffix}` : ""}</div>
    <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "normal" }}>
      {formatCampaignOptionMeta(campaign)}
    </div>
  </div>
);
const planningLotToSelectionKey = (lot) => {
  const lotId = lot?.lot_id || lot?.id || lot?._id;
  if (!lotId) return null;
  return lot?.sub_lot_id ? subLotKey(lotId, lot.sub_lot_id) : fullLotKey(lotId);
};
const parseSelectionKey = (key) => {
  const [type, lotId, subLotId] = String(key || "").split(":");
  if (type === "lot" && lotId) return { lot_id: lotId, sub_lot_id: null };
  if (type === "sub" && lotId && subLotId) return { lot_id: lotId, sub_lot_id: subLotId };
  return null;
};
const statusTag = (s) => <Tag color={STATUS_COLORS[s] || "default"}>{statusLabel(s)}</Tag>;

const ACTIVITY_OPTIONS = [
  { value: "siembra", label: "Siembra" },
  { value: "fumigacion", label: "Fumigación" },
  { value: "cosecha", label: "Cosecha" },
  { value: "fertilizacion", label: "Fertilización" },
  { value: "riego", label: "Riego" },
  { value: "mantenimiento", label: "Mantenimiento" },
  { value: "otro", label: "Otro" },
];

const PRODUCT_CONSUMING_ACTIVITIES = new Set(["siembra", "fumigacion", "fertilizacion"]);
const ADD_CROP_VALUE = "__add_crop__";
const MAX_CALENDAR_LANES = 3;
const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const getEventIdentityAlpha = (id) => {
  const value = String(id || "");
  const hash = value.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return (0.07 + (hash % 5) * 0.025).toFixed(3);
};
const formatPeriod = (row) => {
  return formatPlanningPeriod(row);
};
const getCampaignDisplayStatus = (campaign) => {
  if (!campaign) return "—";
  if (campaign.status === "active") return "Activa";
  return "Cerrada";
};
const getMonthTitle = (date) => {
  if (!date) return "";
  return `${MONTH_NAMES[date.month()]} ${date.year()}`;
};
const getMonthText = (date) => {
  if (!date) return "";
  return `${MONTH_NAMES[date.month()]} de ${date.year()}`;
};

const Planning = () => {
  const [calendarSelection, setCalendarSelection] = useState(null); // { type: 'day' | 'month', date: dayjs() }

  // URL is the single source of truth, including browser back/forward.
  const [searchParams, setSearchParams] = useSearchParams();
  const filterKey = planningFilterKey(searchParams);
  const filters = useMemo(() => readPlanningFilters(new URLSearchParams(filterKey)), [filterKey]);
  const { page, pageSize, view: viewMode } = readPlanningListState(searchParams);
  const setViewMode = view => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    if (view === 'calendar') next.set('view', view); else next.delete('view');
    return next;
  });
  const changePage = useCallback((nextPage, nextSize, replace = false) => {
    setSearchParams(previous => updatePlanningPage(previous, nextPage, nextSize), { replace });
  }, [setSearchParams]);
  useEffect(() => {
    if (filters.mine && searchParams.has('responsible')) setSearchParams(previous => updatePlanningFilters(previous, 'mine', true), { replace: true });
  }, [filters.mine, searchParams, setSearchParams]);

  // catálogos para nombres legibles
  const [users, setUsers] = useState([]);
  const [lots, setLots] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [crops, setCrops] = useState([]);
  const [products, setProducts] = useState([]);
  const [inventoryEnabled, setInventoryEnabled] = useState(false);
  const [vehicles, setVehicles] = useState([]);

  // índices id -> nombre
  const userIx = useMemo(
    () => Object.fromEntries(users.map(u => [u.id ?? u._id, userDisplayName(u)])),
    [users]
  );
  const lotIx = useMemo(
    () => Object.fromEntries(lots.map(l => [l.id ?? l._id, l.name])),
    [lots]
  );
  const cropIx = useMemo(
    () => Object.fromEntries(crops.map(c => [c.id ?? c._id, c.name])),
    [crops]
  );
  const prodIx = useMemo(
    () => Object.fromEntries(products.map(p => [getProductId(p), p.name])),
    [products]
  );
  const vehIx = useMemo(
    () => Object.fromEntries(vehicles.map(v => [v.id ?? v._id, v.name || v.model || v.plate])),
    [vehicles]
  );

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null); // Estado para el detalle
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [form] = Form.useForm();
  const [cropForm] = Form.useForm();
  const [campaignForm] = Form.useForm();
  const [editCampaignForm] = Form.useForm();
  const [sowingForm] = Form.useForm();
  const [completionForm] = Form.useForm();
  const selectedLotKeys = Form.useWatch("lot_selection_keys", form) || [];
  const effectiveAreas = Form.useWatch("effective_areas", form) || {};
  const selectionModes = Form.useWatch("selection_modes",form)||{};
  const [recipeProductContainer,setRecipeProductContainer]=useState(null);
  const selectedActivityType = Form.useWatch("activity_type", form);
  const selectedFieldContext = Form.useWatch("field_context", form);
  const selectedFormCropId = Form.useWatch("crop_id",form);
  const selectedRecipeId = getRecipeId(Form.useWatch("recipe_id",form));
  const selectedDateRange = Form.useWatch("date_range", form);
  const selectedCampaignId = Form.useWatch("campaign_id", form);
  const registerCompleted = Boolean(Form.useWatch("register_completed", form));
  const selectedEffectiveDate = Form.useWatch("effective_date", form);
  const selectedFormProducts = Form.useWatch("products", form) || [];
  const isHistorical = editing?.inventory_impact_mode === 'HISTORICAL_NO_STOCK';
  const isEditingHistorical = Boolean(editing) && isHistorical;
  const isEditingCompleted = editing?.status === "completado";
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [isEditCampaignModalOpen, setIsEditCampaignModalOpen] = useState(false);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [savingCrop, setSavingCrop] = useState(false);
  const [sowingCompletion, setSowingCompletion] = useState({ open: false, planning: null });
  const [completingSowing, setCompletingSowing] = useState(false);
  const [workCompletion, setWorkCompletion] = useState({ open: false, planning: null });
  const [completingWork, setCompletingWork] = useState(false);
  const [statusActionLoading, setStatusActionLoading] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const isMobile = useIsMobile();
  const { containerRef, useCompactPlanningList } = usePlanningLayout();
  const navigate = useNavigate();
  const detailId = searchParams.get("planningId");
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");
  const canCreate = hasPermission(currentUser, PERMISSIONS.PLANNING_CREATE);
  const canEdit = hasPermission(currentUser, PERMISSIONS.PLANNING_EDIT);
  const executionCapabilities = { canEdit, canExecute: hasPermission(currentUser, PERMISSIONS.PLANNING_EXECUTE), userId: currentUser?.id, companyId: currentUser?.company_id };
  const executionError = (error, fallback) => error.response?.status === 403 ? executionDeniedMessage : getUserFriendlyError(error, fallback);
  const canImportHistory = hasPermission(currentUser, PERMISSIONS.HISTORY_IMPORT);
  const [adopting,setAdopting]=useState(null);
  const [adoptionCutoff,setAdoptionCutoff]=useState(null);
  useEffect(()=>{
    let active=true;
    if(Number(currentUser?.role)===3 && canImportHistory && canEdit) {
      api.get('/history/stock-initial/status').then(({data})=>{if(active)setAdoptionCutoff(data.inventory_control_start_date);})
        .catch(()=>{if(active)setAdoptionCutoff(null);});
    } else setAdoptionCutoff(null);
    return ()=>{active=false;};
  },[currentUser?.company_id,currentUser?.role,canImportHistory,canEdit]);
  const getAdoptionActions = row => canAdoptExisting(currentUser,row,adoptionCutoff)
    ? [{key:'adopt-history',label:'Marcar como registro histórico',onClick:()=>setAdopting(row)}] : [];
  const canDisable = hasPermission(currentUser, PERMISSIONS.PLANNING_DISABLE);
  const canViewDisabled = hasPermission(currentUser, PERMISSIONS.PLANNING_VIEW_DISABLED);

  const canView = hasPermission(currentUser, PERMISSIONS.PLANNING_VIEW);
  const listScope = JSON.stringify([currentUser?.company_id, currentUser?.id, currentUser?.role, currentUser?.custom_permissions, canView]);
  const { list, total, loading, refresh: fetchPlanning } = usePlanningList({
    filters, page, pageSize, viewMode, scope: listScope, canView, changePage,
  });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setViewing(null);
    setDetailError(null);
    setIsDetailOpen(Boolean(detailId));
    setDetailLoading(Boolean(detailId) && canView);
    if (detailId) {
      if (!canView) setDetailError('No tenés permiso para ver esta planificación.');
      else api.get('/planning/' + encodeURIComponent(detailId), {signal: controller.signal})
        .then(({data}) => {
          if (!active) return;
          if (!data?.id) throw new Error('Missing planning');
          setViewing(data);
        })
        .catch(error => {
          if (!active || controller.signal.aborted) return;
          const status = error.response?.status;
          setDetailError(status === 403
            ? 'No tenés permiso para ver esta planificación.'
            : status === 404 || status === 400
              ? 'La planificación no existe o no está disponible para tu empresa.'
              : 'No pudimos cargar la planificación. Cerrá el detalle e intentá nuevamente.');
        })
        .finally(() => { if (active) setDetailLoading(false); });
    }
    return () => { active = false; controller.abort(); };
  }, [detailId, canView, currentUser?.company_id, detailRevision]);

  const selectedAreaRows = selectedLotKeys.map(key=>{
    const parsed=parseSelectionKey(key);
    if(!parsed)return null;
    const saved=editing?.lots?.find(item=>planningLotToSelectionKey(item)===key);
    const lot=lots.find(item=>(item.id ?? item._id)===parsed.lot_id);
    const sub=getActiveSubLots(lot).find(item=>item.id===parsed.sub_lot_id);
    const area=saved?.area_ha ?? (parsed.sub_lot_id ? sub?.area_ha : getLotArea(lot));
    return {key,sub_lot_id:parsed.sub_lot_id,selection_mode:saved?.selection_mode,name:saved ? getPlanningLotName(saved) : (parsed.sub_lot_id ? (lot?.name+' / '+(sub?.name||sub?.code)) : lot?.name),area_ha:area,effective_area_ha:saved ? effectiveArea(saved) : area};
  }).filter(Boolean);
  const selectedPlanningArea=selectedAreaRows.reduce((sum,row)=>sum+Number(
    !isEditingCompleted && !partialAreaAllowed(selectedActivityType) ? row.area_ha : (effectiveAreas[row.key] ?? row.effective_area_ha)
  ),0);
  useEffect(()=>{
    if(!isEditingCompleted && !isEditingHistorical && !partialAreaAllowed(selectedActivityType)) {
      const values=form.getFieldValue('effective_areas') || {};
      let changed=false;
      for(const row of selectedAreaRows) if(Number(values[row.key])!==Number(row.area_ha)) {values[row.key]=row.area_ha;changed=true;}
      if(changed)form.setFieldValue('effective_areas',{...values});
      const modes=form.getFieldValue('selection_modes')||{};
      form.setFieldValue('selection_modes',Object.fromEntries(selectedAreaRows.map(row=>[row.key,row.sub_lot_id?'sub_lot':'full_lot'])));
    }
  },[selectedActivityType,selectedLotKeys.join('|'),isEditingCompleted,isEditingHistorical]);

  const getCatalogProduct = useCallback((planningProduct) => (
    products.find(product => getProductId(product) === planningProduct?.product_id)
  ), [products]);

  const getCatalogProductById = useCallback((productId) => (
    products.find(product => getProductId(product) === productId)
  ), [products]);

  const getPlanningProductUnit = useCallback((planningProduct) => (
    planningProduct?.unit || getCatalogProduct(planningProduct)?.unit || ""
  ), [getCatalogProduct]);

  const getPlanningProductAvailable = useCallback((planningProduct) => {
    const directValue = planningProduct?.available_quantity;
    if (directValue !== undefined && directValue !== null) return directValue;
    return getCatalogProduct(planningProduct)?.available_quantity ?? 0;
  }, [getCatalogProduct]);

  const productOptions = useMemo(() => (
    products.map(product => ({
      value: getProductId(product),
      label: product.name,
      searchLabel: product.name || "",
    }))
  ), [products]);

  const selectedProductsHaveItems = useMemo(() => (
    Array.isArray(selectedFormProducts)
    && selectedFormProducts.some(item => item?.product_id)
  ), [selectedFormProducts]);

  const productStockExceeded = useMemo(() => (
    !selectedRecipeId && !registerCompleted && !isEditingHistorical && !isEditingCompleted &&
    Array.isArray(selectedFormProducts)
    && selectedFormProducts.some((item) => {
      if (!item?.product_id) return false;
      const product = getCatalogProductById(item.product_id);
      if (!product || item.amount == null || item.amount === '') return false;
      try { return exceedsAvailable(item.amount,item.unit,product.unit,product.available_quantity); }
      catch { return false; } // Field validation reports invalid precision or units.
    })
  ), [getCatalogProductById, selectedRecipeId, registerCompleted, isEditingCompleted, isEditingHistorical, selectedFormProducts]);

  const usableCampaigns = useMemo(() => campaigns.filter(campaign =>
    campaign.status === "active" || canEdit || (campaign.id ?? campaign._id) === editing?.campaign_id
  ), [campaigns, canEdit, editing?.campaign_id]);

  const campaignCompatibilityRange = useMemo(() => (
    registerCompleted && selectedEffectiveDate
      ? [selectedEffectiveDate, selectedEffectiveDate]
      : selectedDateRange
  ), [registerCompleted, selectedDateRange, selectedEffectiveDate]);

  const campaignContainsPlanningRange = campaignContainsWorkRange;

  const getCompatiblePlanningCampaigns = useCallback((range) => {
    if (!range?.[0] || !range?.[1]) return usableCampaigns;
    return usableCampaigns.filter((campaign) => campaignContainsPlanningRange(campaign, range));
  }, [campaignContainsPlanningRange, usableCampaigns]);

  const buildActualProductFields = useCallback((planning) => {
    const values = {};
    (planning?.products || []).forEach((product) => {
      if (!product.id) return;
      values[product.id] = { actual_amount: String(product.amount ?? 0), unit:normalizeUnit(getPlanningProductUnit(product)) };
    });
    return values;
  }, [getPlanningProductUnit]);

  const buildActualProductsPayload = useCallback((planning, values) => (
    (planning?.products || [])
      .filter(product => product.id)
      .map(product => actualProductPayload(product,values?.actual_products?.[product.id],getCatalogProduct(product)?.unit || getPlanningProductUnit(product)))
  ), [getCatalogProduct,getPlanningProductUnit]);

  const renderActualProductsForm = useCallback((planning) => {
    const plannedProducts = (planning?.products || []).filter(product => product.id);
    if (!plannedProducts.length) {
      return (
        <Alert
          type="info"
          showIcon
          message="Esta planificación no tiene productos asociados."
        />
      );
    }

    return (
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        {planning.recipe_id&&<div><strong>Receta: {planning.recipe_name_snapshot}</strong></div>}
        {plannedProducts.map((product) => {
          const productId = product.id;
          const plannedAmount = product.amount ?? 0;
          const unit = getPlanningProductUnit(product);
          const baseUnit = getCatalogProduct(product)?.unit || unit;
          const available = getPlanningProductAvailable(product);
          const title = product.name || prodIx[product.product_id] || "Producto";

          return (
            <div
              key={productId || product.product_id}
              style={{
                border: "1px solid #edf1e8",
                borderRadius: 8,
                padding: 12,
                background: "#fbfcf8",
              }}
            >
              <Row gutter={[12, 8]} align="middle">
                <Col xs={24} md={10}>
                  <strong>{title}</strong>
                  <div style={{ color: "#6b7280", fontSize: 12 }}>
                    {product.dose_amount!=null&&<div>Dosis: {doseLabel(product.dose_amount,product.dose_unit)}</div>}
                    Planificado: {totalLabel(plannedAmount,unit)}
                  </div>
                </Col>
                <Col xs={24} md={7}>
                  <div style={{ color: "#6b7280", fontSize: 12 }}>Stock utilizable hoy (referencia)</div>
                  <strong>{quantityLabel(available,baseUnit)}</strong>
                </Col>
                <Col xs={24} md={7}>
                  <QuantityUnitFields quantityName={["actual_products",productId,"actual_amount"]}
                    unitName={["actual_products",productId,"unit"]} label="Cantidad real" baseUnit={baseUnit}
                    allowZero allowConversion={inventoryEnabled} extra="El stock se valida al guardar según la fecha efectiva." />
                </Col>
              </Row>
            </div>
          );
        })}
      </Space>
    );
  }, [getPlanningProductAvailable, getPlanningProductUnit, getCatalogProduct, inventoryEnabled, prodIx]);

  const lotSelectionOptions = useMemo(() => {
    const selectedByLot = selectedLotKeys.reduce((acc, key) => {
      const parsed = parseSelectionKey(key);
      if (!parsed) return acc;
      const current = acc.get(parsed.lot_id) || { full: false, subLots: new Set() };
      if (parsed.sub_lot_id) current.subLots.add(parsed.sub_lot_id);
      else current.full = true;
      acc.set(parsed.lot_id, current);
      return acc;
    }, new Map());

    return lots.map((lot) => {
      const lotId = lot.id ?? lot._id;
      const subLots = getActiveSubLots(lot);
      const selected = selectedByLot.get(lotId) || { full: false, subLots: new Set() };
      if (!subLots.length) {
        return {
          value: fullLotKey(lotId),
          label: `${lot.name} · ${formatHa(getLotArea(lot))}`,
        };
      }

      const children = [
        {
          value: fullLotKey(lotId),
          label: `Lote completo · ${formatHa(getLotArea(lot))}`,
          disabled: selected.subLots.size > 0,
        },
        ...subLots.map(subLot => ({
          value: subLotKey(lotId, subLot.id),
          label: `${subLot.name || subLot.code} · ${formatHa(subLot.area_ha)}`,
          disabled: selected.full,
        })),
      ];

      return {
        label: lot.name,
        options: children,
      };
    });
  }, [lots, selectedLotKeys]);

  const lotFilterOptions = useMemo(() => (
    lots.map((lot) => {
      const lotId = lot.id ?? lot._id;
      const subLots = getActiveSubLots(lot);
      if (!subLots.length) {
        return {
          value: fullLotKey(lotId),
          label: `${lot.name} · ${formatHa(getLotArea(lot))}`,
        };
      }

      return {
        label: lot.name,
        options: [
          {
            value: fullLotKey(lotId),
            label: `Lote completo · ${formatHa(getLotArea(lot))}`,
          },
          ...subLots.map(subLot => ({
            value: subLotKey(lotId, subLot.id),
            label: `${subLot.name || subLot.code} · ${formatHa(subLot.area_ha)}`,
          })),
        ],
      };
    })
  ), [lots]);

  const responsibleOptions = useMemo(() => userOptions(users), [users]);

  const cropOptions = useMemo(() => {
    const currentCropId = editing?.crop_id;
    const currentCropName = editing?.crop_name;
    const hasCurrentCrop = currentCropId && crops.some((crop) => (crop.id ?? crop._id) === currentCropId);
    const historicalCurrentCrop = currentCropId && currentCropName && !hasCurrentCrop
      ? [{
        value: currentCropId,
        label: `${currentCropName} (histórico)`,
      }]
      : [];

    return [
      ...historicalCurrentCrop,
      ...crops.map((crop) => ({
        value: crop.id ?? crop._id,
        label: crop.name,
      })),
      {
        value: ADD_CROP_VALUE,
        label: "+ Agregar cultivo",
      },
    ];
  }, [crops, editing]);

  const campaignOptions = useMemo(() => {
    const currentCampaignId = editing?.campaign_id;
    const currentCampaignName = editing?.campaign_name;
    const hasCurrentCampaign = currentCampaignId
      && campaigns.some((campaign) => (campaign.id ?? campaign._id) === currentCampaignId);
    const historicalCurrentCampaign = currentCampaignId && currentCampaignName && !hasCurrentCampaign
      ? [{
        value: currentCampaignId,
        label: `${currentCampaignName} (cerrada)`,
        searchLabel: currentCampaignName,
      }]
      : [];

    return [
      ...historicalCurrentCampaign,
      ...campaigns.map((campaign) => ({
        value: campaign.id ?? campaign._id,
        label: renderCampaignOptionLabel(campaign, `- ${getCampaignDisplayStatus(campaign)}`),
        searchLabel: `${campaign.name} ${campaignPeriod(campaign)} ${getCampaignDisplayStatus(campaign)}`,
      })),
    ];
  }, [campaigns, editing]);

  const planningCampaignOptions = useMemo(() => {
    const options = orderCampaignsForRange(usableCampaigns, campaignCompatibilityRange).map(campaign => ({
      value: campaign.id ?? campaign._id,
      label: campaignLabel(campaign),
      campaign,
      suffix: campaignCompatibilityRange?.[0] && campaignCompatibilityRange?.[1]
        && !campaignContainsWorkRange(campaign, campaignCompatibilityRange) ? "- fuera de ventana" : null,
      searchLabel: `${campaign.name} ${formatCampaignOptionMeta(campaign)}`,
    }));
    if (editing?.campaign_id && !options.some(option => option.value === editing.campaign_id)) {
      options.push({ value: editing.campaign_id, label: editing.campaign_name || "Campaña existente" });
    }
    return options;
  }, [campaignCompatibilityRange, usableCampaigns, editing]);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => (campaign.id ?? campaign._id) === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  );
  const compatibleCampaignCount = useMemo(() => {
    return getCompatiblePlanningCampaigns(campaignCompatibilityRange).length;
  }, [campaignCompatibilityRange, getCompatiblePlanningCampaigns]);
  const campaignDateMismatch = Boolean(
    selectedCampaign
    && campaignCompatibilityRange?.[0]
    && campaignCompatibilityRange?.[1]
    && !campaignContainsPlanningRange(selectedCampaign, campaignCompatibilityRange)
  );
  const selectedPlanningStartsBeforeCampaign = Boolean(
    selectedCampaign
    && campaignCompatibilityRange?.[0]
    && campaignContainsPlanningRange(selectedCampaign, campaignCompatibilityRange)
    && getCampaignStartDate(selectedCampaign)
    && campaignCompatibilityRange[0].isBefore(getCampaignStartDate(selectedCampaign), "day")
  );

  const mustValidateCampaignDates = planningCampaignDatesChanged(editing, selectedCampaignId, campaignCompatibilityRange);

  const activeExtraFilterCount = [
    filters.campaignId,
    filters.responsible,
    filters.lotSelectionKey,
    filters.dateRange?.[0] && filters.dateRange?.[1],
  ].filter(Boolean).length;
  const hasActiveFilters = Object.values(filters).some(Boolean);

  const comparePlanningEvents = (a, b) => {
    const startDiff = (getPlanningDayjs(a.start_at)?.valueOf() || 0) - (getPlanningDayjs(b.start_at)?.valueOf() || 0);
    if (startDiff) return startDiff;

    const activityDiff = String(a.activity_type || "").localeCompare(String(b.activity_type || ""), "es");
    if (activityDiff) return activityDiff;

    const cropDiff = getCropDisplayName(a, cropIx).localeCompare(getCropDisplayName(b, cropIx), "es");
    if (cropDiff) return cropDiff;

    return String(getId(a) || "").localeCompare(String(getId(b) || ""), "es");
  };

  const calendarEventLayout = useMemo(() => {
    const byDate = new Map();
    const byWeek = new Map();

    const weekStart = (date) => date.startOf("day").subtract(date.day(), "day");
    const clampLater = (a, b) => (a.isAfter(b, "day") ? a : b);
    const clampEarlier = (a, b) => (a.isBefore(b, "day") ? a : b);

    const events = [...list]
      .filter((event) => event.start_at && event.end_at)
      .sort(comparePlanningEvents);

    events.forEach((event) => {
      const eventStart = getPlanningDayjs(event.start_at)?.startOf("day");
      const eventEnd = getPlanningDayjs(event.end_at)?.startOf("day");
      if (!eventStart?.isValid() || !eventEnd?.isValid()) return;

      let cursor = weekStart(eventStart);
      const lastWeek = weekStart(eventEnd);

      while (cursor.isBefore(lastWeek, "day") || cursor.isSame(lastWeek, "day")) {
        const startOfWeek = cursor;
        const endOfWeek = cursor.add(6, "day");
        const segmentStart = clampLater(eventStart, startOfWeek);
        const segmentEnd = clampEarlier(eventEnd, endOfWeek);

        if (!segmentStart.isAfter(segmentEnd, "day")) {
          const weekKey = startOfWeek.format("YYYY-MM-DD");
          const segments = byWeek.get(weekKey) || [];
          segments.push({ event, segmentStart, segmentEnd });
          byWeek.set(weekKey, segments);
        }

        cursor = cursor.add(7, "day");
      }
    });

    byWeek.forEach((segments) => {
      const lanes = [];

      segments
        .sort((a, b) => comparePlanningEvents(a.event, b.event))
        .forEach((segment) => {
          let lane = lanes.findIndex((lastEnd) => lastEnd.isBefore(segment.segmentStart, "day"));
          if (lane < 0) {
            lane = lanes.length;
          }
          lanes[lane] = segment.segmentEnd;

          let day = segment.segmentStart;
          while (day.isBefore(segment.segmentEnd, "day") || day.isSame(segment.segmentEnd, "day")) {
            const isSingleDay = segment.segmentStart.isSame(segment.segmentEnd, "day");
            const isStart = day.isSame(segment.segmentStart, "day");
            const isEnd = day.isSame(segment.segmentEnd, "day");
            const dateKey = day.format("YYYY-MM-DD");
            const dateSegments = byDate.get(dateKey) || [];

            dateSegments.push({
              event: segment.event,
              lane,
              part: isSingleDay ? "single" : (isStart ? "start" : (isEnd ? "end" : "middle")),
              showLabel: isSingleDay || isStart,
            });
            byDate.set(dateKey, dateSegments);

            day = day.add(1, "day");
          }
        });
    });

    byDate.forEach((segments, dateKey) => {
      byDate.set(dateKey, segments.sort((a, b) => a.lane - b.lane || comparePlanningEvents(a.event, b.event)));
    });

    return byDate;
  }, [list, cropIx]);

  // planificaciones que "tocan" un día (inicio/fin inclusivo)
  const eventsOn = (day) => {
    if (!day) return [];
    return (calendarEventLayout.get(day.format("YYYY-MM-DD")) || []).map((segment) => segment.event);
  };

  const eventsInMonth = useCallback((month) => {
    if (!month) return [];
    const monthStart = month.startOf("month");
    const monthEnd = month.endOf("month");

    return [...list]
      .filter((event) => {
        if (!event.start_at || !event.end_at) return false;
        const eventStart = getPlanningDayjs(event.start_at)?.startOf("day");
        const eventEnd = getPlanningDayjs(event.end_at)?.endOf("day");
        if (!eventStart?.isValid() || !eventEnd?.isValid()) return false;
        return !eventStart.isAfter(monthEnd) && !eventEnd.isBefore(monthStart);
      })
      .sort(comparePlanningEvents);
  }, [list, cropIx]);

  const selectedCalendarEvents = useMemo(() => {
    if (!calendarSelection?.date) return [];
    return calendarSelection.type === "month"
      ? eventsInMonth(calendarSelection.date)
      : eventsOn(calendarSelection.date);
  }, [calendarSelection, eventsInMonth, calendarEventLayout]);

  const selectedCalendarGroups = useMemo(() => {
    const groups = new Map();
    selectedCalendarEvents.forEach((event) => {
      const key = getPlanningDatePart(event.start_at) || "sin-fecha";
      const items = groups.get(key) || [];
      items.push(event);
      groups.set(key, items);
    });

    return Array.from(groups.entries()).map(([key, items]) => ({
      key,
      title: key === "sin-fecha"
        ? "Sin fecha"
        : `${dayjs(key).format("D")} ${MONTH_NAMES[dayjs(key).month()].toUpperCase()}`,
      items: items.sort(comparePlanningEvents),
    }));
  }, [selectedCalendarEvents, cropIx]);

  const calendarDrawerTitle = useMemo(() => {
    if (!calendarSelection?.date) return "";
    if (calendarSelection.type === "month") {
      return `Planificaciones de ${getMonthTitle(calendarSelection.date)}`;
    }
    return `Planificaciones del ${calendarSelection.date.format("DD/MM/YYYY")}`;
  }, [calendarSelection]);

  const calendarEmptyText = useMemo(() => {
    if (!calendarSelection?.date) return "No hay planificaciones.";
    if (calendarSelection.type === "month") {
      return `No hay planificaciones para ${getMonthText(calendarSelection.date)}.`;
    }
    return "Sin planificaciones para este día";
  }, [calendarSelection]);

  const renderEventPopover = (ev) => {
    const lots = (ev.lots || []).map(getPlanningLotName).filter(Boolean);
    const status = ev.status_effective || ev.status;
    return (
      <div className="cal-event-popover">
        <strong>{getPlanningDisplayName(ev, cropIx)}</strong>
        {getPlanningContextLabel(ev) && <div style={{ fontSize: 12, color: "#6b7280" }}>{getPlanningContextLabel(ev)}</div>}
        <div>{lots.join(", ") || "Sin lotes asignados"}</div>
        <div>{formatHa(getPlanningArea(ev))}</div>
        <div>{formatPeriod(ev)}</div>
        <div>Estado: {statusLabel(status)}</div>
        <div>Responsable: {(userIx[ev.responsible_user] || ev.responsible_name) || "—"}</div>
      </div>
    );
  };

  const renderDateCell = (value) => {
    const segments = calendarEventLayout.get(value.format("YYYY-MM-DD")) || [];
    if (!segments.length) return null;

    const segmentByLane = new Map(segments.map((segment) => [segment.lane, segment]));
    const visibleLaneCount = Math.min(
      MAX_CALENDAR_LANES,
      Math.max(...segments.map((segment) => segment.lane)) + 1
    );
    const hiddenCount = segments.filter((segment) => segment.lane >= MAX_CALENDAR_LANES).length;

    return (
      <div className="cal-bars">
        {Array.from({ length: visibleLaneCount }).map((_, lane) => {
          const segment = segmentByLane.get(lane);
          if (!segment) {
            return <div key={`spacer-${lane}`} className="cal-bar-spacer" aria-hidden="true" />;
          }

          const ev = segment.event;
          const activityStyle = ACTIVITY_EVENT_STYLES[ev.activity_type] || ACTIVITY_EVENT_STYLES.otro;
          const effectiveStatus = ev.status_effective || ev.status;
          const eventLabel = getPlanningEventLabel(ev, cropIx);
          return (
            <Popover
              key={`${getId(ev)}-${lane}`}
              content={renderEventPopover(ev)}
              trigger={isMobile ? [] : ["hover"]}
              mouseEnterDelay={0.25}
            >
              <div
                className={`cal-bar cal-bar--${segment.part} cal-bar--${effectiveStatus}`}
                style={{
                  backgroundColor: activityStyle.background,
                  borderColor: activityStyle.borderColor,
                  color: activityStyle.color,
                  "--cal-identity-alpha": getEventIdentityAlpha(getId(ev)),
                }}
                title={`${getPlanningDisplayName(ev, cropIx)} • ${formatPeriod(ev)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  openDetail(ev);
                }}
              >
                <span className="cal-bar__text">{segment.showLabel ? eventLabel : ""}</span>
              </div>
            </Popover>
          );
        })}
        {hiddenCount > 0 && (
          <Popover
            content={(
              <List
                size="small"
                className="cal-more-list"
                dataSource={eventsOn(value)}
                renderItem={(event) => (
                  <List.Item onClick={(e) => e.stopPropagation()}>
                    <Button type="link" size="small" onClick={() => openDetail(event)}>
                      {getPlanningEventLabel(event, cropIx)}
                    </Button>
                  </List.Item>
                )}
              />
            )}
            trigger="click"
            placement="bottom"
          >
            <button
              type="button"
              className="cal-more"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              +{hiddenCount} más
            </button>
          </Popover>
        )}
      </div>
    );
  };


  // ---------- fetchers ----------
  const fetchUsers = useCallback(async () => {
    // The assignment catalog requires planning.create/edit; read-only users use row metadata.
    if (!canCreate && !canEdit) { setUsers([]); return; }
    try {
      const { data } = await api.get("/users/planning-responsibles");
      setUsers(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch {
      setUsers([]);
      notification.error({ message: "No se pudieron cargar los responsables." });
    }
  }, [canCreate, canEdit]);
  const fetchLots = useCallback(async () => {
    try {
      const { data } = await api.get("/lots", { params: { includeActiveLayout: true } });
      setLots(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch { }
  }, []);
  const fetchCampaigns = useCallback(async () => {
    try {
      const { data } = await api.get("/campaigns", { params: { includeClosed: true } });
      setCampaigns(sortCampaigns(Array.isArray(data) ? data : data?.items || data?.data || [], "desc"));
    } catch {
      setCampaigns([]);
      notification.error({ message: "No se pudieron cargar las campañas." });
    }
  }, []);
  const fetchCrops = useCallback(async () => {
    try {
      const { data } = await api.get("/crops");
      setCrops(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch {
      setCrops([]);
      notification.error({ message: "No se pudieron cargar los cultivos." });
    }
  }, []);
  const fetchProducts = useCallback(async () => {
    try {
      const pageSize = 50;

      const { data: first } = await api.get("/products", {
        params: {
          page: 1,
          pageSize,
        },
      });

      // Compatibilidad con respuesta legacy sin paginación.
      if (Array.isArray(first)) {
        setInventoryEnabled(false);
        setProducts(first);
        return;
      }

      const firstItems =
        first?.items ||
        first?.data ||
        [];

      const total = Number(first?.total ?? firstItems.length);

      setInventoryEnabled(
        first?.inventory_v1_enabled === true
      );

      if (total <= firstItems.length) {
        setProducts(firstItems);
        return;
      }

      const totalPages = Math.ceil(total / pageSize);

      const remainingResponses = await Promise.all(
        Array.from(
          { length: totalPages - 1 },
          (_, index) =>
            api.get("/products", {
              params: {
                page: index + 2,
                pageSize,
              },
            })
        )
      );

      const remainingItems = remainingResponses.flatMap(
        ({ data }) =>
          Array.isArray(data)
            ? data
            : data?.items || data?.data || []
      );

      setProducts([
        ...firstItems,
        ...remainingItems,
      ]);
    } catch {
      setProducts([]);
    }
  }, []);
  const fetchVehicles = useCallback(async () => {
    try {
      const { data } = await api.get("/vehicles");
      setVehicles(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch { }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchLots();
    fetchCampaigns();
    fetchCrops();
    fetchProducts();
    fetchVehicles();
  }, [fetchUsers, fetchLots, fetchCampaigns, fetchCrops, fetchProducts, fetchVehicles]);

  // ---------- drawer handlers ----------
  const openDrawer = (row = null) => {
    if (row && !canEditPlanning(row, canEdit, canImportHistory)) {
      openDetail(row);
      return;
    }
    form.resetFields();
    setEditing(row);
    if (row) {
      form.setFieldsValue({
        title: row.title,
        recipe_id:row.recipe_id || MANUAL_RECIPE,
        selection_modes: Object.fromEntries((row.lots||[]).map(lot=>[planningLotToSelectionKey(lot),lot.selection_mode||(lot.sub_lot_id?'sub_lot':effectiveArea(lot)<Number(lot.area_ha)?'manual_portion':'full_lot')])),
        effective_areas: Object.fromEntries((row.lots || []).map(lot=>[planningLotToSelectionKey(lot),effectiveArea(lot)])),
        historical_lots: (row.lots || []).map(lot => ({ area_ha: lot.area_ha })),
        description: row.description,
        activity_type: row.activity_type,
        campaign_id: row.campaign_id,
        crop_id: row.crop_id,
        field_context: row.field_context,
        date_range: [getPlanningDayjs(row.start_at), getPlanningDayjs(row.end_at)],
        duration_mode: durationMode(row.start_at,row.end_at),
        responsible_user: row.responsible_user,
        vehicle_id: row.vehicle_id,
        lot_selection_keys: (row.lots || [])
          .map(planningLotToSelectionKey)
          .filter(Boolean),
        products: Array.isArray(row.products) ? row.products.map(p => ({
          planning_product_id: p.planning_product_id || p.id,
          actual_amount: p.actual_amount,
          product_id: p.product_id,
          amount: p.amount,
          unit: normalizeUnit(p.unit),
        })) : [],
        status: row.status || "planificado",
        register_completed: false,
        effective_date: row.effective_date ? parseCalendarDate(row.effective_date) : undefined,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        status: "planificado",
        duration_mode: "day",
        products: [],
        recipe_id:MANUAL_RECIPE,
        campaign_id: undefined,
        register_completed: false,
        effective_date: undefined,
      });
    }
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const openDetail = (row) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set("planningId", getId(row));
      return next;
    });
  };

  const closeDetail = () => {
    setIsDetailOpen(false);
    setViewing(null);
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete("planningId");
      return next;
    });
  };

  const handleSubmit = async (values) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      if (isEditingHistorical) {
        if (!canEditPlanning(editing, canEdit, canImportHistory)) {
          throw new Error("No tenés permiso para corregir antecedentes históricos.");
        }
        const historicalPayload = buildHistoricalPayload(editing, values);
        await api.patch(`/planning/${getId(editing)}`, historicalPayload);
        notification.success({ message: "Antecedente corregido" });
        fetchPlanning();
        closeDrawer();
        return;
      }
      const shouldRegisterCompleted = !editing && values.register_completed;
      const effectiveRecipeId=getRecipeId(values.recipe_id);

      const effectiveDate = values.effective_date;
      const [start, end] = shouldRegisterCompleted
        ? [effectiveDate, effectiveDate]
        : validatedDateRange(values.date_range,values.duration_mode || "day");

      // Build payload conditionally to avoid sending empty strings
      const lotSelections = (values.lot_selection_keys || []).map(key=>({
        ...parseSelectionKey(key),effective_area_ha:values.effective_areas?.[key],selection_mode:values.selection_modes?.[key],
      }));

      const payload = {
        activity_type: values.activity_type,
        campaign_id: values.campaign_id,
        crop_id: values.crop_id || null,
        field_context: hasFieldContext(values.activity_type) ? (values.field_context ?? null) : null,
        start_at: start?.format("YYYY-MM-DD[T]00:00:00.000[Z]"),
        end_at: end?.format("YYYY-MM-DD[T]00:00:00.000[Z]"),
        responsible_user: values.responsible_user,
        status: shouldRegisterCompleted ? undefined : values.status || "planificado",
        lot_selections: lotSelections,
      };
      // Preserve stored timestamps when this edit did not change calendar dates/campaign.
      if (editing && !planningCampaignDatesChanged(editing, values.campaign_id, [start, end])) {
        delete payload.start_at;
        delete payload.end_at;
      }
      if (payload.status === undefined) delete payload.status;
      if(shouldRegisterCompleted && effectiveRecipeId)payload.actual_products=registeredRecipeActualProducts(values.recipe_actual_products);

      if(!isEditingCompleted){
        if(effectiveRecipeId)payload.recipe_id=effectiveRecipeId;
        else if(editing?.recipe_id)payload.recipe_id=null;
      }
      // Only include optional fields if they have values
      if (values.description?.trim()) {
        payload.description = values.description.trim();
      }

      if (values.vehicle_id) {
        payload.vehicle_id = values.vehicle_id;
      }

      if (!effectiveRecipeId && !isEditingCompleted && values.products && values.products.length > 0) {
        payload.products = values.products.map(p => planningProductPayload(p,getCatalogProductById(p.product_id) || {unit:p.unit}));
      }

      if (shouldRegisterCompleted) {
        payload.effective_date = effectiveDate?.format("YYYY-MM-DD");
        payload.economic = executionEconomicPayload({...payload,lots:lotSelections},values,economicEditPermissions.every(p=>hasPermission(currentUser,p)));
      }

      if (isEditingCompleted) {
        const completedPayload = {
          responsible_user: values.responsible_user,
          description: values.description?.trim() || null,
        };
        if (values.title !== undefined) {
          completedPayload.title = values.title?.trim() || null;
        }
        await api.patch(`/planning/${getId(editing)}`, completedPayload);
        notification.success({ message: "Planificación actualizada" });
        fetchPlanning();
        closeDrawer();
        return;
      }


      if (editing && getId(editing)) {
        // actualizar; para status usamos PATCH (según colección)
        await api.patch(`/planning/${getId(editing)}`, payload);
        notification.success({ message: "Planificación actualizada" });
      } else if (shouldRegisterCompleted) {
        await api.post("/planning/register-completed", payload);
        notification.success({ message: "Actividad registrada correctamente." });
      } else {
        await api.post("/planning", payload);
        notification.success({ message: "Planificación creada" });
      }
      fetchPlanning();
      closeDrawer();
    } catch (e) {
      console.error("→ save planning error:", e);
      notification.error({
        message: getUserFriendlyError(e, "No se pudo guardar la planificación."),
      });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleCreateCrop = async (values) => {
    setSavingCrop(true);
    try {
      const { data } = await api.post("/crops", { name: values.name?.trim() });
      await fetchCrops();
      form.setFieldValue("crop_id", data?.id);
      cropForm.resetFields();
      setIsCropModalOpen(false);
      notification.success({ message: "Cultivo creado" });
    } catch (e) {
      notification.error({
        message: getUserFriendlyError(e, "No se pudo crear el cultivo."),
      });
    } finally {
      setSavingCrop(false);
    }
  };

  const handleCreateCampaign = async (values) => {
    setSavingCampaign(true);
    try {
      const payload = {
        name: values.name?.trim(),
        work_start_date: values.work_start_date ? values.work_start_date.format("YYYY-MM-DD") : null,
        start_date: values.start_date?.format("YYYY-MM-DD"),
        end_date: values.end_date ? values.end_date.format("YYYY-MM-DD") : null,
        work_end_date: values.work_end_date ? values.work_end_date.format("YYYY-MM-DD") : null,
      };
      if (import.meta.env.DEV) {
        console.log("[CAMPAIGN CREATE]", payload);
      }
      const { data } = await api.post("/campaigns", payload);
      await fetchCampaigns();
      form.setFieldValue("campaign_id", data?.id);
      campaignForm.resetFields();
      setIsCampaignModalOpen(false);
      notification.success({ message: "Campaña creada" });
    } catch (e) {
      notification.error({
        message: getUserFriendlyError(e, "No se pudo crear la campaña."),
      });
    } finally {
      setSavingCampaign(false);
    }
  };

  const openEditCampaignModal = (campaign) => {
    setEditingCampaign(campaign);
    editCampaignForm.setFieldsValue({
      name: campaign.name,
      work_start_date: campaign.work_start_date ? parseCalendarDate(campaign.work_start_date) : null,
      start_date: campaign.start_date ? parseCalendarDate(campaign.start_date) : null,
      end_date: campaign.end_date ? parseCalendarDate(campaign.end_date) : null,
      work_end_date: campaign.work_end_date ? parseCalendarDate(campaign.work_end_date) : null,
    });
    setIsEditCampaignModalOpen(true);
  };

  const closeEditCampaignModal = () => {
    setIsEditCampaignModalOpen(false);
    setEditingCampaign(null);
    editCampaignForm.resetFields();
  };

  const handleUpdateCampaign = async (values) => {
    if (!editingCampaign) return;

    setSavingCampaign(true);
    try {
      const payload = {
        name: values.name?.trim(),
        work_start_date: values.work_start_date ? values.work_start_date.format("YYYY-MM-DD") : null,
        start_date: values.start_date?.format("YYYY-MM-DD"),
        end_date: values.end_date ? values.end_date.format("YYYY-MM-DD") : null,
        work_end_date: values.work_end_date ? values.work_end_date.format("YYYY-MM-DD") : null,
      };

      const campaignId = editingCampaign.id ?? editingCampaign._id;
      await api.put(`/campaigns/${campaignId}`, payload);
      await fetchCampaigns();
      closeEditCampaignModal();
      notification.success({ message: "Campaña actualizada" });
    } catch (e) {
      notification.error({
        message: getUserFriendlyError(e, "No se pudo actualizar la campaña."),
      });
    } finally {
      setSavingCampaign(false);
    }
  };

  const handleDeleteCampaign = async (campaign) => {
    setSavingCampaign(true);
    try {
      const campaignId = campaign.id ?? campaign._id;
      await api.delete(`/campaigns/${campaignId}`);
      await fetchCampaigns();

      const currentCampaignId = form.getFieldValue("campaign_id");
      if (currentCampaignId === campaignId) {
        form.setFieldValue("campaign_id", undefined);
      }

      notification.success({ message: "Campaña eliminada" });
    } catch (e) {
      notification.error({
        message: getUserFriendlyError(
          e,
          "Esta campaña tiene información asociada y no puede eliminarse."
        ),
      });
    } finally {
      setSavingCampaign(false);
    }
  };

  const handleCloseCampaign = async (campaign) => {
    try {
      await api.post(`/campaigns/${campaign.id ?? campaign._id}/close`);
      await fetchCampaigns();
      notification.success({ message: "Campaña cerrada" });
    } catch (e) {
      notification.error({ message: getUserFriendlyError(e, "No se pudo cerrar la campaña.") });
    }
  };

  const handleCancel = async (row) => {
    if (statusActionLoading) return;

    const actionKey = `${getId(row)}:cancel`;
    try {
      setStatusActionLoading(actionKey);
      await api.delete(`/planning/${getId(row)}`); // soft delete -> status cancelado
      notification.success({ message: "Planificación cancelada" });
      fetchPlanning();
    } catch (e) {
      console.error("→ cancel planning error:", e);
      notification.error({ message: getUserFriendlyError(e, "No se pudo cancelar la planificación.") });
    } finally {
      setStatusActionLoading(null);
    }
  };

  const openCompleteSowingModal = (row) => {
    setSowingCompletion({ open: true, planning: row });
    sowingForm.setFieldsValue({
      effective_date: getEffectiveSowingDate(row),
      actual_products: buildActualProductFields(row),
    });
  };

  const closeCompleteSowingModal = () => {
    setSowingCompletion({ open: false, planning: null });
    sowingForm.resetFields();
  };

  const confirmCompleteSowing = async (values) => {
    const planning = sowingCompletion.planning;
    if (!planning) return;

    setCompletingSowing(true);
    try {
      const { data } = await api.post(`/planning/${getId(planning)}/complete-sowing`, {
        effective_date: values.effective_date.format("YYYY-MM-DD"),
        actual_products: buildActualProductsPayload(planning, values),
        economic: executionEconomicPayload(planning,values,economicEditPermissions.every(p=>hasPermission(currentUser,p))),
      });
      notification.success({
        message: data?.message || (
          data?.already_applied
            ? "Esta siembra ya fue registrada en el estado productivo."
            : "La siembra fue completada y el cultivo quedó registrado."
        ),
      });
      closeCompleteSowingModal();
      setDetailRevision(value => value + 1);
      closeCalendarSelection();
      fetchPlanning();
    } catch (e) {
      notification.error({
        message: executionError(e, "No se pudo completar la siembra."),
      });
    } finally {
      setCompletingSowing(false);
    }
  };

  const openCompleteWorkModal = (row) => {
    setWorkCompletion({ open: true, planning: row });
    completionForm.setFieldsValue({
      effective_date: getEffectiveWorkDate(row),
      actual_products: buildActualProductFields(row),
    });
  };

  const closeCompleteWorkModal = () => {
    setWorkCompletion({ open: false, planning: null });
    completionForm.resetFields();
  };

  const confirmCompleteWork = async (values) => {
    const planning = workCompletion.planning;
    if (!planning) return;

    setCompletingWork(true);
    try {
      const { data } = await api.post(`/planning/${getId(planning)}/${completionEndpoint(planning.activity_type)}`, {
        effective_date: values.effective_date.format("YYYY-MM-DD"),
        ...(completionEndpoint(planning.activity_type) === 'complete-work' ? { actual_products: buildActualProductsPayload(planning, values) } : {}),
        economic: executionEconomicPayload(planning,values,economicEditPermissions.every(p=>hasPermission(currentUser,p))),
      });
      notification.success({
        message: data?.message || "El trabajo fue completado y los productos utilizados quedaron registrados.",
      });
      closeCompleteWorkModal();
      setDetailRevision(value => value + 1);
      closeCalendarSelection();
      fetchPlanning();
    } catch (e) {
      notification.error({
        message: executionError(e, "No se pudo completar la planificación."),
      });
    } finally {
      setCompletingWork(false);
    }
  };

  const updateStatus = async (row, status) => {
    if (statusActionLoading || isHistoricalPlanning(row)) return;

    if (!canExecutePlanning(row, executionCapabilities)) return;
    if (status === "completado") {
      if (!completionEndpoint(row?.activity_type)) return;
      if (completionEndpoint(row?.activity_type) === 'complete-sowing') {
        openCompleteSowingModal(row);
        return;
      }
      openCompleteWorkModal(row);
      return;
    }

    const actionKey = `${getId(row)}:${status}`;
    try {
      setStatusActionLoading(actionKey);
      if (status === 'en_progreso') await api.post(`/planning/${getId(row)}/start`, {});
      else if (canEdit) await api.patch(`/planning/${getId(row)}`, { status });
      else return;
      setDetailRevision(value => value + 1);
      fetchPlanning();
    } catch (e) {
      notification.error({ message: executionError(e, "No se pudo actualizar el estado.") });
    } finally {
      setStatusActionLoading(null);
    }
  };

  const closeCalendarSelection = () => {
    setCalendarSelection(null);
  };

  const getStatusTransitionActions = (item) => {
    const status = item?.status;
    if (isHistoricalPlanning(item) || item?.enabled === false || item?.status === 'cancelado') return [];
    if (!canEdit) { const action = primaryExecutionAction(item, executionCapabilities); return action ? [action] : []; }

    if (status === "planificado" || status === "pendiente") {
      return [
        { key: "progress", label: "Iniciar trabajo", ctaLabel: "Iniciar", status: "en_progreso" },
        { key: "done", label: "Completar trabajo", ctaLabel: "Completar", status: "completado" },
      ];
    }

    if (status === "en_progreso") {
      return [
        { key: "done", label: "Completar trabajo", ctaLabel: "Completar", status: "completado" },
        { key: "pending", label: "Volver a pendiente", status: "pendiente" },
      ];
    }

    if (status === "completado") {
      return [
        { key: "reopen", label: "Reabrir planificación", status: "pendiente" },
      ];
    }

    return [];
  };

  const getPrimaryStatusAction = item => primaryExecutionAction(item, executionCapabilities);

  const getMonthlyMenuItems = (item, secondaryActions) => [
    ...getAdoptionActions(item),
    ...secondaryActions.map((action) => ({
      key: action.key,
      label: action.label,
      onClick: () => {
        closeCalendarSelection();
        updateStatus(item, action.status);
      },
    })),
    !isHistoricalPlanning(item) && canEdit && canDisable && item?.status !== "completado" && item?.status !== "cancelado"
      ? {
          key: "cancel",
          danger: true,
          label: "Cancelar",
          onClick: () => {
            Modal.confirm({
              title: "¿Cancelar planificación?",
              content: "Esta acción no elimina el registro, lo marca como cancelado.",
              okText: "Sí",
              cancelText: "No",
              onOk: () => {
                closeCalendarSelection();
                return handleCancel(item);
              },
            });
          },
        }
      : null,
  ].filter(Boolean);

  const renderCalendarSummaryCard = (item) => {
    const effectiveStatus = item.status_effective || item.status;
    const lotSummary = summarizePlanningLotsShort(item.lots || []);
    const locationText = lotSummary.text !== "—"
      ? `${lotSummary.text} · ${formatHa(getPlanningArea(item))}`
      : null;
    const transitionActions = getStatusTransitionActions(item);
    const primaryTransition = getPrimaryStatusAction(item);
    const secondaryTransitions = transitionActions.filter(action => action.key !== primaryTransition?.key);
    const menuItems = getMonthlyMenuItems(item, secondaryTransitions);
    const activityStyle = ACTIVITY_EVENT_STYLES[item.activity_type] || ACTIVITY_EVENT_STYLES.otro;

    return (
      <Card
        key={getId(item)}
        size="small"
        className={`planning-month-card planning-month-card--${effectiveStatus}`}
        styles={{ body: { padding: isMobile ? 12 : 14 } }}
        style={{ borderLeftColor: activityStyle.borderColor }}
      >
        <div className="planning-month-card__header">
          <div className="planning-month-card__title">
            {getCropDisplayName(item, cropIx)} · {formatActivity(item.activity_type)}
          </div>
          <Tag color={STATUS_COLORS[effectiveStatus] || "default"} style={{ marginInlineEnd: 0 }}>
            {statusLabel(effectiveStatus)}
          </Tag>
        </div>

        <div className="planning-month-card__period">{formatPeriod(item)}</div>

        <div className="planning-month-card__meta">
          {locationText && (
            <Tooltip title={lotSummary.tooltip || locationText} placement="topLeft">
              <span className="planning-month-card__line">{locationText}</span>
            </Tooltip>
          )}
          {item.campaign_name && (
            <span className="planning-month-card__line">Campaña {item.campaign_name}</span>
          )}
          {(userIx[item.responsible_user] || item.responsible_name) && (
            <span className="planning-month-card__line planning-month-card__responsible">
              <UserOutlined /> {(userIx[item.responsible_user] || item.responsible_name)}
            </span>
          )}
        </div>

        <div className="planning-month-card__actions">
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => {
              closeCalendarSelection();
              openDetail(item);
            }}
          >
            Ver
          </Button>

          {primaryTransition && !isMobile && (
            <Button
              size="small"
              onClick={() => {
                closeCalendarSelection();
                updateStatus(item, primaryTransition.status);
              }}
              loading={statusActionLoading === `${getId(item)}:${primaryTransition.status}`}
              disabled={Boolean(statusActionLoading)}
            >
              {primaryTransition.ctaLabel || primaryTransition.label}
            </Button>
          )}

          {menuItems.length > 0 && (
            <Dropdown menu={{ items: isMobile && primaryTransition
              ? getMonthlyMenuItems(item, transitionActions)
              : menuItems
            }} trigger={["click"]} placement="bottomRight">
              <Button size="small" icon={<MoreOutlined />} aria-label="Más acciones" />
            </Dropdown>
          )}
        </div>
      </Card>
    );
  };

  const handleFilterChange = (key, val) => setSearchParams(previous => updatePlanningFilters(previous, key, val));
  const clearFilters = () => setSearchParams(previous => clearPlanningFilters(previous));

  const disabledMenu = [
    (canCreate || canEdit) && { key: "campaigns", label: <span onClick={() => setIsCampaignModalOpen(true)}>Campañas</span> },
    canViewDisabled && { key: "1", label: <span onClick={() => navigate("/planificaciones-deshabilitadas")}>Ver canceladas</span> }
  ].filter(Boolean);

  const moreFiltersContent = (
    <Space direction="vertical" style={{ width: 280, maxWidth: 'calc(100vw - 48px)' }} size="middle">
      <Select
        style={{ width: "100%" }}
        placeholder="Todas las campañas"
        allowClear
        value={filters.campaignId}
        onChange={(v) => handleFilterChange("campaignId", v)}
        options={campaignOptions.filter(option => option.value !== ADD_CROP_VALUE)}
      />
      <Select
        style={{ width: "100%" }}
        placeholder="Todos los responsables"
        allowClear
        value={filters.responsible}
        onChange={(v) => handleFilterChange("responsible", v)}
        options={responsibleOptions} optionRender={renderUserOption}
        notFoundContent="No hay usuarios disponibles para asignar como responsables."
      />
      <Select
        style={{ width: "100%" }}
        placeholder="Todos los lotes y sublotes"
        allowClear
        value={filters.lotSelectionKey}
        onChange={(v) => handleFilterChange("lotSelectionKey", v)}
        options={lotFilterOptions}
        optionFilterProp="label"
      />
      <RangePicker
        format="DD/MM/YYYY"
        style={{ width: "100%" }}
        value={filters.dateRange}
        onChange={(range) => handleFilterChange("dateRange", range)}
      />
    </Space>
  );

  // ---------- UI ----------
  return (
    <div ref={containerRef} className="gs-planning">
      <Row justify="space-between" align="middle" className="gs-planning-header">
        <Col><h2>Planificaciones</h2></Col>
        <Col className="gs-planning-actions">
          <Space wrap>
            <Segmented
              size="middle"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { label: "Tabla", value: "table" },
                { label: "Calendario", value: "calendar" },
              ]}
            />
            {isMobile ? (
              disabledMenu.length > 0 ? (
                <Dropdown menu={{ items: disabledMenu }} placement="bottomRight" arrow>
                  <MoreOutlined style={{ fontSize: 24, cursor: "pointer" }} />
                </Dropdown>
              ) : null
            ) : (
              <Space wrap>
                {canViewDisabled && <Button onClick={() => navigate("/planificaciones-deshabilitadas")}>Ver canceladas</Button>}
                {(canCreate || canEdit) && <Button onClick={() => setIsCampaignModalOpen(true)}>Campañas</Button>}
                {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer()}>
                  Nueva Planificación
                </Button>}
              </Space>
            )}
          </Space>
        </Col>
      </Row>

      {/* Filtros adaptables al espacio disponible */}
      {viewMode === "table" && (
        <div className="gs-planning-filters">
          {canView && <Button icon={<UserOutlined />} type={filters.mine ? 'primary' : 'default'} aria-pressed={filters.mine} onClick={() => handleFilterChange('mine', !filters.mine)}>Mis tareas</Button>}
          <div className="gs-planning-filter" style={{ '--planning-filter-width': '180px' }}>
            <Select
              style={{ width: "100%" }}
              placeholder="Todos los cultivos"
              allowClear
              value={filters.cropId}
              onChange={(v) => handleFilterChange("cropId", v)}
              options={crops.map(crop => ({ value: crop.id ?? crop._id, label: crop.name }))}
              notFoundContent="No hay cultivos disponibles."
            />
          </div>
          <div className="gs-planning-filter" style={{ '--planning-filter-width': '190px' }}>
            <Select
              style={{ width: "100%" }}
              placeholder="Todas las actividades"
              allowClear
              value={filters.type}
              onChange={(v) => handleFilterChange("type", v)}
              options={ACTIVITY_OPTIONS}
            />
          </div>
          <div className="gs-planning-filter" style={{ '--planning-filter-width': '170px' }}>
            <Select
              style={{ width: "100%" }}
              placeholder="Todos los estados"
              allowClear
              value={filters.status}
              onChange={(v) => handleFilterChange("status", v)}
              options={[
                { value: "planificado", label: "Planificado" },
                { value: "pendiente", label: "Pendiente" },
                { value: "en_progreso", label: "En progreso" },
                { value: "completado", label: "Completado" },
                { value: "cancelado", label: "Cancelado" },
                { value: "en_demora", label: "En demora" },
              ]}
            />
          </div>
          <div>
            <Popover content={moreFiltersContent} trigger="click" placement="bottomLeft">
              <Button>
                Más filtros{activeExtraFilterCount ? ` (${activeExtraFilterCount})` : ""}
              </Button>
            </Popover>
          </div>
          {hasActiveFilters && (
            <div>
              <Button type="link" onClick={clearFilters}>Limpiar filtros</Button>
            </div>
          )}
        </div>
      )}

      <div aria-busy={loading} className="gs-planning-results">
      <Spin spinning={loading}>
      {/* Tabla cuando caben sus columnas completas */}
      {viewMode === "table" && !useCompactPlanningList && (
        <PlanningTable
          list={list}
          loading={false}
          pagination={false}
          onEdit={openDrawer}
          onView={openDetail}
          onUpdateStatus={updateStatus}
          onCancel={handleCancel}
          rowKey={rowKey}
          userIx={userIx}
          cropIx={cropIx}
          statusTag={statusTag}
          statusActionLoading={statusActionLoading}
          getPrimaryStatusAction={getPrimaryStatusAction}
          getAdoptionActions={getAdoptionActions}
        />
      )}

      {/* Vista CALENDARIO (desktop y mobile) */}
      {viewMode === "calendar" && (
        <div className="gs-planning-calendar">
          <AntCalendar
            fullscreen={!isMobile}
            cellRender={(current, info) => (
              info.type === "date" ? renderDateCell(current) : info.originNode
            )}
            onSelect={(date, info) => {
              const source = info?.source;
              setCalendarSelection({
                type: source === "month" ? "month" : "day",
                date,
              });
            }}
          />
        </div>
      )}

      {/* Cards en espacios compactos, incluidos tablet y escritorio angosto */}
      {useCompactPlanningList && viewMode === "table" && (
        <PlanningListMobile
          list={list}
          onEdit={openDrawer}
          onView={openDetail}
          onUpdateStatus={updateStatus}
          onCancel={handleCancel}
          rowKey={rowKey}
          userIx={userIx}
          cropIx={cropIx}
          statusTag={statusTag}
          statusActionLoading={statusActionLoading}
          getPrimaryStatusAction={getPrimaryStatusAction}
          getAdoptionActions={getAdoptionActions}
        />
      )}

      </Spin>
      {viewMode === 'table' && canView && (
        <Pagination
          className="gs-planning-pagination"
          current={page}
          pageSize={pageSize}
          total={total}
          showSizeChanger
          pageSizeOptions={[8, 16, 24, 48]}
          showLessItems
          size={isMobile ? 'small' : 'default'}
          showTotal={count => `${count} planificaciones`}
          onChange={(nextPage, nextSize) => changePage(nextSize === pageSize ? nextPage : 1, nextSize)}
        />
      )}
      </div>

      {adopting && <AdoptExistingModal key={adopting.id} planning={adopting} onClose={()=>setAdopting(null)}
        onAdopted={async()=>{await fetchPlanning();closeDetail();notification.success({message:'La planificación quedó marcada como registro histórico. Las existencias no se modificaron.'});}} />}
      {/* Modal crear/editar; detalle y ejecución conservan sus contenedores. */}
      <Modal className="planning-form-modal" title={isEditingHistorical?"Corrección de antecedente":editing?"Editar Planificación":registerCompleted?"Registrar actividad":"Nueva Planificación"}
        width={1320} open={isDrawerOpen} onCancel={()=>!isSubmitting&&closeDrawer()} destroyOnHidden maskClosable={!isSubmitting}
        footer={<><Button onClick={closeDrawer} disabled={isSubmitting}>Cancelar</Button><Button type="primary" className="planning-form-submit" onClick={()=>form.submit()}
          loading={isSubmitting} disabled={isSubmitting||productStockExceeded||(!isEditingHistorical&&!selectedActivityType)}>
          {isEditingHistorical?"Guardar corrección":editing?"Actualizar":registerCompleted?"Registrar actividad":"Crear Planificación"}
        </Button></>}>
        <Form layout="vertical" form={form} onFinish={handleSubmit}>
          {isEditingHistorical ? <HistoricalPlanningFields editing={editing} responsibleOptions={responsibleOptions}
            onProductAdded={product=>{
              if(!(editing.products || []).some(p=>p.product_id===product.product_id)) {
                form.setFieldsValue({products:[...(form.getFieldValue('products') || []),product]});
                setEditing({...editing,products:[...(editing.products || []),product]});
              }
              fetchPlanning();
              notification.success({message:'Producto agregado al registro histórico'});
            }} /> : <>
<PlanningFormSection title="Trabajo" description="Actividad y fecha de realización." icon={CalendarOutlined}>          <Form.Item name="activity_type" label={<strong style={{fontSize:16}}>Actividad</strong>} rules={isEditingCompleted ? [] : [{ required: true, message: "Seleccioná la actividad" }]}>
            <Select disabled={isEditingCompleted} options={ACTIVITY_OPTIONS} onChange={activity=>form.setFieldsValue(activityChangeFields(activity))} placeholder="Seleccioná la actividad" />
          </Form.Item>

          {selectedActivityType && <>
          {!editing && <Form.Item name="register_completed" label="¿La actividad ya se realizó?"
            extra={registerCompleted ? 'Registrá un trabajo que ya fue realizado.' : 'La actividad se realizará próximamente.'}>
            <PlanningRegistrationType onChange={completed=>{
              form.setFieldsValue(registrationModeFields(completed));
              form.setFields([{name:'date_range',errors:[]},{name:'effective_date',errors:[]}]);
            }} />
          </Form.Item>}
          {(!registerCompleted || editing) && <PlanningDateFields form={form} disabled={isEditingCompleted} />}

          {!editing && registerCompleted && (
            <Form.Item
              name="effective_date"
              label="Fecha de realización"
              extra="Indicá la fecha en la que el trabajo se realizó efectivamente."
              rules={[{ required: true, message: "Seleccioná la fecha de realización." }]}
            >
              <DatePicker
                format="DD/MM/YYYY"
                style={{ width: "100%" }}
              />
            </Form.Item>
          )}

          </>}
</PlanningFormSection>
          {selectedActivityType && <>
<PlanningFormSection title="Contexto productivo" description="Campaña y cultivo que recibe el trabajo." icon={Leaf}>          <Form.Item
            name="campaign_id"
            label="Campaña"
            rules={isEditingCompleted ? [] : [
              { required: true, message: "Seleccioná una campaña." },
              {
                validator: () => (
                  campaignDateMismatch && mustValidateCampaignDates
                    ? Promise.reject(new Error(campaignWindowWarning(selectedCampaign)))
                    : Promise.resolve()
                ),
              },
            ]}
            extra={(
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4, lineHeight: 1.35 }}>
                {selectedCampaign && (
                  <div style={{ color: "#6b7280" }}>
                    {formatCampaignOptionMeta(selectedCampaign)}
                  </div>
                )}
                {selectedCampaign?.status === "closed" && (
                  <div style={{ color: "#8c6d1f" }}>
                    Esta campaña está cerrada. Estás cargando información histórica.
                  </div>
                )}
                {campaignDateMismatch && (
                  <div style={{ color: "#cf1322" }}>
                    {campaignWindowWarning(selectedCampaign)}
                  </div>
                )}
                {!campaignDateMismatch && selectedPlanningStartsBeforeCampaign && (
                  <div style={{ color: "#595959" }}>
                    {registerCompleted
                      ? "Este trabajo se realizó antes del inicio de la campaña y quedará asociado a ella."
                      : "Este trabajo se realizará antes del inicio de la campaña y quedará asociado a ella."}
                  </div>
                )}
                {!campaignDateMismatch && campaignCompatibilityRange?.[0] && campaignCompatibilityRange?.[1] && compatibleCampaignCount === 0 && (
                  <div style={{ color: "#595959" }}>
                    No hay campañas que admitan trabajos en las fechas indicadas.
                  </div>
                )}
                {!campaignDateMismatch && compatibleCampaignCount > 1 && !selectedCampaignId && (
                  <div style={{ color: "#595959" }}>
                    Hay varias campañas compatibles con la fecha. Seleccioná la que corresponde.
                  </div>
                )}
              </div>
            )}
          >
            <Select
              disabled={isEditingCompleted}
              placeholder="Seleccioná una campaña"
              options={planningCampaignOptions}
              optionFilterProp="searchLabel"
              optionRender={(option) => (
                option.data?.campaign
                  ? renderCampaignDropdownOption(option.data.campaign, option.data.suffix)
                  : option.data?.label
              )}
              notFoundContent="No hay campañas compatibles."
            />
          </Form.Item>          {hasFieldContext(selectedActivityType) && <Form.Item name="field_context" label="Situación del lote"
            rules={(!editing || editing.field_context != null || selectedActivityType !== editing.activity_type) ? [{required:true,message:'Seleccioná la situación del lote.'}] : []}>
            <Select disabled={isEditingCompleted} allowClear={Boolean(editing && editing.field_context == null)}
              placeholder={editing ? 'Sin especificar' : 'Seleccioná la situación del lote'} options={FIELD_CONTEXT_OPTIONS} />
          </Form.Item>}
          <Form.Item
            name="crop_id"
            label="Cultivo beneficiario"
            tooltip="Se aplicará a todos los lotes seleccionados. Si una actividad beneficia cultivos distintos por lote, podrás indicarlo por destino."
            required={!isEditingCompleted && cropRequired(selectedActivityType, hasFieldContext(selectedActivityType) ? selectedFieldContext : null)}
            rules={isEditingCompleted ? [] : [
              {
                validator: (_, value) => {
                  if (cropRequired(selectedActivityType, hasFieldContext(selectedActivityType) ? selectedFieldContext : null) && !value) {
                    return Promise.reject(new Error("Seleccioná un cultivo."));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Select
              allowClear
              disabled={isEditingCompleted}
              placeholder="Seleccioná un cultivo"
              options={cropOptions}
              onChange={(value) => {
                if (value === ADD_CROP_VALUE) {
                  form.setFieldValue("crop_id", undefined);
                  cropForm.resetFields();
                  setIsCropModalOpen(true);
                }
              }}
            />
          </Form.Item>          {!editing && registerCompleted && <ExecutionEconomicFields
            showLabor={false} compact planning={{field_context:selectedFieldContext,crop_id:selectedFormCropId,campaign_name:selectedCampaign?.name,
              lots:selectedAreaRows.map(row=>({...parseSelectionKey(row.key),name:row.name}))}}
            crops={crops} user={currentUser} form={form}/>}</PlanningFormSection>
          <PlanningLocationSection
            lotSelectionOptions={lotSelectionOptions}
            selectedAreaRows={selectedAreaRows}
            selectedActivityType={selectedActivityType}
            selectedPlanningArea={selectedPlanningArea}
            isEditingCompleted={isEditingCompleted}
          />
<PlanningFormSection title="Recursos" description="Asigná responsable, vehículo y receta." icon={UserOutlined}><div className="planning-form-resource-grid">          <Form.Item name="responsible_user" label="Responsable" rules={[{ required: true, message: "Seleccioná un responsable" }]}>
            <Select
              allowClear
              placeholder="Seleccioná un usuario"
              options={responsibleOptions} optionRender={renderUserOption}
              notFoundContent="No hay usuarios disponibles para asignar como responsables."
            />
          </Form.Item>

          <Form.Item name="vehicle_id" label="Vehículo">
            <Select
              allowClear
              disabled={isEditingCompleted}
              placeholder="Seleccioná un vehículo"
              options={vehicles
                .filter(v => v.status === 'activo')
                .map(v => ({ value: v.id ?? v._id, label: vehIx[v.id ?? v._id] }))}
            />
          </Form.Item>

          {(['fumigacion','fertilizacion','siembra'].includes(selectedActivityType) || selectedRecipeId) && <PlanningRecipeFields
            productsContainer={recipeProductContainer} form={form} activity={selectedActivityType} context={hasFieldContext(selectedActivityType)?selectedFieldContext:null} crop={selectedFormCropId}
            editing={editing} completed={isEditingCompleted} registerCompleted={registerCompleted}
            selections={selectedAreaRows.map(row=>({...row,effective_area_ha:
              !isEditingCompleted && !partialAreaAllowed(selectedActivityType)?row.area_ha:(effectiveAreas[row.key] ?? row.effective_area_ha)
            }))} />}
</div></PlanningFormSection>
<PlanningFormSection title="Productos" description="Dosis y cantidades para la superficie seleccionada." icon={Package} wide><div ref={setRecipeProductContainer}/>{!selectedRecipeId&&<PlanningFormProducts form={form} products={products} area={selectedPlanningArea.toFixed(4)} completed={isEditingCompleted} performed={!editing&&registerCompleted}/>} </PlanningFormSection>
<PlanningFormSection title="Costo de la labor" description="La valorización pendiente puede completarse después." icon={DollarOutlined}>          {!editing && registerCompleted && <ExecutionEconomicFields
            showTargets={false} compact planning={{field_context:selectedFieldContext,crop_id:selectedFormCropId,campaign_name:selectedCampaign?.name,
              lots:selectedAreaRows.map(row=>({...parseSelectionKey(row.key),name:row.name}))}}
            crops={crops} user={currentUser} form={form}/>}{(editing||!registerCompleted)&&<p>El costo real se registra al completar el trabajo.</p>}</PlanningFormSection>
<PlanningFormSection title="Observaciones" description="Detalles adicionales del trabajo." icon={FileTextOutlined}><Form.Item name="description" label="Observaciones"><Input.TextArea placeholder="Agregá observaciones o detalles adicionales..." rows={3}/></Form.Item>          {(!registerCompleted || editing) && (
            <Form.Item name="status" label="Estado">
              <Select
                disabled={isEditingCompleted}
                options={[
                  { value: "planificado", label: "Planificado" },
                  { value: "pendiente", label: "Pendiente" },
                  { value: "en_progreso", label: "En progreso" },
                  { value: "completado", label: "Completado" },
                ]}
                placeholder="Estado"
              />
            </Form.Item>
          )}</PlanningFormSection>
          </>}</>}
        </Form>
      </Modal>

      {/* Drawer Detalle (Read-only) */}
      <Drawer
        className="planning-detail-drawer"
        title="Detalle de Planificación"
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDetail}
        open={isDetailOpen}
        height={isMobile ? "85vh" : undefined}
        width={isMobile ? "100%" : 500}
        destroyOnHidden
      >
        {detailLoading && <p role="status">Cargando planificación…</p>}
        {detailError && <Alert type="warning" showIcon message={detailError} />}
        {viewing && (
          <Space direction="vertical" style={{ width: "100%" }} size="large">
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Planificación">
                <strong>{getPlanningDisplayName(viewing, cropIx)}</strong>
                {viewing.inventory_impact_mode === "HISTORICAL_NO_STOCK" && <p>Histórico · Sin impacto en inventario. Los productos y cantidades son informativos y no modificaron el stock.</p>}
              </Descriptions.Item>
              {viewing.recipe_id && <Descriptions.Item label="Receta">{viewing.recipe_name_snapshot}</Descriptions.Item>}
              <Descriptions.Item label="Cultivo">{getCropDisplayName(viewing, cropIx)}</Descriptions.Item>
              {getPlanningContextLabel(viewing) && <Descriptions.Item label="Situación del lote">{getPlanningContextLabel(viewing)}</Descriptions.Item>}
              <Descriptions.Item label="Estado">{statusTag(viewing.status_effective || viewing.status)}</Descriptions.Item>
              <Descriptions.Item label="Campaña">
                {campaignLabel(viewing)}
              </Descriptions.Item>
              {viewing.title && !viewing.crop_id && !viewing.crop_name && (
                <Descriptions.Item label="Título histórico">{viewing.title}</Descriptions.Item>
              )}
              <Descriptions.Item label={durationMode(viewing.start_at,viewing.end_at) === "day" ? "Fecha" : "Período"}>
                {formatPeriod(viewing)}
              </Descriptions.Item>
              {viewing.registered_retroactively === true && (
                <Descriptions.Item label="Registro">
                  <Space direction="vertical" size={2}>
                    <span>Registrada posteriormente</span>
                    {viewing.effective_date && (
                      <span style={{ color: "#595959" }}>Realizada el {formatDate(viewing.effective_date)}</span>
                    )}
                  </Space>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Responsable">
                {(userIx[viewing.responsible_user] || viewing.responsible_name) || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Asignado por">{viewing.assigned_by_name || "No documentado"}</Descriptions.Item>
              <Descriptions.Item label="Asignado">{viewing.assigned_at && dayjs(viewing.assigned_at).isValid() ? dayjs(viewing.assigned_at).format("DD/MM/YYYY · HH:mm") : "No documentado"}</Descriptions.Item>
              <Descriptions.Item label="Vehículo">
                {vehIx[viewing.vehicle_id] || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Superficie total">
                {formatHa(getPlanningArea(viewing))}
              </Descriptions.Item>
              <Descriptions.Item label="Descripción">
                {viewing.description || "—"}
              </Descriptions.Item>
            </Descriptions>

            {getPrimaryStatusAction(viewing) && (
              <Button
                type="primary"
                loading={statusActionLoading === `${getId(viewing)}:${getPrimaryStatusAction(viewing).status}`}
                disabled={Boolean(statusActionLoading)}
                onClick={() => updateStatus(viewing, getPrimaryStatusAction(viewing).status)}
              >
                {getPrimaryStatusAction(viewing).label}
              </Button>
            )}

            <div>
              <h4>Ubicación</h4>
              <List
                size="small"
                bordered
                dataSource={viewing.lots || []}
                renderItem={item => (
                  <List.Item>
                    <strong>{getPlanningLotName(item)}</strong>
                    {item.area_ha ? <span style={{ marginLeft: 8, color: "#595959" }}>{selectionAreaLabel(item)}</span> : null}
                  </List.Item>
                )}
                locale={{ emptyText: "Sin lotes asignados" }}
              />
              <div style={{ marginTop: 12 }}>
                <LotMapPreview selections={viewing.lots || []} allLots={lots} />
              </div>
            </div>
            <div>
              <h4>Productos</h4>
              <List
                size="small"
                bordered
                dataSource={viewing.products || []}
                renderItem={(product) => {
                  const details = product.dose_amount!=null ? doseLabel(product.dose_amount,product.dose_unit)+' · Total: '+totalLabel(product.amount,product.unit) : quantityLabel(product.amount,product.unit);
                  return (
                    <List.Item>
                      {product.name || prodIx[product.product_id] || "Producto"}
                      {details ? ` — ${details}` : ""}
                    </List.Item>
                  );
                }}
                locale={{ emptyText: "Sin productos asignados" }}
              />
            </div>
            {isDetailOpen && <PlanningCostEstimate planning={viewing} user={currentUser}/>}
            {isDetailOpen && <PlanningActualCost planning={viewing} user={currentUser}/>}
          </Space>
        )}
      </Drawer>

      <Drawer
        className="planning-calendar-drawer"
        title={calendarDrawerTitle}
        open={!!calendarSelection}
        onClose={closeCalendarSelection}
        width={isMobile ? "100%" : 520}
        placement={isMobile ? "bottom" : "right"}
        height={isMobile ? "80vh" : undefined}
        destroyOnHidden
      >
        {selectedCalendarGroups.length ? (
          <div className="planning-month-list">
            {selectedCalendarGroups.map((group) => (
              <section key={group.key} className="planning-month-group">
                <div className="planning-month-group__title">{group.title}</div>
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  {group.items.map(renderCalendarSummaryCard)}
                </Space>
              </section>
            ))}
          </div>
        ) : (
          <div className="planning-month-empty">{calendarEmptyText}</div>
        )}
      </Drawer>

      <Modal
        title="Completar siembra"
        open={sowingCompletion.open}
        onCancel={closeCompleteSowingModal}
        onOk={() => sowingForm.submit()}
        okText="Confirmar siembra"
        cancelText="Cancelar"
        confirmLoading={completingSowing}
        destroyOnHidden
      >
        {sowingCompletion.planning && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              message="Al confirmar, GrowSync registrará este cultivo como estado productivo de las superficies seleccionadas."
            />

            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Cultivo">
                {getCropDisplayName(sowingCompletion.planning, cropIx)}
              </Descriptions.Item>
              <Descriptions.Item label="Campaña">
                {campaignLabel(sowingCompletion.planning)}
              </Descriptions.Item>
              <Descriptions.Item label="Superficie total">
                {formatHa(getPlanningArea(sowingCompletion.planning))}
              </Descriptions.Item>
            </Descriptions>

            <div>
              <strong>Ubicación</strong>
              <List
                size="small"
                dataSource={sowingCompletion.planning.lots || []}
                renderItem={(item) => (
                  <List.Item>
                    {getPlanningLotName(item)}
                    {item.area_ha ? <span style={{ marginLeft: 8, color: "#595959" }}>{selectionAreaLabel(item)}</span> : null}
                  </List.Item>
                )}
                locale={{ emptyText: "Sin lotes asignados" }}
              />
            </div>

            <Form form={sowingForm} layout="vertical" onFinish={confirmCompleteSowing}>
              <Form.Item
                name="effective_date"
                label="Fecha efectiva de siembra"
                rules={[
                  { required: true, message: "Seleccioná la fecha efectiva de siembra." },
                  {
                    validator: (_, value) => {
                      const campaign = campaigns.find((item) => (item.id ?? item._id) === sowingCompletion.planning?.campaign_id);
                      const dateKey = value?.format("YYYY-MM-DD");
                      if (!dateKey || !campaign) return Promise.resolve();
                      return campaignContainsWorkDate(campaign, dayjs(dateKey))
                        ? Promise.resolve()
                        : Promise.reject(new Error("La fecha efectiva de siembra debe estar dentro de la ventana operativa de la campaña."));
                    },
                  },
                ]}
              >
                <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
              </Form.Item>

              <Form.Item label="Productos utilizados" style={{ marginBottom: 0 }}>
                {renderActualProductsForm(sowingCompletion.planning)}
              </Form.Item>
              <ExecutionEconomicFields planning={sowingCompletion.planning} crops={crops} user={currentUser} form={sowingForm}/>
            </Form>
          </Space>
        )}
      </Modal>

      <Modal
        title={`Completar ${formatActivity(workCompletion.planning?.activity_type || "")}`}
        open={workCompletion.open}
        onCancel={closeCompleteWorkModal}
        onOk={() => completionForm.submit()}
        okText="Confirmar trabajo"
        cancelText="Cancelar"
        confirmLoading={completingWork}
        destroyOnHidden
      >
        {workCompletion.planning && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              message={completionEndpoint(workCompletion.planning?.activity_type) === 'complete-activity' ? 'Confirmá la fecha real de la tarea. Esta acción no registra consumos, cultivos ni cosechas.' : 'Confirmá la fecha real del trabajo y las cantidades efectivamente utilizadas.'}
            />

            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Planificación">
                {getPlanningDisplayName(workCompletion.planning, cropIx)}
              </Descriptions.Item>
              <Descriptions.Item label="Campaña">
                {campaignLabel(workCompletion.planning)}
              </Descriptions.Item>
              <Descriptions.Item label="Superficie total">
                {formatHa(getPlanningArea(workCompletion.planning))}
              </Descriptions.Item>
            </Descriptions>

            <div>
              <strong>Ubicación</strong>
              <List
                size="small"
                dataSource={workCompletion.planning.lots || []}
                renderItem={(item) => (
                  <List.Item>
                    {getPlanningLotName(item)}
                    {item.area_ha ? <span style={{ marginLeft: 8, color: "#595959" }}>{selectionAreaLabel(item)}</span> : null}
                  </List.Item>
                )}
                locale={{ emptyText: "Sin lotes asignados" }}
              />
            </div>

            <Form form={completionForm} layout="vertical" onFinish={confirmCompleteWork}>
              <Form.Item
                name="effective_date"
                label="Fecha efectiva del trabajo"
                rules={[
                  { required: true, message: "Seleccioná la fecha efectiva del trabajo." },
                  {
                    validator: (_, value) => {
                      const campaign = campaigns.find((item) => (item.id ?? item._id) === workCompletion.planning?.campaign_id);
                      const dateKey = value?.format("YYYY-MM-DD");
                      if (!dateKey || !campaign) return Promise.resolve();
                      return campaignContainsWorkDate(campaign, dayjs(dateKey))
                        ? Promise.resolve()
                        : Promise.reject(new Error("La fecha seleccionada está fuera del período de trabajos de la campaña."));
                    },
                  },
                ]}
              >
                <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
              </Form.Item>

              {completionEndpoint(workCompletion.planning.activity_type) === 'complete-work' && <Form.Item label="Productos utilizados" style={{ marginBottom: 0 }}>
                {renderActualProductsForm(workCompletion.planning)}
              </Form.Item>}
              <ExecutionEconomicFields planning={workCompletion.planning} crops={crops} user={currentUser} form={completionForm}/>
            </Form>
          </Space>
        )}
      </Modal>

      <Modal
        title="Campañas"
        open={isCampaignModalOpen}
        onCancel={() => setIsCampaignModalOpen(false)}
        footer={null}
        width={860}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: "100%" }} size="large">
          <Alert type="info" showIcon message={CAMPAIGN_HELP_TEXT} />

          <Form form={campaignForm} layout="vertical" onFinish={handleCreateCampaign}>
            <Row gutter={12}>
              <Col xs={24} md={6}>
                <Form.Item name="name" label="Nombre" rules={[{ required: true, message: "Ingresá el nombre de la campaña" }]}>
                  <Input placeholder="Ej: 2026/27" />
                </Form.Item>
              </Col>
              <Col xs={24} md={5}>
                <Form.Item
                  name="work_start_date"
                  label="Trabajos desde"
                  dependencies={["start_date"]}
                  rules={[
                    ({ getFieldValue }) => ({
                      validator: (_, value) => {
                        const start = getFieldValue("start_date");
                        if (!start || !value || !value.isAfter(start, "day")) return Promise.resolve();
                        return Promise.reject(new Error("La fecha de trabajos no puede ser posterior a la fecha de inicio."));
                      },
                    }),
                  ]}
                  extra={CAMPAIGN_WORK_START_HELP_TEXT}
                >
                  <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={5}>
                <Form.Item name="start_date" label="Inicio oficial" rules={[{ required: true, message: "Seleccioná la fecha de inicio" }]}>
                  <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={5}>
                <Form.Item
                  name="end_date"
                  label="Fin oficial"
                  dependencies={["start_date"]}
                  rules={[
                    ({ getFieldValue }) => ({
                      validator: (_, value) => {
                        const start = getFieldValue("start_date");
                        if (!start || !value || !value.isBefore(start, "day")) return Promise.resolve();
                        return Promise.reject(new Error("La fecha de finalización no puede ser anterior a la fecha de inicio."));
                      },
                    }),
                  ]}
                  extra="Podés dejar la fecha de finalización sin definir mientras la campaña esté en curso."
                >
                  <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={5}>
                <Form.Item name="work_end_date" label="Trabajos hasta" dependencies={["end_date"]}
                  extra="Sin definir, se utiliza el fin oficial; si ambos están vacíos, la ventana queda abierta."
                  rules={[({ getFieldValue }) => ({
                    validator: (_, value) => {
                      const end = getFieldValue("end_date");
                      if (!value || (end && !value.isBefore(end, "day"))) return Promise.resolve();
                      return Promise.reject(new Error("El fin de trabajos requiere un fin oficial y no puede ser anterior a él."));
                    },
                  })]}>
                  <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={3}>
                <Form.Item label=" ">
                  <Button type="primary" htmlType="submit" loading={savingCampaign} block>
                    Crear
                  </Button>
                </Form.Item>
              </Col>
            </Row>
          </Form>

          <Table
            size="small"
            pagination={false}
            dataSource={campaigns}
            scroll={{ x: 850 }}
            rowKey={(campaign) => campaign.id ?? campaign._id}
            locale={{ emptyText: "No hay campañas cargadas" }}
            columns={[
              { title: "Campaña", dataIndex: "name", render: (_, campaign) => campaignLabel(campaign) },
              {
                title: "Trabajos desde",
                dataIndex: "work_start_date",
                render: (_, campaign) => formatCampaignWorkStart(campaign),
              },
              {
                title: "Inicio oficial",
                dataIndex: "start_date",
                render: (value) => value ? formatCalendarDate(value, "—") : "—",
              },
              {
                title: "Fin oficial",
                dataIndex: "end_date",
                render: (value) => value ? formatCalendarDate(value) : "En curso",
              },
              {
                title: "Trabajos hasta",
                dataIndex: "work_end_date",
                render: (_, campaign) => campaignWorkEnd(campaign) ? formatDate(campaignWorkEnd(campaign)) : "Sin fin definido",
              },
              {
                title: "Estado",
                dataIndex: "status",
                render: (_, campaign) => {
                  const displayStatus = getCampaignDisplayStatus(campaign);
                  return (
                    <Tag color={campaign.status === "active" ? "green" : "default"}>
                      {displayStatus}
                    </Tag>
                  );
                },
              },
              {
                title: "Acciones",
                key: "actions",
                align: "center",
                width: 150,
                render: (_, campaign) => {
                  const campaignInUse = campaign.can_delete === false || Number(campaign.references_count || 0) > 0;

                  return (
                    <Space size="small" style={{ justifyContent: "center", width: "100%" }}>
                      <Tooltip title="Editar campaña">
                        <Button
                          type="text"
                          shape="circle"
                          icon={<EditOutlined />}
                          aria-label="Editar campaña"
                          onClick={() => openEditCampaignModal(campaign)}
                        />
                      </Tooltip>

                      <Tooltip title={campaignInUse ? "Esta campaña tiene información asociada y no puede eliminarse." : "Eliminar campaña"}>
                        <span>
                          <Popconfirm
                            title="¿Eliminar campaña?"
                            description="Esta campaña no tiene información asociada. Esta acción no se puede deshacer."
                            okText="Eliminar"
                            cancelText="Cancelar"
                            okButtonProps={{ danger: true }}
                            disabled={campaignInUse}
                            onConfirm={() => handleDeleteCampaign(campaign)}
                          >
                            <Button
                              type="text"
                              danger
                              shape="circle"
                              icon={<DeleteOutlined />}
                              aria-label="Eliminar campaña"
                              disabled={campaignInUse}
                            />
                          </Popconfirm>
                        </span>
                      </Tooltip>

                      {campaign.status === "active" ? (
                        <Popconfirm
                          title="Cerrar campaña"
                          description="Las planificaciones históricas seguirán conservando esta campaña."
                          okText="Cerrar"
                          cancelText="Cancelar"
                          onConfirm={() => handleCloseCampaign(campaign)}
                        >
                          <Button type="link" size="small">Cerrar</Button>
                        </Popconfirm>
                      ) : null}
                    </Space>
                  );
                },
              },
            ]}
          />
        </Space>
      </Modal>

      <Modal
        title="Editar campaña"
        open={isEditCampaignModalOpen}
        onCancel={closeEditCampaignModal}
        onOk={() => editCampaignForm.submit()}
        okText="Guardar"
        cancelText="Cancelar"
        confirmLoading={savingCampaign}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Alert type="info" showIcon message={CAMPAIGN_HELP_TEXT} />

          <Form form={editCampaignForm} layout="vertical" onFinish={handleUpdateCampaign}>
            <Form.Item
              name="name"
              label="Nombre"
              rules={[{ required: true, message: "Ingresá el nombre de la campaña" }]}
            >
              <Input placeholder="Ej: 2025/26" />
            </Form.Item>

            <Form.Item
              name="work_start_date"
              label="Trabajos desde"
              dependencies={["start_date"]}
              rules={[
                ({ getFieldValue }) => ({
                  validator: (_, value) => {
                    const start = getFieldValue("start_date");
                    if (!start || !value || !value.isAfter(start, "day")) return Promise.resolve();
                    return Promise.reject(new Error("La fecha de trabajos no puede ser posterior a la fecha de inicio."));
                  },
                }),
              ]}
              extra={CAMPAIGN_WORK_START_HELP_TEXT}
            >
              <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item
              name="start_date"
              label="Inicio oficial"
              rules={[{ required: true, message: "Seleccioná la fecha de inicio" }]}
            >
              <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item
              name="end_date"
              label="Fin oficial"
              dependencies={["start_date"]}
              rules={[
                ({ getFieldValue }) => ({
                  validator: (_, value) => {
                    const start = getFieldValue("start_date");
                    if (!start || !value || !value.isBefore(start, "day")) return Promise.resolve();
                    return Promise.reject(new Error("La fecha de finalización no puede ser anterior a la fecha de inicio."));
                  },
                }),
              ]}
              extra="Podés dejar la fecha de finalización sin definir mientras la campaña esté en curso."
            >
              <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="work_end_date" label="Trabajos hasta" dependencies={["end_date"]}
                  extra="Sin definir, se utiliza el fin oficial; si ambos están vacíos, la ventana queda abierta."
                  rules={[({ getFieldValue }) => ({
                    validator: (_, value) => {
                      const end = getFieldValue("end_date");
                      if (!value || (end && !value.isBefore(end, "day"))) return Promise.resolve();
                      return Promise.reject(new Error("El fin de trabajos requiere un fin oficial y no puede ser anterior a él."));
                    },
                  })]}>
                  <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
                </Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal
        title="Nuevo cultivo"
        open={isCropModalOpen}
        onCancel={() => setIsCropModalOpen(false)}
        onOk={() => cropForm.submit()}
        confirmLoading={savingCrop}
        okText="Guardar"
        cancelText="Cancelar"
        destroyOnHidden
      >
        <Form form={cropForm} layout="vertical" onFinish={handleCreateCrop}>
          <Form.Item
            name="name"
            label="Nombre"
            rules={[{ required: true, message: "Ingresá el nombre del cultivo" }]}
          >
            <Input placeholder="Ej: Maní" />
          </Form.Item>
        </Form>
      </Modal>

      {
        isMobile && !isDrawerOpen && !isDetailOpen && canCreate && (
          <button
            type="button"
            className="fab-button"
            aria-label="Nueva planificacion"
            onClick={() => openDrawer()}
          >
            <PlusOutlined />
          </button>
        )
      }
    </div >
  );
};

export default Planning;
