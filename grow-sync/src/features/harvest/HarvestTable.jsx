import { campaignOptions, campaignValue } from '../../utils/campaigns.mjs';
import React, { useEffect, useMemo, useState } from 'react';
import { Select } from 'antd';
import { AppIcons } from '../../components/AppIcons';
import { FilterBar, Metric, ViewSwitcher, DataTable, EntityLink, ConfirmDialog, LoadingState, ErrorState } from '../../components/ui';
import { getHarvestRecords, getHarvestFilters, disableHarvestRecord, enableHarvestRecord } from '../../services/harvestService';
import { dashboardSource } from '../dashboard/dashboardSource';
import { readAllPages } from '../dashboard/dashboardModel.mjs';
import api from '../../services/apiClient';
import { formatCalendarDate } from '../../utils/calendarDate';
import { formatNumber } from '../../utils/numberFormat';
import { formatHectares } from '../../utils/harvestUtils';
import { PERMISSIONS } from '../../constants/permissions';
import { hasPermission } from '../../utils/permissions';
import { cropLabel, campaignLabel, surfaceLabel, authorLabel, filterHarvestRows, readHarvestPages } from './harvestPresentation.mjs';
import HarvestCharts from './HarvestCharts';
import HarvestDetail from './HarvestDetail';

const defaults = { campaign:undefined, crop:undefined, surface:undefined, search:'', state:'active', origin:undefined };
export default function HarvestTable({ refreshKey = 0, onEdit, lots = [], isMobile = false }) {
  const [user] = useState(()=>JSON.parse(localStorage.getItem('user') || 'null'));
  const canStats = Number(user?.role) >= 1;
  const canDisabled = hasPermission(user,PERMISSIONS.HARVEST_VIEW_DISABLED);
  const canEdit = hasPermission(user,PERMISSIONS.HARVEST_EDIT);
  const [filters,setFilters] = useState(defaults), [view,setView] = useState('table');
  const [records,setRecords] = useState([]), [loading,setLoading] = useState(true), [error,setError] = useState(null);
  const [analytics,setAnalytics] = useState(null), [statsLoading,setStatsLoading] = useState(false), [statsError,setStatsError] = useState(null);
  const [options,setOptions] = useState({campaigns:[],crops:[]}), [users,setUsers] = useState([user]);
  const [selected,setSelected] = useState(null), [confirmation,setConfirmation] = useState(null), [revision,setRevision] = useState(0), [page,setPage] = useState(1);
  const change = (key,value) => {setFilters(previous=>({...previous,[key]:value}));setPage(1);};
  useEffect(()=>{
    let cancelled = false;
    setLoading(true);setError(null);
    readHarvestPages(getHarvestRecords,{campaign:filters.campaign,crop:filters.crop,onlyDisabled:canDisabled&&filters.state==='disabled'?'true':'false',includeDisabled:canDisabled&&filters.state==='all'?'true':'false'},()=>cancelled)
      .then(rows=>{if(!cancelled)setRecords(rows);}).catch(reason=>{if(!cancelled)setError(reason);}).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[filters.campaign,filters.crop,filters.state,canDisabled,refreshKey,revision]);
  useEffect(()=>{
    if(!canStats)return;
    let cancelled=false;setStatsLoading(true);setStatsError(null);setAnalytics(null);
    dashboardSource.production({filters:{campaign:filters.campaign,crop:filters.crop,unit:'kg'}})
      .then(data=>{if(!cancelled)setAnalytics(data);}).catch(reason=>{if(!cancelled)setStatsError(reason);}).finally(()=>{if(!cancelled)setStatsLoading(false);});
    return ()=>{cancelled=true;};
  },[canStats,filters.campaign,filters.crop,refreshKey,revision]);
  useEffect(()=>{
    if(!canStats)return;
    let cancelled=false;
    getHarvestFilters().then(data=>{if(!cancelled)setOptions({...data,campaigns:data.campaigns||[],crops:data.crops||[]});}).catch(()=>{});
    return ()=>{cancelled=true;};
  },[canStats,refreshKey,revision]);
  useEffect(()=>{
    // Existing users endpoint requires administrator role, independently of UI permissions.
    if(!(Number(user?.role)>=3) || !hasPermission(user,PERMISSIONS.USERS_VIEW))return;
    let cancelled=false;
    readAllPages(async params=>(await api.get('/users',{params})).data,{includeDisabled:true})
      .then(data=>{if(!cancelled)setUsers([user,...data.data]);}).catch(()=>{});
    return ()=>{cancelled=true;};
  },[user]);
  const visible = useMemo(()=>filterHarvestRows(records,filters),[records,filters]);
  const selectOptions = (values,extra) => [...new Set([...values,...extra])].filter(Boolean).map(value=>({value,label:value}));
  const surfaceOptions = [...new Map(records.map(row=>[row.sub_lot_id?`sub:${row.sub_lot_id}`:`lot:${row.lot_id}`,surfaceLabel(row)])).entries()].map(([value,label])=>({value,label}));
  const actions = row => [
    {key:'detail',label:'Ver detalle',onClick:()=>setSelected(row)},
    {key:'edit',label:'Editar',hidden:!row.enabled||!canEdit,onClick:()=>onEdit(row)},
    {key:'disable',label:'Deshabilitar',danger:true,hidden:!row.enabled||!hasPermission(user,PERMISSIONS.HARVEST_DISABLE),onClick:()=>setConfirmation(row)},
    {key:'enable',label:'Habilitar',hidden:row.enabled||!hasPermission(user,PERMISSIONS.HARVEST_ENABLE),onClick:()=>setConfirmation(row)},
  ];
  const clipped = value => <span className="gs-harvest-ellipsis" title={value}>{value}</span>;
  const columns = [
    {title:'Fecha',dataIndex:'harvest_date',width:110,render:value=>formatCalendarDate(value)},
    {title:'Cultivo',key:'crop',render:(_,row)=><span className="gs-harvest-crop"><AppIcons.crop/>{clipped(cropLabel(row))}</span>},
    {title:'Lote / Sublote',key:'surface',render:(_,row)=><><EntityLink onClick={()=>setSelected(row)}>{clipped(surfaceLabel(row))}</EntityLink>{row.sub_lot_name&&<small className="gs-harvest-ellipsis" title={row.lot_name}>{row.lot_name}</small>}</>},
    {title:'Superficie',dataIndex:'harvested_area_ha',width:110,render:formatHectares},
    {title:'Producción',dataIndex:'production_kg',width:125,render:value=>`${formatNumber(value)} kg`},
    {title:'Rendimiento',dataIndex:'yield_kg_ha',width:130,render:value=>`${formatNumber(value)} kg/ha`},
    {title:'Campaña',key:'campaign',render:(_,row)=>clipped(campaignLabel(row))},
    {title:'Registrado por',key:'author',render:(_,row)=>clipped(authorLabel(row,users))},
  ];
  const activeFilters = Object.entries(filters).filter(([key,value])=>value && !(key==='state'&&value==='active')).map(([key,value])=>({key,label:key==='state'?(value==='disabled'?'Deshabilitadas':'Todos los estados'):key==='surface'?surfaceOptions.find(item=>item.value===value)?.label||'Superficie seleccionada':key==='origin'?({historical:'Histórica',current:'Actual',unknown:'Sin procedencia documentada'}[value]):value,onRemove:()=>change(key,defaults[key])}));
  return <>
    {canStats && <>{statsLoading?<LoadingState label="Cargando resumen productivo…" rows={1}/>:statsError?<ErrorState error={statsError} onRetry={()=>setRevision(value=>value+1)}/>:analytics&&<div className="gs-harvest-metrics">
      <Metric compact icon={<AppIcons.area/>} label="Superficie cosechada" value={formatHectares(analytics.summary.total_area_ha)}/>
      <Metric compact icon={<AppIcons.inventory/>} label="Producción total" value={`${formatNumber(analytics.summary.total_production_kg)} kg`}/>
      <Metric compact icon={<AppIcons.harvest/>} label="Rendimiento promedio" value={`${formatNumber(Number(analytics.summary.total_area_ha)>0?analytics.summary.avg_yield_kg_ha:null)} kg/ha`}/>
    </div>}<p className="gs-ui-helper gs-harvest-scope">Resumen y gráficos: cosechas activas de la campaña y cultivo seleccionados. Los demás filtros se aplican al listado.</p></>}
    <FilterBar search={{value:filters.search,onChange:value=>change('search',value),placeholder:'Buscar cosechas…'}} filters={<>
      <Select aria-label="Campaña" placeholder="Todas las campañas" allowClear showSearch optionFilterProp="label" value={filters.campaign} onChange={value=>change('campaign',value)} options={campaignOptions([...new Map([...records.filter(row=>row.campaign_id || row.campaign_name || row.campaign),...(options.campaign_details ?? options.campaigns)].map(row=>[campaignValue(row),row])).values()])}/>
      <Select aria-label="Cultivo" placeholder="Todos los cultivos" allowClear showSearch optionFilterProp="label" value={filters.crop} onChange={value=>change('crop',value)} options={selectOptions(options.crops,records.map(row=>row.crop_name||row.crop))}/>
      <Select aria-label="Lote o sublote" placeholder="Lotes y sublotes" allowClear showSearch optionFilterProp="label" value={filters.surface} onChange={value=>change('surface',value)} options={surfaceOptions}/>
    </>} moreFilters={<>
      {canDisabled&&<label className="gs-harvest-filter-field">Estado<Select aria-label="Estado" value={filters.state} onChange={value=>change('state',value)} options={[{value:'active',label:'Activas'},{value:'disabled',label:'Deshabilitadas'},{value:'all',label:'Todos'}]}/></label>}
      <label className="gs-harvest-filter-field">Procedencia<Select aria-label="Procedencia" placeholder="Todas" allowClear value={filters.origin} onChange={value=>change('origin',value)} options={[{value:'current',label:'Actual'},{value:'historical',label:'Histórica'},{value:'unknown',label:'No documentada'}]}/></label>
    </>} activeFilters={activeFilters} onClear={()=>{setFilters(defaults);setPage(1);}}/>
    <div className="gs-harvest-view"><ViewSwitcher value={view} onChange={setView} options={[{value:'table',label:'Tabla'},{value:'charts',label:'Gráficos',disabled:!canStats}]}/></div>
    <div className={`gs-harvest-workspace ${view==='charts'?'gs-harvest-workspace--charts':''}`}>
      {view==='table'&&<div className="gs-harvest-table"><DataTable title="Registros de cosecha" columns={columns} dataSource={visible} loading={loading} error={error} onRetry={()=>setRevision(value=>value+1)} actions={actions} rowLabel={row=>`${cropLabel(row)} · ${formatCalendarDate(row.harvest_date)}`} pagination={{current:page,pageSize:10,onChange:setPage}} renderMobile={row=><div className="gs-harvest-mobile"><EntityLink onClick={()=>setSelected(row)}><AppIcons.crop/> {surfaceLabel(row)}</EntityLink>{row.sub_lot_name&&<small>{row.lot_name}</small>}<span>{formatHectares(row.harvested_area_ha)} · {formatNumber(row.yield_kg_ha)} kg/ha</span><span>{formatNumber(row.production_kg)} kg · {campaignLabel(row)}</span></div>}/></div>}
      {(!isMobile||view==='charts')&&canStats&&!statsLoading&&!statsError&&analytics&&<aside aria-label="Analítica de cosechas"><HarvestCharts data={analytics}/></aside>}
    </div>
    <HarvestDetail record={selected} lots={lots} users={users} onClose={()=>setSelected(null)} onEdit={canEdit?row=>{setSelected(null);onEdit(row);}:undefined}/>
    <ConfirmDialog open={!!confirmation} title={confirmation?.enabled?'Deshabilitar cosecha':'Habilitar cosecha'} description="¿Querés cambiar el estado de este registro?" consequences="El registro conserva su historial." destructive={!!confirmation?.enabled} confirmLabel={confirmation?.enabled?'Deshabilitar':'Habilitar'} onCancel={()=>setConfirmation(null)} onConfirm={()=>confirmation.enabled?disableHarvestRecord(confirmation.id):enableHarvestRecord(confirmation.id)} onSuccess={()=>{setConfirmation(null);setSelected(null);setRevision(value=>value+1);}}/>
  </>;
}
