/**
 * Stage 3B-8/R0 — classify evidence from an OFFLINE OCI image. The source of
 * truth remains the original Buffalo process receipts, not CI greenness.
 * This file never contacts Cloudflare, makes grants, starts an agent, or deploys.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {validateMinimalReceipt} from './stage3b8r-bwrap-minimal.mjs';

export const R0_SCHEMA='BUFFALO_STAGE3B8R0_LOCAL_OCI_SANDBOX_GATE_V1';
const SHA40=/^[a-f0-9]{40}$/;
const expectedModel='57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39';
const directPrefix='BUFFALO_3B8_PROCESS_EVIDENCE=';
const wsPrefix='BUFFALO_3B8_WS_PROCESS_EVIDENCE=';
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=code=>{throw Error('3B8R0_'+code)};
const bool=(value,key)=>{if(value!==true)fail(key)};
const falseVal=(value,key)=>{if(value!==false)fail(key)};
const MINIMAL_PREFIX='BUFFALO_3B8R0_MINIMAL=';
function processFailureCode(log){
 // Observational classification only: a WorkerSpawner warning alone does NOT
 // establish that the Docker kernel denied namespaces.
 if(/creating new namespace failed|user namespaces.*disabled/i.test(log))
  return 'NAMESPACE_ERROR_IN_ORIGINAL_WORKER_LOG';
 if(/bwrap exited early/i.test(log))return 'WORKER_BWRAP_EARLY_EXIT_CAUSE_UNKNOWN';
 if(/bwrap sandbox is unavailable/i.test(log))return 'WORKER_BWRAP_UNAVAILABLE_CAUSE_UNKNOWN';
 if(/3B8_REAL_WORKER_IPC_TIMEOUT|3B8_REAL_WS_TIMEOUT/i.test(log))
  return 'ORIGINAL_PROCESS_IPC_OR_WS_TIMEOUT';
 return 'ORIGINAL_PROCESS_ERROR_UNCLASSIFIED';
}
function receipt(log,prefix) {
 if(typeof log!=='string'||log.length>1024*1024)fail('LOG_MISSING_OR_TOO_LARGE');
 const rows=log.split(/\r?\n/).filter(x=>x.startsWith(prefix));
 if(rows.length!==1)fail('RECEIPT_COUNT_'+rows.length);
 let value;
 try{value=JSON.parse(rows[0].slice(prefix.length))}catch{fail('RECEIPT_MALFORMED')}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('RECEIPT_SHAPE');
 return value;
}
function checkDirect(x,sha) {
 if(x.schema!=='BUFFALO_STAGE3B8_ORIGINAL_MERLIN_PROCESS_OFFLINE_V1'||
    x.status!=='ORIGINAL_MERLIN_WORKER_OFFLINE_PROVIDER_DENIED_PASS'||
    x.checkout_commit!==sha||x.initial_model_sha256!==expectedModel||
    x.agent!=='merlin'||x.provider!=='UNREGISTERED_DENY_ONLY'||
    x.genuine_terminal_error!=='CONVERSATION_ERROR'||
    x.terminal_status!=='awaiting_user'||x.ipc_barriers!==2||
    x.model_sync_requests!==1)fail('DIRECT_RECEIPT_IDENTITY_OR_SEQUENCE');
 for(const k of ['original_worker_spawner','original_agent_worker',
   'bwrap_ipc_worker','worker_exited'])bool(x[k],'DIRECT_'+k);
 for(const k of ['provider_requests_measured','agent_model_response',
  'model_modified','simulation_executed','grader_executed',
  'bridge_or_container_deployed','execution_allowed'])falseVal(x[k],'DIRECT_'+k);
}
function checkWs(x,sha) {
 if(x.schema!=='BUFFALO_STAGE3B8_ORIGINAL_WS_PROCESS_OFFLINE_V1'||
    x.status!=='ORIGINAL_MERLIN_WS_PROCESS_OFFLINE_PASS'||
    x.checkout_commit!==sha||x.model_sha256!==expectedModel||
    x.agent!=='merlin'||x.provider_selected!=='anthropic'||
    x.worker_spawn_calls!==1)fail('WS_RECEIPT_IDENTITY_OR_SEQUENCE');
 for(const k of ['handler_original','spawner_delegated_original','worker_original',
  'worker_sandbox_bwrap','real_ipc_barrier','worker_reaped'])bool(x[k],'WS_'+k);
 for(const k of ['agent_turn_executed','provider_requests_measured',
  'cloudflare_deployed','execution_allowed'])falseVal(x[k],'WS_'+k);
 if(!Array.isArray(x.original_frames)||
    !['session_created','session_ready','agent_selected'].every(
       name=>x.original_frames.includes(name))||
    x.original_frames.some(name=>['agent_complete','tool_call_request','run_model'].includes(name)))
   fail('WS_ORIGINAL_FRAME_SET');
}
const makeBase=(sourceSha,minimal,direct,ws,minimalReceipt)=>({
 schema:R0_SCHEMA,source_commit:sourceSha,
 minimal_log_sha256:hash(minimal.log),
 direct_log_sha256:hash(direct.log),ws_log_sha256:hash(ws.log),
 minimal_flags_sha256:minimalReceipt.flags_sha256,
 minimal_probe_status:minimalReceipt.status,
 minimal_probe_reason_code:minimalReceipt.reason_code,
 image_test_only:true,artifact_not_remote_attestation:true,
 cloudflare_deployed:false,remote_container_executed:false,
 provider_requests_measured:false,inference_authorized:false,
 grant_created:false,public_ingress_enabled:false,
 next_step_requires_separate_approval:true
});
export function classifyR0({sourceSha,imageSourceSha,minimal,direct,ws}) {
 if(!SHA40.test(sourceSha??'')||sourceSha!==imageSourceSha)
  fail('IMAGE_CHECKOUT_IDENTITY_MISMATCH');
 if(!minimal||!direct||!ws||!Number.isInteger(minimal.exitCode)||
    !Number.isInteger(direct.exitCode)||!Number.isInteger(ws.exitCode)||
    typeof minimal.log!=='string'||typeof direct.log!=='string'||
    typeof ws.log!=='string')fail('PROBE_INPUT_INVALID');
 const min=validateMinimalReceipt(receipt(minimal.log,MINIMAL_PREFIX),sourceSha);
 const expectedMinimalExit=min.status==='MINIMAL_BWRAP_PASS'?0:2;
 if(minimal.exitCode!==expectedMinimalExit)
  fail('MINIMAL_PROCESS_EXIT_AND_RECEIPT_DISAGREE');
 const base=makeBase(sourceSha,minimal,direct,ws,min);
 if(min.status==='MINIMAL_BWRAP_BLOCKED'){
   if(direct.exitCode!==99||direct.log.trim()!=='SKIPPED_AFTER_MINIMAL_FAILURE'||
      ws.exitCode!==99||ws.log.trim()!=='SKIPPED_AFTER_MINIMAL_FAILURE')
    fail('MINIMAL_DENIAL_DID_NOT_SKIP_AGENT');
   return {...base,status:'OCI_MINIMAL_BWRAP_BLOCKED',phase:'MINIMAL_NAMESPACE',
      cause_code:min.reason_code,evidence_scope:'LOCAL_OCI_ONLY',
      ready_for_private_execution:false};
 }
 if(direct.exitCode!==0){
   if(ws.exitCode!==99||ws.log.trim()!=='SKIPPED_AFTER_DIRECT_FAILURE')
    fail('DIRECT_FAILURE_DID_NOT_SKIP_WS');
   if(direct.log.includes(directPrefix))fail('CONTRADICTORY_DIRECT_RECEIPT');
   return {...base,status:'OCI_ORIGINAL_WORKER_BLOCKED_AFTER_MINIMAL_PASS',
      phase:'ORIGINAL_WORKER',cause_code:processFailureCode(direct.log),
      evidence_scope:'LOCAL_OCI_ONLY',ready_for_private_execution:false};
 }
 checkDirect(receipt(direct.log,directPrefix),sourceSha);
 if(ws.exitCode!==0){
   if(ws.log.includes(wsPrefix))fail('CONTRADICTORY_WS_RECEIPT');
   return {...base,status:'OCI_ORIGINAL_WS_BLOCKED_AFTER_MINIMAL_PASS',
      phase:'ORIGINAL_WEBSOCKET',cause_code:processFailureCode(ws.log),
      evidence_scope:'LOCAL_OCI_ONLY',ready_for_private_execution:false};
 }
 checkWs(receipt(ws.log,wsPrefix),sourceSha);
 return {...base,status:'LOCAL_OCI_BWRAP_AND_ORIGINAL_WS_PASS',
   phase:'LOCAL_OCI_PROCESS_AND_WEBSOCKET',
   evidence_scope:'LOCAL_OCI_ONLY_NOT_CLOUDFLARE',
   ready_for_private_execution:false,
   direct_worker_process_verified:true,ws_worker_process_verified:true};
}

function parse(argv) {
 const opts={};
 for(let i=0;i<argv.length;i+=2){
  const k=argv[i],v=argv[i+1];
  if(!['--minimal-log','--minimal-exit','--direct-log','--direct-exit',
    '--ws-log','--ws-exit','--source-sha','--image-sha','--output'].includes(k)||
     !v||opts[k])fail('INVALID_ARGS');
  opts[k]=v;
 }
 if(Object.keys(opts).length!==9)fail('MISSING_ARGS');
 const ec=s=>{if(!/^(0|[1-9][0-9]{0,2})$/.test(s))fail('BAD_EXIT_CODE');return Number(s)};
 return {
  sourceSha:opts['--source-sha'],imageSourceSha:opts['--image-sha'],
  minimal:{exitCode:ec(readFileSync(opts['--minimal-exit'],'utf8').trim()),
    log:readFileSync(opts['--minimal-log'],'utf8')},
  direct:{exitCode:ec(readFileSync(opts['--direct-exit'],'utf8').trim()),
    log:readFileSync(opts['--direct-log'],'utf8')},
  ws:{exitCode:ec(readFileSync(opts['--ws-exit'],'utf8').trim()),
    log:readFileSync(opts['--ws-log'],'utf8')},
  output:opts['--output']
 };
}
if(process.argv[1]?.endsWith('/stage3b8r-oci-preflight.mjs')){
 try{
  const {output,...args}=parse(process.argv.slice(2));
  const result=classifyR0(args);
  writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('BUFFALO_3B8R0_RESULT='+JSON.stringify(result));
  if(result.status!=='LOCAL_OCI_BWRAP_AND_ORIGINAL_WS_PASS')process.exitCode=2;
 }catch(e){console.error('BUFFALO_3B8R0_INVALID',e.message);process.exitCode=3}
}
