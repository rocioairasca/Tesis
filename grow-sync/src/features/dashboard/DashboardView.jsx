import { MY_TASKS_URL, myTaskUrl, TASK_GROUP_LABELS, taskAssignerName } from '../planning/myTasks.mjs';
import {userDisplayName} from '../../utils/userDisplay.mjs';
import { campaignFilterOptions } from '../../utils/campaigns.mjs';
import React from 'react';
import { Select } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PageHeader, Metric, StatusBadge, CategoryTag, EntityLink, LoadingState, ErrorState, EmptyState } from '../../components/ui';
import DashboardChart from './DashboardChart';
import { formatActivity, formatPlanningPeriod, statusLabel, summarizePlanningLots } from '../planning/planningDisplay';
import { formatNumber, harvestUnits, numberValue } from './dashboardModel.mjs';
import { calendarDateKey } from '../../utils/calendarDate';
import { WeatherIcon, getWeatherPresentation, degToCompass } from './weatherPresentation';
import { AppIcons, activityIcons } from '../../components/AppIcons';
const { planning:CalendarOutlined, inventory:AppstoreOutlined, area:EnvironmentOutlined, harvest:DashboardOutlined, crop:HarvestOutlined, wind:WindIcon, drop:DropIcon, crop:CropIcon, person:PersonIcon, clock:ClockIcon, divisions:DivisionsIcon } = AppIcons;
import './dashboard.css';
import StaticFieldOverview from './StaticFieldOverview';

function Section({ id, title, description, action, children, className = '' }) {
  return <section aria-labelledby={id} className={`gs-dashboard-section ${className}`}><div className="gs-dashboard-section-heading"><div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>{children}</section>;
}
function RequestState({ request, label, children }) {
  if (request.status === 'hidden') return null;
  if (request.status === 'loading') return <LoadingState label={`Cargando ${label}…`} rows={2} />;
  if (request.status === 'error') return <div><p className="gs-dashboard-note">No se pudo cargar {label}.</p><ErrorState error={request.error} message="Intentá nuevamente." onRetry={request.retry} /></div>;
  return children;
}
function Attention({ access, delayed, inventory }) {
  const navigate = useNavigate();
  const counts = inventory.data || {};
  const metrics = [
    ['empty', 'Productos sin stock', 'danger', 'Saldo agotado'],
    ['low', 'Productos con stock bajo', 'warning', 'Revisar reposición'],
    ['expired', 'Productos con vencimientos pasados', 'danger', 'Revisar en inventario'],
    ['expiring', 'Productos próximos a vencer', 'warning', 'Dentro de 15 días'],
  ].filter(([key]) => counts[key] > 0).sort((a, b) => (a[2] === 'danger' ? 0 : 1) - (b[2] === 'danger' ? 0 : 1));
  const allLoaded = (!access.planning || delayed.status === 'success') && (!access.inventory || inventory.status === 'success');
  const clear = allLoaded && !(delayed.data > 0) && !metrics.length && !counts.unknown;
  if (clear) return null;
  return <Section className="gs-dashboard-operational" id="dashboard-attention" title="Requiere tu atención" description="Excepciones para revisar antes de empezar.">
    <div className="gs-dashboard-alerts">
      {access.planning && <RequestState request={delayed} label="demoras">{delayed.data > 0 && <Metric icon={<span data-alert-tone="danger"><CalendarOutlined size={24} /></span>} helper="Revisar planificaciones →" compact label="Planificaciones en demora" value={formatNumber(delayed.data, 0)} status={{ tone: 'danger', label: 'Requieren revisión' }} onClick={() => navigate('/planificaciones')} />}</RequestState>}
      {access.inventory && <RequestState request={inventory} label="alertas de inventario">{metrics.map(([key, label, tone, helper]) => <Metric key={key} icon={<span data-alert-tone={tone}><AppstoreOutlined size={24} /></span>} helper="Ver inventario →" compact label={label} value={formatNumber(counts[key], 0)} status={{ tone, label: helper }} onClick={() => navigate('/inventario')} />)}{counts.unknown > 0 && <p className="gs-dashboard-note">Hay productos sin saldo informado. <EntityLink to="/inventario">Revisar inventario</EntityLink></p>}</RequestState>}
    </div>
    {access.inventory && metrics.length > 0 && <p className="gs-dashboard-note">Un producto puede tener más de una alerta. Los vencimientos consideran productos con stock.</p>}
  </Section>;
}
function MyTasks({ request }) {
  const { rows = [], total = 0 } = request.data || {};
  return <Section className="gs-dashboard-operational" id="dashboard-my-tasks" title="Mis tareas" description="Trabajos que tenés asignados." action={<EntityLink to={MY_TASKS_URL}>Ver todas mis tareas</EntityLink>}>
    <RequestState request={request} label="tus tareas">
      {!rows.length ? <EmptyState title="No tenés tareas para hoy ni para los próximos 7 días." description="Podés consultar otras fechas en Ver todas mis tareas." /> : <>
        <p className="gs-dashboard-note gs-dashboard-my-tasks-count">{total} {total === 1 ? 'tarea abierta' : 'tareas abiertas'} · En demora, hoy y próximos 7 días</p>
        <ul className="gs-dashboard-my-tasks">{rows.map(row => {
          const state = row.status_effective || row.status, lots = summarizePlanningLots(row.lots || []);
          const ActivityIcon = activityIcons[row.activity_type] || AppIcons.more;
          const title = row.title?.trim() || formatActivity(row.activity_type), assigner = taskAssignerName(row);
          return <li key={row.id}>
            <div className="gs-dashboard-my-task-main">
              <div className="gs-dashboard-tags"><CategoryTag icon={<ActivityIcon size={18} />}>{formatActivity(row.activity_type)}</CategoryTag><StatusBadge tone={state === 'en_demora' ? 'warning' : state === 'en_progreso' ? 'info' : 'neutral'}>{statusLabel(state)}</StatusBadge></div>
              <strong>{title}</strong><span title={lots.tooltip}>{lots.text === '—' ? 'Sin lote asignado' : lots.text}{row.crop_name ? ' · ' + row.crop_name : ''}</span>
              {assigner && <span className="gs-dashboard-note">Asignado por {assigner}</span>}
            </div>
            <div className="gs-dashboard-my-task-action"><span>{TASK_GROUP_LABELS[row.taskGroup]}</span><span>{formatPlanningPeriod(row)}</span><EntityLink to={myTaskUrl(row.id)} ariaLabel={`Ver tarea: ${title} · ${lots.text}`}>Ver tarea</EntityLink></div>
          </li>;
        })}</ul>
        {total > rows.length && <p className="gs-dashboard-note">Se muestran {rows.length} de {total} tareas. Consultá el listado completo en Ver todas mis tareas.</p>}
      </>}
    </RequestState>
  </Section>;
}
function Work({ request }) {
  const rows = request.data || [];
  return <Section className="gs-dashboard-operational" id="dashboard-work" title="Trabajo del equipo" description="Planificaciones abiertas de hoy y los próximos 7 días." action={<EntityLink to="/planificaciones">Ver planificaciones</EntityLink>}>
    <RequestState request={request} label="planificaciones">
      {!rows.length ? <EmptyState title="No hay trabajo programado en este período" description="Consultá Planificaciones para ver otras fechas y estados." /> : <>
        <ul className="gs-dashboard-work-list">{rows.slice(0, 6).map(row => {
          const state = row.status_effective || row.status;
          const ActivityIcon = activityIcons[row.activity_type] || AppIcons.more;
          const lots = summarizePlanningLots(row.lots || []);
          return <li key={row.id}><div className="gs-dashboard-work-context"><div className="gs-dashboard-tags"><CategoryTag icon={<ActivityIcon size={18} />}>{formatActivity(row.activity_type)}</CategoryTag><StatusBadge tone={state === 'en_demora' ? 'danger' : state === 'en_progreso' ? 'info' : 'neutral'}>{statusLabel(state)}</StatusBadge></div><strong title={lots.tooltip}>{lots.text === '—' ? 'Sin lote asignado' : lots.text}</strong><span className="gs-dashboard-note"><CropIcon size={16} /> {row.crop_name || 'Sin cultivo informado'} · <PersonIcon size={16} /> {row.responsible_name || 'Sin responsable asignado'}</span></div><div className="gs-dashboard-work-date"><span>{row.isToday ? 'Hoy' : 'Próxima'}</span><span><ClockIcon size={16} /> {formatPlanningPeriod(row)}</span></div></li>;
        })}</ul>
        {rows.length > 6 && <p className="gs-dashboard-note">Se muestran 6 de {formatNumber(rows.length, 0)} planificaciones. <EntityLink to="/planificaciones">Ver todas</EntityLink></p>}
      </>}
    </RequestState>
  </Section>;
}
export function Weather({ request, canViewRain }) {
  const data = request.data?.reading;
  const fallback = request.data?.fallback;
  const failure = request.data?.failure;
  const presentation = fallback && data?.weather_code == null
    ? { kind: 'temperature', label: 'Condición no informada' } : getWeatherPresentation(data);
  const observed = data?.observed_at || data?.updated_at || data?.date;
  const dateOnly = typeof observed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(observed);
  const date = observed ? new Date(dateOnly ? observed + 'T12:00:00' : observed) : null;
  const timestamp = date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  }).format(date) + (dateOnly ? '' : ' · ' + new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)) : null;
  const canRetry = request.status === 'error' || (request.status !== 'loading' && fallback && request.data?.retryable !== false);
  return <Section id="dashboard-weather" title="Clima" className="gs-dashboard-weather gs-dashboard-operational" action={<div className="gs-dashboard-weather-actions">
    {canViewRain && <EntityLink to="/registro-lluvias">Registro de lluvias</EntityLink>}
    {canRetry && <EntityLink onClick={request.retry}>Reintentar</EntityLink>}
  </div>}>
    {request.status === 'loading' ? <LoadingState label="Consultando clima…" rows={2} /> : request.status === 'error' ? <ErrorState message="No se pudo consultar el clima." /> : <>
      {!data ? <EmptyState title="No hay un registro climático disponible" description={failure === 'permission_denied' ? 'Habilitá el permiso de ubicación para consultar el clima.' : undefined} /> : <div className="gs-dashboard-weather-body">
        <div className="gs-dashboard-weather-summary">
          {fallback && <StatusBadge tone="warning">Último dato disponible · Desactualizado</StatusBadge>}
          <div className="gs-dashboard-weather-reading"><div className="gs-dashboard-weather-current"><span aria-hidden="true"><WeatherIcon kind={presentation.kind} size={40} /></span><div><strong>{formatNumber(data.temperature, 1)} <small>°C</small></strong><span>{presentation.label}</span></div></div><div className="gs-dashboard-weather-detail"><span><WindIcon size={16} /> Viento</span><strong>{formatNumber(data.wind_speed, 1)}{numberValue(data.wind_speed) != null ? ' km/h' : ''} {numberValue(data.wind_direction) != null ? degToCompass(Number(data.wind_direction)) : ''}</strong></div>{numberValue(data.humidity) != null && <div className="gs-dashboard-weather-detail"><span><DropIcon size={16} /> Humedad</span><strong>{formatNumber(data.humidity, 0)} %</strong></div>}</div>
        </div>
        {timestamp && <p className="gs-dashboard-note gs-dashboard-weather-updated">Última lectura: {timestamp}</p>}
      </div>}
    </>}
  </Section>;
}
function Production({ request, options, filters, onFiltersChange, canViewHarvest }) {
  const data = request.data;
  const summary = data?.summary;
  const hasArea = numberValue(summary?.total_area_ha) > 0;
  const unit = harvestUnits.find(item => item.value === filters.unit) || harvestUnits[0];
  const filter = (key, value) => onFiltersChange({ ...filters, [key]: value });
  return <Section id="dashboard-production" title="Producción y cosecha" description="Resultados de las cosechas registradas." action={canViewHarvest && <EntityLink to="/harvest">Ver cosechas</EntityLink>}>
    <div className="gs-dashboard-filters" role="group" aria-label="Filtros de producción">
      <label>Campaña<Select aria-label="Campaña de producción" placeholder="Todas las campañas" allowClear value={filters.campaign} disabled={options.status !== 'success'} onChange={value => filter('campaign', value)} options={campaignFilterOptions(options.data)} /></label>
      <label>Cultivo<Select aria-label="Cultivo de producción" placeholder="Todos los cultivos" allowClear value={filters.crop} disabled={options.status !== 'success'} onChange={value => filter('crop', value)} options={(options.data?.crops || []).map(value => ({ value, label: value }))} /></label>
      <label>Unidad<Select aria-label="Unidad de producción" value={filters.unit} onChange={value => filter('unit', value)} options={harvestUnits} /></label>
    </div>
    {options.status !== 'success' && <RequestState request={options} label="filtros de producción" />}
    <RequestState request={request} label="producción">
      {!summary || Number(summary.total_records) === 0 ? <EmptyState title="No hay cosechas para esta selección" description="Probá otra campaña o cultivo para consultar sus resultados." /> : <>
        <div className="gs-dashboard-metrics"><Metric icon={<HarvestOutlined size={24} />} label="Producción total" value={`${formatNumber(summary.total_production_kg)} ${unit.value}`} helper={`${formatNumber(summary.total_records, 0)} ${Number(summary.total_records) === 1 ? 'registro' : 'registros'} de cosecha`} /><Metric icon={<EnvironmentOutlined size={24} />} label="Superficie cosechada" value={`${formatNumber(hasArea ? summary.total_area_ha : null)} ha`} helper={hasArea ? "Superficie registrada en cosechas" : "Sin superficie informada"} /><Metric icon={<DashboardOutlined size={24} />} label="Rendimiento promedio" value={`${formatNumber(hasArea ? summary.avg_yield_kg_ha : null)} ${unit.yieldLabel}`} helper={hasArea ? "Ponderado por superficie cosechada" : "Requiere superficie cosechada"} /></div>
        <div className="gs-dashboard-charts"><DashboardChart kind="yield" rows={data.byCrop} unit={unit.value} yieldUnit={unit.yieldLabel} /><DashboardChart kind="campaign" rows={data.byCampaign} unit={unit.value} /></div>
      </>}
    </RequestState>
  </Section>;
}
export default function DashboardView({ user, today, access, delayed, myTasks = { status: 'loading' }, work, inventory, weather, field, fieldMap = { status: 'hidden' }, production, options, filters, onFiltersChange }) {
  const name = userDisplayName(user).split(/\s+/)[0];
  const dateKey = calendarDateKey(today);
  const dateLabel = dateKey ? new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dateKey}T12:00:00Z`)) : '';
  return <div className="gs-dashboard"><PageHeader title={name ? `¡Hola, ${name}!` : '¡Hola!'} description={dateLabel} />
    <div className="gs-dashboard-row">
      <Weather request={weather} canViewRain={access.rain} />
      {(access.planning || access.inventory) && <Attention access={access} delayed={delayed} inventory={inventory} />}
    </div>
    {(access.planning || access.teamWork) && <div className="gs-dashboard-row">
      {access.planning && <MyTasks request={myTasks} />}
      {access.teamWork && <Work request={work} />}
    </div>}
    {access.field && <Section id="dashboard-field" title="Resumen del campo" action={<EntityLink to="/lotes">Ver lotes</EntityLink>}>
      <RequestState request={field} label="resumen del campo">{field.data?.lots === 0 ? <EmptyState title="Todavía no hay lotes activos" /> : <div className="gs-dashboard-field-kpis"><Metric compact icon={<EnvironmentOutlined size={24} />} label="Lotes activos" value={formatNumber(field.data?.lots, 0)} />{fieldMap.status === 'success' && <><Metric compact icon={<EnvironmentOutlined size={22} />} label="Superficie total" value={fieldMap.data.area == null ? '—' : `${formatNumber(fieldMap.data.area)} ha`} helper={fieldMap.data.area == null ? 'Superficie incompleta' : undefined} /><Metric compact icon={<DivisionsIcon size={22} />} label="Divisiones vigentes" value={formatNumber(fieldMap.data.divisions, 0)} /></>}</div>}</RequestState>
      <RequestState request={fieldMap} label="vista del establecimiento">{fieldMap.status === 'success' && <><StaticFieldOverview geometries={fieldMap.data?.geometries || []} />{fieldMap.data?.missing > 0 && <p className="gs-dashboard-note">{formatNumber(fieldMap.data.missing, 0)} {fieldMap.data.missing === 1 ? 'lote sin geometría utilizable no se muestra' : 'lotes sin geometría utilizable no se muestran'} en la vista.</p>}</>}</RequestState>
    </Section>}
    {access.production && <Production request={production} options={options} filters={filters} onFiltersChange={onFiltersChange} canViewHarvest={access.harvest} />}
  </div>;
}
