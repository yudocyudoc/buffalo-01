import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {classifyR0,R0_SCHEMA} from './stage3b8r-oci-preflight.mjs';
import {MINIMAL_ARGS,MINIMAL_SCHEMA} from './stage3b8r-bwrap-minimal.mjs';

const sha='a'.repeat(40);
const hash=s=>createHash('sha256').update(s).digest('hex');
const model='57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39';
const goodMin={
 schema:MINIMAL_SCHEMA,source_commit:sha,
 flags_sha256:hash(JSON.stringify(MINIMAL_ARGS)),
 status:'MINIMAL_BWRAP_PASS',reason_code:'NONE',
 exit_code:0,stderr_sha256:hash(''),
 network_disabled:true,sandbox_relaxations:false,agent_executed:false,
 inference_executed:false,raw_stderr_in_receipt:false
};
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
const mk=(d=direct,w=ws,m=goodMin)=>({
 sourceSha:sha,imageSourceSha:sha,
 minimal:{exitCode:m.status==='MINIMAL_BWRAP_PASS'?0:2,
  log:'BUFFALO_3B8R0_MINIMAL='+JSON.stringify(m)+'\n'},
 direct:{exitCode:0,log:'BUFFALO_3B8_PROCESS_EVIDENCE='+JSON.stringify(d)+'\n'},
 ws:{exitCode:0,log:'BUFFALO_3B8_WS_PROCESS_EVIDENCE='+JSON.stringify(w)+'\n'}
});
test('genuine two-process PASS also requires separate minimal bwrap PASS',()=>{
 const x=classifyR0(mk());
 assert.equal(x.schema,R0_SCHEMA);
 assert.equal(x.status,'LOCAL_OCI_BWRAP_AND_ORIGINAL_WS_PASS');
 assert.equal(x.minimal_probe_status,'MINIMAL_BWRAP_PASS');
 assert.equal(x.direct_worker_process_verified,true);
 assert.equal(x.ready_for_private_execution,false);
 assert.equal(x.cloudflare_deployed,false);
 assert.equal(x.inference_authorized,false);
});
test('minimal kernel namespace denial blocks agent and WS, records exact code',()=>{
 const r=mk(direct,ws,{...goodMin,status:'MINIMAL_BWRAP_BLOCKED',
  reason_code:'NAMESPACE_CREATION_DENIED',exit_code:1});
 r.direct={exitCode:99,log:'SKIPPED_AFTER_MINIMAL_FAILURE\n'};
 r.ws={exitCode:99,log:'SKIPPED_AFTER_MINIMAL_FAILURE\n'};
 const x=classifyR0(r);
 assert.equal(x.status,'OCI_MINIMAL_BWRAP_BLOCKED');
 assert.equal(x.cause_code,'NAMESPACE_CREATION_DENIED');
 assert.equal(x.ready_for_private_execution,false);
 assert.equal(x.phase,'MINIMAL_NAMESPACE');
});
test('generic bwrap early exit after minimal PASS is NOT namespace proof',()=>{
 const r=mk();
 r.direct={exitCode:1,log:'[worker] bwrap exited early (code=1)\n'};
 r.ws={exitCode:99,log:'SKIPPED_AFTER_DIRECT_FAILURE\n'};
 const x=classifyR0(r);
 assert.equal(x.status,'OCI_ORIGINAL_WORKER_BLOCKED_AFTER_MINIMAL_PASS');
 assert.equal(x.cause_code,'WORKER_BWRAP_EARLY_EXIT_CAUSE_UNKNOWN');
 assert.equal(x.minimal_probe_status,'MINIMAL_BWRAP_PASS');
});
test('a real IPC timeout after minimal PASS is correctly separated',()=>{
 const r=mk();r.direct={exitCode:1,log:'3B8_REAL_WORKER_IPC_TIMEOUT\n'};
 r.ws={exitCode:99,log:'SKIPPED_AFTER_DIRECT_FAILURE\n'};
 const x=classifyR0(r);
 assert.equal(x.cause_code,'ORIGINAL_PROCESS_IPC_OR_WS_TIMEOUT');
 assert.equal(x.status,'OCI_ORIGINAL_WORKER_BLOCKED_AFTER_MINIMAL_PASS');
});
test('WebSocket failure after process PASS is not an isolated kernel denial',()=>{
 const r=mk();
 r.ws={exitCode:1,log:'3B8_REAL_WS_TIMEOUT\n'};
 const x=classifyR0(r);
 assert.equal(x.status,'OCI_ORIGINAL_WS_BLOCKED_AFTER_MINIMAL_PASS');
 assert.equal(x.cause_code,'ORIGINAL_PROCESS_IPC_OR_WS_TIMEOUT');
});
test('no minimal receipt is NO PASS, including if original process claimed success',()=>{
 const r=mk();r.minimal.log='NO_MINIMAL_EVIDENCE\n';
 assert.throws(()=>classifyR0(r),/3B8R0_RECEIPT_COUNT_0/);
 const dup=mk();dup.minimal.log+=dup.minimal.log;
 assert.throws(()=>classifyR0(dup),/3B8R0_RECEIPT_COUNT_2/);
});
test('unknown Docker failure cannot be marked a namespace denial',()=>{
 const r=mk();
 r.direct={exitCode:1,log:'Error: model sync broken\n'};
 r.ws={exitCode:99,log:'SKIPPED_AFTER_DIRECT_FAILURE\n'};
 assert.equal(classifyR0(r).cause_code,'ORIGINAL_PROCESS_ERROR_UNCLASSIFIED');
});
test('mismatched minimal receipt exit, flags, or source identity fail',()=>{
 let r=mk();r.minimal.exitCode=2;
 assert.throws(()=>classifyR0(r),/3B8R0_MINIMAL_PROCESS_EXIT_AND_RECEIPT_DISAGREE/);
 r=mk(direct,ws,{...goodMin,flags_sha256:'0'.repeat(64)});
 assert.throws(()=>classifyR0(r),/3B8R0_MINIMAL_RECEIPT_INVALID/);
 r=mk();r.sourceSha='b'.repeat(40);
 assert.throws(()=>classifyR0(r),/3B8R0_IMAGE_CHECKOUT_IDENTITY_MISMATCH/);
});
test('fake process PASS without native process or with modified model fails',()=>{
 const changes=[
  {bwrap_ipc_worker:false},{worker_exited:false},{model_modified:true},
  {provider_requests_measured:true},{terminal_status:'success'},
  {initial_model_sha256:'0'.repeat(64)},{checkout_commit:'b'.repeat(40)}
 ];
 for(const change of changes)
  assert.throws(()=>classifyR0(mk({...direct,...change})),/3B8R0_/);
});
test('forged green without authentic WS receipt is not acceptable',()=>{
 const r=mk();r.ws.log='PASS\n';
 assert.throws(()=>classifyR0(r),/3B8R0_RECEIPT_COUNT_0/);
 const y=mk(direct,{...ws,agent_turn_executed:true});
 assert.throws(()=>classifyR0(y),/3B8R0_WS_agent_turn_executed/);
});
test('cannot skip real probes after minimal PASS or run after minimal DENY',()=>{
 let r=mk();
 r.direct={exitCode:99,log:'SKIPPED_AFTER_MINIMAL_FAILURE\n'};
 r.ws={exitCode:99,log:'SKIPPED_AFTER_MINIMAL_FAILURE\n'};
 assert.throws(()=>classifyR0(r),/3B8R0_DIRECT_FAILURE_DID_NOT_SKIP_WS/);
 const denied={...goodMin,status:'MINIMAL_BWRAP_BLOCKED',reason_code:'PERMISSION_DENIED_UNSPECIFIED',exit_code:1};
 r=mk(direct,ws,denied);
 assert.throws(()=>classifyR0(r),/3B8R0_MINIMAL_DENIAL_DID_NOT_SKIP_AGENT/);
});
test('no contradictory positive receipt when a process reports failure',()=>{
 const r=mk();
 r.direct={exitCode:1,log:'bwrap exited early\nBUFFALO_3B8_PROCESS_EVIDENCE='+JSON.stringify(direct)};
 r.ws={exitCode:99,log:'SKIPPED_AFTER_DIRECT_FAILURE\n'};
 assert.throws(()=>classifyR0(r),/3B8R0_CONTRADICTORY_DIRECT_RECEIPT/);
});
