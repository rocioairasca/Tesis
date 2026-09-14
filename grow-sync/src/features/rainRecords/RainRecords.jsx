import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Form, Input, InputNumber, Select, Pagination, notification } from 'antd';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { PageHeader, Metric, FilterBar, CategoryTag, StatusBadge, RowActions, EmptyState, LoadingState, ErrorState, FocusModal, ConfirmDialog } from '../../components/ui';
import { tokens } from '../../theme/tokens';
import { rainPeriod, rainSummary, formatRain } from './rainPresentation.mjs';
import './rainRecords.css';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PERMISSIONS } from "../../constants/permissions";
import { hasPermission } from "../../utils/permissions";
import {
  createRainRecord,
  disableRainRecord,
  enableRainRecord,
  getMonthlyRainStats,
  getRainRecords,
  syncTodayRainRecord,
  updateRainRecord,
} from "../../services/rainRecordsService";
import { getUserFriendlyError } from "../../utils/userFriendlyErrors";


const SOURCE_LABELS = {
  api: { label: "API" },
  manual: { label: "Manual" },
  edited_api: { label: "API corregida" },
};

const formatDate = (value) => {
  if (!value) return "-";
  const dateText = String(value).slice(0, 10);
  const [year, month, day] = dateText.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
};

const toDateInput = (value) => {
  if (!value) return "";
  return String(value).slice(0, 10);
};

const getBrowserLocation = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) {
    reject(new Error("Tu navegador no permite obtener la ubicacion actual."));
    return;
  }

  navigator.geolocation.getCurrentPosition(
    ({ coords: { latitude, longitude } }) => resolve({ latitude, longitude }),
    (error) => reject(error),
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
});

const RainRecords = () => {

  const currentUser = JSON.parse(localStorage.getItem("user") || "null");
  const canCreate = hasPermission(currentUser, PERMISSIONS.RAIN_RECORDS_CREATE);
  const canEdit = hasPermission(currentUser, PERMISSIONS.RAIN_RECORDS_EDIT);
  const canDisable = hasPermission(currentUser, PERMISSIONS.RAIN_RECORDS_DISABLE);
  const canEnable = hasPermission(currentUser, PERMISSIONS.RAIN_RECORDS_ENABLE);

  const [form] = Form.useForm();
  const [records, setRecords] = useState([]);
  const [monthlyStats, setMonthlyStats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [period, setPeriod] = useState('6');
  const [recordsError, setRecordsError] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [disableTarget, setDisableTarget] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 0,
  });

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setRecordsError(null);
    try {
      const response = await getRainRecords({
        page: pagination.page,
        pageSize: pagination.pageSize,
        includeDisabled: statusFilter === "all",
        onlyDisabled: statusFilter === "disabled",
      });

      setRecords(response?.data || []);
      setPagination((prev) => ({
        ...prev,
        ...(response?.pagination || {}),
      }));
    } catch (error) {
      setRecordsError(error);
      notification.error({
        message: getUserFriendlyError(error, "No se pudieron cargar los registros de lluvia."),
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, pagination.page, pagination.pageSize]);

  const fetchMonthlyStats = useCallback(async () => {
    setStatsLoading(true); setStatsError(null);
    try {
      const data = await getMonthlyRainStats();
      setMonthlyStats((data || []).map((item) => ({
        month: item.month,
        rain_mm: Number(item.rain_mm || 0),
      })));
    } catch (error) {
      setStatsError(error);
    } finally { setStatsLoading(false); }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    fetchMonthlyStats();
  }, [fetchMonthlyStats]);

  const refreshAll = () => {
    fetchRecords();
    fetchMonthlyStats();
  };

  const openDrawer = (record = null) => {
    setEditingRecord(record);
    form.setFieldsValue({
      date: toDateInput(record?.date) || new Date().toISOString().slice(0, 10),
      rain_mm: record?.rain_mm ?? undefined,
      notes: record?.notes || "",
    });
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingRecord(null);
    form.resetFields();
  };

  const handleSubmit = async (values) => {
    try {
      const payload = {
        date: values.date,
        rain_mm: Number(values.rain_mm),
        notes: values.notes || null,
      };

      if (editingRecord?.id) {
        await updateRainRecord(editingRecord.id, payload);
        notification.success({ message: "Registro de lluvia actualizado" });
      } else {
        await createRainRecord({ ...payload, source: "manual" });
        notification.success({ message: "Registro de lluvia creado" });
      }

      closeDrawer();
      refreshAll();
    } catch (error) {
      console.error("Error al guardar registro de lluvia:", error);
      notification.error({
        message: getUserFriendlyError(error, "No se pudo guardar el registro de lluvia."),
      });
    }
  };

  const handleDisable = async (id) => {
    try {
      await disableRainRecord(id);
      notification.success({ message: "Registro de lluvia deshabilitado" });
      refreshAll();
    } catch (error) {
      notification.error({
        message: getUserFriendlyError(error, "No se pudo deshabilitar el registro."),
      });
      throw error;
    }
  };

  const handleEnable = async (id) => {
    try {
      await enableRainRecord(id);
      notification.success({ message: "Registro de lluvia habilitado" });
      refreshAll();
    } catch (error) {
      notification.error({
        message: getUserFriendlyError(error, "No se pudo habilitar el registro."),
      });
    }
  };

  const handleSyncToday = async () => {
    setSyncing(true);
    try {
      const coords = await getBrowserLocation();
      const response = await syncTodayRainRecord(coords);

      if (response?.skipped) {
        notification.warning({
          message: "Sincronizacion omitida",
          description: response.message,
        });
      } else {
        notification.success({
          message: "Lluvia sincronizada",
          description: response?.message,
        });
      }

      refreshAll();
    } catch (error) {
      const permissionDenied = error?.code === 1;
      notification.error({
        message: permissionDenied
          ? "Permiso de ubicación denegado"
          : getUserFriendlyError(error, "No se pudo sincronizar la lluvia de hoy."),
      });
    } finally {
      setSyncing(false);
    }
  };

  const chartRows = useMemo(() => rainPeriod(monthlyStats, period), [monthlyStats, period]);
  const summary = useMemo(() => rainSummary(monthlyStats), [monthlyStats]);
  const changeStatus = value => { setStatusFilter(value); setPagination(prev => ({...prev, page:1})); };
  const actions = record => [
    {key:'edit', label:'Editar', hidden:!record.enabled || !canEdit, onClick:()=>openDrawer(record)},
    {key:'enable', label:'Habilitar', hidden:record.enabled || !canEnable, onClick:()=>handleEnable(record.id)},
    {key:'disable', label:'Deshabilitar', danger:true, hidden:!record.enabled || !canDisable, onClick:()=>setDisableTarget(record)},
  ];
  return <div className="gs-rain">
    <PageHeader title="Registro de lluvias" description="Consultá y registrá las precipitaciones del establecimiento."
      primaryAction={{label:'Registrar lluvia', icon:<PlusIcon />, hidden:!canCreate, onClick:()=>openDrawer()}}
      secondaryActions={[{key:'sync',label:syncing?'Sincronizando…':'Sincronizar lluvia de hoy',icon:<ArrowsClockwiseIcon />,disabled:!canCreate || syncing,onClick:handleSyncToday}]} />
    <div className="gs-rain-overview">
      <section className="gs-rain-panel gs-rain-summary" aria-label="Resumen de lluvias">
        <h2>Resumen</h2>
        {statsLoading ? <LoadingState rows={2}/> : statsError ? <ErrorState message="No se pudo cargar el resumen." onRetry={fetchMonthlyStats}/> : <>
          <Metric compact label="Este mes" value={`${formatRain(summary.month)} mm`} />
          <Metric compact label="Acumulado del año" value={`${formatRain(summary.year)} mm`} />
        </>}
      </section>
      <section className="gs-rain-panel" aria-label="Lluvia acumulada por mes">
        <div className="gs-rain-panel-heading"><h2>Lluvia acumulada por mes</h2><Select aria-label="Período del gráfico" value={period} onChange={setPeriod} options={[{value:'6',label:'Últimos 6 meses'},{value:'12',label:'Últimos 12 meses'},{value:'year',label:'Año actual'}]}/></div>
        <div className="gs-rain-chart">
          {statsLoading ? <LoadingState rows={4}/> : statsError ? <ErrorState message="No se pudo cargar el gráfico." onRetry={fetchMonthlyStats}/> : !chartRows.some(row=>row.recorded) ? <EmptyState title="Sin lluvias registradas en este período" description="Elegí otro período o registrá una precipitación."/> : <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={chartRows} margin={{top:16,right:8,bottom:0,left:0}} accessibilityLayer>
              <CartesianGrid vertical={false} stroke={tokens.border} strokeDasharray="3 3"/>
              <XAxis dataKey="label" tick={{fontSize:12,fill:tokens.textSecondary}} tickLine={false} axisLine={false} minTickGap={8}/>
              <YAxis width={44} tick={{fontSize:12,fill:tokens.textSecondary}} tickLine={false} axisLine={false} tickFormatter={formatRain} label={{value:'mm',angle:-90,position:'insideLeft',offset:4}}/>
              <RechartsTooltip cursor={{fill:tokens.surfaceSelected}} itemStyle={{color:tokens.textPrimary}} formatter={(value,_,entry)=>[entry.payload.recorded?`${formatRain(value)} mm`:'Sin registros','Lluvia']} labelFormatter={(_,payload)=>payload?.[0]?.payload.month || ''}/>
              <Bar dataKey="rain_mm" fill={tokens.brand.accent} radius={[4,4,0,0]} maxBarSize={44}/>
            </BarChart>
          </ResponsiveContainer>}
        </div>
      </section>
    </div>
    <section className="gs-rain-panel gs-rain-history" aria-label="Historial de lluvias">
      <div className="gs-rain-panel-heading"><h2>Historial de lluvias</h2>
        <FilterBar moreFilters={<label className="gs-rain-state-filter">Estado<Select aria-label="Estado de los registros" value={statusFilter} onChange={changeStatus} options={[{value:'active',label:'Activos'},{value:'disabled',label:'Deshabilitados'},{value:'all',label:'Todos'}]}/></label>}
          activeFilters={statusFilter==='active'?[]:[{key:'status',label:statusFilter==='all'?'Todos los registros':'Deshabilitados',onRemove:()=>changeStatus('active')}]}/>
      </div>
      {recordsError ? <ErrorState message="No se pudo cargar el historial de lluvias." onRetry={fetchRecords}/> : loading ? <LoadingState label="Cargando registros…"/> : !records.length ? <EmptyState title="No hay lluvias registradas" description={statusFilter==='active'?'Registrá una precipitación o sincronizá la lluvia del día.':'No hay registros que coincidan con el filtro.'} action={canCreate?{label:'Registrar lluvia',onClick:()=>openDrawer()}:undefined}/> : <>
        <ul className="gs-rain-records">{records.map(record=><li key={record.id}>
          <time dateTime={toDateInput(record.date)}>{formatDate(record.date)}</time>
          <strong className="gs-rain-amount">{formatRain(record.rain_mm)} <span>mm</span></strong>
          <div className="gs-rain-origin"><CategoryTag>{SOURCE_LABELS[record.source]?.label || record.source || 'Sin fuente'}</CategoryTag>{!record.enabled && <StatusBadge>Deshabilitado</StatusBadge>}</div>
          <RowActions label={`Acciones del ${formatDate(record.date)}`} actions={actions(record)}/>
          {record.notes && <p className="gs-rain-notes">{record.notes}</p>}
        </li>)}</ul>
        <Pagination current={pagination.page} pageSize={pagination.pageSize} total={pagination.total} showSizeChanger={false} responsive onChange={(page)=>setPagination(prev=>({...prev,page}))}/>
      </>}
    </section>
    <ConfirmDialog open={!!disableTarget} title="Deshabilitar registro" description={`¿Querés deshabilitar la lluvia del ${formatDate(disableTarget?.date)}?`} consequences="El registro se conservará y podrá consultarse desde los filtros." destructive confirmLabel="Deshabilitar" onCancel={()=>setDisableTarget(null)} onConfirm={()=>handleDisable(disableTarget.id)} onSuccess={()=>setDisableTarget(null)}/>
    <FocusModal title={editingRecord?'Editar registro de lluvia':'Registrar lluvia'} open={isDrawerOpen} onCancel={closeDrawer}>
        <Form layout="vertical" form={form} onFinish={handleSubmit}>
          {editingRecord?.source === "api" && (
            <p className="gs-ui-helper">
              Al editar este registro, la fuente pasará a API corregida.
            </p>
          )}

          <Form.Item
            name="date"
            label="Fecha"
            rules={[{ required: true, message: "Ingresá la fecha." }]}
          >
            <Input type="date" />
          </Form.Item>

          <Form.Item
            name="rain_mm"
            label="Lluvia (mm)"
            rules={[{ required: true, message: "Ingresá los milímetros de lluvia." }]}
          >
            <InputNumber min={0} step={0.1} precision={2} decimalSeparator="," style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item name="notes" label="Notas (opcional)">
            <Input.TextArea rows={3} placeholder="Observaciones o correcciones" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editingRecord ? "Actualizar registro" : "Guardar registro"}
            </Button>
          </Form.Item>
        </Form>
    </FocusModal>
  </div>;
};
export default RainRecords;
