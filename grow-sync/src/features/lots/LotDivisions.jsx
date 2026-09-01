import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Divider,
  Empty,
  Form,
  List,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  notification,
} from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';

import api from '../../services/apiClient';
import useIsMobile from '../../hooks/useIsMobile';
import { PERMISSIONS } from '../../constants/permissions';
import { hasPermission } from '../../utils/permissions';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  PlusOutlined,
  SyncOutlined,
} from '../../components/AppIcons';
import SubLotEditor from './components/SubLotEditor';
import { getUserFriendlyError } from '../../utils/userFriendlyErrors';

const { Text, Title } = Typography;

const getId = (record) => record?.id ?? record?._id;
const formatHa = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00';
};

const formatPercent = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('es-AR', { maximumFractionDigits: 1 }) : '0';
};

const formatDate = (value) => {
  if (!value) return 'Actual';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
};

const formatActivity = (value) => {
  const labels = {
    siembra: 'Siembra',
    fumigacion: 'Fumigación',
    fertilizacion: 'Fertilización',
    cosecha: 'Cosecha',
    riego: 'Riego',
    mantenimiento: 'Mantenimiento',
    otro: 'Actividad',
    uso_producto: 'Uso de producto',
    ciclo_cultivo: 'Ciclo de cultivo',
  };
  return labels[value] || value || 'Actividad';
};

const toDateKey = (value) => value ? dayjs(value).format('YYYY-MM-DD') : null;

const campaignContainsDate = (campaign, dateKey) => (
  campaign?.start_date
  && dateKey >= String(campaign.start_date).slice(0, 10)
  && (!campaign.end_date || dateKey <= String(campaign.end_date).slice(0, 10))
);

const statusColor = {
  draft: 'gold',
  active: 'green',
  locked: 'blue',
  archived: 'default',
};

const statusLabel = {
  draft: 'En edición',
  active: 'Activa',
  locked: 'Histórica',
  archived: 'Archivada',
};

const canRequestDeleteLayout = (layout) => (
  layout?.status === 'draft'
  && !layout?.activated_at
  && !layout?.locked_at
  && !layout?.archived_at
);

const friendlyErrorMessage = (error, fallback = 'No pudimos guardar los cambios. Intentá nuevamente.') => (
  getUserFriendlyError(error, fallback)
);

const findSingleCompatibleCampaign = (campaigns = [], dateKey) => {
  const compatible = campaigns.filter((campaign) => campaignContainsDate(campaign, dateKey));
  return compatible.length === 1 ? compatible[0] : null;
};

class SubLotEditorErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.boundaryKey !== this.props.boundaryKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error, info) {
    console.error('[SUBLOT EDITOR ERROR]', { error, info });
  }

  retry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Alert
          type="error"
          showIcon
          message="No pudimos cargar el editor de sublotes."
          description="Reintentá abrir el editor. Si vuelve a fallar, los detalles quedaron registrados en la consola."
          action={(
            <Button size="small" onClick={this.retry}>
              Reintentar
            </Button>
          )}
        />
      );
    }

    return this.props.children;
  }
}

const LotDivisions = () => {
  const { lotId } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [lot, setLot] = useState(null);
  const [layouts, setLayouts] = useState([]);
  const [selectedLayoutId, setSelectedLayoutId] = useState(null);
  const [selectedLayout, setSelectedLayout] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState(null);
  const [productiveState, setProductiveState] = useState(null);
  const [history, setHistory] = useState([]);
  const [crops, setCrops] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [cropModal, setCropModal] = useState({ open: false, mode: 'create', unit: null, assignment: null });
  const [subLotDirty, setSubLotDirty] = useState(false);
  const [cropForm] = Form.useForm();

  const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
  const canManageProductiveState =
    hasPermission(currentUser, PERMISSIONS.PLANNING_CREATE)
    || hasPermission(currentUser, PERMISSIONS.PLANNING_EDIT);

  const activeLayout = useMemo(
    () => layouts.find((layout) => layout.status === 'active') || null,
    [layouts]
  );

  const selectedSummary = selectedLayout || layouts.find((layout) => layout.id === selectedLayoutId) || activeLayout;
  const editable = selectedLayout?.status === 'draft';
  const productiveUnits = Array.isArray(productiveState?.units) ? productiveState.units : [];

  const locationOptions = useMemo(() => productiveUnits.map((unit) => ({
    value: `${unit.lot_id}|${unit.sub_lot_id || ''}`,
    label: unit.sub_lot_id ? `Lote ${unit.name}` : `Lote completo (${lot?.name || unit.name})`,
    lot_id: unit.lot_id,
    sub_lot_id: unit.sub_lot_id || null,
  })), [lot?.name, productiveUnits]);

  const cropLocationOptions = useMemo(() => {
    const options = [...locationOptions];
    const assignment = cropModal.assignment;
    if (assignment?.lot_id) {
      const value = `${assignment.lot_id}|${assignment.sub_lot_id || ''}`;
      if (!options.some((option) => option.value === value)) {
        options.push({
          value,
          label: assignment.sub_lot_name || assignment.lot_name || 'Ubicación histórica',
        });
      }
    }
    return options;
  }, [cropModal.assignment, locationOptions]);

  const fetchLot = useCallback(async () => {
    const { data } = await api.get('/lots', {
      params: {
        includeDisabled: true,
        pageSize: 1000,
      },
    });
    const list = Array.isArray(data) ? data : data?.items || data?.data || [];
    const found = list.find((item) => getId(item) === lotId);
    if (!found) {
      throw new Error('Lote no encontrado');
    }
    setLot(found);
  }, [lotId]);

  const fetchLayouts = useCallback(async (preferredLayoutId = null) => {
    const { data } = await api.get(`/lots/${lotId}/layouts`);
    const list = Array.isArray(data) ? data : data?.items || data?.data || [];
    const detailedList = await Promise.all(
      list.map(async (layout) => {
        try {
          const detailResponse = await api.get(`/lots/${lotId}/layouts/${layout.id}`);
          return detailResponse.data?.layout || detailResponse.data || layout;
        } catch {
          return layout;
        }
      })
    );
    setLayouts(detailedList);

    const nextSelected =
      (preferredLayoutId && detailedList.find((layout) => layout.id === preferredLayoutId)) ||
      detailedList.find((layout) => layout.status === 'draft') ||
      detailedList.find((layout) => layout.status === 'active') ||
      detailedList[0] ||
      null;

    setSelectedLayoutId(nextSelected?.id || null);
    return nextSelected;
  }, [lotId]);

  const fetchLayoutDetail = useCallback(async (layoutId) => {
    if (!layoutId) {
      setSelectedLayout(null);
      return null;
    }

    const { data } = await api.get(`/lots/${lotId}/layouts/${layoutId}`);
    const detail = data?.layout || data;
    setSelectedLayout(detail);
    return detail;
  }, [lotId]);

  const fetchProductiveState = useCallback(async () => {
    const { data } = await api.get(`/lots/${lotId}/productive-state`);
    setProductiveState(data);
  }, [lotId]);

  const fetchProductiveHistory = useCallback(async () => {
    const { data } = await api.get(`/lots/${lotId}/history`);
    const list = Array.isArray(data) ? data : data?.data || [];
    setHistory(list);
  }, [lotId]);

  const fetchProductiveOptions = useCallback(async () => {
    const [campaignsResponse, cropsResponse] = await Promise.all([
      api.get('/campaigns', { params: { includeClosed: true } }),
      api.get('/crops'),
    ]);
    const nextCampaigns = Array.isArray(campaignsResponse.data) ? campaignsResponse.data : [];
    const nextCrops = Array.isArray(cropsResponse.data) ? cropsResponse.data : [];
    setCampaigns(nextCampaigns);
    setCrops(nextCrops);
    return { campaigns: nextCampaigns, crops: nextCrops };
  }, []);

  const refreshAll = useCallback(async (preferredLayoutId = null) => {
    setLoading(true);
    try {
      await fetchLot();
      const nextLayout = await fetchLayouts(preferredLayoutId);
      await fetchLayoutDetail(nextLayout?.id);
      await Promise.all([
        fetchProductiveState(),
        fetchProductiveHistory(),
      ]);
    } catch (error) {
      console.error('Error al cargar divisiones:', error);
      notification.error({
        message: 'Error al cargar divisiones del lote',
        description: friendlyErrorMessage(error, 'No se pudieron cargar las divisiones del lote.'),
      });
    } finally {
      setLoading(false);
    }
  }, [fetchLayoutDetail, fetchLayouts, fetchLot, fetchProductiveHistory, fetchProductiveState]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    setValidation(null);
    fetchLayoutDetail(selectedLayoutId).catch((error) => {
      console.error('Error al cargar división:', error);
      notification.error({ message: 'No se pudo cargar la división seleccionada' });
    });
  }, [fetchLayoutDetail, selectedLayoutId]);

  const createDraftLayout = async () => {
    setSaving(true);
    try {
      const { data } = await api.post(`/lots/${lotId}/layouts`, {
        name: `Nueva división ${new Date().toLocaleDateString('es-AR')}`,
      });
      const layout = data?.layout || data;
      notification.success({ message: 'Nueva división creada' });
      await refreshAll(layout.id);
    } catch (error) {
      console.error('Error al crear división:', error);
      notification.error({
        message: 'No se pudo crear la división',
        description: friendlyErrorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteLayout = async (layout) => {
    if (!layout?.id) return;

    Modal.confirm({
      title: '¿Eliminar esta versión?',
      content: 'Se eliminará la división que está en edición. Esta acción no afecta la división activa del lote.',
      okText: 'Eliminar',
      cancelText: 'Cancelar',
      okButtonProps: { danger: true },
      onOk: async () => {
        setSaving(true);
        try {
          setValidation(null);
          await api.delete(`/lots/${lotId}/layouts/${layout.id}`);
          notification.success({ message: 'Versión eliminada' });
          await refreshAll(
            selectedLayoutId === layout.id ? null : selectedLayoutId
          );
        } catch (error) {
          console.error('Error al eliminar división:', error);
          notification.error({
            message: 'No se pudo eliminar la versión',
            description: friendlyErrorMessage(
              error,
              'Esta división ya tiene información asociada y no puede eliminarse.'
            ),
          });
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const saveSubLotChanges = async ({ subLots = [] } = {}) => {
    if (!selectedLayoutId) return;

    const url = `/lots/${lotId}/layouts/${selectedLayoutId}/sub-lots`;
    const payload = { subLots };

    setSaving(true);
    try {
      setValidation(null);

      if (import.meta.env.DEV) {
        console.log('[SUBLOT BATCH SAVE]', {
          method: 'PUT',
          url,
          lotId,
          layoutId: selectedLayoutId,
          subLots: payload.subLots,
        });
      }

      const { data } = await api.put(url, payload);
      if (data?.validation) setValidation(data.validation);
      if (data?.layout) setSelectedLayout(data.layout);
      notification.success({ message: 'Cambios guardados' });
      setSubLotDirty(false);
      await refreshAll(selectedLayoutId);
    } catch (error) {
      console.error('Error al guardar cambios de sublotes:', error);
      if (import.meta.env.DEV) {
        console.error('[SUBLOT BATCH SAVE ERROR]', {
          status: error.response?.status,
          data: error.response?.data,
          url,
          payload,
        });
      }
      notification.error({
        message: 'No pudimos guardar la división. Revisá los datos e intentá nuevamente.',
        description: friendlyErrorMessage(error),
      });
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const validateLayout = async () => {
    if (!selectedLayoutId) return null;
    if (subLotDirty) {
      notification.warning({ message: 'Guardá los cambios antes de comprobar la división.' });
      return null;
    }

    setSaving(true);
    try {
      const { data } = await api.post(`/lots/${lotId}/layouts/${selectedLayoutId}/validate`);
      setValidation(data);
      const missingHa = Number(data?.summary?.coverage_missing_ha || 0);
      const withinTolerance = data?.summary?.coverage_within_tolerance === true && missingHa > 0.005;

      if (data.valid) {
        notification.success({
          message: withinTolerance
            ? 'La división está dentro de la tolerancia de cobertura.'
            : 'La división cubre correctamente el lote.',
        });
      } else {
        notification.warning({ message: 'La división todavía tiene observaciones' });
      }
      return data;
    } catch (error) {
      console.error('Error al comprobar división:', error);
      notification.error({
        message: 'No se pudo comprobar la división',
        description: friendlyErrorMessage(error),
      });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const activateLayout = async () => {
    if (!selectedLayoutId || !validation?.valid) return;

    Modal.confirm({
      title: 'Activar división',
      content: 'Esta división pasará a ser la configuración vigente del lote. La configuración anterior quedará guardada como histórica.',
      okText: 'Activar división',
      cancelText: 'Cancelar',
      onOk: async () => {
        setSaving(true);
        try {
          await api.post(`/lots/${lotId}/layouts/${selectedLayoutId}/activate`);
          notification.success({ message: 'División activada' });
          setValidation(null);
          await refreshAll(selectedLayoutId);
        } catch (error) {
          console.error('Error al activar layout:', error);
          notification.error({
            message: 'No se pudo activar la división',
            description: friendlyErrorMessage(error),
          });
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const openCropModal = async ({ mode = 'create', unit = null, assignment = null } = {}) => {
    try {
      let availableCampaigns = campaigns;
      let availableCrops = crops;
      if (!crops.length || !campaigns.length) {
        const options = await fetchProductiveOptions();
        availableCampaigns = options.campaigns;
        availableCrops = options.crops;
      }
      const startDate = assignment?.start_date ? dayjs(assignment.start_date) : dayjs();
      const dateKey = toDateKey(startDate);
      const suggestedCampaign = assignment?.campaign_id
        ? null
        : findSingleCompatibleCampaign(availableCampaigns, dateKey);
      const selectedLocation = assignment
        ? `${assignment.lot_id}|${assignment.sub_lot_id || ''}`
        : (unit ? `${unit.lot_id || lotId}|${unit.sub_lot_id || ''}` : undefined);

      setCropModal({ open: true, mode, unit, assignment });
      cropForm.setFieldsValue({
        location_key: selectedLocation,
        crop_id: assignment?.crop_id || availableCrops[0]?.id || undefined,
        campaign_id: assignment?.campaign_id || suggestedCampaign?.id || undefined,
        start_date: startDate,
        end_date: assignment?.end_date ? dayjs(assignment.end_date) : null,
      });
    } catch (error) {
      console.error('Error al cargar opciones productivas:', error);
      notification.error({
        message: 'No se pudo abrir el registro de cultivo',
        description: friendlyErrorMessage(error, 'No se pudieron cargar cultivos y campañas.'),
      });
    }
  };

  const closeCropModal = () => {
    setCropModal({ open: false, mode: 'create', unit: null, assignment: null });
    cropForm.resetFields();
  };

  const handleStartDateChange = (dateValue) => {
    const dateKey = toDateKey(dateValue);
    const matchingCampaign = findSingleCompatibleCampaign(campaigns, dateKey);
    if (matchingCampaign) {
      cropForm.setFieldValue('campaign_id', matchingCampaign.id);
    }
  };

  const saveCropAssignment = async (values) => {
    const [selectedLotId, selectedSubLotId = ''] = String(values.location_key).split('|');
    const campaign = campaigns.find((item) => item.id === values.campaign_id);
    const startDate = toDateKey(values.start_date);
    const endDate = toDateKey(values.end_date);

    if (!campaignContainsDate(campaign, startDate) || (endDate && !campaignContainsDate(campaign, endDate))) {
      notification.error({ message: 'La fecha seleccionada no corresponde a la campaña elegida.' });
      return;
    }

    const payload = {
      campaign_id: values.campaign_id,
      lot_id: selectedLotId,
      sub_lot_id: selectedSubLotId || null,
      crop_id: values.crop_id,
      start_date: startDate,
      end_date: endDate,
    };

    setSaving(true);
    try {
      if (cropModal.assignment?.id) {
        await api.put(`/crop-assignments/${cropModal.assignment.id}`, payload);
        notification.success({ message: 'El ciclo productivo fue actualizado.' });
      } else {
        await api.post('/crop-assignments', payload);
        notification.success({ message: 'El cultivo fue registrado.' });
      }
      if (campaign?.status === 'closed') {
        notification.info({ message: 'Esta campaña está cerrada. Estás cargando información histórica.' });
      }
      closeCropModal();
      await Promise.all([fetchProductiveState(), fetchProductiveHistory()]);
    } catch (error) {
      console.error('Error al guardar cultivo:', error);
      notification.error({
        message: 'No se pudo guardar el cultivo',
        description: friendlyErrorMessage(error, 'No se pudo guardar el cultivo.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const renderPreviousCrops = (previousCrops = []) => {
    if (!previousCrops.length) return <Text type="secondary">Sin cultivo anterior registrado</Text>;
    if (previousCrops.length === 1) return <Text>{previousCrops[0].crop_name}</Text>;

    return (
      <Space wrap>
        {previousCrops.map((crop) => (
          <Tag key={crop.crop_id || crop.crop_name}>
            {crop.crop_name} · {formatPercent(crop.percentage)}%
          </Tag>
        ))}
      </Space>
    );
  };

  const renderProductiveState = () => (
    <Card
      size="small"
      title="Estado productivo"
      extra={canManageProductiveState && productiveUnits.length > 0 ? (
        <Button size="small" type="primary" onClick={() => openCropModal()}>
          Registrar cultivo
        </Button>
      ) : null}
      style={{ marginBottom: 16 }}
    >
      {!productiveUnits.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No hay unidades productivas para mostrar" />
      ) : (
        <List
          dataSource={productiveUnits}
          grid={{ gutter: 12, xs: 1, sm: 1, md: productiveState?.mode === 'sub_lots' ? 2 : 1 }}
          renderItem={(unit) => (
            <List.Item>
              <Card
                size="small"
                className="productive-state-card"
                title={(
                  <Space direction="vertical" size={0}>
                    <Text strong>{unit.sub_lot_id ? unit.name : `${lot?.name || unit.name} completo`}</Text>
                    <Text type="secondary">{formatHa(unit.area_ha)} ha</Text>
                  </Space>
                )}
              >
                <Row gutter={[12, 12]}>
                  <Col xs={24} sm={12}>
                    <Text type="secondary">Cultivo actual</Text>
                    <div>
                      {unit.current_crop?.crop_name ? (
                        <Text strong>{unit.current_crop.crop_name}</Text>
                      ) : (
                        <Text type="secondary">Sin cultivo asignado actualmente</Text>
                      )}
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <Text type="secondary">Desde</Text>
                    <div>{unit.current_crop?.start_date ? formatDate(unit.current_crop.start_date) : '-'}</div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <Text type="secondary">Campaña</Text>
                    <div>{unit.current_crop?.campaign_name || '-'}</div>
                  </Col>
                  <Col span={24}>
                    <Text type="secondary">
                      {unit.previous_crops?.length > 1 ? 'Cultivos anteriores' : 'Cultivo anterior'}
                    </Text>
                    <div>{renderPreviousCrops(unit.previous_crops)}</div>
                  </Col>
                </Row>
                {canManageProductiveState && unit.current_crop?.assignment_id && !unit.current_crop?.end_date ? (
                  <Button
                    size="small"
                    style={{ marginTop: 12 }}
                    onClick={() => openCropModal({
                      mode: 'finalize',
                      unit,
                      assignment: {
                        id: unit.current_crop.assignment_id,
                        campaign_id: unit.current_crop.campaign_id,
                        lot_id: unit.current_crop.lot_id || unit.lot_id,
                        sub_lot_id: unit.current_crop.sub_lot_id || null,
                        crop_id: unit.current_crop.crop_id,
                        crop_name: unit.current_crop.crop_name,
                        start_date: unit.current_crop.start_date,
                        end_date: unit.current_crop.end_date,
                      },
                    })}
                  >
                    Finalizar ciclo
                  </Button>
                ) : null}
              </Card>
            </List.Item>
          )}
        />
      )}
    </Card>
  );

  const renderHistoryProducts = (products = []) => {
    if (!products.length) return null;

    return (
      <Space direction="vertical" size={2}>
        <Text type="secondary">{products.length === 1 ? 'Producto' : 'Productos'}</Text>
        {products.map((product) => (
          <Text key={`${product.product_id}-${product.name}`}>
            {product.name || 'Producto'}
            {' · '}
            {Number(product.amount || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}
            {product.unit ? ` ${product.unit}` : ''}
          </Text>
        ))}
      </Space>
    );
  };

  const renderHistoryDetails = (event) => {
    if (event.type === 'harvest') {
      return (
        <Space direction="vertical" size={2}>
          {event.details?.yield_kg_ha != null && (
            <Text>Rendimiento: {Number(event.details.yield_kg_ha).toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg/ha</Text>
          )}
          {event.details?.production_kg != null && (
            <Text>Producción: {Number(event.details.production_kg).toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg</Text>
          )}
        </Space>
      );
    }

    if (event.type === 'crop_cycle') {
      return (
        <Text type="secondary">
          {formatDate(event.details?.start_date)} - {formatDate(event.details?.end_date)}
        </Text>
      );
    }

    return null;
  };

  const renderProductiveHistory = () => (
    <Card size="small" title="Historial del lote">
      <List
        dataSource={history}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No hay actividades registradas" /> }}
        renderItem={(event) => {
          const isManualCropCycle = event.type === 'crop_cycle';
          const cropAssignment = isManualCropCycle ? {
            ...event,
            id: event.source_id,
            crop_name: event.crop,
            campaign_name: event.campaign,
            start_date: event.details?.start_date,
            end_date: event.details?.end_date,
          } : null;

          return (
            <List.Item
              actions={canManageProductiveState && isManualCropCycle ? [
                <Button type="link" size="small" onClick={() => openCropModal({ mode: 'edit', assignment: cropAssignment })}>
                  Editar
                </Button>,
              ] : []}
            >
              <List.Item.Meta
                title={(
                  <Space wrap>
                    <Text strong>{event.title || formatActivity(event.activity_type)}</Text>
                    {event.campaign && <Tag>{event.campaign}</Tag>}
                    {event.registered_retroactively && <Tag>Registrada posteriormente</Tag>}
                  </Space>
                )}
                description={(
                  <Space direction="vertical" size={4}>
                    <Text type="secondary">
                      {formatDate(event.event_date)}
                      {' · '}
                      {event.sub_lot_name || 'Lote completo'}
                      {event.area_ha ? ` · ${formatHa(event.area_ha)} ha` : ''}
                    </Text>
                    {event.crop && <Text>Cultivo: {event.crop}</Text>}
                    {renderHistoryProducts(event.products)}
                    {renderHistoryDetails(event)}
                    {event.description && <Text type="secondary">{event.description}</Text>}
                  </Space>
                )}
              />
            </List.Item>
          );
        }}
      />
    </Card>
  );

  const confirmDiscardSubLotChanges = (onDiscard) => {
    if (!subLotDirty) {
      onDiscard();
      return;
    }

    Modal.confirm({
      title: 'Tenés cambios sin guardar. ¿Querés descartarlos?',
      okText: 'Descartar cambios',
      cancelText: 'Seguir editando',
      okButtonProps: { danger: true },
      onOk: () => {
        setSubLotDirty(false);
        onDiscard();
      },
    });
  };

  const renderLayoutCard = (layout) => {
    const subLots = layout.sub_lots || [];
    const isSelected = selectedLayoutId === layout.id;

    return (
      <List.Item
        onClick={() => {
          if (layout.id === selectedLayoutId) return;
          confirmDiscardSubLotChanges(() => setSelectedLayoutId(layout.id));
        }}
        style={{
          cursor: 'pointer',
          background: isSelected ? '#f6ffed' : '#fff',
          border: isSelected ? '1px solid #95ba56' : '1px solid #f0f0f0',
          borderRadius: 8,
          padding: 12,
          marginBottom: 8,
        }}
      >
        <List.Item.Meta
          title={(
            <Space wrap align="center">
              <Text strong>Versión {layout.version}</Text>
              <Tag color={statusColor[layout.status] || 'default'}>
                {statusLabel[layout.status] || layout.status}
              </Tag>
            </Space>
          )}
          description={(
            <Space direction="vertical" size={4}>
              <Text>
                {subLots.length ? `${subLots.length} sublotes` : 'Lote completo'}
                {' · '}
                {formatHa(layout.parent_area_ha_snapshot)} ha
              </Text>
            </Space>
          )}
        />
        {canRequestDeleteLayout(layout) ? (
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            title="Eliminar versión"
            aria-label="Eliminar versión"
            loading={saving}
            onClick={(event) => {
              event.stopPropagation();
              deleteLayout(layout);
            }}
          />
        ) : null}
      </List.Item>
    );
  };

  if (loading && !lot) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Row justify="space-between" align="middle" gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col>
          <Space align="center" wrap>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => confirmDiscardSubLotChanges(() => navigate('/lotes'))}
              shape={isMobile ? 'circle' : undefined}
            >
              {isMobile ? null : 'Volver'}
            </Button>
            <div>
              <Title level={3} style={{ margin: 0 }}>{lot?.name || 'Lote'}</Title>
              <Text type="secondary">Superficie total: {formatHa(lot?.area_ha || lot?.area)} ha</Text>
            </div>
          </Space>
        </Col>
        <Col>
          <Space wrap>
            <Button icon={<SyncOutlined />} onClick={() => refreshAll(selectedLayoutId)} loading={loading}>
              Actualizar
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={createDraftLayout} loading={saving}>
              Nueva división
            </Button>
          </Space>
        </Col>
      </Row>

      {activeLayout ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message="División actual del lote"
        />
      ) : (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Este lote todavía no tiene una división actual."
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={7} order={isMobile ? 2 : 1}>
          <Card size="small" title="Historial de divisiones">
            <List
              dataSource={layouts}
              loading={loading}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sin divisiones" /> }}
              renderItem={renderLayoutCard}
            />
          </Card>
        </Col>

        <Col xs={24} lg={17} order={isMobile ? 1 : 2}>
          {renderProductiveState()}

          <Card
            size="small"
            title={(
              <Space wrap>
                <span>
                  {selectedSummary ? `Versión ${selectedSummary.version}` : 'Editor'}
                </span>
                {selectedSummary?.status && (
                  <Tag color={statusColor[selectedSummary.status] || 'default'}>
                    {statusLabel[selectedSummary.status] || selectedSummary.status}
                  </Tag>
                )}
                {validation?.valid && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
              </Space>
            )}
          >
            {selectedLayout ? (
              <SubLotEditorErrorBoundary boundaryKey={selectedLayout.id}>
                <SubLotEditor
                  lot={lot}
                  layout={selectedLayout}
                  editable={editable}
                  validation={validation}
                  saving={saving}
                  isMobile={isMobile}
                  onValidate={validateLayout}
                  onActivate={activateLayout}
                  onSaveChanges={saveSubLotChanges}
                  onDirtyChange={setSubLotDirty}
                />
              </SubLotEditorErrorBoundary>
            ) : (
              <Empty description="Seleccioná o creá una división" />
            )}
          </Card>

          <div style={{ marginTop: 16 }}>
            {renderProductiveHistory()}
          </div>
        </Col>
      </Row>

      <Modal
        title={cropModal.mode === 'finalize' ? 'Finalizar ciclo' : cropModal.assignment ? 'Editar cultivo' : 'Registrar cultivo'}
        open={cropModal.open}
        onCancel={closeCropModal}
        onOk={() => cropForm.submit()}
        okText={cropModal.mode === 'finalize' ? 'Finalizar ciclo' : 'Guardar'}
        cancelText="Cancelar"
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form layout="vertical" form={cropForm} onFinish={saveCropAssignment}>
          {cropModal.mode !== 'finalize' ? (
            <>
              <Form.Item
                name="location_key"
                label="Superficie"
                rules={[{ required: true, message: 'Seleccioná la superficie.' }]}
              >
                <Select
                  placeholder="Seleccioná la superficie"
                  options={cropLocationOptions}
                  disabled={Boolean(cropModal.unit)}
                />
              </Form.Item>
              <Form.Item
                name="crop_id"
                label="Cultivo"
                rules={[{ required: true, message: 'Seleccioná el cultivo.' }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={crops.map((crop) => ({ value: crop.id, label: crop.name }))}
                />
              </Form.Item>
            </>
          ) : (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`Vas a finalizar el ciclo de ${cropModal.assignment?.crop_name || 'este cultivo'}.`}
            />
          )}

          {cropModal.mode === 'finalize' ? (
            <>
              <Form.Item name="location_key" hidden>
                <Select options={cropLocationOptions} />
              </Form.Item>
              <Form.Item name="crop_id" hidden>
                <Select options={crops.map((crop) => ({ value: crop.id, label: crop.name }))} />
              </Form.Item>
            </>
          ) : null}

          <Form.Item
            name="campaign_id"
            label="Campaña"
            rules={[{ required: true, message: 'Seleccioná la campaña.' }]}
          >
            <Select
              disabled={cropModal.mode === 'finalize'}
              options={campaigns.map((campaign) => ({
                value: campaign.id,
                label: `${campaign.name}${campaign.status === 'closed' ? ' · cerrada' : ''}`,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="start_date"
            label="Desde"
            rules={[{ required: true, message: 'Seleccioná la fecha de inicio.' }]}
          >
            <DatePicker
              style={{ width: '100%' }}
              format="DD/MM/YYYY"
              disabled={cropModal.mode === 'finalize'}
              onChange={handleStartDateChange}
            />
          </Form.Item>

          <Form.Item
            name="end_date"
            label={cropModal.mode === 'finalize' ? 'Fecha de finalización' : 'Hasta'}
            rules={cropModal.mode === 'finalize' ? [{ required: true, message: 'Seleccioná la fecha de finalización.' }] : []}
          >
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>

          <Divider />
          <Text type="secondary">
            La superficie se calcula automáticamente según la ubicación seleccionada.
          </Text>
        </Form>
      </Modal>
    </div>
  );
};

export default LotDivisions;
