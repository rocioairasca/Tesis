import React,{useEffect,useRef,useState} from 'react';
import {Alert,Button} from 'antd';
import api from '../../../services/apiClient';
import {safePdfUrl} from './soilAnalysisModel.mjs';

export default function SoilPdfPreview({reportId}){
 const [link,setLink]=useState(null),[error,setError]=useState(false),[previewError,setPreviewError]=useState(false),[opening,setOpening]=useState(false),[popupLink,setPopupLink]=useState(null);
 const refresh=useRef(null);
 useEffect(()=>{
  let active=true,timer,controller,pendingWindow;
  setLink(null);setError(false);setPreviewError(false);setOpening(false);setPopupLink(null);
  const request=async({open=false,popup=null}={})=>{
   clearTimeout(timer);controller?.abort();pendingWindow?.close();pendingWindow=popup;
   const current=new AbortController();controller=current;
   setOpening(open);setPopupLink(null);setError(false);
   try{
    const {data}=await api.get('/soil-analysis/'+reportId+'/file-url',{signal:current.signal});
    if(!active||current.signal.aborted)return;
    const url=safePdfUrl(data.url),expires=Date.parse(data.expires_at);
    if(!url||!Number.isFinite(expires)||expires<=Date.now())throw new Error('Documento no disponible');
    setLink(url);setPreviewError(false);
    if(open){
     if(popup&&!popup.closed){popup.location.replace(url);pendingWindow=null;}
     else setPopupLink(url);
    }
    timer=setTimeout(()=>request(),Math.max(1000,Math.min(270000,expires-Date.now()-30000)));
   }catch{
    if(active&&!current.signal.aborted){setError(true);setLink(null);pendingWindow?.close();pendingWindow=null;}
   }finally{if(active&&!current.signal.aborted)setOpening(false);}
  };
  refresh.current=request;request();
  return ()=>{active=false;controller?.abort();clearTimeout(timer);pendingWindow?.close();refresh.current=null;};
 },[reportId]);
 const openPdf=()=>{
  // Reserve the tab during the user gesture, before requesting a fresh signed URL.
  const popup=window.open('about:blank','_blank');
  if(popup)popup.opener=null;
  refresh.current?.({open:true,popup});
 };
 return <section className="soil-pdf-preview" aria-label="Documento original">
  <h3>PDF original</h3>
  {error||previewError?<Alert type="warning" message="No se pudo cargar la vista previa del PDF." />:!link?<p>Cargando documento…</p>:null}
  {link&&!previewError&&<iframe title="Vista previa del PDF original" src={link} referrerPolicy="no-referrer" onError={()=>setPreviewError(true)} />}
  <p>Si no se muestra la vista previa, podés abrir el documento.</p>
  <Button onClick={openPdf} loading={opening}>Abrir PDF</Button>
  {popupLink&&<p><a href={popupLink} target="_blank" rel="noopener noreferrer">Abrir PDF en nueva pestaña</a></p>}
 </section>;
}
