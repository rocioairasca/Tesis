const {Worker}=require('node:worker_threads');
function readPdfText(buffer,{signal,timeoutMs=15000}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new Error('PDF_TEXT_UNAVAILABLE'));return;}
  const worker=new Worker(require.resolve('./soilPdfText.worker'),{workerData:new Uint8Array(buffer),resourceLimits:{maxOldGenerationSizeMb:128}});
  let settled=false;
  const finish=(error,text)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();if(error)reject(new Error('PDF_TEXT_UNAVAILABLE'));else resolve(text);};
  const abort=()=>finish(true),timer=setTimeout(abort,timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});worker.once('message',m=>finish(m.error,m.text));worker.once('error',abort);worker.once('exit',()=>{if(!settled)finish(true);});
 });
}
module.exports={readPdfText};
