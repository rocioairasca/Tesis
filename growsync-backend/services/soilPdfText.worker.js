const {parentPort,workerData}=require('node:worker_threads');
(async()=>{
 let pdf;
 try{
  const {getDocumentProxy}=await import('unpdf');
  pdf=await getDocumentProxy(new Uint8Array(workerData),{isEvalSupported:false,useSystemFonts:false,useWorkerFetch:false,disableFontFace:true,verbosity:0});
  if(pdf.numPages>50)throw new Error('PDF_LIMIT');
  let text='';
  for(let n=1;n<=pdf.numPages;n++){
   const page=await pdf.getPage(n),content=await page.getTextContent({disableNormalization:true});
   text+=content.items.filter(item=>typeof item.str==='string').map(item=>item.str+(item.hasEOL?'\n':' ')).join('')+'\n';
   if(text.length>100000)throw new Error('PDF_LIMIT');
   page.cleanup();
  }
  parentPort.postMessage({text});
 }catch{parentPort.postMessage({error:true});}
 finally{await pdf?.destroy();}
})();
