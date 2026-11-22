import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const runner=resolve('scripts/full-integration/original-offline-orchestrator.mjs');
const guard=resolve('scripts/full-integration/offline-egress-guard.mjs');
const gitSha=(process.env.GITHUB_SHA||'a'.repeat(40)).toLowerCase();
const id='123e4567-e89b-42d3-a456-426614174111';
function invoke({agent='merlin',caseIndex='0',guarded=true,env={}}={}){
 const cli=[...(guarded?['--import',guard]:[]),runner,
  '--agent',agent,'--case-index',caseIndex,'--commit',gitSha,'--handoff-id',id];
 const e={...process.env,...env};
 return spawnSync(process.execPath,cli,{cwd:process.cwd(),env:e,encoding:'utf8',timeout:30000,maxBuffer:1024*1024*6});
}
test('real ORIGINAL Merlin SessionManager/Orchestrator handles client sync and refuses offline provider',()=>{
 const child=invoke();
 assert.equal(child.status,0,child.stderr+'\n'+child.stdout);
 const line=child.stdout.split('\n').find(x=>x.startsWith('BUFFALO_ORIGINAL_OFFLINE_EVIDENCE='));
 assert.ok(line,'Missing real orchestrator result');
 const proof=JSON.parse(line.split('=',2)[1]);
 assert.equal(proof.schema,'BUFFALO_ORIGINAL_ORCHESTRATOR_OFFLINE_PREP_V1');
 assert.equal(proof.status,'OFFLINE_BOUNDARY_PASS_NO_AGENT_OUTPUT');
 assert.equal(proof.agent,'merlin');
 assert.equal(proof.original_agent_mode,'sdk');
 assert.equal(proof.scenario_id,'dialysisClinic');
 assert.equal(proof.session_initialized,true);
 assert.equal(proof.original_tool_model_sync_requests,2);
 assert.equal(proof.original_tool_model_sync_responses,2);
 assert.equal(proof.rejected_provider,'buffalo_stage3_provider_denied');
 assert.equal(proof.terminal_error_code,'CONVERSATION_ERROR');
 assert.equal(proof.terminal_status,'awaiting_user');
 assert.equal(proof.agent_turn_executed,false);
 assert.equal(proof.grader_executed,false);
 assert.equal(proof.simulation_executed,false);
 assert.equal(proof.output_model_generated,false);
 assert.equal(proof.provider_requests,0);
 assert.equal(proof.network_attempts,0);
 assert.equal(proof.child_process_attempts,0);
 assert.equal(proof.execution_allowed,false);
 assert.equal(proof.github_provenance_attested,false);
 assert.match(proof.initial_model_sha256,/^[a-f0-9]{64}$/);
 assert.match(proof.original_system_prompt_sha256,/^[a-f0-9]{64}$/);
 assert.match(proof.manifest_sha256,/^[a-f0-9]{64}$/);
});
test('never calls original runner without early egress guard',()=>{
 const child=invoke({guarded:false});
 assert.notEqual(child.status,0);
 assert.match(child.stderr,/STAGE3_FAIL_EGRESS_GUARD_REQUIRED/);
 assert(!child.stdout.includes('BUFFALO_ORIGINAL_OFFLINE_EVIDENCE='));
});
test('explicit paid approval aborts prior to constructing original session',()=>{
 const child=invoke({env:{BUFFALO_PAID_RUN:'I_ACCEPT_CLOUDFLARE_AI_COSTS'}});
 assert.notEqual(child.status,0);
 assert.match(child.stderr,/STAGE3_FAIL_ENV_SECRET_OR_PAID_CONSENT_PRESENT/);
 assert(!child.stdout.includes('BUFFALO_ORIGINAL_OFFLINE_EVIDENCE='));
});
test('invalid agent is rejected rather than impersonating an original agent',()=>{
 const child=invoke({agent:'not_an_agent'});
 assert.notEqual(child.status,0);
 assert.match(child.stderr,/STAGE3_FAIL_ORIGINAL_AGENT_MISSING|FULL_HANDOFF_/);
});
test('scenario index out of bounds is a failure, not a vacuous PASS',()=>{
 const child=invoke({caseIndex:'999'});
 assert.notEqual(child.status,0);
 assert.match(child.stderr,/FULL_HANDOFF_PREPARE_CASE_INDEX_OUT_OF_BOUNDS|STAGE3_FAIL_/);
});
test('original SHA is required to agree with GitHub checkout',()=>{
 const child=invoke({env:{GITHUB_SHA:'f'.repeat(40)}});
 assert.notEqual(child.status,0);
 assert.match(child.stderr,/STAGE3_FAIL_CHECKOUT_COMMIT_MISMATCH/);
});

test('egress guard actually blocks global fetch and forbids outbound process launch',()=>{
 const fetchTrial=spawnSync(process.execPath,['--import',guard,
  '--input-type=module','-e', "await fetch('https://example.invalid')"],{
  cwd:process.cwd(),encoding:'utf8',timeout:15000});
 assert.notEqual(fetchTrial.status,0);
 assert.match(fetchTrial.stderr,/STAGE3_EXTERNAL_OPERATION_BLOCKED_FETCH/);
 const spawnTrial=spawnSync(process.execPath,['--import',guard,
  '--input-type=module','-e',
  "import {spawn} from 'node:child_process';spawn('sh',['-c','echo not-allowed'])"],{
  cwd:process.cwd(),encoding:'utf8',timeout:15000});
 assert.notEqual(spawnTrial.status,0);
 assert.match(spawnTrial.stderr,/STAGE3_EXTERNAL_OPERATION_BLOCKED_PROCESS_SPAWN/);
});
