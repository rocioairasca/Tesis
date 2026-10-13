import React,{useEffect,useState} from 'react';
import {Alert,Button} from 'antd';
import api from '../../../services/apiClient';
import {safePdfUrl} from './soilAnalysisModel.mjs';
export default function SoilPdfPreview({reportId}){
 const [link,setLink]=useState(null),[error,setError]=useState(false),[previewError,setPreviewError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let timer;setLink(null);setError(false);setPreviewError(false);
  const renew=async()=>{try{
   const {data}=await api.get('/soil-analysis/'+reportId+'/file-url',{signal:controller.signal});
   if(controller.signal.aborted)return;
   const url=safePdfUrl(data.url);if(!url)throw new Error('Vista previa no disponible');setLink(url);setError(false);
   const expires=Date.parse(data.expires_at);timer=setTimeout(renew,Math.max(1000,Math.min(270000,expires-Date.now()-30000||270000)));
  }catch{if(!controller.signal.aborted){setError(true);setLink(null);}}};renew();
  return ()=>{controller.abort();clearTimeout(timer);};
 },[reportId,retry]);
 return <section className="soil-pdf-preview" aria-label="Documento original">
  <h3>PDF original</h3>
  {error?<Alert type="warning" message="No se pudo mostrar la vista previa" action={<Button onClick={()=>setRetry(r=>r+1)}>Reintentar</Button>} />:!link?<p>Cargando documento…</p>:<>
   {previewError?<Alert type="warning" message="No se pudo mostrar la vista previa" />:<iframe title="Vista previa del PDF original" src={link} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-downloads" onError={()=>setPreviewError(true)} />}
   <p>Si no se muestra la vista previa, podés abrir el documento.</p>
   <a href={link} target="_blank" rel="noopener noreferrer">Abrir PDF</a>
  </>}
 </section>;
}
