import {createPortal} from 'react-dom';
import React,{useEffect,useRef,useState} from 'react';
import {Alert,Form,Select,Tag} from 'antd';
import QuantityUnitFields from '../../../components/QuantityUnitFields';
import {exceedsAvailable} from '../../../utils/inventoryConversion';
import {realQuantityDefaults,realQuantityKey} from '../planningRecipe.mjs';
import api from '../../../services/apiClient';
import {getUserFriendlyError} from '../../../utils/userFriendlyErrors';
import {activityLabel,contextLabel,doseLabel} from '../../recipes/recipeModel.mjs';
import {MANUAL_RECIPE,recipeId,planningRecipeSnapshot,recipePreview,detachRecipeProducts,sumEffectiveAreas,totalLabel} from '../planningRecipe.mjs';


export function RecipeCalculationPreview({ preview, recipe }){
  const source = preview || recipe;
  const items = source?.items || [];

  if (!source) return null;

  return (
    <section
      className="planning-recipe-preview"
      aria-label="Productos de la receta"
    >
      <div style={{ marginBottom: 12 }}>
        <strong>{source.name}</strong>

        {preview ? (
          <div style={{ color:'#6b7280', fontSize:13 }}>
            Superficie: {totalLabel(preview.area,'ha')}
          </div>
        ) : (
          <div style={{ color:'#6b7280', fontSize:13 }}>
            Seleccioná la superficie para calcular las cantidades totales.
          </div>
        )}
      </div>

      {items.map(item => (
        <div
          key={item.product_id}
          className="planning-recipe-item"
        >
          <strong>{item.product_name}</strong>

          <dl>
            <div>
              <dt>Dosis</dt>
              <dd>{doseLabel(item.dose_amount,item.dose_unit)}</dd>
            </div>

            <div>
              <dt>Total</dt>
              <dd>
                {preview
                  ? roundedRecipeTotalLabel(item.amount, item.unit)
                  : 'Pendiente de superficie'}
              </dd>
            </div>

            <div>
              <dt>Disponible</dt>
              <dd>
                {totalLabel(
                  item.available_quantity ?? '0',
                  item.product_unit
                )}
              </dd>
            </div>
          </dl>

          {preview && item.insufficient && (
            <Tag color="orange">Supera disponible</Tag>
          )}
        </div>
      ))}

      {preview?.items?.some(i=>i.insufficient) && (
        <Alert
          type="warning"
          showIcon
          message="La cantidad planificada supera el stock disponible. La disponibilidad es informativa; al registrar el trabajo se valida la cantidad real según la fecha efectiva."
        />
      )}
    </section>
  );
}

const roundedRecipeTotalLabel = (value, unit) => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) return '—';

  if (unit === 'kg' && amount > 0 && amount < 1) {
    return `${Math.round(amount * 1000)} g`;
  }

  if (unit === 'litros' && amount > 0 && amount < 1) {
    return `${Math.round(amount * 1000)} mL`;
  }

  const rounded = Math.round(amount);

  if (unit === 'litros') return `${rounded} L`;
  if (unit === 'kg') return `${rounded} kg`;
  if (unit === 'unit') return `${rounded} u.`;
  if (unit === 'bag') return `${rounded} bolsas`;

  return `${rounded} ${unit || ''}`.trim();
};

export default function PlanningRecipeFields({form,activity,context,crop,selections,editing,completed=false,registerCompleted=false,productsContainer=null}){
  const selected=recipeId(Form.useWatch('recipe_id',form));
  const realQuantities=Form.useWatch('recipe_actual_products',form);
  const [choices,setChoices]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(null);
  const known=useRef(new Map());
  const snapshot=planningRecipeSnapshot(editing);
  const supported=['fumigacion','fertilizacion','siembra'].includes(activity);

  useEffect(()=>{
    if(!supported||completed){setChoices([]);return;}
    const controller=new AbortController();

    setLoading(true);
    setError(null);

      api.get('/planning/recipe-options',{
        params:{
          activity_type:activity
        },
        signal:controller.signal
      })

      .then(({ data }) => {
        if (controller.signal.aborted) return;

        const candidates = [
          Array.isArray(data) ? data : null,
          Array.isArray(data?.items) ? data.items : null,
          Array.isArray(data?.data) ? data.data : null,
          Array.isArray(data?.recipes) ? data.recipes : null,
        ].filter(Boolean);

        const rows = candidates.reduce(
          (largest, current) =>
            current.length > largest.length ? current : largest,
          []
        );

        known.current.clear();

        for (const r of rows) {
          known.current.set(r.id, r);
        }

        setChoices(rows);
      })
            .catch(e=>{if(!controller.signal.aborted)setError(getUserFriendlyError(e));})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  }, [activity, supported, completed]);


  const recipe=selected===snapshot?.id?snapshot:known.current.get(selected);

  const compatible =
    !selected ||
    Boolean(
      recipe &&
      (!recipe.activity_type || recipe.activity_type === activity)
    );

  let preview=null;
  let calculationError=null;
  let validArea=false;

  try {
    sumEffectiveAreas(selections);
    validArea=true;

    if (recipe) {
      preview=recipePreview(recipe,selections,{readOnly:completed});
    }
  } catch (e) {
    // No tener lote todavía no es un error de receta.
    if (selections?.length) {
      calculationError=e.message;
    }
  }

  const confirmationKey =
    registerCompleted && preview && compatible
      ? realQuantityKey(preview, {
          selected,
          activity,
          context,
          crop: context === 'stubble' ? null : crop,
          selections,
        })
      : null;

  
  const lastConfirmationKey=useRef(null);

  useEffect(()=>{
    if(confirmationKey!==lastConfirmationKey.current){
      form.setFieldValue('recipe_actual_products',confirmationKey?realQuantityDefaults(preview):{});
      lastConfirmationKey.current=confirmationKey;
    }
  },[confirmationKey,form]);

  if(!supported&&!snapshot&&!selected)return null;

  const options=[
    {
      value: MANUAL_RECIPE,
      label:'Sin receta / Carga manual',
    },
    ...choices
      .filter(r => r.id !== snapshot?.id)
      .map(r => ({
        value: r.id,
        label: [
          r.name,
          activityLabel(r.activity_type),
          r.field_context && contextLabel(r.field_context),
          r.crop_name
        ]
          .filter(Boolean)
          .join(' · '),
      })),
  ];

  if (snapshot) {
    options.push({
      value: snapshot.id,
      label: snapshot.name +' · Dosis guardadas',
      disabled: completed,
    });
  }

  if(selected && recipe && !options.some(o=>o.value===selected))options.push({value:selected,label:recipe.name,disabled:true});
  return <>
    <Form.Item name="recipe_id" label="Receta" rules={[{validator:(_,value)=>{
      if(!recipeId(value))return Promise.resolve();
      if(!compatible)return Promise.reject(new Error('La receta seleccionada ya no es compatible con la actividad, contexto o cultivo.'));
      if(!preview)return Promise.reject(new Error(calculationError||'No pudimos calcular la receta.'));
      return Promise.resolve();
    }}]}>
      <Select aria-label="Receta" showSearch optionFilterProp="label" options={options} loading={loading}
        disabled={completed} placeholder="Sin receta / Carga manual"
        onChange={value=>{
          if(!recipeId(value)&&selected){
            // Detachment is explicit. Never transfer a recipe preview into the consuming register-completed flow.
            if(registerCompleted)form.setFieldValue('products',[]);
            else if(preview)form.setFieldValue('products',detachRecipeProducts(preview));
          }
        }} />
    </Form.Item>
    {productsContainer?createPortal(<>    {error&&<Alert type="error" showIcon message={error} />}
    {selected&&!compatible&&<Alert type="error" showIcon message="La receta seleccionada ya no es compatible con la actividad, contexto o cultivo. Cambiá la receta o usá carga manual." />}
    {selected&&calculationError&&<Alert type="error" showIcon message={calculationError} />}
    {recipe && (
      <RecipeCalculationPreview
        preview={preview}
        recipe={recipe}
      />
    )}
    {registerCompleted&&preview&&compatible&&<section aria-label="Productos utilizados" className="planning-recipe-preview">
      <h4>Productos utilizados</h4>
      {preview.items.some(item=>{
        const real=realQuantities?.[item.product_id];
        try{return real&&exceedsAvailable(real.actual_amount,real.unit,item.product_unit,item.available_quantity??'0',true);}catch{return false;}
      })&&<Alert type="warning" showIcon message="La cantidad real supera el stock visible. Se validará la disponibilidad según la fecha de realización al guardar." />}
      <p>Las cantidades se calcularon desde la receta. Ajustalas si en el trabajo se utilizó una cantidad diferente.</p>
      {preview.items.map(item=><div key={item.product_id} className="planning-recipe-item">
        <strong>{item.product_name}</strong>
        <p>Dosis: {doseLabel(item.dose_amount,item.dose_unit)} · Planificado: {totalLabel(item.amount,item.unit)}</p>
        <QuantityUnitFields quantityName={['recipe_actual_products',item.product_id,'actual_amount']}
          unitName={['recipe_actual_products',item.product_id,'unit']} label="Cantidad realmente utilizada"
          baseUnit={item.product_unit} allowZero extra="El stock se valida al guardar según la fecha efectiva." />
      </div>)}
    </section>}</>,productsContainer):<>    {error&&<Alert type="error" showIcon message={error} />}
    {selected&&!compatible&&<Alert type="error" showIcon message="La receta seleccionada ya no es compatible con la actividad, contexto o cultivo. Cambiá la receta o usá carga manual." />}
    {selected&&calculationError&&<Alert type="error" showIcon message={calculationError} />}
    {recipe&&(
      <RecipeCalculationPreview
        preview={preview}
        recipe={recipe}
      />
    )}
    {registerCompleted&&preview&&compatible&&<section aria-label="Productos utilizados" className="planning-recipe-preview">
      <h4>Productos utilizados</h4>
      {preview.items.some(item=>{
        const real=realQuantities?.[item.product_id];
        try{return real&&exceedsAvailable(real.actual_amount,real.unit,item.product_unit,item.available_quantity??'0',true);}catch{return false;}
      })&&<Alert type="warning" showIcon message="La cantidad real supera el stock visible. Se validará la disponibilidad según la fecha de realización al guardar." />}
      <p>Las cantidades se calcularon desde la receta. Ajustalas si en el trabajo se utilizó una cantidad diferente.</p>
      {preview.items.map(item=><div key={item.product_id} className="planning-recipe-item">
        <strong>{item.product_name}</strong>
        <p>Dosis: {doseLabel(item.dose_amount,item.dose_unit)} · Planificado: {totalLabel(item.amount,item.unit)}</p>
        <QuantityUnitFields quantityName={['recipe_actual_products',item.product_id,'actual_amount']}
          unitName={['recipe_actual_products',item.product_id,'unit']} label="Cantidad realmente utilizada"
          baseUnit={item.product_unit} allowZero extra="El stock se valida al guardar según la fecha efectiva." />
      </div>)}
    </section>}</>}
  </>;
}
