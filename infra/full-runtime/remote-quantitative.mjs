// Private, explicitly authorized smoke operator. Not a product restriction.
import {validInvocationId} from './engine-protocol.mjs';
import {acceptedGemmaModel} from '../private-merlin/gemma-response.mjs';
export const ID='one-shot-buffalo-full-quantitative-v1';
export const PROJECT='buffalo-full-quantitative-v1';
export const LIMIT=1;
export const PASS='FULL_REMOTE_QUANTITATIVE_MODEL_RETURNED';
export const PROMPT='Create a stock Inventory initially 10, fed by Inflow equal to Demand of 5 per Day. Simulate days 0 to 4 with Euler dt 1.';
const table='buffalo_stage3b8r1_receipts';
const check=(ok,reason)=>{if(!ok)throw Error(reason)};
const integer=n=>Number.isSafeInteger(n)&&n>0;
export function validGrant(g,now=Date.now()){
 return g?.project===PROJECT&&g.max_calls===LIMIT&&/^[a-f0-9]{40}$/.test(g.source_commit)&&
 /^sha256:[a-f0-9]{64}$/.test(g.image_digest)&&validInvocationId(g.run_id)&&
 Number.isSafeInteger(g.expires)&&g.expires>now&&g.expires-now<=22*60000;
}
export function validInference(r){
 return r?.channel==='original-engine'&&r.status==='OK'&&r.response_format==='json_schema'&&
 acceptedGemmaModel(r.response_model)&&r.finish_reason==='stop'&&
 validInvocationId(r.invocation_id)&&/^[a-f0-9]{64}$/.test(r.request_sha256)&&
 /^[a-f0-9]{64}$/.test(r.schema_sha256)&&r.predicates?.schema_valid===true&&r.predicates?.total_tokens_valid===true&&
 r.predicates?.json_valid===true&&Array.isArray(r.failed_predicates)&&r.failed_predicates.length===0&&
 integer(r.usage?.prompt_tokens)&&integer(r.usage?.completion_tokens)&&integer(r.max_completion_tokens)&&r.usage.completion_tokens<=r.max_completion_tokens&&
 r.max_completion_tokens<=8192&&Number.isFinite(r.neurons)&&r.neurons>=0;
}
export async function runQuantitative(env){
 let g;try{g=JSON.parse(env.FULL_QUANTITATIVE_GRANT??'null')}catch{return}
 if(!validGrant(g)||!env.APP_AUTH_KEY)return;
 const claim={probe_id:ID,run_id:g.run_id,status:'CLAIMED',approval:g,claimed_at:new Date().toISOString()};
 const ins=await env.DB.prepare('INSERT INTO '+table+' (probe_id,run_id,status,receipt_json) VALUES (?,?,?,?) ON CONFLICT(probe_id) DO NOTHING')
   .bind(ID,g.run_id,'CLAIMED',JSON.stringify(claim)).run();
 if(ins.meta?.changes!==1)return;
 const evidence={...claim,status:'RUNTIME_FAILURE',inference:null,container_stopped:false};
 let stage='FRESH_PROJECT',started=false;
 const req=(path,init={})=>{
   const headers=new Headers(init.headers);headers.set('x-buffalo-project',PROJECT);
   headers.set('Authentication',env.APP_AUTH_KEY);
   return env.FULL.fetch(new Request('http://buffalo.internal'+path,{...init,headers}));
 };
 const readReceipt=async()=>{
   const r=await req('/project/inference/1');if(r.status===404)return null;
   check(r.ok,'RECEIPT_READ');return r.json();
 };
 try{
   check(validGrant(g),'GRANT_EXPIRED');
   check(await readReceipt()===null,'PROJECT_ALREADY_USED');
   stage='REST';started=true;
   const health=await req('/status');check(health.ok,'APP_STATUS');await health.body?.cancel();
   check(validGrant(g),'GRANT_EXPIRED');
   stage='GENERATE';
   const response=await req('/api/v1/engines/quantitative/generate',{method:'POST',
     headers:{'content-type':'application/json'},body:JSON.stringify({prompt:PROMPT}),
     signal:AbortSignal.timeout(Math.max(1,Math.min(180000,g.expires-Date.now())))});
   evidence.rest_status=response.status;
   check(response.ok,'REST_HTTP');
   const result=await response.json();evidence.rest_success=result.success===true;
   check(result.success===true,'ORIGINAL_ENGINE_REJECTED');
   check(Array.isArray(result.model?.variables)&&Array.isArray(result.model?.relationships),'MISSING_MODEL');
   evidence.model=result.model;
   stage='RECEIPT';evidence.inference=await readReceipt();
   check(validInference(evidence.inference),'INFERENCE_CONTRACT');
   const second=await req('/project/inference/2');check(second.status===404,'EXTRA_RESERVATION');
   evidence.single_reservation=true;
   evidence.status=PASS;
 }catch(e){
   evidence.failure_stage=stage;
   evidence.failure_code=/^[A-Z_]{1,80}$/.test(e?.message??'')?e.message:'REMOTE_EXECUTION_FAILURE';
 }finally{
   if(started){
     try{const stopped=await env.FULL.stop(PROJECT);check(stopped?.container_stopped===true,'STOP_UNCONFIRMED');evidence.container_stopped=true;}
     catch{evidence.status='RUNTIME_FAILURE';evidence.failure_stage='STOP';evidence.failure_code='STOP_UNCONFIRMED';}
   }
   if(!evidence.inference)try{evidence.inference=await readReceipt()}catch{}
   evidence.finished_at=new Date().toISOString();
   const updated=await env.DB.prepare('UPDATE '+table+' SET status=?,receipt_json=? WHERE probe_id=? AND run_id=? AND status=?')
     .bind(evidence.status,JSON.stringify(evidence),ID,g.run_id,'CLAIMED').run();
   check(updated.meta?.changes===1,'TERMINAL_RECEIPT_WRITE');
   console.log('FULL_REMOTE_QUANTITATIVE_OUTCOME '+evidence.status);
 }
}
export default {fetch:()=>new Response(null,{status:404}),scheduled(_event,env){return runQuantitative(env)}};
