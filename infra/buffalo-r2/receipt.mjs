// Shared bounded receipt contract, no native dependencies or provider calls.
export const ID='one-shot-private-original-merlin-r2-v1';
export const MODE='ONE_PRIVATE_ORIGINAL_MERLIN_PROCESS_NO_INFERENCE';
export const SCHEMA='BUFFALO_STAGE3B8R2_PRIVATE_PROCESS_V1';
export const MODEL='57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39';
export const validCommit=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
export const validKey=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const validRun=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
const flags=['original_worker_spawner','original_agent_worker','bwrap_ipc_worker','worker_exited','shutdown_ipc_sent','launch_context_verified','proxy_stopped','session_directory_removed'];
const negatives=['agent_model_response','model_modified','simulation_executed','grader_executed','provider_requests_measured','inference_authorized'];
const failures=new Set(['LAUNCH_CONTEXT_FAILED','ORIGINAL_WORKER_START_FAILED','ORIGINAL_IPC_TIMEOUT','ORIGINAL_PROCESS_TIMEOUT','ORIGINAL_PROCESS_FAILED','INVALID_PROCESS_RECEIPT']);
export function boundedReceipt(x,commit,run){
 if(!x||x.schema!==SCHEMA||x.probe_id!==ID||x.source_commit!==commit||!validCommit(commit)||x.run_id!==run||!validRun(run)||
 !validKey(x.process_log_sha256)||!Number.isInteger(x.exit_code)||x.exit_code<0||x.exit_code>255||
 x.inference_authorized!==false||x.provider_requests_measured!==false||x.raw_log_in_receipt!==false)throw Error('R2_RECEIPT_INVALID');
 const base={schema:SCHEMA,probe_id:ID,source_commit:commit,run_id:run,process_log_sha256:x.process_log_sha256,exit_code:x.exit_code,
  inference_authorized:false,provider_requests_measured:false,raw_log_in_receipt:false};
 if(x.status==='ORIGINAL_PROCESS_BLOCKED'){
  if(!failures.has(x.reason_code)||x.exit_code===0||x.evidence!==null)throw Error('R2_FALSE_BLOCK');
  return {...base,status:x.status,reason_code:x.reason_code,evidence:null};
 }
 const p=x.evidence;
 if(x.status!=='ORIGINAL_PROCESS_PASS'||x.exit_code!==0||x.reason_code!=='NONE'||!p||
 p.schema!=='BUFFALO_STAGE3B8_ORIGINAL_MERLIN_PROCESS_OFFLINE_V1'||p.status!=='ORIGINAL_MERLIN_WORKER_OFFLINE_PROVIDER_DENIED_PASS'||
 p.checkout_commit!==commit||p.agent!=='merlin'||p.scenario!=='dialysisClinic'||p.initial_model_sha256!==MODEL||
 !validKey(p.agent_config_sha256)||p.provider!=='UNREGISTERED_DENY_ONLY'||p.ipc_barriers!==2||p.model_sync_requests!==1||
 p.worker_exit_code!==0||p.worker_exit_signal!==null||
 p.genuine_terminal_error!=='CONVERSATION_ERROR'||p.terminal_status!=='awaiting_user'||
 flags.some(k=>p[k]!==true)||negatives.some(k=>p[k]!==false))throw Error('R2_FALSE_PASS');
 return {...base,status:x.status,reason_code:'NONE',evidence:{schema:p.schema,status:p.status,checkout_commit:commit,agent:'merlin',scenario:'dialysisClinic',
 initial_model_sha256:MODEL,agent_config_sha256:p.agent_config_sha256,provider:'UNREGISTERED_DENY_ONLY',ipc_barriers:2,model_sync_requests:1,
 genuine_terminal_error:'CONVERSATION_ERROR',terminal_status:'awaiting_user',worker_exit_code:0,worker_exit_signal:null,...Object.fromEntries(flags.map(k=>[k,true])),...Object.fromEntries(negatives.map(k=>[k,false]))}};
}
