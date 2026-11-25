// Compatible-client adapter to the original Seldon REST parameter contract.
// Compare explicitly selected immutable completed runs, not the latest model
// or insertion order. Never supply invented feedback or diagnostic results.
import {RUN_ID,validRun} from './project-runs.mjs';
import {digest} from './provider-wire.mjs';
const engines=new Set(['seldon','seldon-mentor','seldon-ile-user']);
const require=(ok,code)=>{if(!ok)throw Error(code);};
const MAX_BYTES=65536;
export async function loadComparison(request,runIds){
 require(Array.isArray(runIds)&&runIds.length===2&&new Set(runIds).size===2&&runIds.every(x=>typeof x==='string'&&RUN_ID.test(x)),'SELECT_TWO_DISTINCT_RUNS');
 const runs=[];
 for(const id of runIds){
  const response=await request('/project/runs/'+id);
  require(response.status===200,'RUN_NOT_AVAILABLE');
  const record=await response.json();
  require(validRun(record),'INVALID_PERSISTED_RUN');
  const revision=await request('/project/model/revisions/'+record.revision);
  require(revision.status===200,'REVISION_NOT_AVAILABLE');
  const body=await revision.text();
  require(revision.headers.get('etag')==='"'+record.revision+'"'&&
   revision.headers.get('x-buffalo-model-sha256')===record.model_sha256&&
   await digest(body)===record.model_sha256,'REVISION_IDENTITY_MISMATCH');
  const model=JSON.parse(body);
  // Only compare runs with the same simulation grid and variable coverage.
  // Reject ambiguity rather than silently align, truncate or resample.
  require(model.specs&&Object.entries(record.settings).every(([k,v])=>model.specs[k]===v),'REVISION_SETTINGS_MISMATCH');
  runs.push({id,record,model});
 }
 const [a,b]=runs;
 const sameSequence=(left,right)=>left.length===right.length&&left.every((value,i)=>value===right[i]);
 // validRun checks the exact field set and scalar types of each metadata group.
 const sameFields=(left,right)=>Object.keys(left).every(key=>left[key]===right[key]);
 require(sameSequence(a.record.series.time,b.record.series.time)&&
  sameSequence(Object.keys(a.record.series).sort(),Object.keys(b.record.series).sort())&&
  sameFields(a.record.settings,b.record.settings)&&sameFields(a.record.execution,b.record.execution)&&
  sameFields(a.record.simulator,b.record.simulator),'INCOMPARABLE_RUNS');
 return runs;
}
export function comparisonRequest(engine,prompt,runs){
 require(engines.has(engine),'UNSUPPORTED_DISCUSSION_ENGINE');
 require(typeof prompt==='string'&&prompt.trim().length>0&&prompt.length<=4000,'INVALID_DISCUSSION_PROMPT');
 const [baseline,current]=runs;
 const behaviorContent=JSON.stringify(Object.fromEntries(runs.map(({id,record})=>[id,record.series])));
 // The original engine accepts one currentModel plus behavioral and
 // background text. Include both exact historical models in background;
 // do not imply that the baseline was run on the current model.
 const backgroundKnowledge='Persisted comparison evidence (client-reported completed simulations). '+
  'Run order is baseline then comparison. The currentModel corresponds only to the comparison run. '+
  'Each historical model and simulator is identified below. Loop-dominance information was not supplied; do not infer or fabricate loop scores. '+
  'Absent diagnostics mean not reported, not a verified clean check.\n'+JSON.stringify({
   baseline_run_id:baseline.id,comparison_run_id:current.id,
   runs:runs.map(({id,record,model})=>({
    run_id:id,revision:record.revision,model_sha256:record.model_sha256,
    simulator:record.simulator,settings:record.settings,execution:record.execution,
    ...(Object.hasOwn(record,'unitWarnings')?{unitWarnings:record.unitWarnings}:{}),
    ...(Object.hasOwn(record,'errors')?{errors:record.errors}:{}),model
   }))
  });
 const payload={prompt,currentModel:structuredClone(current.model),behaviorContent,backgroundKnowledge,
  ...(engine==='seldon-ile-user'?{currentRunName:current.id}:{})};
 require(new TextEncoder().encode(JSON.stringify(payload)).byteLength<=MAX_BYTES,'DISCUSSION_BODY_LIMIT');
 return payload;
}
export async function discussPersistedRuns(request,engine,prompt,runIds,key){
 const runs=await loadComparison(request,runIds);
 const payload=comparisonRequest(engine,prompt,runs);
 const response=await request('/api/v1/engines/'+engine+'/generate',{
  method:'POST',headers:{'content-type':'application/json',Authentication:key},body:JSON.stringify(payload)});
 require(response.status===200,'DISCUSSION_HTTP_FAILURE');
 const result=await response.json();
 require(result.success===true&&typeof result.output?.textContent==='string'&&
  typeof result.output.feedbackInformationRequired==='boolean','DISCUSSION_ENGINE_FAILURE');
 // Preserve upstream output verbatim, including its request for feedback.
 // No automatic simulation, feedback synthesis, inference retry or edit.
 return {output:result.output,runIds:[...runIds]};
}
