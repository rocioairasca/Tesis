import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  List,
  Modal,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  notification,
} from 'antd';
import { useNavigate, useParams } from 'react-router-dom';

import api from '../../services/apiClient';
import useIsMobile from '../../hooks/useIsMobile';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  PlusOutlined,
  SyncOutlined,
} from '../../components/AppIcons';
import SubLotEditor from './components/SubLotEditor';

const { Text, Title } = Typography;

const getId = (record) => record?.id ?? record?._id;
const formatHa = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

const statusColor = {
  draft: 'gold',
  active: 'green',
  locked: 'blue',
  archived: 'default',
};

const statusLabel = {
  draft: 'Draft',
  active: 'Active',
  locked: 'Locked',
  archived: 'Archived',
};

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

  const activeLayout = useMemo(
    () => layouts.find((layout) => layout.status === 'active') || null,
    [layouts]
  );

  const selectedSummary = selectedLayout || layouts.find((layout) => layout.id === selectedLayoutId) || activeLayout;
  const editable = selectedLayout?.status === 'draft';

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

  const refreshAll = useCallback(async (preferredLayoutId = null) => {
    setLoading(true);
    try {
      await fetchLot();
      const nextLayout = await fetchLayouts(preferredLayoutId);
      await fetchLayoutDetail(nextLayout?.id);
    } catch (error) {
      console.error('Error al cargar divisiones:', error);
      notification.error({
        message: 'Error al cargar divisiones del lote',
        description: error?.response?.data?.message || error.message,
      });
    } finally {
      setLoading(false);
    }
  }, [fetchLayoutDetail, fetchLayouts, fetchLot]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    setValidation(null);
    fetchLayoutDetail(selectedLayoutId).catch((error) => {
      console.error('Error al cargar layout:', error);
      notification.error({ message: 'No se pudo cargar el layout seleccionado' });
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
      console.error('Error al crear layout:', error);
      notification.error({
        message: 'No se pudo crear la división',
        description: error?.response?.data?.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const createSubLot = async (payload) => {
    if (!selectedLayoutId) return;
    setSaving(true);
    try {
      setValidation(null);
      await api.post(`/lots/${lotId}/layouts/${selectedLayoutId}/sub-lots`, payload);
      notification.success({ message: 'Sublote guardado' });
      await refreshAll(selectedLayoutId);
    } catch (error) {
      console.error('Error al guardar sublote:', error);
      notification.error({
        message: 'No se pudo guardar el sublote',
        description: error?.response?.data?.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const updateSubLot = async (subLotId, payload) => {
    if (!selectedLayoutId) return;
    setSaving(true);
    try {
      setValidation(null);
      await api.put(`/lots/${lotId}/layouts/${selectedLayoutId}/sub-lots/${subLotId}`, payload);
      notification.success({ message: 'Sublote actualizado' });
      await refreshAll(selectedLayoutId);
    } catch (error) {
      console.error('Error al actualizar sublote:', error);
      notification.error({
        message: 'No se pudo actualizar el sublote',
        description: error?.response?.data?.message,
      });
      await refreshAll(selectedLayoutId);
    } finally {
      setSaving(false);
    }
  };

  const deleteSubLot = async (subLotId) => {
    if (!selectedLayoutId) return;

    Modal.confirm({
      title: 'Eliminar sublote',
      content: 'El sublote se quitará del layout draft.',
      okText: 'Eliminar',
      cancelText: 'Cancelar',
      okButtonProps: { danger: true },
      onOk: async () => {
        setSaving(true);
        try {
          setValidation(null);
          await api.delete(`/lots/${lotId}/layouts/${selectedLayoutId}/sub-lots/${subLotId}`);
          notification.success({ message: 'Sublote eliminado' });
          await refreshAll(selectedLayoutId);
        } catch (error) {
          console.error('Error al eliminar sublote:', error);
          notification.error({
            message: 'No se pudo eliminar el sublote',
            description: error?.response?.data?.message,
          });
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const validateLayout = async () => {
    if (!selectedLayoutId) return null;
    setSaving(true);
    try {
      const { data } = await api.post(`/lots/${lotId}/layouts/${selectedLayoutId}/validate`);
      setValidation(data);
      if (data.valid) {
        notification.success({ message: 'La división cubre correctamente el 100% del lote.' });
      } else {
        notification.warning({ message: 'La división todavía tiene observaciones' });
      }
      return data;
    } catch (error) {
      console.error('Error al validar layout:', error);
      notification.error({
        message: 'No se pudo validar la división',
        description: error?.response?.data?.message,
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
            description: error?.response?.data?.message,
          });
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const renderLayoutCard = (layout) => {
    const subLots = layout.sub_lots || [];
    const isSelected = selectedLayoutId === layout.id;

    return (
      <List.Item
        onClick={() => setSelectedLayoutId(layout.id)}
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
            <Space wrap>
              <Text strong>Versión {layout.version}</Text>
              <Tag color={statusColor[layout.status] || 'default'}>
                {statusLabel[layout.status] || layout.status}
              </Tag>
            </Space>
          )}
          description={(
            <Space direction="vertical" size={4}>
              <Text type="secondary">{layout.name || 'Sin nombre'}</Text>
              <Text>
                {subLots.length ? `${subLots.length} sublotes` : 'Lote completo'}
                {' - '}
                {formatHa(layout.parent_area_ha_snapshot)} ha
              </Text>
              {subLots.map((subLot) => (
                <Text key={subLot.id} type="secondary">
                  {subLot.name} - {formatHa(subLot.area_ha)} ha
                </Text>
              ))}
            </Space>
          )}
        />
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
              onClick={() => navigate('/lotes')}
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
          message={`Layout activo actual: Versión ${activeLayout.version}`}
        />
      ) : (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Este lote todavía no tiene un layout activo."
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={7} order={isMobile ? 2 : 1}>
          <Card size="small" title="Historial de divisiones">
            <List
              dataSource={layouts}
              loading={loading}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sin layouts" /> }}
              renderItem={renderLayoutCard}
            />
          </Card>
        </Col>

        <Col xs={24} lg={17} order={isMobile ? 1 : 2}>
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
              <SubLotEditor
                lot={lot}
                layout={selectedLayout}
                editable={editable}
                validation={validation}
                saving={saving}
                isMobile={isMobile}
                onCreateSubLot={createSubLot}
                onUpdateSubLot={updateSubLot}
                onDeleteSubLot={deleteSubLot}
                onValidate={validateLayout}
                onActivate={activateLayout}
              />
            ) : (
              <Empty description="Seleccioná o creá una división" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default LotDivisions;
