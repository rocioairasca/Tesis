const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {extract}=require('../services/soilAnalysisExtraction'),fixture=require('./soilExtraction.fixture');
test('extract endpoint requires create, shares upload validation, never accesses DB/Storage, and returns an unpersisted proposal',async()=>{
 let user={id:'synthetic',company_id:'synthetic',role:0,custom_permissions:['soil_analysis.create']},calls=0;
 const forbidden=new Proxy({}, {get(){throw new Error('Extraction must never access persistence');}});
 const app=express();app.use((req,res,next)=>{req.user=user;next();});app.use('/api/soil-analysis',require('../routes/soilAnalysis')({pool:forbidden,storage:forbidden,extractor:args=>{calls++;return extract({...args,provider:async()=>fixture.proposal()});}}));app.use((error,req,res,next)=>res.status(error.status||500).json({message:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const url='http://127.0.0.1:'+server.address().port+'/api/soil-analysis/extract';
 const send=(bytes=fixture.pdf(),mime='application/pdf',extra=false)=>{const form=new FormData();form.append('file',new Blob([bytes],{type:mime}),'synthetic.pdf');if(extra)form.append('company_id','foreign');return fetch(url,{method:'POST',body:form});};
 try{
  const response=await send();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const data=await response.json();assert.equal(data.report_number,'S26-0385');assert.equal(data.id,undefined);assert.equal(data.samples[0].lot_id,undefined);assert.deepEqual(data.samples[0].results.map(r=>r.raw_value),['7,1','3,0','<0,1']);assert.ok(data.warnings.every(w=>typeof w==='string'));assert.ok(data.warnings.some(w=>w.startsWith('Información: ')));assert.ok(data.warnings.every(w=>!w.includes('result_status')));
  const before=calls;
  for(const [bytes,mime,extra] of [[fixture.pdf(),'text/plain',false],[Buffer.from('not PDF'),'application/pdf',false],[Buffer.alloc(10*1024*1024+1),'application/pdf',false],[fixture.pdf(),'application/pdf',true]])assert.ok([400,413].includes((await send(bytes,mime,extra)).status));
  assert.equal(calls,before);user={...user,custom_permissions:['soil_analysis.view']};assert.equal((await send()).status,403);assert.equal(calls,before);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
