// Single authorized I task. The R ledger and original image remain untouched.
import {MODEL,CONFIG_HASH,grant,checkInput,requireThat,digest,verifyClaim} from './protocol.mjs';
import {ID as R_ID,PASS as R_PASS,checkRemotePass as checkRPass} from './r-operator.mjs';
export const ID='one-shot-private-merlin-bridge-i-gemma-binding-v2';
export const FAILED_ID='one-shot-private-merlin-bridge-i-gemma-v1';
export const FAILED_TASK='5c82c14b-8799-43ba-b61d-3e56d6dfeeb9';
export function checkPriorFailure(row){
 requireThat(row?.probe_id===FAILED_ID&&row.run_id===FAILED_TASK&&row.status==='RUNTIME_FAILURE','I_V1_FAILURE_REQUIRED');
 const r=JSON.parse(row.receipt_json),t=r.task,p=t?.receipt;
 requireThat(r.probe_id===FAILED_ID&&r.run_id===FAILED_TASK&&r.status===row.status&&r.source_commit===SOURCE&&r.image_digest===IMAGE&&r.inference_authorized===true&&t?.task_id===FAILED_TASK&&t.status===row.status&&p?.task_id===FAILED_TASK&&p.posts===1&&p.egress_attempts===1&&p.container_stopped===true&&p.usage===null&&p.output===null&&t.error==='WS_INCOMPLETE','I_V1_FAILURE_IDENTITY');
 return r;
}
export const PASS='REAL_MERLIN_TURN_COMPLETED';
export const SOURCE='a09ab52d832b84efbe6b8e522e85d32dcde6bc1a';
export const IMAGE='sha256:04e7b615345ee6526dd61df1d1dc2770c5e7f7501e683c8a11e4de1333fda787';
export const MODEL_ID='@cf/google/gemma-4-26b-a4b-it';
export const LIMITS=Object.freeze({provider_model:MODEL_ID,max_posts:1,max_input_bytes:131072,max_output_tokens:2048});
export const TERMINALS=new Set([PASS,'RUNTIME_FAILURE','NO_TERMINAL_TASK','INVALID_REMOTE_RECEIPT']);
const same=(x,g)=>x?.phase==='I'&&x.project_id===g.project_id&&x.task_id===g.task_id&&x.model_sha256===MODEL&&x.source_commit===SOURCE&&x.image_digest===IMAGE;
export function exactGrant(g){
 requireThat(g?.phase==='I'&&g.project_id==='arena-igc'&&g.model_sha256===MODEL&&g.source_commit===SOURCE&&g.image_digest===IMAGE&&
  Object.keys(LIMITS).every(k=>g[k]===LIMITS[k]),'I_UNAPPROVED_GRANT');
 return g;
}
export function checkHistoricalR(row){
 requireThat(row?.probe_id===R_ID&&row.status===R_PASS,'I_R_REQUIRED');
 const r=JSON.parse(row.receipt_json),g=r.approval;
 requireThat(r.probe_id===R_ID&&r.run_id===row.run_id&&r.status===R_PASS&&r.source_commit===SOURCE&&r.image_digest===IMAGE&&
  g?.phase==='R'&&g.task_id===row.run_id&&g.source_commit===SOURCE&&g.image_digest===IMAGE&&g.model_sha256===MODEL&&
  r.inference_authorized===false&&r.egress_independently_measured===false,'I_R_IDENTITY');
 checkRPass(r.task,g);
 return r;
}
export async function checkIPass(task,g){
 exactGrant(g);
 requireThat(same(task,g)&&task.status===PASS,'I_TASK_IDENTITY');
 verifyClaim(g,task.approval);
 const r=task.receipt,p=r?.proof,u=r?.usage;
 requireThat(r?.status===PASS&&r.phase==='I'&&r.task_id===g.task_id&&r.source_commit===SOURCE&&r.image_digest===IMAGE&&
  r.posts===1&&r.egress_attempts===1&&r.provider_model===MODEL_ID&&r.finish_reason==='stop'&&
  r.provider_diagnostic?.transport==='binding-v2'&&r.provider_diagnostic.stage==='COMPLETE'&&r.provider_diagnostic.status==='OK'&&
  r.container_stopped===true&&r.intercepts_registered===true&&r.internet_enabled_config===false&&
  u&&Number.isSafeInteger(u.prompt_tokens)&&u.prompt_tokens>0&&Number.isSafeInteger(u.completion_tokens)&&u.completion_tokens>0&&u.completion_tokens<=LIMITS.max_output_tokens&&
  typeof r.output==='string'&&r.output.trim()&&r.output.length<=24000&&
  p?.source_commit===SOURCE&&p.agent_config_sha256===CONFIG_HASH&&p.model_sha256===MODEL&&p.spawn_calls===1&&
  p.shutdown_ipc_sent===true&&p.exit?.code===0&&p.exit.signal===null&&/^sess_[a-f0-9]{32}$/.test(p.session_id)&&
  JSON.stringify(p.worker_frames)===JSON.stringify(['get_current_model','agent_text','agent_complete'])&&
  JSON.stringify(r.frames)===JSON.stringify(['session_created','session_ready','agent_selected','agent_text','get_current_model','agent_text','agent_complete'])&&
  p.output_sha256===await digest(r.output),'I_REMOTE_PROOF_INVALID');
 verifyClaim(g,r.approval);
 return true;
}
async function save(db,claim,status,task){
 const evidence={...claim,status,task:task??null,finished_at:new Date().toISOString(),inference_authorized:true,egress_independently_measured:false};
 const result=await db.prepare('UPDATE buffalo_stage3b8r1_receipts SET status=?,receipt_json=? WHERE probe_id=? AND run_id=? AND status=?')
  .bind(status,JSON.stringify(evidence),ID,claim.run_id,'CLAIMED').run();
 requireThat(result.meta?.changes===1||result.meta?.changes===0,'I_LEDGER_WRITE_FAILED');
 if(result.meta.changes===1)console.log('PRIVATE_MERLIN_BINDING_I_TERMINAL '+status);
 return evidence;
}
export async function runPrivateI(env){
 if(env.MERLIN_GRANT==='null'||env.MERLIN_GRANT==null)return;
 requireThat(env.MERLIN_I_TRANSPORT==='binding-v2','BINDING_OPERATOR_NOT_ARMED');
 const row=await env.DB.prepare('SELECT run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?').bind(ID).first();
 if(row&&row.status!=='CLAIMED')return;
 let g,claim;
 if(row){
  claim=JSON.parse(row.receipt_json);g=exactGrant(claim.approval);
  requireThat(row.run_id===g.task_id&&claim.probe_id===ID&&claim.run_id===g.task_id&&JSON.stringify(g)===env.MERLIN_GRANT,'I_LEDGER_IDENTITY');
 }else{
  g=exactGrant(grant(env,'I'));
  const prior=await env.DB.prepare('SELECT probe_id,run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?').bind(R_ID).first();
  checkHistoricalR(prior);
  const failed=await env.DB.prepare('SELECT probe_id,run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?').bind(FAILED_ID).first();
  checkPriorFailure(failed);
  requireThat(failed.run_id!==g.task_id&&prior.run_id!==g.task_id,'I_R_TASK_REUSE');
  const input={project_id:g.project_id,phase:'I',task_id:g.task_id,model_sha256:MODEL,sd_json:env.MERLIN_SD_JSON};
  await checkInput(input);
  claim={probe_id:ID,run_id:g.task_id,status:'CLAIMED',source_commit:SOURCE,image_digest:IMAGE,approval:g,claimed_at:new Date().toISOString()};
  const inserted=await env.DB.prepare('INSERT INTO buffalo_stage3b8r1_receipts (probe_id,run_id,status,receipt_json) VALUES (?,?,?,?) ON CONFLICT(probe_id) DO NOTHING')
   .bind(ID,g.task_id,'CLAIMED',JSON.stringify(claim)).run();
  if(inserted.meta?.changes!==1)return;
  try{exactGrant(grant(env,'I'));await env.MERLIN.submit(input)}catch{} // Never submit again, even if acknowledgment is ambiguous.
 }
 let task;
 try{task=await env.MERLIN.read({project_id:g.project_id,phase:'I',task_id:g.task_id})}catch{return}
 if(task?.status===PASS){
  try{await checkIPass(task,g)}catch{return save(env.DB,claim,'INVALID_REMOTE_RECEIPT',task)}
  return save(env.DB,claim,PASS,task);
 }
 if(task&&!same(task,g))return save(env.DB,claim,'INVALID_REMOTE_RECEIPT',null);
 if(task&&!['QUEUED','RUNNING'].includes(task.status))return save(env.DB,claim,'RUNTIME_FAILURE',task);
 if(Date.now()>g.expires+180000)return save(env.DB,claim,'NO_TERMINAL_TASK',task);
}
export default {fetch:()=>new Response(null,{status:404}),scheduled(_event,env){return runPrivateI(env)}};
