// Experimental one-run read-only compatible-client boundary.
// Does not modify upstream cache files or guarantee arbitrary Seldon calls.
import {isDeepStrictEqual as equal} from 'node:util';
const check=(ok,code)=>{if(!ok)throw Error(code)};
const norm=s=>s.toLowerCase().replace(/\s+/g,'_');
export function createEvidenceClient(selected){
 const {runId:id}=selected;
 const model=structuredClone(selected.model),run=structuredClone(selected.run),feedback=structuredClone(selected.feedback);
 const p=feedback.content.provenance;
 check(p?.run_id===id&&feedback.run_id===id&&p.run_sha256===feedback.run_sha256&&p.revision===run.revision&&p.model_sha256===run.model_sha256,'EVIDENCE_IDENTITY_MISMATCH');
 check(selected.assessment.dominance.status==='supported_by_partition_scores','EVIDENCE_DOMINANCE_UNSUPPORTED');
 const time=run.series.time;
 check(Array.isArray(time)&&time.length>0&&time.every((v,i)=>Number.isFinite(v)&&(i===0||v>time[i-1])),'EVIDENCE_GRID_INVALID');
 let columns=[],grid=null;const events=[];
 function snapshot(){return structuredClone({run_id:id,revision:run.revision,model_sha256:run.model_sha256,run_sha256:feedback.run_sha256,full_samples:time.length,columns,grid,events})}
 async function clientRequest(m,current){
  check(equal(current,model),'EVIDENCE_MODEL_CHANGED');
  check(equal(selected.model,model)&&equal(selected.run,run)&&equal(selected.feedback,feedback),'EVIDENCE_SOURCE_CHANGED');
  if(m.type==='get_run_info')return selected.clientRequest(m);
  check(['get_variable_data','feedback_request'].includes(m.type),'EVIDENCE_REQUEST_UNSUPPORTED');
  check(Array.isArray(m.runIds)&&m.runIds.length===1&&m.runIds[0]===id,'EVIDENCE_RUN_EXPLICIT_REQUIRED');
  if(m.type==='feedback_request'){
   const result=await selected.clientRequest(m);
   check(equal(result,{runIds:[id],feedbackContent:feedback.content}),'EVIDENCE_FEEDBACK_CHANGED');
   events.push({type:m.type,run_id:id});return result;
  }
  check(Array.isArray(m.variableNames)&&m.variableNames.length>0&&m.variableNames.every(v=>typeof v==='string'&&v.length>0),'EVIDENCE_VARIABLES_REQUIRED');
  check(m.detailed===undefined||typeof m.detailed==='boolean','EVIDENCE_RESOLUTION_INVALID');
  const detailed=m.detailed===true,count=Math.min(time.length,detailed?200:50);
  // Different request modes may not be silently combined, even if grids happen to coincide.
  check(grid===null||grid.detailed===detailed,'EVIDENCE_RESOLUTION_CHANGED');
  const next=[...new Set([...columns,...m.variableNames])];
  const mapping=new Map();
  for(const name of next){
   const matches=Object.keys(run.series).filter(k=>k!=='time'&&norm(k)===norm(name));
   check(matches.length===1&&name!=='time','EVIDENCE_VARIABLE_UNKNOWN_OR_AMBIGUOUS');
   check(![...mapping.values()].includes(matches[0]),'EVIDENCE_VARIABLE_ALIAS_COLLISION');
   const values=run.series[matches[0]];
   check(Array.isArray(values)&&values.length===time.length&&values.every(Number.isFinite),'EVIDENCE_COLUMN_INVALID');
   mapping.set(name,matches[0]);
  }
  const indices=Array.from({length:count},(_,i)=>count===1?0:Math.round(i*(time.length-1)/(count-1)));
  // Ask the original client to return the cumulative columns, all from the immutable source.
  const result=await selected.clientRequest({...m,variableNames:next});
  const expected={time:indices.map(i=>time[i])};
  for(const [name,key] of mapping)Object.defineProperty(expected,name,{value:indices.map(i=>run.series[key][i]),enumerable:true,writable:true,configurable:true});
  check(equal(result,{[id]:expected}),'EVIDENCE_CLIENT_RESPONSE_MISMATCH');
  columns=next;grid={detailed,samples:count,indices,method:'rounded_even_index'};
  events.push({type:m.type,requested:[...m.variableNames],returned:[...columns],samples:count,detailed});
  return result;
 }
 return {clientRequest,snapshot};
}
