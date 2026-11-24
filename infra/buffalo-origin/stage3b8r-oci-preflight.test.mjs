import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyR0,R0_SCHEMA} from './stage3b8r-oci-preflight.mjs';

const sha='a'.repeat(40);
const model='57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39';
const direct={
 schema:'BUFFALO_STAGE3B8_ORIGINAL_MERLIN_PROCESS_OFFLINE_V1',
 status:'ORIGINAL_MERLIN_WORKER_OFFLINE_PROVIDER_DENIED_PASS',
 checkout_commit:sha,initial_model_sha256:model,agent:'merlin',provider:'UNREGISTERED_DENY_ONLY',
 genuine_terminal_error:'CONVERSATION_ERROR',terminal_status:'awaiting_user',
 ipc_barriers:2,model_sync_requests:1,
 original_worker_spawner:true,original_agent_worker:true,bwrap_ipc_worker:true,worker_exited:true,
 provider_requests_measured:false,agent_model_response:false,model_modified:false,
 simulation_executed:false,grader_executed:false,bridge_or_container_deployed:false,
 execution_allowed:false
};
const ws={
 schema:'BUFFALO_STAGE3B8_ORIGINAL_WS_PROCESS_OFFLINE_V1',
 status:'ORIGINAL_MERLIN_WS_PROCESS_OFFLINE_PASS',
 checkout_commit:sha,model_sha256:model,agent:'merlin',provider_selected:'anthropic',
 worker_spawn_calls:1,handler_original:true,spawner_delegated_original:true,worker_original:true,
 worker_sandbox_bwrap:true,real_ipc_barrier:true,worker_reaped:true,
 agent_turn_executed:false,provider_requests_measured:false,cloudflare_deployed:false,
 execution_allowed:false,original_frames:['session_created','session_ready','agent_selected','agent_text']
};
const mk=(d=direct,w=ws)=>({
 sourceSha:sha,imageSourceSha:sha,
 direct:{exitCode:0,log:'BUFFALO_3B8_PROCESS_EVIDENCE='+JSON.stringify(d)+'\n'},
 ws:{exitCode:0,log:'BUFFALO_3B8_WS_PROCESS_EVIDENCE='+JSON.stringify(w)+'\n'}
});
test('valid local OCI evidence is NOT a Cloudflare deployment or authorization',()=>{
 const x=classifyR0(mk());
 assert.equal(x.schema,R0_SCHEMA);
 assert.equal(x.status,'LOCAL_OCI_BWRAP_AND_ORIGINAL_WS_PASS');
 assert.equal(x.ready_for_private_execution,false);
 assert.equal(x.cloudflare_deployed,false);
 assert.equal(x.remote_container_executed,false);
 assert.equal(x.provider_requests_measured,false);
 assert.equal(x.inference_authorized,false);
 assert.equal(x.direct_worker_process_verified,true);
});
test('bwrap user namespace denied is BLOCKED, never PASS',()=>{
 const x=mk();
 x.direct={exitCode:1,log:'bwrap: Creating new namespace failed: Operation not permitted\n'};
 x.ws={exitCode:99,log:'SKIPPED_AFTER_DIRECT_FAILURE\n'};
 const out=classifyR0(x);
 assert.equal(out.status,'OCI_SANDBOX_BLOCKED');
 assert.equal(out.ready_for_private_execution,false);
 assert.equal(out.phase,'DIRECT_PROCESS');
});
test('runner and image identity are exact, not a declared stage3b7 digest',()=>{
 assert.throws(()=>classifyR0({...mk(),imageSourceSha:'b'.repeat(40)}),
 /3B8R0_IMAGE_CHECKOUT_IDENTITY_MISMATCH/);
 assert.throws(()=>classifyR0({...mk(),sourceSha:'abc'}),/3B8R0_IMAGE_CHECKOUT_IDENTITY_MISMATCH/);
});
test('fake green without a genuine process receipt cannot count',()=>{
 const x=mk();x.direct.log='SUCCESS\n';
 assert.throws(()=>classifyR0(x),/3B8R0_RECEIPT_COUNT_0/);
 const y=mk();y.ws.log+=y.ws.log;
 assert.throws(()=>classifyR0(y),/3B8R0_RECEIPT_COUNT_2/);
});
test('denies forged sandbox, unfinished process and model modifications',()=>{
 for(const changed of [
  {bwrap_ipc_worker:false},{worker_exited:false},{model_modified:true},
  {provider_requests_measured:true},{terminal_status:'success'},
  {initial_model_sha256:'0'.repeat(64)},{checkout_commit:'b'.repeat(40)}
 ]){
  assert.throws(()=>classifyR0(mk({...direct,...changed})),/3B8R0_/);
 }
});
test('denies a greeting fabricated as a model response',()=>{
 const x=mk(direct,{...ws,agent_turn_executed:true});
 assert.throws(()=>classifyR0(x),/3B8R0_WS_agent_turn_executed/);
 assert.throws(()=>classifyR0(mk(direct,{...ws,worker_spawn_calls:2})),/3B8R0_WS_RECEIPT_IDENTITY_OR_SEQUENCE/);
});
test('unknown Docker failure is NOT silently reclassified as namespace blocking',()=>{
 const x=mk();x.direct={exitCode:1,log:'Error: model sync broken\n'};
 x.ws={exitCode:99,log:'SKIPPED_AFTER_DIRECT_FAILURE\n'};
 assert.throws(()=>classifyR0(x),/3B8R0_DIRECT_FAILURE_NOT_PROVEN_SANDBOX/);
});
test('denies a sandbox-block claim with a hidden positive receipt',()=>{
 const x=mk();
 x.direct={exitCode:1,log:'bwrap exited early\nBUFFALO_3B8_PROCESS_EVIDENCE='+JSON.stringify(direct)};
 x.ws={exitCode:99,log:'SKIPPED_AFTER_DIRECT_FAILURE\n'};
 assert.throws(()=>classifyR0(x),/3B8R0_CONTRADICTORY_DIRECT_RECEIPT/);
});
