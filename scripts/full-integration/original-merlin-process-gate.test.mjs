import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OriginalMerlinProcessGate,MERLIN_PROCESS_GATE_SCHEMA} from './original-merlin-process-gate.mjs';

const commit='a'.repeat(40);
const sessionId='sess_1234567890abcdef1234567890abcdef';
const model={variables:[],relationships:[],title:'Fixture only — not a real DEV model'};
const modelSha256=createHash('sha256').update(JSON.stringify(model)).digest('hex');
const auth='non-secret-ci-authentication-3b8-0000000000';
const clientId='buffalo-worker-123e4567-e89b-42d3-a456-426614174111';
const init={type:'initialize_session',clientProduct:'Buffalo WebSocket Lab',
 clientVersion:'1.0.0',mode:'sfd',model,tools:[],supportsArrays:true,
 supportsModules:false,supportsSubTypes:false};
const select={type:'select_agent',sessionId,agentId:'merlin',provider:'cloudflare'};
const frame=x=>JSON.stringify(x);
function gate(processApproved=true){return new OriginalMerlinProcessGate({sourceCommit:commit,
 runtimeCommit:commit,modelSha256,authenticationKey:auth,clientId,processApproved});}
function toReady(g){
 assert.equal(g.fromBuffalo(frame({type:'session_created',sessionId})).allowed,true);
 const req=g.fromClient(frame(init));assert.equal(req.allowed,true,req.reason);
 const patched=JSON.parse(req.body);
 assert.equal(patched.authenticationKey,auth);
 assert.equal(patched.clientId,clientId);
 assert.equal(g.fromBuffalo(frame({type:'session_ready',sessionId})).allowed,true);
 return g;
}

test('process approval precedes initialization/prewarm and defaults to denied',()=>{
 const g=gate(false);
 assert.equal(g.fromBuffalo(frame({type:'session_created',sessionId})).allowed,true);
 assert.equal(g.fromClient(frame(init)).reason,'PROCESS_NOT_APPROVED_BEFORE_INITIALIZE');
 assert.equal(g.snapshot().process_execution_verified,false);
});
test('pinned session handshake, exactly one Merlin selection, no chat or false output',()=>{
 const g=toReady(gate());
 assert.equal(g.fromClient(frame(select)).allowed,true);
 assert.equal(g.fromBuffalo(frame({type:'agent_selected',sessionId,
   agentId:'merlin',currentProvider:'cloudflare'})).allowed,true);
 assert.equal(g.fromBuffalo(frame({type:'agent_text',sessionId,
   content:'Merlin (Cloudflare) — What can I do for you today?',isThinking:false})).allowed,true);
 assert.equal(g.fromClient(frame({type:'chat',sessionId,message:'invoke provider'})).reason,
  'INFERENCE_OR_MUTATION_NOT_AUTHORIZED_IN_P');
 assert.equal(g.fromClient(frame(select)).allowed,false);
 assert.equal(g.fromBuffalo(frame({type:'agent_complete',sessionId,status:'success'})).allowed,false);
 assert.equal(g.fromClient(frame({type:'disconnect',sessionId})).allowed,true);
 assert.equal(g.fromClient(frame(init)).allowed,false);
 const evidence=g.snapshot();
 assert.equal(evidence.schema,MERLIN_PROCESS_GATE_SCHEMA);
 assert.equal(evidence.provider_requests_measured,false);
 assert.equal(evidence.agent_turn_executed,false);
 assert.equal(evidence.process_execution_verified,false);
 assert.equal(evidence.state,'CLOSING');
});
test('rejects identity/config drift at creation',()=>{
 for(const changes of [{runtimeCommit:'b'.repeat(40)},{sourceCommit:'bad'},
  {modelSha256:'bad'},{authenticationKey:'weak'},{clientId:'not-issued-by-host'}]){
  assert.throws(()=>new OriginalMerlinProcessGate({sourceCommit:commit,runtimeCommit:commit,
   modelSha256,authenticationKey:auth,clientId,processApproved:true,...changes}),
   /3B8_PROCESS_GATE_IDENTITY_REQUIRED/);
 }
});
test('rejects premature chat, selected-server output and invalid session IDs',()=>{
 const g=gate();
 assert.equal(g.fromClient(frame({type:'chat',sessionId,message:'x'})).allowed,false);
 assert.equal(g.fromBuffalo(frame({type:'agent_selected',sessionId})).allowed,false);
 assert.equal(g.fromBuffalo(frame({type:'session_created',sessionId:'not-a-uuid'})).allowed,false);
});
test('rejects injected auth, client id, tool registration, history and altered model',()=>{
 for(const change of [{authenticationKey:auth},{clientId},{tools:[{name:'update_model'}]},
  {historicalMessages:[]},{model:{...model,title:'changed'}},{mode:'cld'},
  {context:{}},{supportsMedia:true},{sessionId}]){
  const g=gate();g.fromBuffalo(frame({type:'session_created',sessionId}));
  assert.equal(g.fromClient(frame({...init,...change})).reason,
   'INITIAL_MODEL_OR_FIELDS_NOT_AUTHORIZED',JSON.stringify(change));
 }
});
test('rejects cross-session, substitute agent/provider, extra fields and duplicate select',()=>{
 const cases=[{sessionId:'sess_abcdef1234567890abcdef1234567890'},
  {agentId:'socrates'},{provider:'openai'},{agentConfig:'fake'},
  {intelligence:'expensive'},{clientId:'injected'}];
 for(const change of cases){const g=toReady(gate());
  assert.equal(g.fromClient(frame({...select,...change})).reason,'AGENT_SELECTION_NOT_AUTHORIZED');
 }
 const g=toReady(gate());g.fromClient(frame(select));
 assert.equal(g.fromClient(frame(select)).allowed,false);
});
test('fails closed for binaries, oversized frames, bad JSON/shape, foreign origin content',()=>{
 const g=toReady(gate());
 for(const raw of [Buffer.from('hey'),'{broken','[]','x'.repeat(262145)]){
  assert.equal(g.fromClient(raw).allowed,false);
  assert.equal(g.fromBuffalo(raw).allowed,false);
 }
 assert.equal(g.fromBuffalo(frame({type:'error',sessionId,
  errorCode:'CONVERSATION_ERROR'})).allowed,false);
 assert.equal(g.fromBuffalo(frame({type:'agent_text',sessionId,
  content:'I generated a model',isThinking:false})).allowed,false);
 assert.equal(g.fromClient(frame({type:'tool_call_response',sessionId,callId:'x',result:{}})).allowed,false);
});
test('allows original agent selection error but never converts it into a process PASS',()=>{
 const g=toReady(gate());g.fromClient(frame(select));
 assert.equal(g.fromBuffalo(frame({type:'error',sessionId,
  errorCode:'AGENT_SELECTION_ERROR',error:'sandbox failed'})).allowed,true);
 assert.equal(g.snapshot().state,'SELECTION_ERROR');
 assert.equal(g.snapshot().process_execution_verified,false);
});
