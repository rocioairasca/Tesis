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
  return <Section id="dashboard-attention" title="Requiere tu atención" description="Excepciones para revisar antes de empezar.">
    <div className="gs-dashboard-alerts">
      {access.planning && <RequestState request={delayed} label="demoras">{delayed.data > 0 && <Metric icon={<span data-alert-tone="danger"><CalendarOutlined size={24} /></span>} helper="Revisar planificaciones →" compact label="Planificaciones en demora" value={formatNumber(delayed.data, 0)} status={{ tone: 'danger', label: 'Requieren revisión' }} onClick={() => navigate('/planificaciones')} />}</RequestState>}
      {access.inventory && <RequestState request={inventory} label="alertas de inventario">{metrics.map(([key, label, tone, helper]) => <Metric key={key} icon={<span data-alert-tone={tone}><AppstoreOutlined size={24} /></span>} helper="Ver inventario →" compact label={label} value={formatNumber(counts[key], 0)} status={{ tone, label: helper }} onClick={() => navigate('/inventario')} />)}{counts.unknown > 0 && <p className="gs-dashboard-note">Hay productos sin saldo informado. <EntityLink to="/inventario">Revisar inventario</EntityLink></p>}</RequestState>}
    </div>
    {access.inventory && metrics.length > 0 && <p className="gs-dashboard-note">Un producto puede tener más de una alerta. Los vencimientos consideran productos con stock.</p>}
  </Section>;
}
function Work({ request }) {
  const rows = request.data || [];
  return <Section id="dashboard-work" title="Trabajo de hoy" description="Planificaciones abiertas de hoy y los próximos 7 días." action={<EntityLink to="/planificaciones">Ver planificaciones</EntityLink>}>
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
function Weather({ request, canViewRain }) {
  const data = request.data?.reading;
  const fallback = request.data?.fallback;
  const presentation = fallback ? { kind: 'temperature', label: 'Condición no informada' } : getWeatherPresentation(data);
  const observed = data?.date || data?.updated_at;
  const date = observed ? new Date(observed) : null;
  const timestamp = date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', hour12: false }).format(date) : null;
  return <Section id="dashboard-weather" title="Clima" className="gs-dashboard-weather" action={canViewRain && <EntityLink to="/registro-lluvias">Registro de lluvias</EntityLink>}>
    <RequestState request={request} label="clima">
      {!data ? <EmptyState title="No hay un registro climático disponible" /> : <>
        <div className="gs-dashboard-weather-reading"><div className="gs-dashboard-weather-current"><span aria-hidden="true"><WeatherIcon kind={presentation.kind} size={40} /></span><div><strong>{formatNumber(data.temperature, 1)} <small>°C</small></strong><span>{presentation.label}</span></div></div><div className="gs-dashboard-weather-detail"><span><WindIcon size={16} /> Viento</span><strong>{formatNumber(data.wind_speed, 1)}{numberValue(data.wind_speed) != null ? ' km/h' : ''} {numberValue(data.wind_direction) != null ? degToCompass(Number(data.wind_direction)) : ''}</strong></div>{numberValue(data.humidity) != null && <div className="gs-dashboard-weather-detail"><span><DropIcon size={16} /> Humedad</span><strong>{formatNumber(data.humidity, 0)} %</strong></div>}</div>
        <p className="gs-dashboard-note">{fallback ? 'Último registro guardado · ubicación no verificada.' : 'Open-Meteo · ubicación de este dispositivo.'}{timestamp && ` Lectura: ${timestamp}.`}</p>
        {fallback && <StatusBadge tone="warning">No se pudo obtener el clima de tu ubicación</StatusBadge>}
      </>}
    </RequestState>
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
export default function DashboardView({ user, today, access, delayed, work, inventory, weather, field, fieldMap = { status: 'hidden' }, production, options, filters, onFiltersChange }) {
  const name = [user?.full_name, user?.first_name, user?.name, user?.nickname].find(value => typeof value === 'string' && value.trim() && !value.includes('@'))?.trim().split(/\s+/)[0];
  const dateKey = calendarDateKey(today);
  const dateLabel = dateKey ? new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dateKey}T12:00:00Z`)) : '';
  return <div className="gs-dashboard"><PageHeader title={name ? `¡Hola, ${name}!` : '¡Hola!'} description={dateLabel} />
    {(access.planning || access.inventory) && <Attention access={access} delayed={delayed} inventory={inventory} />}
    {access.planning && <Work request={work} />}
    <Weather request={weather} canViewRain={access.rain} />
    {access.field && <Section id="dashboard-field" title="Resumen del campo" action={<EntityLink to="/lotes">Ver lotes</EntityLink>}>
      <RequestState request={field} label="resumen del campo">{field.data?.lots === 0 ? <EmptyState title="Todavía no hay lotes activos" /> : <div className="gs-dashboard-field-kpis"><Metric compact icon={<EnvironmentOutlined size={24} />} label="Lotes activos" value={formatNumber(field.data?.lots, 0)} />{fieldMap.status === 'success' && <><Metric compact icon={<EnvironmentOutlined size={22} />} label="Superficie total" value={fieldMap.data.area == null ? '—' : `${formatNumber(fieldMap.data.area)} ha`} helper={fieldMap.data.area == null ? 'Superficie incompleta' : undefined} /><Metric compact icon={<DivisionsIcon size={22} />} label="Divisiones vigentes" value={formatNumber(fieldMap.data.divisions, 0)} /></>}</div>}</RequestState>
      <RequestState request={fieldMap} label="vista del establecimiento">{fieldMap.status === 'success' && <><StaticFieldOverview geometries={fieldMap.data?.geometries || []} />{fieldMap.data?.missing > 0 && <p className="gs-dashboard-note">{formatNumber(fieldMap.data.missing, 0)} {fieldMap.data.missing === 1 ? 'lote sin geometría utilizable no se muestra' : 'lotes sin geometría utilizable no se muestran'} en la vista.</p>}</>}</RequestState>
    </Section>}
    {access.production && <Production request={production} options={options} filters={filters} onFiltersChange={onFiltersChange} canViewHarvest={access.harvest} />}
  </div>;
}
