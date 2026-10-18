import React,{useCallback,useEffect,useState} from 'react';
import {Alert,Button,Form,Select,Space,message} from 'antd';
import {PlusOutlined} from '../../components/AppIcons';
import {PageHeader,FilterBar,DataTable,EntityLink,StatusBadge,ConfirmDialog,FormDrawer} from '../../components/ui';
import {PERMISSIONS} from '../../constants/permissions';
import {hasPermission} from '../../utils/permissions';
import {getUserFriendlyError} from '../../utils/userFriendlyErrors';
import api from '../../services/apiClient';
import RecipeForm from './components/RecipeForm';
import {activityLabel,contextLabel,doseLabel,filterRecipes,recipePayload,recipeProducts,RECIPE_ACTIVITIES} from './recipeModel.mjs';
import './recipes.css';
export default function Recipes(){
  const user=JSON.parse(localStorage.getItem('user')||'null');
  const allowed=key=>hasPermission(user,key);
  const canDisabled=allowed(PERMISSIONS.RECIPES_VIEW_DISABLED);
  const [rows,setRows]=useState([]),[catalog,setCatalog]=useState({products:[],crops:[]});
  const [loading,setLoading]=useState(true),[error,setError]=useState(null);
  const [enabled,setEnabled]=useState('true'),[search,setSearch]=useState(''),[activity,setActivity]=useState(),[crop,setCrop]=useState();
  const [viewing,setViewing]=useState(null),[editor,setEditor]=useState(null),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState(null),[confirmation,setConfirmation]=useState(null);
  const [form]=Form.useForm();
  const load=useCallback(async(signal)=>{
    setLoading(true);setError(null);
    try{
      const [recipes,options]=await Promise.all([api.get('/recipes',{params:{enabled},signal}),api.get('/recipes/options',{signal})]);
      if(!signal?.aborted){setRows(recipes.data);setCatalog(options.data);}
    }catch(e){if(!signal?.aborted)setError(e);}finally{if(!signal?.aborted)setLoading(false);}
  },[enabled]);
  useEffect(()=>{const controller=new AbortController();load(controller.signal);return ()=>controller.abort();},[load]);
  const products=recipeProducts(catalog.products,editor?.recipe);
  const openEditor=recipe=>{
    setSaveError(null);setEditor({recipe});form.resetFields();
    form.setFieldsValue(recipe?{name:recipe.name,activity_type:recipe.activity_type,field_context:recipe.field_context,crop_id:recipe.crop_id,
      items:recipe.items.map(i=>({product_id:i.product_id,dose_amount:i.dose_amount,dose_unit:i.dose_unit}))}:{activity_type:'fumigacion',items:[{}]});
  };
  const save=async values=>{
    setSaveError(null);setSaving(true);
    try{
      const body=recipePayload(values,products),id=editor?.recipe?.id;
      const result=id?await api.put('/recipes/'+id,body):await api.post('/recipes',body);
      setEditor(null);setViewing(current=>current?.id===result.data.id?result.data:current);message.success('Receta guardada');await load();
    }catch(e){setSaveError(getUserFriendlyError(e,e.message||'No pudimos guardar la receta.'));}finally{setSaving(false);}
  };
  const actions=recipe=>[
    {key:'view',label:'Ver receta',onClick:()=>setViewing(recipe)},
    {key:'edit',label:'Editar',hidden:!allowed(PERMISSIONS.RECIPES_EDIT),onClick:()=>openEditor(recipe)},
    {key:'disable',label:'Deshabilitar',danger:true,hidden:!recipe.enabled||!allowed(PERMISSIONS.RECIPES_DISABLE),onClick:()=>setConfirmation({recipe,enable:false})},
    {key:'enable',label:'Restaurar',hidden:recipe.enabled||!allowed(PERMISSIONS.RECIPES_ENABLE),onClick:()=>setConfirmation({recipe,enable:true})},
  ];
  const columns=[
    {title:'Receta',dataIndex:'name',ellipsis:false,render:(name,row)=><div className="recipe-name-cell"><EntityLink onClick={()=>setViewing(row)}>{name}</EntityLink>{!row.enabled&&<span className="recipe-disabled-badge"><StatusBadge tone="neutral">Deshabilitada</StatusBadge></span>}</div>},
    {title:'Actividad',dataIndex:'activity_type',width:140,render:activityLabel},
    {title:'Contexto',dataIndex:'field_context',width:120,render:contextLabel},
    {title:'Cultivo',dataIndex:'crop_name',width:120,render:name=>name||'General'},
    {title:'Productos',key:'products',width:100,align:'center',render:(_,row)=>row.items.length},
  ];
  const filtered=filterRecipes(rows,{search,activity,crop});
  const activeFilters=[...(activity?[{key:'activity',label:activityLabel(activity),onRemove:()=>setActivity()}]:[]),...(crop?[{key:'crop',label:catalog.crops.find(c=>c.id===crop)?.name||'Cultivo',onRemove:()=>setCrop()}]:[])];
  return <main className="gs-recipes">
    <PageHeader title="Recetas" description="Mezclas y dosis por hectárea" primaryAction={{label:'Nueva receta',icon:<PlusOutlined />,hidden:!allowed(PERMISSIONS.RECIPES_CREATE),disabled:loading,onClick:()=>openEditor(null)}} />
    <FilterBar search={{label:'Buscar recetas por nombre',placeholder:'Buscar por nombre',value:search,onChange:setSearch}}
      activeFilters={activeFilters} onClear={()=>{setSearch('');setActivity();setCrop();}}
      filters={<>
        <Select aria-label="Filtrar por actividad" allowClear placeholder="Actividad" value={activity} options={RECIPE_ACTIVITIES} onChange={setActivity} />
        <Select aria-label="Filtrar por cultivo" allowClear showSearch optionFilterProp="label" placeholder="Cultivo" value={crop} options={catalog.crops.map(c=>({value:c.id,label:c.name}))} onChange={setCrop} />
        <Select aria-label="Filtrar por estado" value={enabled} onChange={setEnabled} options={[{value:'true',label:'Activas'},...(canDisabled?[{value:'false',label:'Deshabilitadas'},{value:'all',label:'Todas'}]:[])]} />
      </>} />
    <DataTable title="Listado de recetas" columns={columns} dataSource={filtered} loading={loading} error={error} onRetry={()=>load()} rowLabel={r=>r.name} actions={actions} actionsColumnWidth={80} pagination={{showTotal:false}}
      empty={{title:'No encontramos recetas',description:'Creá una mezcla reutilizable o revisá los filtros.'}}
      renderMobile={row=><button className="recipe-card-detail" onClick={()=>setViewing(row)} aria-label={`Ver receta ${row.name}`}>
        <span>{activityLabel(row.activity_type)}{row.field_context?' · '+contextLabel(row.field_context):''}</span>
        <span>{row.crop_name||'General'}</span><span>{row.items.length} productos</span>
        <StatusBadge tone={row.enabled?'success':'neutral'}>{row.enabled?'Activa':'Deshabilitada'}</StatusBadge>
      </button>} />
    <FormDrawer title={editor?.recipe?'Editar receta':'Nueva receta'} open={Boolean(editor)} onClose={()=>setEditor(null)} wide busy={saving}
      footer={<Space wrap><Button disabled={saving} onClick={()=>setEditor(null)}>Cancelar</Button><Button type="primary" loading={saving} onClick={()=>form.submit()}>Guardar receta</Button></Space>}>
      {saveError&&<Alert type="error" showIcon message={saveError} />}
      {editor&&<RecipeForm form={form} products={products} crops={catalog.crops} busy={saving} onFinish={save} />}
    </FormDrawer>
    <FormDrawer title={viewing?.name||'Detalle de receta'} open={Boolean(viewing)} onClose={()=>setViewing(null)}
      footer={viewing&&allowed(PERMISSIONS.RECIPES_EDIT)&&<Button onClick={()=>{openEditor(viewing);setViewing(null);}}>Editar receta</Button>}>
      {viewing&&<>
        <p>{[activityLabel(viewing.activity_type),viewing.field_context&&contextLabel(viewing.field_context),viewing.crop_name].filter(Boolean).join(' · ')}</p>
        <StatusBadge tone={viewing.enabled?'success':'neutral'}>{viewing.enabled?'Activa':'Deshabilitada'}</StatusBadge>
        <h3>Productos</h3><ul className="recipe-products">{viewing.items.map(item=><li key={item.id}>
          <span>{item.product_name}{item.product_enabled===false&&<small> (deshabilitado)</small>}</span><strong>{doseLabel(item.dose_amount,item.dose_unit)}</strong>
        </li>)}</ul>
      </>}
    </FormDrawer>
    {confirmation&&<ConfirmDialog open title={confirmation.enable?'Restaurar receta':'Deshabilitar receta'}
      description={confirmation.enable?`¿Restaurar ${confirmation.recipe.name}?`:`¿Deshabilitar ${confirmation.recipe.name}? Podrás restaurarla más adelante.`}
      confirmLabel={confirmation.enable?'Restaurar':'Deshabilitar'} destructive={!confirmation.enable} onCancel={()=>setConfirmation(null)}
      onConfirm={async()=>{const {recipe,enable}=confirmation;const result=enable?await api.post(`/recipes/${recipe.id}/enable`):await api.delete(`/recipes/${recipe.id}`);setViewing(v=>v?.id===recipe.id?result.data:v);await load();}}
      onSuccess={()=>setConfirmation(null)} />}
  </main>;
}
