import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OriginalHandshakeFrameGate} from './original-ws-handshake-gate.mjs';

const initialModel={variables:[],relationships:[],title:'Buffalo offline handshake only'};
const modelSha256=createHash('sha256').update(JSON.stringify(initialModel)).digest('hex');
const ORIGIN_AUTH='test_origin_auth_do_not_use_outside_tests_12345678';
const gate=()=>new OriginalHandshakeFrameGate({modelSha256,authenticationKey:ORIGIN_AUTH});
const init=()=>({type:'initialize_session',
 clientProduct:'Buffalo Stage3B Offline Test',clientVersion:'1.0.0',
 mode:'sfd',model:initialModel,tools:[],supportsArrays:true,
 supportsModules:false,supportsSubTypes:false});
const stringify=x=>JSON.stringify(x);
test('original session_created → initialize_session → session_ready accepts only original handshake frames',()=>{
 const g=gate();
 const created=g.fromBuffalo(stringify({type:'session_created',sessionId:'buffalo-abc'}));
 assert.equal(created.allowed,true);
 const allowed=g.fromClient(stringify(init()));
 assert.equal(allowed.allowed,true);
 assert.equal(JSON.parse(allowed.body).authenticationKey,ORIGIN_AUTH);
 assert.equal(JSON.parse(allowed.body).clientId,'buffalo-offline-handshake-client');
 assert.equal(init().authenticationKey,undefined);
 assert.equal(init().clientId,undefined);
 const ready=g.fromBuffalo(stringify({type:'session_ready',sessionId:'buffalo-abc'}));
 assert.equal(ready.allowed,true);
 assert.equal(g.snapshot().state,'READY_HANDSHAKE_ONLY');
 assert.equal(g.snapshot().inbound_frames,1);
 assert.equal(g.snapshot().outbound_frames,2);
 assert.equal(g.snapshot().provider_requests,0);
 assert.equal(g.snapshot().websocket_bridge_enabled,false);
 const bye=g.fromClient(stringify({type:'disconnect',sessionId:'buffalo-abc'}));
 assert.equal(bye.allowed,true);
 assert.equal(g.snapshot().state,'CLOSING');
});
test('provider selection and chat are forbidden even after session_ready',()=>{
 const g=gate();
 g.fromBuffalo(stringify({type:'session_created',sessionId:'buffalo-abc'}));
 g.fromClient(stringify(init()));
 g.fromBuffalo(stringify({type:'session_ready',sessionId:'buffalo-abc'}));
 for(const frame of [
  {type:'select_agent',sessionId:'buffalo-abc',agentId:'merlin',provider:'cloudflare'},
  {type:'chat',sessionId:'buffalo-abc',message:'Use cloudflare'},
  {type:'stop_iteration',sessionId:'buffalo-abc'},
  {type:'add_file',sessionId:'buffalo-abc',content:'base64'},
  {type:'model_updated_notification',sessionId:'buffalo-abc',model:initialModel},
  {type:'tool_call_response',sessionId:'buffalo-abc',callId:'x',result:{}},
  {type:'set_intelligence',sessionId:'buffalo-abc',intelligence:'advanced'}
 ]){
  const r=g.fromClient(stringify(frame));
  assert.equal(r.allowed,false,frame.type);
 }
 assert.equal(g.snapshot().provider_requests,0);
});
test('user cannot smuggle custom agent configuration, historical messages, tools or authentication key',()=>{
 for(const extra of [
  {historicalMessages:[{type:'user_text',content:'hi'}]},
  {agentConfig:'---\nprovider:anthropic\n---'},
  {authenticationKey:'user-provided'},
  {tools:[{name:'run_paid'}]},
  {context:{secret:true}},
  {clientId:'external'},
  {supportsMedia:true},
  {model:{variables:[{name:'Injected',type:'stock'}]}},
  {mode:'cld'}
 ]){
  const g=gate();
  assert.equal(g.fromBuffalo(stringify({type:'session_created',sessionId:'buffalo-abc'})).allowed,true);
  const attempt=g.fromClient(stringify({...init(),...extra}));
  assert.equal(attempt.allowed,false,JSON.stringify(extra));
  assert.equal(g.snapshot().inbound_frames,0);
 }
});
test('handshake ordering, origin session identity and invalid JSON are denied',()=>{
 const g=gate();
 assert.equal(g.fromClient(stringify(init())).allowed,false);
 assert.equal(g.fromBuffalo(stringify({type:'session_ready',sessionId:'buffalo-abc'})).allowed,false);
 assert.equal(g.fromBuffalo(stringify({type:'session_created',sessionId:'buffalo-abc'})).allowed,true);
 assert.equal(g.fromClient('not-json').allowed,false);
 assert.equal(g.fromClient(stringify({...init(),sessionId:'cross-session'})).allowed,false);
 assert.equal(g.fromClient(stringify(init())).allowed,true);
 assert.equal(g.fromBuffalo(stringify({type:'session_ready',sessionId:'wrong-session'})).allowed,false);
 assert.equal(g.fromClient(stringify({type:'disconnect',sessionId:'other'})).allowed,false);
});
test('oversize and invalid-origin messages must be rejected without forwarding',()=>{
 const g=gate();
 assert.equal(g.fromBuffalo('x'.repeat(262145)).reason,'ORIGIN_FRAME_OVERSIZE');
 assert.equal(g.fromClient('x'.repeat(262145)).reason,'CLIENT_FRAME_OVERSIZE');
 assert.equal(g.fromBuffalo('{').reason,'ORIGIN_FRAME_INVALID_JSON');
 assert.equal(g.fromClient('{').reason,'CLIENT_FRAME_INVALID_JSON');
 assert.throws(()=>new OriginalHandshakeFrameGate({modelSha256:'wrong',authenticationKey:ORIGIN_AUTH}),/WS_GATE_MODEL_SHA_REQUIRED/);
 assert.throws(()=>new OriginalHandshakeFrameGate({modelSha256,authenticationKey:'short'}),/WS_GATE_ORIGIN_AUTH_REQUIRED/);
});
