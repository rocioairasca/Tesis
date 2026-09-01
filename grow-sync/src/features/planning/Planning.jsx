/**
 * Componente: Planning
 * Ubicación: src/features/planning/Planning.jsx
 * Descripción:
 *  Contenedor principal para la gestión de planificaciones.
 *  Maneja la lógica de estado, llamadas a API, y renderizado condicional
 *  de vistas (Tabla Desktop, Lista Mobile, Calendario).
 * 
 * Refactorización:
 *  - Se extrajo la tabla desktop a `components/PlanningTable.jsx`.
 *  - Se extrajo la lista mobile a `components/PlanningListMobile.jsx`.
 *  - Se mantiene la lógica de estado y handlers aquí.
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Alert,
  Button, Card, Drawer, Form, Input, InputNumber, Select, DatePicker,
  Dropdown, Space, Row, Col, Tag, notification,
  Calendar as AntCalendar, Segmented, List, Popconfirm, Descriptions, Table, Modal, Popover, Tooltip
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  MoreOutlined,
  EyeOutlined,
  UserOutlined,
} from '../../components/AppIcons';
import api from "../../services/apiClient";
import useIsMobile from "../../hooks/useIsMobile";
import { useNavigate } from "react-router-dom";

import dayjs from "dayjs";
import isBetween from "dayjs/plugin/isBetween";
import PlanningTable from "./components/PlanningTable";
import PlanningListMobile from "./components/PlanningListMobile";
import LotMapPreview from "./components/LotMapPreview";
import { PERMISSIONS } from "../../constants/permissions";
import { hasPermission } from "../../utils/permissions";
import {
  ACTIVITY_EVENT_STYLES,
  STATUS_COLORS,
  formatActivity,
  getCropDisplayName,
  getPlanningDisplayName,
  getPlanningEventLabel,
  getPlanningLotName,
  summarizePlanningLotsShort,
  statusLabel,
} from "./planningDisplay";
import { getUserFriendlyError } from "../../utils/userFriendlyErrors";

dayjs.extend(isBetween);

const { RangePicker } = DatePicker;
const CAMPAIGN_HELP_TEXT = "La campaña representa un ciclo productivo completo. Distintas campañas pueden desarrollarse al mismo tiempo.";
const CAMPAIGN_WORK_START_HELP_TEXT = "Permite incluir trabajos realizados antes del inicio de la campaña. Si no se indica, se usará la fecha de inicio.";

// --- helpers ---
const getId = (r) => r?.id ?? r?._id;
const rowKey = (r) => getId(r) ?? r?.title ?? String(Math.random());
const fullLotKey = (lotId) => `lot:${lotId}`;
const subLotKey = (lotId, subLotId) => `sub:${lotId}:${subLotId}`;
const formatHa = (value) => `${Number(value || 0).toLocaleString("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})} ha`;
const getLotArea = (lot) => Number(lot?.area_ha ?? lot?.area ?? 0);
const getActiveSubLots = (lot) => (
  Array.isArray(lot?.active_layout?.sub_lots) ? lot.active_layout.sub_lots : []
);
const getPlanningLotArea = (lot) => Number(lot?.area_ha || 0);
const getPlanningArea = (row) => {
  const plannedArea = Number(row?.planned_area_ha || 0);
  if (plannedArea > 0) return plannedArea;
  return (row?.lots || []).reduce((sum, lot) => sum + getPlanningLotArea(lot), 0);
};
const getEffectiveSowingDate = (row) => {
  const source = row?.end_at || row?.start_at;
  return source ? dayjs(source) : dayjs();
};
const getEffectiveWorkDate = getEffectiveSowingDate;
const parseDecimalInput = (value) => {
  if (typeof value === "string") return Number(value.replace(",", "."));
  return Number(value);
};
const formatDate = (value) => {
  if (!value) return "—";
  return dayjs(value).format("DD/MM/YYYY");
};
const getCampaignWorkStartValue = (campaign) => campaign?.work_start_date ?? campaign?.start_date;
const formatCampaignWorkStart = (campaign) => formatDate(getCampaignWorkStartValue(campaign));
const getCampaignWorkStartDate = (campaign) => (
  getCampaignWorkStartValue(campaign)
    ? dayjs(getCampaignWorkStartValue(campaign)).startOf("day")
    : null
);
const getCampaignStartDate = (campaign) => (
  campaign?.start_date ? dayjs(campaign.start_date).startOf("day") : null
);
const getCampaignEndDate = (campaign) => (
  campaign?.end_date ? dayjs(campaign.end_date).endOf("day") : null
);
const formatCampaignOptionMeta = (campaign) => (
  `Trabajos desde ${formatCampaignWorkStart(campaign)} · Inicio ${formatDate(campaign?.start_date)} · Fin ${campaign?.end_date ? formatDate(campaign.end_date) : "En curso"}`
);
const renderCampaignOptionLabel = (campaign, suffix = null) => (
  <div>
    <div>{campaign.name}{suffix ? ` ${suffix}` : ""}</div>
    <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "normal" }}>
      {formatCampaignOptionMeta(campaign)}
    </div>
  </div>
);
const renderCampaignDropdownOption = (campaign, suffix = null) => (
  <div style={{ padding: "4px 0", lineHeight: 1.35 }}>
    <div>{campaign.name}{suffix ? ` ${suffix}` : ""}</div>
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
const campaignContainsWorkRange = (campaign, range) => {
  const [start, end] = range || [];
  if (!campaign || !start || !end) return true;

  const campaignWorkStart = getCampaignWorkStartDate(campaign);
  const campaignEnd = getCampaignEndDate(campaign);
  return campaignWorkStart && !start.isBefore(campaignWorkStart) && (!campaignEnd || !end.isAfter(campaignEnd));
};
const campaignContainsWorkDate = (campaign, date) => {
  if (!campaign || !date) return false;
  const campaignWorkStart = getCampaignWorkStartDate(campaign);
  const campaignEnd = getCampaignEndDate(campaign);
  return campaignWorkStart && !date.isBefore(campaignWorkStart) && (!campaignEnd || !date.isAfter(campaignEnd));
};
const campaignContainsFormalDate = (campaign, date) => {
  if (!campaign || !date) return false;
  const campaignStart = getCampaignStartDate(campaign);
  const campaignEnd = getCampaignEndDate(campaign);
  return campaignStart && !date.isBefore(campaignStart) && (!campaignEnd || !date.isAfter(campaignEnd));
};

const getCompatibleCampaigns = (campaigns, range) => (
  range?.[0] && range?.[1] ? campaigns.filter((campaign) => campaignContainsWorkRange(campaign, range)) : []
);

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
const ACTIVITIES_REQUIRING_CROP = new Set(["siembra", "fumigacion", "fertilizacion", "cosecha"]);
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
  if (!row?.start_at || !row?.end_at) return "—";
  const start = dayjs(row.start_at);
  const end = dayjs(row.end_at);
  return start.isSame(end, "day")
    ? start.format("DD/MM/YYYY")
    : `${start.format("DD/MM/YYYY")} → ${end.format("DD/MM/YYYY")}`;
};
const getCampaignDisplayStatus = (campaign) => {
  if (!campaign) return "—";
  if (campaign.status === "active") return "Activa";
  if (campaign.start_date && dayjs(campaign.start_date).isAfter(dayjs(), "day")) return "Próxima";
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
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  const [viewMode, setViewMode] = useState("table"); // 'table' | 'calendar'
  const [calendarSelection, setCalendarSelection] = useState(null); // { type: 'day' | 'month', date: dayjs() }

  // filtros
  const [filters, setFilters] = useState({
    status: null,
    responsible: null,
    cropId: null,
    type: null,
    campaignId: null,
    lotSelectionKey: null,
    dateRange: null,
  });

  // catálogos para nombres legibles
  const [users, setUsers] = useState([]);
  const [lots, setLots] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [crops, setCrops] = useState([]);
  const [products, setProducts] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  // índices id -> nombre
  const userIx = useMemo(
    () => Object.fromEntries(users.map(u => [u.id ?? u._id, u.full_name || u.nickname || u.username || u.email])),
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
    () => Object.fromEntries(products.map(p => [p.id ?? p._id, p.name])),
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
  const [form] = Form.useForm();
  const [cropForm] = Form.useForm();
  const [campaignForm] = Form.useForm();
  const [editCampaignForm] = Form.useForm();
  const [sowingForm] = Form.useForm();
  const [completionForm] = Form.useForm();
  const selectedLotKeys = Form.useWatch("lot_selection_keys", form) || [];
  const selectedActivityType = Form.useWatch("activity_type", form);
  const selectedDateRange = Form.useWatch("date_range", form);
  const selectedCampaignId = Form.useWatch("campaign_id", form);
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

  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");
  const canCreate = hasPermission(currentUser, PERMISSIONS.PLANNING_CREATE);
  const canEdit = hasPermission(currentUser, PERMISSIONS.PLANNING_EDIT);
  const canDisable = hasPermission(currentUser, PERMISSIONS.PLANNING_DISABLE);
  const canViewDisabled = hasPermission(currentUser, PERMISSIONS.PLANNING_VIEW_DISABLED);

  const selectedPlanningArea = useMemo(() => {
    return selectedLotKeys.reduce((sum, key) => {
      const parsed = parseSelectionKey(key);
      if (!parsed) return sum;

      const lot = lots.find(item => (item.id ?? item._id) === parsed.lot_id);
      if (!lot) return sum;

      if (!parsed.sub_lot_id) return sum + getLotArea(lot);

      const subLot = getActiveSubLots(lot).find(item => item.id === parsed.sub_lot_id);
      return sum + Number(subLot?.area_ha || 0);
    }, 0);
  }, [lots, selectedLotKeys]);

  const getCatalogProduct = useCallback((planningProduct) => (
    products.find(product => (product.id ?? product._id) === planningProduct?.product_id)
  ), [products]);

  const getPlanningProductUnit = useCallback((planningProduct) => (
    planningProduct?.unit || getCatalogProduct(planningProduct)?.unit || ""
  ), [getCatalogProduct]);

  const getPlanningProductAvailable = useCallback((planningProduct) => {
    const directValue = planningProduct?.available_quantity;
    if (directValue !== undefined && directValue !== null) return Number(directValue || 0);
    return Number(getCatalogProduct(planningProduct)?.available_quantity || 0);
  }, [getCatalogProduct]);

  const buildActualProductFields = useCallback((planning) => {
    const values = {};
    (planning?.products || []).forEach((product) => {
      if (!product.id) return;
      values[product.id] = { actual_amount: Number(product.amount || 0) };
    });
    return values;
  }, []);

  const buildActualProductsPayload = useCallback((planning, values) => (
    (planning?.products || [])
      .filter(product => product.id)
      .map(product => ({
        planning_product_id: product.id,
        actual_amount: parseDecimalInput(
          values?.actual_products?.[product.id]?.actual_amount ?? product.amount ?? 0
        ),
      }))
  ), []);

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
        {plannedProducts.map((product) => {
          const productId = product.id;
          const plannedAmount = Number(product.amount || 0);
          const unit = getPlanningProductUnit(product);
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
                    Planificado: {plannedAmount.toLocaleString("es-AR", { maximumFractionDigits: 2 })} {unit || ""}
                  </div>
                </Col>
                <Col xs={24} md={7}>
                  <div style={{ color: "#6b7280", fontSize: 12 }}>Stock disponible</div>
                  <strong>{available.toLocaleString("es-AR", { maximumFractionDigits: 2 })} {unit || ""}</strong>
                </Col>
                <Col xs={24} md={7}>
                  <Form.Item
                    name={["actual_products", productId, "actual_amount"]}
                    label="Cantidad real"
                    style={{ marginBottom: 0 }}
                    rules={[
                      { required: true, message: "Ingresá la cantidad real." },
                      {
                        validator: (_, value) => {
                          const amount = parseDecimalInput(value);
                          if (!Number.isFinite(amount) || amount < 0) {
                            return Promise.reject(new Error("Ingresá una cantidad válida."));
                          }
                          if (amount > available) {
                            return Promise.reject(new Error("No hay stock suficiente."));
                          }
                          return Promise.resolve();
                        },
                      },
                    ]}
                  >
                    <InputNumber
                      min={0}
                      decimalSeparator=","
                      style={{ width: "100%" }}
                      addonAfter={unit || undefined}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </div>
          );
        })}
      </Space>
    );
  }, [getPlanningProductAvailable, getPlanningProductUnit, prodIx]);

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

  const responsibleOptions = useMemo(() => {
    const nameCounts = users.reduce((acc, user) => {
      const name = user.full_name || user.nickname || user.username || user.email || "Sin nombre";
      acc.set(name, (acc.get(name) || 0) + 1);
      return acc;
    }, new Map());

    return users.map((user) => {
      const id = user.id ?? user._id;
      const name = user.full_name || user.nickname || user.username || user.email || "Sin nombre";
      const showEmail = Boolean(user.email && nameCounts.get(name) > 1);

      return {
        value: id,
        label: showEmail ? (
          <div>
            <div>{name}</div>
            <div style={{ fontSize: 12, color: "#8c8c8c" }}>{user.email}</div>
          </div>
        ) : name,
      };
    });
  }, [users]);

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
        searchLabel: `${campaign.name} ${formatCampaignOptionMeta(campaign)} ${getCampaignDisplayStatus(campaign)}`,
      })),
    ];
  }, [campaigns, editing]);

  const planningCampaignOptions = useMemo(() => {
    const hasCompleteRange = selectedDateRange?.[0] && selectedDateRange?.[1];
    const compatibleCampaigns = hasCompleteRange ? getCompatibleCampaigns(campaigns, selectedDateRange) : campaigns;
    const hasSelectedCampaign = selectedCampaignId
      && compatibleCampaigns.some((campaign) => (campaign.id ?? campaign._id) === selectedCampaignId);
    const selectedIncompatibleCampaign = hasCompleteRange && selectedCampaignId && !hasSelectedCampaign
      ? campaigns.find((campaign) => (campaign.id ?? campaign._id) === selectedCampaignId)
      : null;

    return [
      ...(selectedIncompatibleCampaign ? [{
        value: selectedCampaignId,
        label: selectedIncompatibleCampaign.name,
        campaign: selectedIncompatibleCampaign,
        suffix: "- fuera de fecha",
        searchLabel: `${selectedIncompatibleCampaign.name} ${formatCampaignOptionMeta(selectedIncompatibleCampaign)}`,
      }] : []),
      ...compatibleCampaigns.map((campaign) => ({
        value: campaign.id ?? campaign._id,
        label: campaign.name,
        campaign,
        searchLabel: `${campaign.name} ${formatCampaignOptionMeta(campaign)}`,
      })),
    ];
  }, [campaigns, selectedCampaignId, selectedDateRange]);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => (campaign.id ?? campaign._id) === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  );
  const suggestedCampaign = useMemo(() => {
    const compatibleCampaigns = getCompatibleCampaigns(campaigns, selectedDateRange);
    return compatibleCampaigns.length === 1 ? compatibleCampaigns[0] : null;
  }, [campaigns, selectedDateRange]);
  const compatibleCampaignCount = useMemo(() => {
    return getCompatibleCampaigns(campaigns, selectedDateRange).length;
  }, [campaigns, selectedDateRange]);
  const campaignDateMismatch = Boolean(
    selectedCampaign
    && selectedDateRange?.[0]
    && selectedDateRange?.[1]
    && !campaignContainsWorkRange(selectedCampaign, selectedDateRange)
  );
  const selectedPlanningStartsBeforeCampaign = Boolean(
    selectedCampaign
    && selectedDateRange?.[0]
    && campaignContainsWorkRange(selectedCampaign, selectedDateRange)
    && getCampaignStartDate(selectedCampaign)
    && selectedDateRange[0].isBefore(getCampaignStartDate(selectedCampaign), "day")
  );

  const syncCampaignForRange = useCallback((range) => {
    const [start, end] = range || [];
    if (!start || !end) {
      form.setFieldValue("campaign_id", undefined);
      return;
    }

    const compatibleCampaigns = getCompatibleCampaigns(campaigns, range);
    const currentCampaignId = form.getFieldValue("campaign_id");
    const currentIsCompatible = compatibleCampaigns.some((campaign) => (
      (campaign.id ?? campaign._id) === currentCampaignId
    ));
    if (currentIsCompatible) return;

    if (compatibleCampaigns.length === 1) {
      form.setFieldValue("campaign_id", compatibleCampaigns[0].id ?? compatibleCampaigns[0]._id);
    } else {
      form.setFieldValue("campaign_id", undefined);
    }
  }, [campaigns, form]);

  const activeExtraFilterCount = [
    filters.campaignId,
    filters.responsible,
    filters.lotSelectionKey,
    filters.dateRange?.[0] && filters.dateRange?.[1],
  ].filter(Boolean).length;
  const hasActiveFilters = Object.values(filters).some(Boolean);

  const comparePlanningEvents = (a, b) => {
    const startDiff = dayjs(a.start_at).valueOf() - dayjs(b.start_at).valueOf();
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
      const eventStart = dayjs(event.start_at).startOf("day");
      const eventEnd = dayjs(event.end_at).startOf("day");
      if (!eventStart.isValid() || !eventEnd.isValid()) return;

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
        const eventStart = dayjs(event.start_at).startOf("day");
        const eventEnd = dayjs(event.end_at).endOf("day");
        if (!eventStart.isValid() || !eventEnd.isValid()) return false;
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
      const start = dayjs(event.start_at);
      const key = start.isValid() ? start.format("YYYY-MM-DD") : "sin-fecha";
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
        <strong>{getCropDisplayName(ev, cropIx)} · {formatActivity(ev.activity_type)}</strong>
        <div>{lots.join(", ") || "Sin lotes asignados"}</div>
        <div>{formatHa(getPlanningArea(ev))}</div>
        <div>{formatPeriod(ev)}</div>
        <div>Estado: {statusLabel(status)}</div>
        <div>Responsable: {userIx[ev.responsible_user] || "—"}</div>
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
  const fetchPlanning = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.responsible) params.responsible = filters.responsible;
      if (filters.cropId) params.cropId = filters.cropId;
      if (filters.type) params.type = filters.type;
      if (filters.campaignId) params.campaignId = filters.campaignId;
      if (filters.lotSelectionKey) {
        const parsed = parseSelectionKey(filters.lotSelectionKey);
        if (parsed?.sub_lot_id) params.subLotId = parsed.sub_lot_id;
        else if (parsed?.lot_id) params.lotId = parsed.lot_id;
      }
      if (filters.dateRange?.[0] && filters.dateRange?.[1]) {
        params.from = filters.dateRange[0].format("YYYY-MM-DD[T]00:00:00.000[Z]");
        params.to = filters.dateRange[1].format("YYYY-MM-DD[T]23:59:59.999[Z]");
      }

      const { data } = await api.get("/planning", { params }); // ?includeDisabled=0&includeCanceled=0 por default
      const items = Array.isArray(data) ? data : data?.items || data?.data || [];
      setList(items);
    } catch (e) {
      console.error("→ planning list error:", e);
      notification.error({ message: "Error al cargar planificaciones" });
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await api.get("/users/planning-responsibles");
      setUsers(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch {
      setUsers([]);
      notification.error({ message: "No se pudieron cargar los responsables." });
    }
  }, []);
  const fetchLots = useCallback(async () => {
    try {
      const { data } = await api.get("/lots", { params: { includeActiveLayout: true } });
      setLots(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch { }
  }, []);
  const fetchCampaigns = useCallback(async () => {
    try {
      const { data } = await api.get("/campaigns", { params: { includeClosed: true } });
      setCampaigns(Array.isArray(data) ? data : data?.items || data?.data || []);
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
      const { data } = await api.get("/products");
      setProducts(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch { }
  }, []);
  const fetchVehicles = useCallback(async () => {
    try {
      const { data } = await api.get("/vehicles");
      setVehicles(Array.isArray(data) ? data : data?.items || data?.data || []);
    } catch { }
  }, []);

  useEffect(() => {
    fetchPlanning();
    fetchUsers();
    fetchLots();
    fetchCampaigns();
    fetchCrops();
    fetchProducts();
    fetchVehicles();
  }, [fetchPlanning, fetchUsers, fetchLots, fetchCampaigns, fetchCrops, fetchProducts, fetchVehicles]);

  // ---------- drawer handlers ----------
  const openDrawer = (row = null) => {
    setEditing(row);
    if (row) {
      form.setFieldsValue({
        description: row.description,
        activity_type: row.activity_type,
        campaign_id: row.campaign_id,
        crop_id: row.crop_id,
        date_range: [row.start_at ? dayjs(row.start_at) : null, row.end_at ? dayjs(row.end_at) : null],
        responsible_user: row.responsible_user,
        vehicle_id: row.vehicle_id,
        lot_selection_keys: (row.lots || [])
          .map(planningLotToSelectionKey)
          .filter(Boolean),
        products: Array.isArray(row.products) ? row.products.map(p => ({
          product_id: p.product_id,
          amount: p.amount,
          unit: p.unit,
        })) : [],
        status: row.status || "planificado",
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        status: "planificado",
        products: [],
        campaign_id: undefined,
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
    setViewing(row);
    setIsDetailOpen(true);
  };

  const closeDetail = () => {
    setIsDetailOpen(false);
    setViewing(null);
  };

  const handleSubmit = async (values) => {
    try {
      const [start, end] = values.date_range || [];

      // Build payload conditionally to avoid sending empty strings
      const lotSelections = (values.lot_selection_keys || [])
        .map(parseSelectionKey)
        .filter(Boolean);

      const payload = {
        activity_type: values.activity_type,
        campaign_id: values.campaign_id,
        crop_id: values.crop_id || null,
        start_at: start?.format("YYYY-MM-DD[T]00:00:00.000[Z]"),
        end_at: end?.format("YYYY-MM-DD[T]00:00:00.000[Z]"),
        responsible_user: values.responsible_user,
        status: values.status || "planificado",
        lot_selections: lotSelections,
      };

      // Only include optional fields if they have values
      if (values.description?.trim()) {
        payload.description = values.description.trim();
      }

      if (values.vehicle_id) {
        payload.vehicle_id = values.vehicle_id;
      }

      if (values.products && values.products.length > 0) {
        payload.products = values.products.map(p => ({
          product_id: p.product_id,
          amount: Number(p.amount ?? 0),
          unit: p.unit || products.find(x => x.id === p.product_id)?.unit || "",
        }));
      }

      console.log("📤 Payload a enviar:", JSON.stringify(payload, null, 2));

      if (editing && getId(editing)) {
        // actualizar; para status usamos PATCH (según colección)
        await api.patch(`/planning/${getId(editing)}`, payload);
        notification.success({ message: "Planificación actualizada" });
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
      work_start_date: campaign.work_start_date ? dayjs(campaign.work_start_date) : null,
      start_date: campaign.start_date ? dayjs(campaign.start_date) : null,
      end_date: campaign.end_date ? dayjs(campaign.end_date) : null,
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
      const currentCampaignId = form.getFieldValue("campaign_id");
      if (currentCampaignId === (campaign.id ?? campaign._id)) {
        form.setFieldValue("campaign_id", undefined);
      }
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
      });
      notification.success({
        message: data?.message || (
          data?.already_applied
            ? "Esta siembra ya fue registrada en el estado productivo."
            : "La siembra fue completada y el cultivo quedó registrado."
        ),
      });
      closeCompleteSowingModal();
      closeCalendarSelection();
      fetchPlanning();
    } catch (e) {
      notification.error({
        message: getUserFriendlyError(e, "No se pudo completar la siembra."),
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
      const { data } = await api.post(`/planning/${getId(planning)}/complete-work`, {
        effective_date: values.effective_date.format("YYYY-MM-DD"),
        actual_products: buildActualProductsPayload(planning, values),
      });
      notification.success({
        message: data?.message || "El trabajo fue completado y los productos utilizados quedaron registrados.",
      });
      closeCompleteWorkModal();
      closeCalendarSelection();
      fetchPlanning();
    } catch (e) {
      notification.error({
        message: getUserFriendlyError(e, "No se pudo completar la planificación."),
      });
    } finally {
      setCompletingWork(false);
    }
  };

  const updateStatus = async (row, status) => {
    if (statusActionLoading) return;

    if (status === "completado" && PRODUCT_CONSUMING_ACTIVITIES.has(row?.activity_type)) {
      if (row?.activity_type === "siembra") {
        openCompleteSowingModal(row);
        return;
      }
      openCompleteWorkModal(row);
      return;
    }

    const actionKey = `${getId(row)}:${status}`;
    try {
      setStatusActionLoading(actionKey);
      await api.patch(`/planning/${getId(row)}`, { status });
      fetchPlanning();
    } catch (e) {
      notification.error({ message: getUserFriendlyError(e, "No se pudo actualizar el estado.") });
    } finally {
      setStatusActionLoading(null);
    }
  };

  const closeCalendarSelection = () => {
    setCalendarSelection(null);
  };

  const getStatusTransitionActions = (item) => {
    const status = item?.status;
    if (!canEdit) return [];

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

  const getPrimaryStatusAction = (item) => {
    const status = item?.status;
    if (!canEdit) return null;
    if (status === "planificado" || status === "pendiente") {
      return { key: "progress", label: "Iniciar trabajo", ctaLabel: "Iniciar", status: "en_progreso" };
    }
    if (status === "en_progreso") {
      return { key: "done", label: "Completar trabajo", ctaLabel: "Completar", status: "completado" };
    }
    return null;
  };

  const getMonthlyMenuItems = (item, secondaryActions) => [
    ...secondaryActions.map((action) => ({
      key: action.key,
      label: action.label,
      onClick: () => {
        closeCalendarSelection();
        updateStatus(item, action.status);
      },
    })),
    canEdit && canDisable && item?.status !== "completado" && item?.status !== "cancelado"
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
          {userIx[item.responsible_user] && (
            <span className="planning-month-card__line planning-month-card__responsible">
              <UserOutlined /> {userIx[item.responsible_user]}
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

  const handleFilterChange = (key, val) => {
    setFilters(prev => ({ ...prev, [key]: val }));
  };

  const clearFilters = () => {
    setFilters({
      status: null,
      responsible: null,
      cropId: null,
      type: null,
      campaignId: null,
      lotSelectionKey: null,
      dateRange: null,
    });
  };

  const disabledMenu = [
    (canCreate || canEdit) && { key: "campaigns", label: <span onClick={() => setIsCampaignModalOpen(true)}>Campañas</span> },
    canViewDisabled && { key: "1", label: <span onClick={() => navigate("/planificaciones-deshabilitadas")}>Ver canceladas</span> }
  ].filter(Boolean);

  const moreFiltersContent = (
    <Space direction="vertical" style={{ width: 280 }} size="middle">
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
        options={responsibleOptions}
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
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col><h2>Planificaciones</h2></Col>
        <Col>
          <Space>
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
              <Space>
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

      {/* Filtros (Desktop) */}
      {viewMode === "table" && (
        <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 16 }}>
          <Col flex="180px">
            <Select
              style={{ width: "100%" }}
              placeholder="Todos los cultivos"
              allowClear
              value={filters.cropId}
              onChange={(v) => handleFilterChange("cropId", v)}
              options={crops.map(crop => ({ value: crop.id ?? crop._id, label: crop.name }))}
              notFoundContent="No hay cultivos disponibles."
            />
          </Col>
          <Col flex="190px">
            <Select
              style={{ width: "100%" }}
              placeholder="Todas las actividades"
              allowClear
              value={filters.type}
              onChange={(v) => handleFilterChange("type", v)}
              options={ACTIVITY_OPTIONS}
            />
          </Col>
          <Col flex="170px">
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
          </Col>
          <Col flex="none">
            <Popover content={moreFiltersContent} trigger="click" placement="bottomLeft">
              <Button>
                Más filtros{activeExtraFilterCount ? ` (${activeExtraFilterCount})` : ""}
              </Button>
            </Popover>
          </Col>
          {hasActiveFilters && (
            <Col flex="none">
              <Button type="link" onClick={clearFilters}>Limpiar filtros</Button>
            </Col>
          )}
        </Row>
      )}

      {/* Tabla (desktop) */}
      {viewMode === "table" && !isMobile && (
        <PlanningTable
          list={list}
          loading={loading}
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
        />
      )}

      {/* Vista CALENDARIO (desktop y mobile) */}
      {viewMode === "calendar" && (
        <div style={{ background: "#fff", padding: 12, borderRadius: 8 }}>
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

      {/* Cards (mobile) */}
      {isMobile && viewMode === "table" && (
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
        />
      )}

      {/* Drawer crear/editar */}
      <Drawer
        title={editing ? "Editar Planificación" : "Nueva Planificación"}
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDrawer}
        open={isDrawerOpen}
        height={isMobile ? "90vh" : undefined}
        width={isMobile ? "100%" : 480}
        destroyOnHidden
        styles={{ body: { paddingBottom: 80 } }}
      >
        <Form layout="vertical" form={form} onFinish={handleSubmit}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7a59", marginBottom: 12, textTransform: "uppercase" }}>
            Planificación
          </div>

          <Form.Item
            name="crop_id"
            label="Cultivo"
            required={ACTIVITIES_REQUIRING_CROP.has(selectedActivityType)}
            rules={[
              {
                validator: (_, value) => {
                  if (ACTIVITIES_REQUIRING_CROP.has(selectedActivityType) && !value) {
                    return Promise.reject(new Error("Seleccioná un cultivo."));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Select
              allowClear
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
          </Form.Item>

          <Form.Item name="activity_type" label="Actividad" rules={[{ required: true, message: "Seleccioná la actividad" }]}>
            <Select options={ACTIVITY_OPTIONS} placeholder="Seleccioná la actividad" />
          </Form.Item>

          <Form.Item
            name="campaign_id"
            label="Campaña"
            rules={[
              { required: true, message: "Seleccioná una campaña." },
              {
                validator: () => (
                  campaignDateMismatch
                    ? Promise.reject(new Error("La campaña seleccionada no admite trabajos en las fechas indicadas."))
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
                    La campaña seleccionada no admite trabajos en las fechas indicadas.
                    {suggestedCampaign ? ` Campaña sugerida: ${suggestedCampaign.name}.` : ""}
                  </div>
                )}
                {!campaignDateMismatch && selectedPlanningStartsBeforeCampaign && (
                  <div style={{ color: "#595959" }}>
                    Este trabajo se realizará antes del inicio de la campaña y quedará asociado a ella.
                  </div>
                )}
                {!campaignDateMismatch && selectedDateRange?.[0] && selectedDateRange?.[1] && compatibleCampaignCount === 0 && (
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
          </Form.Item>

          <Form.Item name="date_range" label="Período" rules={[{ required: true, message: "Seleccioná el período" }]}>
            <RangePicker
              format="DD/MM/YYYY"
              style={{ width: "100%" }}
              onChange={syncCampaignForRange}
            />
          </Form.Item>

          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7a59", margin: "24px 0 12px", textTransform: "uppercase" }}>
            Ubicación
          </div>

          <Form.Item
            name="lot_selection_keys"
            label="Lotes y sublotes"
            rules={[
              { required: true, message: "Seleccioná al menos un lote o sublote" },
              {
                validator: (_, value = []) => {
                  const selectedByLot = value.reduce((acc, key) => {
                    const parsed = parseSelectionKey(key);
                    if (!parsed) return acc;
                    const current = acc.get(parsed.lot_id) || { full: false, subLots: 0 };
                    if (parsed.sub_lot_id) current.subLots += 1;
                    else current.full = true;
                    acc.set(parsed.lot_id, current);
                    return acc;
                  }, new Map());
                  const hasInvalidMix = Array.from(selectedByLot.values()).some(item => item.full && item.subLots > 0);
                  return hasInvalidMix
                    ? Promise.reject(new Error("No combines un lote completo con sublotes del mismo lote"))
                    : Promise.resolve();
                },
              },
            ]}
          >
            <Select
              mode="multiple"
              placeholder="Seleccioná lotes completos o sublotes"
              options={lotSelectionOptions}
              optionFilterProp="label"
            />
          </Form.Item>

          <div style={{ marginTop: -12, marginBottom: 16, color: "#595959", fontSize: 13 }}>
            Superficie planificada: <strong>{formatHa(selectedPlanningArea)}</strong>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7a59", margin: "24px 0 12px", textTransform: "uppercase" }}>
            Recursos
          </div>

          <Form.Item name="responsible_user" label="Responsable" rules={[{ required: true, message: "Seleccioná un responsable" }]}>
            <Select
              allowClear
              placeholder="Seleccioná un usuario"
              options={responsibleOptions}
              notFoundContent="No hay usuarios disponibles para asignar como responsables."
            />
          </Form.Item>

          <Form.Item name="vehicle_id" label="Vehículo">
            <Select
              allowClear
              placeholder="Seleccioná un vehículo"
              options={vehicles
                .filter(v => v.status === 'activo')
                .map(v => ({ value: v.id ?? v._id, label: vehIx[v.id ?? v._id] }))}
            />
          </Form.Item>

          <Form.List name="products">
            {(fields, { add, remove }) => (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <label style={{ fontWeight: 500 }}>Productos</label>
                  <Button type="dashed" onClick={() => add()} size="small">Agregar producto</Button>
                </div>

                {fields.map(({ key, name, ...rest }) => (
                  <Space key={key} style={{ display: "flex", marginBottom: 8 }} align="start" wrap>
                    <Form.Item
                      {...rest}
                      name={[name, "product_id"]}
                      rules={[{ required: true, message: "Producto" }]}
                    >
                      <Select
                        placeholder="Producto"
                        style={{ width: 200 }}
                        options={products.map(p => ({ value: p.id ?? p._id, label: prodIx[p.id ?? p._id] }))}
                        onChange={(pid) => {
                          const prod = products.find(p => (p.id ?? p._id) === pid);
                          const current = form.getFieldValue("products") || [];
                          current[name] = { ...(current[name] || {}), unit: prod?.unit || "" };
                          form.setFieldsValue({ products: current });
                        }}
                      />
                    </Form.Item>

                    <Form.Item
                      {...rest}
                      name={[name, "amount"]}
                      rules={[{ required: true, message: "Cantidad" }]}
                    >
                      <InputNumber min={0} placeholder="Cantidad" style={{ width: 120 }} />
                    </Form.Item>

                    <Form.Item {...rest} name={[name, "unit"]}>
                      <Input placeholder="Unidad" style={{ width: 100 }} />
                    </Form.Item>

                    <Button danger type="text" onClick={() => remove(name)}>Eliminar</Button>
                  </Space>
                ))}
              </>
            )}
          </Form.List>

          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7a59", margin: "24px 0 12px", textTransform: "uppercase" }}>
            Información adicional
          </div>

          <Form.Item name="status" label="Estado">
            <Select
              options={[
                { value: "planificado", label: "Planificado" },
                { value: "pendiente", label: "Pendiente" },
                { value: "en_progreso", label: "En progreso" },
                { value: "completado", label: "Completado" },
              ]}
              placeholder="Estado"
            />
          </Form.Item>

          <Form.Item name="description" label="Descripción">
            <Input.TextArea placeholder="Agregá observaciones o detalles adicionales..." rows={3} />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editing ? "Actualizar" : "Crear Planificación"}
            </Button>
          </Form.Item>
        </Form>
      </Drawer>

      {/* Drawer Detalle (Read-only) */}
      <Drawer
        title="Detalle de Planificación"
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDetail}
        open={isDetailOpen}
        height={isMobile ? "85vh" : undefined}
        width={isMobile ? "100%" : 500}
        destroyOnHidden
      >
        {viewing && (
          <Space direction="vertical" style={{ width: "100%" }} size="large">
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Planificación">
                <strong>{getPlanningDisplayName(viewing, cropIx)}</strong>
              </Descriptions.Item>
              <Descriptions.Item label="Estado">{statusTag(viewing.status_effective || viewing.status)}</Descriptions.Item>
              <Descriptions.Item label="Campaña">
                {viewing.campaign_name || "—"}
              </Descriptions.Item>
              {viewing.title && !viewing.crop_id && !viewing.crop_name && (
                <Descriptions.Item label="Título histórico">{viewing.title}</Descriptions.Item>
              )}
              <Descriptions.Item label="Período">
                {formatPeriod(viewing)}
              </Descriptions.Item>
              <Descriptions.Item label="Responsable">
                {userIx[viewing.responsible_user] || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Vehículo">
                {vehIx[viewing.vehicle_id] || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Superficie planificada">
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
                    {item.area_ha ? <span style={{ marginLeft: 8, color: "#595959" }}>{formatHa(item.area_ha)}</span> : null}
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
                  const details = [product.amount, product.unit].filter(Boolean).join(" ");
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
                {sowingCompletion.planning.campaign_name || "—"}
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
                    {item.area_ha ? <span style={{ marginLeft: 8, color: "#595959" }}>{formatHa(item.area_ha)}</span> : null}
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
                      return campaignContainsFormalDate(campaign, dayjs(dateKey))
                        ? Promise.resolve()
                        : Promise.reject(new Error("La fecha efectiva de siembra debe estar dentro del período formal de la campaña."));
                    },
                  },
                ]}
              >
                <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
              </Form.Item>

              <Form.Item label="Productos utilizados" style={{ marginBottom: 0 }}>
                {renderActualProductsForm(sowingCompletion.planning)}
              </Form.Item>
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
              message="Confirmá la fecha real del trabajo y las cantidades efectivamente utilizadas."
            />

            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Planificación">
                {getPlanningDisplayName(workCompletion.planning, cropIx)}
              </Descriptions.Item>
              <Descriptions.Item label="Campaña">
                {workCompletion.planning.campaign_name || "—"}
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
                    {item.area_ha ? <span style={{ marginLeft: 8, color: "#595959" }}>{formatHa(item.area_ha)}</span> : null}
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

              <Form.Item label="Productos utilizados" style={{ marginBottom: 0 }}>
                {renderActualProductsForm(workCompletion.planning)}
              </Form.Item>
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
                <Form.Item name="start_date" label="Fecha de inicio" rules={[{ required: true, message: "Seleccioná la fecha de inicio" }]}>
                  <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={5}>
                <Form.Item
                  name="end_date"
                  label="Fecha de finalización"
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
            rowKey={(campaign) => campaign.id ?? campaign._id}
            locale={{ emptyText: "No hay campañas cargadas" }}
            columns={[
              { title: "Campaña", dataIndex: "name" },
              {
                title: "Trabajos desde",
                dataIndex: "work_start_date",
                render: (_, campaign) => formatCampaignWorkStart(campaign),
              },
              {
                title: "Inicio",
                dataIndex: "start_date",
                render: (value) => value ? dayjs(value).format("DD/MM/YYYY") : "—",
              },
              {
                title: "Fin",
                dataIndex: "end_date",
                render: (value) => value ? dayjs(value).format("DD/MM/YYYY") : "En curso",
              },
              {
                title: "Estado",
                dataIndex: "status",
                render: (_, campaign) => {
                  const displayStatus = getCampaignDisplayStatus(campaign);
                  return (
                    <Tag color={campaign.status === "active" ? "green" : (displayStatus === "Próxima" ? "blue" : "default")}>
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
              label="Fecha de inicio"
              rules={[{ required: true, message: "Seleccioná la fecha de inicio" }]}
            >
              <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item
              name="end_date"
              label="Fecha de finalización"
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
        isMobile && !isDrawerOpen && canCreate && (
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

