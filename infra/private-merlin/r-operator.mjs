// Private scheduled R consumer of the SAME ArenaMerlin entrypoint used by Arena.
// Only the initial D1 INSERT winner may submit. Subsequent invocations read only.
import {MODEL,CONFIG_HASH,grant,checkInput,requireThat} from './protocol.mjs';
export const ID='one-shot-private-merlin-bridge-r-v1';
export const PASS='ORIGINAL_AGENT_PROCESS_BOUNDARY_PASS_NO_INFERENCE';
export const TERMINALS=new Set([PASS,'RUNTIME_FAILURE','NO_TERMINAL_TASK','INVALID_REMOTE_RECEIPT']);
const same=(x,g)=>x?.phase==='R'&&x.project_id===g.project_id&&x.task_id===g.task_id&&x.model_sha256===MODEL&&x.source_commit===g.source_commit&&x.image_digest===g.image_digest;
export function checkRemotePass(task,g){
 requireThat(same(task,g)&&task.status===PASS,'R_TASK_IDENTITY');
 const r=task.receipt,p=r?.proof;
 requireThat(r?.status===PASS&&r.phase==='R'&&r.task_id===g.task_id&&r.source_commit===g.source_commit&&r.image_digest===g.image_digest&&
  r.posts===0&&r.egress_attempts===0&&r.container_stopped===true&&r.intercepts_registered===true&&r.internet_enabled_config===false&&
  r.output===null&&p?.source_commit===g.source_commit&&p.agent_config_sha256===CONFIG_HASH&&p.model_sha256===MODEL&&p.spawn_calls===1&&
  p.shutdown_ipc_sent===true&&p.exit?.code===0&&p.exit.signal===null&&/^sess_[a-f0-9]{32}$/.test(p.session_id)&&
  JSON.stringify(p.worker_frames)===JSON.stringify(['get_current_model','error','agent_complete'])&&
  JSON.stringify(r.frames)===JSON.stringify(['session_created','session_ready','agent_selected','agent_text','get_current_model','error','agent_complete']),'R_REMOTE_PROOF_INVALID');
 return true;
}
async function save(db,claim,status,task){
 const evidence={...claim,status,task:task??null,finished_at:new Date().toISOString(),inference_authorized:false,
  egress_independently_measured:false};
 const result=await db.prepare('UPDATE buffalo_stage3b8r1_receipts SET status=?,receipt_json=? WHERE probe_id=? AND run_id=? AND status=?')
  .bind(status,JSON.stringify(evidence),ID,claim.run_id,'CLAIMED').run();
 requireThat(result.meta?.changes===1||result.meta?.changes===0,'R_LEDGER_WRITE_FAILED');
 if(result.meta.changes===1)console.log('PRIVATE_MERLIN_R_TERMINAL '+status);
 return evidence;
}
export async function runPrivateR(env){
 if(env.MERLIN_GRANT==='null'||env.MERLIN_GRANT==null)return;
 // Expired grant cannot allocate. Already claimed tasks are read-only reconciled.
 let row=await env.DB.prepare('SELECT run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?').bind(ID).first();
 if(row&&row.status!=='CLAIMED')return;
 let g,claim;
 if(row){
  claim=JSON.parse(row.receipt_json);g=claim.approval;
  requireThat(row.run_id===g.task_id&&claim.probe_id===ID&&claim.run_id===g.task_id&&g.phase==='R'&&
    JSON.stringify(g)===env.MERLIN_GRANT,'R_LEDGER_IDENTITY');
 }else{
  g=grant(env,'R');
  const input={project_id:g.project_id,phase:'R',task_id:g.task_id,model_sha256:MODEL,sd_json:env.MERLIN_SD_JSON};
  await checkInput(input);
  claim={probe_id:ID,run_id:g.task_id,status:'CLAIMED',source_commit:g.source_commit,image_digest:g.image_digest,
    approval:g,claimed_at:new Date().toISOString()};
  const insert=await env.DB.prepare('INSERT INTO buffalo_stage3b8r1_receipts (probe_id,run_id,status,receipt_json) VALUES (?,?,?,?) ON CONFLICT(probe_id) DO NOTHING')
   .bind(ID,g.task_id,'CLAIMED',JSON.stringify(claim)).run();
  if(insert.meta?.changes!==1)return; // only winner submits; ambiguous ack never replayed
  try{grant(env,'R');await env.MERLIN.submit(input)}catch{} // never re-submit
 }
 let task;
 try{task=await env.MERLIN.read({project_id:g.project_id,phase:'R',task_id:g.task_id})}catch{return}
 if(task?.status===PASS){
  try{checkRemotePass(task,g)}catch{return save(env.DB,claim,'INVALID_REMOTE_RECEIPT',null)}
  return save(env.DB,claim,PASS,task);
 }
 if(task&&!same(task,g))return save(env.DB,claim,'INVALID_REMOTE_RECEIPT',null);
 if(task&& !['QUEUED','RUNNING'].includes(task.status))return save(env.DB,claim,'RUNTIME_FAILURE',task);
 // Allow the Router watchdog and Bridge reconciliation time after expiry.
 if(Date.now()>g.expires+180000)return save(env.DB,claim,'NO_TERMINAL_TASK',task);
}
export default {fetch:()=>new Response(null,{status:404}),scheduled(_event,env){return runPrivateR(env)}};
