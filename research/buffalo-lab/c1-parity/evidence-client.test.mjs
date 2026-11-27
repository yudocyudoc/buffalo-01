import test from 'node:test';
import assert from 'node:assert/strict';
import {createEvidenceClient} from './evidence-client.mjs';
function fixture(){
 const id='run-A',model={variables:[{name:'Inventory'},{name:'Workers'}]},time=Array.from({length:241},(_,i)=>i);
 const series={time,inventory:time.map(x=>100+x),workers:time.map(x=>10-x/100)};
 const p={run_id:id,run_sha256:'run-hash',revision:1,model_sha256:'model-hash'};
 const run={revision:1,model_sha256:'model-hash',series};
 const feedback={run_id:id,run_sha256:p.run_sha256,content:{provenance:p}};
 return {runId:id,model,run,feedback,assessment:{dominance:{status:'supported_by_partition_scores'}},async clientRequest(m){
  if(m.type==='feedback_request')return {runIds:[id],feedbackContent:feedback.content};
  if(m.type==='get_run_info')return {runs:[{id}]};
  const n=m.detailed?200:50,indices=Array.from({length:n},(_,i)=>Math.round(i*240/(n-1)));
  return {[id]:{time:indices.map(i=>time[i]),...Object.fromEntries(m.variableNames.map(name=>[name,indices.map(i=>series[name.toLowerCase()][i])]))}};
 }};
}
const data=(names,detailed=true,runIds=['run-A'])=>({type:'get_variable_data',variableNames:names,detailed,runIds});
test('successive requests retain prior columns on identical sample indices',async()=>{
 const s=fixture(),c=createEvidenceClient(s);
 const a=await c.clientRequest(data(['Inventory']),s.model);
 const b=await c.clientRequest(data(['Workers']),s.model);
 assert.deepEqual(b['run-A'].Inventory,a['run-A'].Inventory);
 assert.deepEqual(b['run-A'].time,a['run-A'].time);
 assert.equal(b['run-A'].Workers.length,200);
 assert.deepEqual(c.snapshot().columns,['Inventory','Workers']);
 assert.deepEqual(c.snapshot().events.map(x=>x.requested),[['Inventory'],['Workers']]);
});
test('wrong or implicit run, unknown variable, changed resolution/model and alias collision fail without cache mutation',async()=>{
 const s=fixture(),c=createEvidenceClient(s);await c.clientRequest(data(['Inventory']),s.model);
 const before=c.snapshot();
 for(const [m,model,code] of [[data(['Workers'],true,['run-B']),s.model,'EVIDENCE_RUN_EXPLICIT_REQUIRED'],[data(['Workers'],true,[]),s.model,'EVIDENCE_RUN_EXPLICIT_REQUIRED'],[data(['Missing']),s.model,'EVIDENCE_VARIABLE_UNKNOWN_OR_AMBIGUOUS'],[data(['Workers'],false),s.model,'EVIDENCE_RESOLUTION_CHANGED'],[data(['Workers']),{variables:[]},'EVIDENCE_MODEL_CHANGED'],[data(['inventory']),s.model,'EVIDENCE_VARIABLE_ALIAS_COLLISION']]){
  await assert.rejects(c.clientRequest(m,model),new RegExp(code));assert.deepEqual(c.snapshot(),before);
 }
});
test('source identity and exact payload checks fail closed',async()=>{
 const s=fixture();s.feedback.content.provenance.revision=2;
 assert.throws(()=>createEvidenceClient(s),/EVIDENCE_IDENTITY_MISMATCH/);
 const t=fixture(),c=createEvidenceClient(t);t.run.series.inventory[0]=999;
 await assert.rejects(c.clientRequest(data(['Inventory']),t.model),/EVIDENCE_SOURCE_CHANGED/);
 const u=fixture(),v=createEvidenceClient(u);u.clientRequest=async()=>({'run-A':{time:[0],Inventory:[999]}});
 await assert.rejects(v.clientRequest(data(['Inventory']),u.model),/EVIDENCE_CLIENT_RESPONSE_MISMATCH/);assert.deepEqual(v.snapshot().columns,[]);
 const w=fixture(),x=createEvidenceClient(w);w.clientRequest=async()=>({runIds:['run-B'],feedbackContent:w.feedback.content});
 await assert.rejects(x.clientRequest({type:'feedback_request',runIds:['run-A']},w.model),/EVIDENCE_FEEDBACK_CHANGED/);
});
