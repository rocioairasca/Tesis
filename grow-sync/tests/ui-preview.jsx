// Dev-only fixture, absent from the production entry graph. All data is in memory.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Button, ConfigProvider, Input, Select, Space, Switch } from 'antd';
import { appTheme } from '../src/theme/theme';
import { cssVariables } from '../src/theme/tokens';
import { PageHeader, FilterBar, StatusBadge, CategoryTag, Metric, ViewSwitcher, EmptyState, EntityLink, LoadingState, ErrorState, DataTable, FocusModal, FormDrawer, ConfirmDialog } from '../src/components/ui';
import { InboxOutlined } from '../src/components/AppIcons';
import '../src/index.css';
import '../src/layout/shell.css';
import '@ant-design/v5-patch-for-react-19';
import './ui-preview.css';

const fixtures = Array.from({ length: 13 }, (_, i) => ({ id: i + 1, name: `Entidad de ejemplo ${i + 1}`, category: i % 2 ? 'Categoría B' : 'Categoría A', status: i % 3 ? 'Disponible' : 'En revisión', quantity: i + 1 }));
function Preview() {
  const [query, setQuery] = useState(''), [category, setCategory] = useState(null), [status, setStatus] = useState(null);
  const [view, setView] = useState('table'), [overlay, setOverlay] = useState(null), [notice, setNotice] = useState('');
  const [keys, setKeys] = useState([]), [page, setPage] = useState(1), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false);
  const [failConfirmation, setFailConfirmation] = useState(false);
  const rows = fixtures.filter(r => (!query || r.name.toLowerCase().includes(query.toLowerCase())) && (!category || r.category === category) && (!status || r.status === status));
  const update = setter => value => { setter(value); setPage(1); };
  const columns = [
    { title: 'Nombre', dataIndex: 'name', render: (name, row) => <EntityLink onClick={() => { setNotice(`Detalle de ${row.name}`); setOverlay('drawer'); }}>{name}</EntityLink> },
    { title: 'Categoría', dataIndex: 'category', render: value => <CategoryTag>{value}</CategoryTag> },
    { title: 'Estado', dataIndex: 'status', render: value => <StatusBadge tone={value === 'Disponible' ? 'success' : 'warning'}>{value}</StatusBadge> },
    { title: 'Cantidad', dataIndex: 'quantity', align: 'right' },
  ];
  return <main className="ui-preview">
    <PageHeader title="Patrones compartidos" description="Vista de desarrollo · datos ficticios · sin operaciones reales" breadcrumb={[{ title: 'GrowSync' }, { title: 'Componentes' }]}
      primaryAction={{ label: 'Abrir modal', onClick: () => setOverlay('modal') }} secondaryActions={[{ key: 'drawer', label: 'Abrir drawer', onClick: () => setOverlay('drawer') }, { key: 'confirm', label: 'Probar confirmación', onClick: () => setOverlay('confirm') }]} />
    <p role="status">{notice}</p>
    <section aria-label="Indicadores" className="ui-preview-metrics"><Metric label="Registros de ejemplo" value={13} helper="Valores ficticios" icon={<InboxOutlined />} /><Metric label="En revisión" value={5} status={{ tone: 'warning', label: 'Revisar' }} onClick={() => update(setStatus)('En revisión')} /><Metric compact label="Seleccionados" value={keys.length} helper="Variante compacta" /></section>
    <section className="ui-preview-section"><h2>Estado y clasificación</h2><Space wrap>{[['success','Completado'],['warning','En demora'],['danger','Vencido'],['info','Planificado'],['neutral','Deshabilitado']].map(([tone,label]) => <StatusBadge key={tone} tone={tone}>{label}</StatusBadge>)}<CategoryTag>Categoría A</CategoryTag><EntityLink disabled>Entidad no disponible</EntityLink></Space></section>
    <section className="ui-preview-section">
      <FilterBar search={{ label: 'Buscar ejemplos', placeholder: 'Buscar ejemplos…', value: query, onChange: update(setQuery) }}
        filters={<Select aria-label="Categoría" placeholder="Todas las categorías" allowClear value={category} onChange={update(setCategory)} options={['Categoría A','Categoría B'].map(value=>({value,label:value}))} style={{minWidth:180}} />}
        moreFilters={<Select aria-label="Estado" placeholder="Todos los estados" allowClear value={status} onChange={update(setStatus)} options={['Disponible','En revisión'].map(value=>({value,label:value}))} />}
        activeFilters={[...(category?[{key:'category',label:category,onRemove:()=>update(setCategory)(null)}]:[]),...(status?[{key:'status',label:status,onRemove:()=>update(setStatus)(null)}]:[])]}
        onClear={()=>{setCategory(null);setStatus(null);setPage(1);}} />
      <div className="ui-preview-controls"><ViewSwitcher value={view} onChange={setView} options={[{label:'Tabla',value:'table'},{label:'Resumen',value:'summary'}]} /><Space wrap><Switch aria-label="Simular carga" checked={loading} onChange={setLoading} /> Carga <Switch aria-label="Simular error" checked={failed} onChange={setFailed} /> Error</Space></div>
      {view==='table'?<DataTable title="Listado de ejemplo" columns={columns} dataSource={rows} rowLabel={r=>r.name} loading={loading} error={failed?new Error('SQL stack internalservererror'):null} onRetry={()=>setFailed(false)}
        pagination={{current:page,pageSize:5,onChange:setPage}} rowSelection={{selectedRowKeys:keys,onChange:setKeys}}
        empty={{title:'No encontramos ejemplos con estos filtros',description:'Probá con otro nombre o limpiá los filtros.'}}
        actions={row=>[{key:'view',label:'Ver detalle',onClick:()=>{setNotice(row.name);setOverlay('drawer');}},{key:'disable',label:'Deshabilitar ejemplo',danger:true,onClick:()=>setOverlay('confirm')}]} />
        : <Metric label="Registros que coinciden" value={rows.length} helper="Otra representación del mismo contenido" compact />}
    </section>
    <section className="ui-preview-section"><h2>Estados compartidos</h2><EmptyState title="Todavía no hay registros en esta colección" description="Una acción clara ayuda a empezar." action={{label:'Crear ejemplo',onClick:()=>setOverlay('modal')}} /><LoadingState variant="action" label="Guardando ejemplo…" /><ErrorState error={new Error('SQL constraint')} onRetry={()=>setNotice('Reintento de ejemplo solicitado')} /></section>
    <FocusModal open={overlay==='modal'} title="Operación breve" onCancel={()=>setOverlay(null)} footer={<Space><Button onClick={()=>setOverlay(null)}>Cancelar</Button><Button type="primary" onClick={()=>{setNotice('Ejemplo guardado en memoria.');setOverlay(null);}}>Guardar ejemplo</Button></Space>}><p>Un modal concentra una operación corta.</p><label htmlFor="example-name">Nombre de ejemplo</label><Input id="example-name" /></FocusModal>
    <FormDrawer open={overlay==='drawer'} title="Contexto del ejemplo" wide onClose={()=>setOverlay(null)} footer={<Button type="primary" onClick={()=>setOverlay(null)}>Listo</Button>}><p>Drawer amplio con pie persistente y pantalla completa en mobile.</p>{Array.from({length:12},(_,i)=><p key={i}>Sección {i+1}: información ficticia que permite comprobar el desplazamiento del contenido.</p>)}</FormDrawer>
    {overlay==='confirm'&&<ConfirmDialog open title="Deshabilitar ejemplo" description="El ejemplo dejaría de aparecer en la lista activa." consequences="Su historial se conservaría. Esta prueba no modifica ningún registro real." confirmLabel="Deshabilitar ejemplo" destructive onCancel={()=>setOverlay(null)} onConfirm={async()=>{await new Promise(resolve=>setTimeout(resolve,600));if(failConfirmation)throw new Error('SQL constraint failure');}} onSuccess={()=>{setNotice('Confirmación completada sin modificar datos.');setOverlay(null);}}/>}
    <label className="ui-preview-controls"><Switch checked={failConfirmation} onChange={setFailConfirmation} /> Simular fallo en la confirmación</label>
  </main>;
}
Object.entries(cssVariables).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
if(import.meta.env.DEV)createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><MemoryRouter><Preview/></MemoryRouter></ConfigProvider>);
