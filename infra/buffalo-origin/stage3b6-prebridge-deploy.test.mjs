import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSafePreBridge,ORIGIN,BRIDGE,HANDOFF,SOURCE,MODEL,IMAGE,DB} from './stage3b6-prebridge-deploy.mjs';

const ACCOUNT='a'.repeat(32);
const good=()=>({
 apps:[{name:'buffalo-private-origin-lab',scheduling_policy:'durable_object',
  health:{instances:{active:0,starting:0}}}],
 usage:{instances:0},
 originSub:{enabled:false,previews_enabled:false},
 bridgeSub:{enabled:false,previews_enabled:false},
 originSecrets:['BUFFALO_ORIGIN_AUTH_KEY','BUFFALO_ORIGIN_UPGRADE_TOKEN'].map(name=>({name})),
 bridgeSecrets:['BUFFALO_ORIGIN_AUTH_KEY','BUFFALO_ORIGIN_UPGRADE_TOKEN','BUFFALO_WS_LAB_BEARER'].map(name=>({name})),
 originVersion:{containers:[{class_name:'BuffaloHandshakeContainer',
  images:{base:'registry.cloudflare.com/'+ACCOUNT+'/buffalo-private-origin@'+IMAGE}}],
  bindings:[
   {type:'durable_object_namespace',name:'BUFFALO_CONTAINER'},
   {type:'plain_text',name:'BUFFALO_ORIGIN_MODE',text:'HANDSHAKE_ONLY_NO_AGENT_PROCESS'},
   {type:'plain_text',name:'BUFFALO_ORIGIN_COMMIT_SHA',text:SOURCE},
   {type:'plain_text',name:'BUFFALO_ORIGIN_MODEL_SHA256',text:MODEL},
   {type:'secret_text',name:'BUFFALO_ORIGIN_AUTH_KEY'},
   {type:'secret_text',name:'BUFFALO_ORIGIN_UPGRADE_TOKEN'}
  ]},
 bridgeSettings:{bindings:[{name:'DB',type:'d1',database_id:DB},
  ...['BUFFALO_ORIGIN_AUTH_KEY','BUFFALO_ORIGIN_UPGRADE_TOKEN','BUFFALO_WS_LAB_BEARER'].map(name=>({name,type:'secret_text'}))]},
 handoff:[{handoff_id:HANDOFF,commit_sha:SOURCE,
  manifest_sha256:'4d80f1f4ee8a75ba610943826ab3858c2019a79414e5aad249f3f3342f29aa0e',
  execution_allowed:0}],
 proof:[{proof_status:'SOURCE_ATTESTED',commit_sha:SOURCE,execution_allowed:0}],
 grants:[{n:0}]
});
test('synthetic topology fixture is accepted as a shape only',()=>{
 assert.match(assertSafePreBridge(good(),ACCOUNT),/GATE_PASS/);
});
test('missing origin secrets and inactive version cannot pass',()=>{
 for(const change of [
  x=>x.originSecrets=[],
  x=>x.bridgeSecrets=[],
  x=>x.originVersion.bindings=x.originVersion.bindings.filter(b=>b.type!=='secret_text'),
  x=>x.originVersion.containers[0].images.base='registry.cloudflare.com/'+ACCOUNT+'/buffalo-private-origin@sha256:'+'f'.repeat(64),
  x=>x.bridgeSettings.bindings=[{name:'BUFFALO_ORIGIN',type:'service'}],
  x=>x.originSub.enabled=true,
  x=>x.apps[0].health.instances.starting=1,
  x=>x.grants[0].n=1,
  x=>x.proof[0].proof_status='UNVERIFIED',
  x=>x.handoff[0].commit_sha='1'.repeat(40)
 ]){
  const x=good();change(x);
  assert.throws(()=>assertSafePreBridge(x,ACCOUNT),/STAGE3B6_PREBRIDGE_DENIED/);
 }
});
