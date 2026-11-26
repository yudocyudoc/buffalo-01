// Private scheduled operator; real native binding lives in the original runtime.
// One immutable D1 claim per case. No retries; each authorized project has its
// own durable eight-reservation ceiling and a short expiry.
import {CASES,LIMIT,probeId,fixture,validGrant} from './remote-ltm-cases.mjs';
import {readSession} from './session-client.mjs';
import {openNativeLtmRun} from './native-ltm-client.mjs';
import {digest} from './provider-wire.mjs';
import {acceptedGemmaModel} from '../private-merlin/gemma-response.mjs';
export const PASS='FULL_REMOTE_NATIVE_LTM_PASS';
const table='buffalo_stage3b8r1_receipts';
const check=(ok,reason)=>{if(!ok)throw Error(reason)};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const completed=(tools,name)=>tools.some(t=>t.event==='tool_call_completed'&&t.name===name&&!t.isError);
export const REQUIRED_TOOLS=['get_feedback_information','get_variable_data','generate_ltm_narrative'];
export function validReceipts(rows){
 return rows.length>=2&&rows.length<=LIMIT&&rows.every((r,i)=>r.attempt===i+1&&r.status==='OK'&&
  acceptedGemmaModel(r.response_model)&&['stop','tool_calls'].includes(r.finish_reason)&&
  Number.isSafeInteger(r.usage?.prompt_tokens)&&r.usage.prompt_tokens>0&&
  Number.isSafeInteger(r.usage?.completion_tokens)&&r.usage.completion_tokens>0&&
  Number.isFinite(r.neurons)&&r.neurons>=0)&&
  rows.some(r=>r.finish_reason==='tool_calls')&&rows.some(r=>r.channel==='original-engine'&&
  r.response_format==='json_schema'&&r.predicates?.schema_valid===true)&&rows.at(-1).finish_reason==='stop';
}
export async function runNativeLtm(env,{session=readSession}={}){
 let g;try{g=JSON.parse(env.FULL_NATIVE_LTM_GRANT??'null')}catch{return}
 if(!validGrant(g)||!env.APP_AUTH_KEY)return;
 const id=probeId(g.case_name),claim={probe_id:id,run_id:g.run_id,approval:g,status:'CLAIMED',claimed_at:new Date().toISOString()};
 const ins=await env.DB.prepare('INSERT INTO '+table+' (probe_id,run_id,status,receipt_json) VALUES (?,?,?,?) ON CONFLICT(probe_id) DO NOTHING')
  .bind(id,g.run_id,'CLAIMED',JSON.stringify(claim)).run();
 if(ins.meta?.changes!==1)return;
 const e={...claim,status:'RUNTIME_FAILURE',case_name:g.case_name,mode:'native_workers_ai_binding',tools:[],inferences:[],narratives:[],container_stopped:false,prose:'not_semantically_verified'};
 let stage='FRESH_PROJECT',started=false;
 const req=(path,init={})=>{
  const headers=new Headers(init.headers);headers.set('x-buffalo-project',g.project);headers.set('Authentication',env.APP_AUTH_KEY);
  return env.FULL.fetch(new Request('http://buffalo.internal'+path,{...init,headers}));
 };
 const read=async path=>{const r=await req(path);check(r.ok,'ARTIFACT_READ');return r.text()};
 const stop=async()=>{const r=await env.FULL.stop(g.project);check(r?.container_stopped===true,'STOP_UNCONFIRMED');e.container_stopped=true};
 const receipts=async()=>{
  const rows=[];
  for(let i=1;i<=LIMIT+1;i++){
   const r=await req('/project/inference/'+i);if(r.status===404)break;
   check(r.ok&&i<=LIMIT,'INFERENCE_RECEIPT_LIMIT');
   rows.push({attempt:i,...await r.json()});
  }
  e.inferences=rows;
 };
 try{
  check(validGrant(g),'GRANT_EXPIRED');
  check((await req('/project/inference/1')).status===404,'PROJECT_ALREADY_USED');
  const {model,expectedCycles,expectedSamples}=fixture(g.case_name);
  const create=await req('/project/model',{method:'PUT',headers:{'if-none-match':'*'},body:JSON.stringify(model)});
  check(create.status===201&&create.headers.get('etag')==='"1"','PROJECT_NOT_FRESH');
  e.model=model;e.identity={revision:1,model_sha256:create.headers.get('x-buffalo-model-sha256')};
  e.simulation_id=crypto.randomUUID();const path='/project/runs/'+e.simulation_id,ltm=path+'/ltm';
  stage='SIMULATION';started=true;
  const init={method:'PUT',body:JSON.stringify(e.identity)};
  check((await req(ltm,init)).status===201,'NATIVE_COMPUTE');
  check((await req(ltm,init)).status===204,'NATIVE_REPLAY');
  const ltmBody=await read(ltm);e.evidence_sha256=await digest(ltmBody);
  e.evidence=JSON.parse(ltmBody);
  check(e.evidence.loops.length===expectedCycles&&e.evidence.time.length===expectedSamples&&
    e.evidence.time[0]===model.specs.startTime&&e.evidence.time.at(-1)===model.specs.stopTime,'NATIVE_MATRIX_SHAPE');
  await stop();e.first_stop=true;
  stage='REOPEN';
  const selected=await openNativeLtmRun(req,e.simulation_id);
  e.run=selected.run;e.feedback=selected.feedback;e.assessment=selected.assessment;
  check(equal(selected.model,model)&&selected.feedback.source.evidence_sha256===e.evidence_sha256&&
    await digest(await read(ltm))===e.evidence_sha256,'REOPEN_IDENTITY');
  check(selected.assessment.dominance.status==='supported_by_partition_scores','DOMINANCE_NOT_SUPPORTED');
  check(validGrant(g),'GRANT_EXPIRED');
  const stock=model.variables.find(v=>v.type==='stock').name;
  // Identical user prompt to the controlled matrix; no injected tool calls.
  const prompt='Analyze the immutable saved simulation '+e.simulation_id+
   '. Use get_feedback_information for that run, get_variable_data for '+stock+
   ', and generate_ltm_narrative for that run. Explain structure, activity and dominance separately. Do not edit or rerun the model. Do not invent periods or equate individual maxima with dominance.';
  e.prompt=prompt;
  stage='MERLIN';e.container_stopped=false;
  const ws=await req('/api/v1',{headers:{Upgrade:'websocket'}});
  check(ws.status===101&&ws.webSocket,'WS_UPGRADE');
  const result=await session(ws.webSocket,{mode:'sfd',key:env.APP_AUTH_KEY,agent:'merlin',edit:true,
   model:selected.model,tools:e.tools,deadline:Math.min(g.expires,Date.now()+300000),scenario:{
    readOnly:true,message:prompt,clientRequest:selected.clientRequest,
    async onToolCompleted(message){
     if(message.toolName==='generate_ltm_narrative'&&!message.isError){
      const narrativeId=crypto.randomUUID();
      const saved=await selected.saveNarrative(narrativeId,prompt,JSON.parse(message.result[0].text));
      e.narratives.push({id:narrativeId,record:saved});
     }
    },
    verify(model,tools){
     check(equal(model,selected.model),'UNEXPECTED_MODEL_CHANGE');
     check(REQUIRED_TOOLS.every(name=>completed(tools,name)),'REQUIRED_TOOL_MISSING');
    }
   }});
  e.session={session_id:result.session_id,updated:result.updated,output:result.output};
  check(e.narratives.length>0,'NO_SAVED_NARRATIVE');
  stage='RECOVERY';await stop();
  for(const n of e.narratives){
   check(equal(JSON.parse(await read(path+'/narratives/'+n.id)),n.record),'NARRATIVE_RECOVERY');
   check(n.record.assessment.dominance.status==='supported_by_partition_scores'&&
    n.record.assessment.prose==='not_semantically_verified','NARRATIVE_ASSESSMENT');
  }
  check(await digest(await read(ltm))===e.evidence_sha256,'EVIDENCE_CHANGED');
  stage='RECEIPTS';await receipts();check(validReceipts(e.inferences),'INFERENCE_CONTRACT');
  e.status=PASS;
 }catch(error){
  e.failure_stage=stage;e.failure_code=String(error?.message??error).slice(0,300);
 }finally{
  if(started&&!e.container_stopped)try{await stop()}catch{e.status='RUNTIME_FAILURE';e.container_stopped=false;e.failure_stage='STOP';e.failure_code='STOP_UNCONFIRMED'}
  // The DO receipts are authoritative; save them even if a tool or narrative fails.
  try{await receipts()}catch{e.status='RUNTIME_FAILURE';e.receipts_incomplete=true}
  e.finished_at=new Date().toISOString();
  let body=JSON.stringify(e);
  // D1 has a finite row limit. Preserve compact failure evidence rather than
  // lose terminal status, never claim success if full artifact did not fit.
  if(new TextEncoder().encode(body).length>1500000){
   e.status='RUNTIME_FAILURE';e.failure_stage='EXPORT';e.failure_code='D1_RECEIPT_TOO_LARGE';
   delete e.evidence;delete e.run;delete e.feedback;body=JSON.stringify(e);
  }
  const updated=await env.DB.prepare('UPDATE '+table+' SET status=?,receipt_json=? WHERE probe_id=? AND run_id=? AND status=?')
   .bind(e.status,body,id,g.run_id,'CLAIMED').run();
  check(updated.meta?.changes===1,'TERMINAL_RECEIPT_WRITE');
  console.log('FULL_REMOTE_NATIVE_LTM_OUTCOME '+g.case_name+' '+e.status);
 }
}
export default {fetch:()=>new Response(null,{status:404}),scheduled(_event,env){return runNativeLtm(env)}};
