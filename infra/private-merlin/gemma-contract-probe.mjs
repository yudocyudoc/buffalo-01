// One synthetic request. No Buffalo runtime, model data, Container or credentials.
export const ID='one-shot-gemma-native-response-contract-v1';
export const MODEL='@cf/google/gemma-4-26b-a4b-it';
export const FAILED_ID='one-shot-private-merlin-bridge-i-gemma-binding-v2';
export const FAILED_TASK='12369a1c-fe8f-4e03-b3c1-5bd9170a6418';
export const INPUT=Object.freeze({messages:Object.freeze([
 Object.freeze({role:'system',content:'Reply with only the requested word.'}),
 Object.freeze({role:'user',content:'Say OK.'})
]),max_completion_tokens:32,stream:false,chat_template_kwargs:Object.freeze({enable_thinking:false})});
const assert=(v,m)=>{if(!v)throw Error(m)};
export function checkPrior(row){
 assert(row?.probe_id===FAILED_ID&&row.run_id===FAILED_TASK&&row.status==='RUNTIME_FAILURE','BINDING_I_FAILURE_REQUIRED');
 const x=JSON.parse(row.receipt_json),r=x.task?.receipt;
 assert(x.probe_id===FAILED_ID&&x.run_id===FAILED_TASK&&x.status===row.status&&r?.task_id===FAILED_TASK&&
 r.posts===1&&r.egress_attempts===2&&r.provider_model===MODEL&&r.container_stopped===true&&
 r.provider_diagnostic?.stage==='RESPONSE'&&r.provider_diagnostic.status==='FAILED'&&
 r.usage?.prompt_tokens===6904&&r.usage.completion_tokens===311&&r.finish_reason==='stop','BINDING_I_FAILURE_IDENTITY');
 return x;
}
export function responseChecks(result){
 const u=result?.usage,c=result?.choices?.[0],m=c?.message;
 return {
  usage_present:!!u,
  prompt_tokens_valid:Number.isSafeInteger(u?.prompt_tokens)&&u.prompt_tokens>0,
  completion_tokens_valid:Number.isSafeInteger(u?.completion_tokens)&&u.completion_tokens>0&&u.completion_tokens<=32,
  model_exact:result?.model===MODEL,
  one_choice:result?.choices?.length===1,
  stop:c?.finish_reason==='stop',
  assistant_role:m?.role==='assistant',
  no_tool_calls:!m?.tool_calls?.length,
  no_function_call:!m?.function_call,
  content_string:typeof m?.content==='string',
  content_nonempty:typeof m?.content==='string'&&!!m.content.trim(),
  content_bounded:typeof m?.content==='string'&&m.content.length<=16000
 };
}
const claimValid=g=>g&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(g.task_id)&&
 /^[a-f0-9]{40}$/.test(g.source_commit)&&g.model===MODEL&&g.max_calls===1&&g.max_output_tokens===32&&Number.isSafeInteger(g.expires)&&g.expires>Date.now()&&g.expires<=Date.now()+22*60000;
export async function runProbe(env){
 const g=JSON.parse(env.GEMMA_PROBE_GRANT??'null');
 if(!claimValid(g)||typeof env.AI?.run!=='function')return;
 const prior=await env.DB.prepare('SELECT probe_id,run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?').bind(FAILED_ID).first();
 checkPrior(prior);
 const claim={probe_id:ID,run_id:g.task_id,status:'CLAIMED',approval:g,claimed_at:new Date().toISOString(),request:INPUT,reserved_calls:1};
 const ins=await env.DB.prepare('INSERT INTO buffalo_stage3b8r1_receipts (probe_id,run_id,status,receipt_json) VALUES (?,?,?,?) ON CONFLICT(probe_id) DO NOTHING').bind(ID,g.task_id,'CLAIMED',JSON.stringify(claim)).run();
 if(ins.meta?.changes!==1)return;
 let terminal={...claim,status:'PROVIDER_FAILURE',response:null,checks:null,usage:null};
 try{
  assert(claimValid(g),'GRANT_EXPIRED_AFTER_CLAIM');
  const result=await env.AI.run(MODEL,INPUT); // Only invocation site. No retry or fallback.
  const serialized=JSON.stringify(result);
  const size=typeof serialized==='string'?new TextEncoder().encode(serialized).length:null;
  const u=result?.usage;
  terminal={...claim,status:size!==null&&size<=16384?'RESPONSE_CAPTURED':'RESPONSE_UNCAPTURED',
   response:size!==null&&size<=16384?JSON.parse(serialized):null,response_bytes:size,
   checks:responseChecks(result),usage:u&&[u.prompt_tokens,u.completion_tokens].every(n=>Number.isSafeInteger(n)&&n>=0)?{prompt_tokens:u.prompt_tokens,completion_tokens:u.completion_tokens}:null};
 }catch(e){
  terminal.provider_code=Number.isSafeInteger(e?.code)?e.code:null;
  terminal.provider_http_status=Number.isSafeInteger(e?.status)?e.status:null;
 }
 terminal.finished_at=new Date().toISOString();
 const saved=await env.DB.prepare('UPDATE buffalo_stage3b8r1_receipts SET status=?,receipt_json=? WHERE probe_id=? AND run_id=? AND status=?').bind(terminal.status,JSON.stringify(terminal),ID,g.task_id,'CLAIMED').run();
 assert(saved.meta?.changes===1,'PROBE_RECEIPT_NOT_SAVED');
 console.log('GEMMA_CONTRACT_TERMINAL '+terminal.status);
}
export default {fetch:()=>new Response(null,{status:404}),scheduled(_event,env){return runProbe(env)}};
