import React,{useEffect,useRef,useState} from 'react';
import {Alert,Form,Select,Tag} from 'antd';
import api from '../../../services/apiClient';
import {getUserFriendlyError} from '../../../utils/userFriendlyErrors';
import {activityLabel,contextLabel,doseLabel} from '../../recipes/recipeModel.mjs';
import {MANUAL_RECIPE,recipeId,planningRecipeSnapshot,recipePreview,isRecipeCompatible,detachRecipeProducts,sumEffectiveAreas,totalLabel} from '../planningRecipe.mjs';
export function RecipeCalculationPreview({preview}){
  return <section className="planning-recipe-preview" aria-label="Vista previa de receta">
    <p><strong>Receta:</strong> {preview.name}</p><p><strong>Superficie:</strong> {totalLabel(preview.area,'ha')}</p>
    {preview.items.map(item=><div key={item.product_id} className="planning-recipe-item">
      <strong>{item.product_name}</strong>
      <dl><div><dt>Dosis</dt><dd>{doseLabel(item.dose_amount,item.dose_unit)}</dd></div>
        <div><dt>Total</dt><dd>{totalLabel(item.amount,item.unit)}</dd></div>
        <div><dt>Disponible</dt><dd>{totalLabel(item.available_quantity??'0',item.product_unit)}</dd></div></dl>
      {item.insufficient&&<Tag color="orange">Supera disponible</Tag>}
    </div>)}
    {preview.items.some(i=>i.insufficient)&&<Alert type="warning" showIcon message="La cantidad planificada supera el stock disponible. Podés guardar la planificación; la disponibilidad es informativa." />}
  </section>;
}
export default function PlanningRecipeFields({form,activity,context,crop,selections,editing,completed=false,registerCompleted=false}){
  const selected=recipeId(Form.useWatch('recipe_id',form));
  const [choices,setChoices]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(null);
  const known=useRef(new Map());
  const snapshot=planningRecipeSnapshot(editing);
  const supported=['fumigacion','fertilizacion','siembra'].includes(activity);
  useEffect(()=>{
    if(!supported||completed||registerCompleted){setChoices([]);return;}
    const controller=new AbortController();setLoading(true);setError(null);
    api.get('/planning/recipe-options',{params:{activity_type:activity,field_context:context??undefined,crop_id:crop??undefined},signal:controller.signal})
      .then(({data})=>{if(!controller.signal.aborted){for(const r of data)known.current.set(r.id,r);setChoices(data);}})
      .catch(e=>{if(!controller.signal.aborted)setError(getUserFriendlyError(e));})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[activity,context,crop,supported,completed,registerCompleted]);
  const recipe=selected===snapshot?.id?snapshot:known.current.get(selected);
  const fieldsUnchanged=snapshot&&activity===snapshot.activity_type&&(context??null)===(snapshot.field_context??null)&&(crop??null)===(snapshot.crop_id??null);
  const compatible=!selected||Boolean(recipe&&(selected===snapshot?.id&&fieldsUnchanged||isRecipeCompatible(known.current.get(selected)||recipe,{activity_type:activity,field_context:context,crop_id:crop})));
  let preview=null,calculationError=null,validArea=false;
  try{sumEffectiveAreas(selections);validArea=true;if(recipe)preview=recipePreview(recipe,selections,{readOnly:completed});}catch(e){calculationError=e.message;}
  if(!supported&&!snapshot&&!selected)return null;
  const options=[{value:MANUAL_RECIPE,label:'Sin receta / Carga manual'},...choices.filter(r=>r.id!==snapshot?.id).map(r=>({
    value:r.id,label:[r.name,activityLabel(r.activity_type),r.field_context&&contextLabel(r.field_context),r.crop_name].filter(Boolean).join(' · '),disabled:registerCompleted||!validArea,
  }))];
  if(snapshot)options.push({value:snapshot.id,label:snapshot.name+' · Dosis guardadas',disabled:registerCompleted});
  if(selected && recipe && !options.some(o=>o.value===selected))options.push({value:selected,label:recipe.name,disabled:true});
  return <>
    <Form.Item name="recipe_id" label="Receta" rules={[{validator:(_,value)=>{
      if(!recipeId(value))return Promise.resolve();
      if(registerCompleted)return Promise.reject(new Error('Las recetas no están disponibles al registrar actividades realizadas. Usá carga manual.'));
      if(!compatible)return Promise.reject(new Error('La receta seleccionada ya no es compatible con la actividad, contexto o cultivo.'));
      if(!preview)return Promise.reject(new Error(calculationError||'No pudimos calcular la receta.'));
      return Promise.resolve();
    }}]}>
      <Select aria-label="Receta" showSearch optionFilterProp="label" options={options} loading={loading}
        disabled={completed||(!validArea&&!selected)} placeholder="Sin receta / Carga manual"
        onChange={value=>{
          if(!recipeId(value)&&selected){
            // Detachment is explicit. Never transfer a recipe preview into the consuming register-completed flow.
            if(registerCompleted)form.setFieldValue('products',[]);
            else if(preview)form.setFieldValue('products',detachRecipeProducts(preview));
          }
        }} />
    </Form.Item>
    {error&&<Alert type="error" showIcon message={error} />}
    {selected&&!compatible&&<Alert type="error" showIcon message="La receta seleccionada ya no es compatible con la actividad, contexto o cultivo. Cambiá la receta o usá carga manual." />}
    {selected&&registerCompleted&&<Alert type="warning" showIcon message="Para registrar una actividad realizada elegí Sin receta / Carga manual y cargá sus productos manualmente." />}
    {selected&&calculationError&&<Alert type="error" showIcon message={calculationError} />}
    {preview&&<RecipeCalculationPreview preview={preview} />}
  </>;
}
