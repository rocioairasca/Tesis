import React from 'react';
import {Alert,Button,Checkbox,Space} from 'antd';
export default function SoilExtractionEntry({mode,onModeChange,status,file,onFileChange,onExtract,warnings,reviewed,onReviewed}){
 return <section className="soil-extraction-entry" aria-label="Forma de carga">
  <Space wrap><Button type={mode==='pdf'?'primary':'default'} onClick={()=>onModeChange('pdf')}>Cargar desde PDF</Button><Button type={mode==='manual'?'primary':'default'} onClick={()=>onModeChange('manual')}>Completar manualmente</Button></Space>
  {mode==='pdf'&&<>
   {status!=='review'&&<>
    <p>Analizá el PDF y revisá los datos propuestos antes de guardar. El archivo original sigue siendo la fuente documental.</p>
    <label className="soil-file-field">PDF original (máximo 10 MB)<input type="file" accept="application/pdf,.pdf" aria-label="PDF original" onChange={e=>onFileChange(e.target.files?.[0]??null)}/>{file&&<small>{file.name}</small>}</label>
    <Button type="primary" loading={status==='loading'} disabled={!file} onClick={onExtract}>Analizar PDF</Button>
   </>}
   {status==='error'&&<Alert type="warning" showIcon message="No pudimos leer automáticamente este PDF. Podés volver a intentarlo o completar el análisis manualmente."/>}
   {status==='review'&&<>
    <Alert type="info" showIcon message="Datos extraídos del PDF · Revisá antes de guardar" description="Elegí manualmente el lote y la división de cada muestra. Todos los datos propuestos se pueden corregir."/>
    {warnings.length>0&&<Alert type="warning" message="Revisá estos datos" description={<ul>{warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}/>}
    <Checkbox checked={reviewed} onChange={e=>onReviewed(e.target.checked)}>Revisé los datos extraídos y los comparé con el PDF original.</Checkbox>
   </>}
  </>}
 </section>;
}
