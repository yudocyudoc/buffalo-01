/**
 * Real ORIGINAL Buffalo WebSocket handler handshake through the new restricted
 * frame policy, in a localhost-only CI process. No inferencing, agent selection,
 * paid SDK or process prewarm: only WorkerSpawner.spawn is stubbed in THIS test.
 *
 * This is not a deployed Cloudflare WebSocket gateway or a real agent run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {WebSocket,WebSocketServer} from 'ws';
import {SessionManager} from '../../agent/utilities/SessionManager.js';
import {WebSocketHandler} from '../../agent/WebSocket.js';
import {WorkerSpawner} from '../../agent/WorkerSpawner.js';
import {OriginalHandshakeFrameGate} from './original-ws-handshake-gate.mjs';

const toSha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const model={variables:[],relationships:[],title:'Real Buffalo WebSocket handshake (no agent)'};
const originAuth='CI_ORIGINAL_WS_NO_PROVIDER_AUTH_ONLY_12345678';
function waitFor(bus,predicate,timeoutMs=6500){
 return new Promise((resolve,reject)=>{
  const match=bus.messages.find(predicate);
  if(match)return resolve(match);
  const timer=setTimeout(()=>{
   bus.listeners.delete(listener);
   reject(Error('ORIGINAL_WS_HANDSHAKE_TIMEOUT'));
  },timeoutMs);
  const listener=(message)=>{
   if(predicate(message)){
    clearTimeout(timer);bus.listeners.delete(listener);resolve(message);
   }
  };
  bus.listeners.add(listener);
 });
}
test('real original WebSocketHandler session_created → session_ready → disconnect, with guarded frames and zero inference',async()=>{
 const temp=mkdtempSync(join(tmpdir(),'buffalo-ws-real-no-provider-'));
 const oldAuth=process.env.AUTHENTICATION_KEY;
 const oldSpawn=WorkerSpawner.spawn;
 const oldFetch=globalThis.fetch;
 let spawnAttempts=0,fetchAttempts=0;
 WorkerSpawner.spawn=async()=>{spawnAttempts++;throw Error('CI_REAL_ORIGINAL_WS_SPAWN_BLOCKED')};
 globalThis.fetch=async()=>{fetchAttempts++;throw Error('CI_NO_PROVIDER_EGRESS')};
 process.env.AUTHENTICATION_KEY=originAuth;
 let server,wss,client,manager;
 const bus={messages:[],listeners:new Set()};
 try{
  server=createServer();
  manager=new SessionManager({disableCleanup:true,tempBasePath:temp});
  wss=new WebSocketServer({server,path:'/api/v1',maxPayload:262144});
  wss.on('connection',ws=>new WebSocketHandler(ws,manager));
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(0,'127.0.0.1',resolve);
  });
  const port=server.address().port;
  const policy=new OriginalHandshakeFrameGate({
   modelSha256:toSha(model),authenticationKey:originAuth
  });
  client=new WebSocket('ws://127.0.0.1:'+port+'/api/v1');
  client.on('message',bytes=>{
   const raw=bytes.toString('utf8');
   const response=policy.fromBuffalo(raw);
   assert.equal(response.allowed,true,JSON.stringify(response));
   const msg=JSON.parse(response.body);
   bus.messages.push(msg);
   for(const listener of bus.listeners)listener(msg);
  });
  await new Promise((resolve,reject)=>{
   client.once('open',resolve);
   client.once('error',reject);
  });
  const created=await waitFor(bus,m=>m.type==='session_created');
  assert.ok(created.sessionId);
  // The genuine handler's pre-initialization gate also refuses a chat.
  client.send(JSON.stringify({
   type:'chat',sessionId:created.sessionId,message:'never run an agent'
  }));
  const denied=await waitFor(bus,m=>m.type==='error'&&m.errorCode==='SESSION_NOT_INITIALIZED');
  assert.equal(denied.errorCode,'SESSION_NOT_INITIALIZED');
  assert.equal(spawnAttempts,0);
  const opening={
   type:'initialize_session',clientProduct:'Buffalo WebSocket Lab',
   clientVersion:'1.0.0',mode:'sfd',model,tools:[],
   supportsArrays:true,supportsModules:false,supportsSubTypes:false
  };
  const admitted=policy.fromClient(JSON.stringify(opening));
  assert.equal(admitted.allowed,true);
  assert.equal(JSON.parse(admitted.body).authenticationKey,originAuth);
  client.send(admitted.body);
  const ready=await waitFor(bus,m=>m.type==='session_ready');
  assert.equal(ready.sessionId,created.sessionId);
  assert.equal(policy.snapshot().state,'READY_HANDSHAKE_ONLY');
  assert.equal(spawnAttempts,1,'Original handler did attempt its documented prewarm');
  assert.equal(fetchAttempts,0);
  assert.equal(policy.fromClient(JSON.stringify({
   type:'select_agent',agentId:'merlin',provider:'cloudflare',
   sessionId:created.sessionId
  })).reason,'INFERENCE_TURN_NOT_AUTHORIZED');
  assert.equal(policy.fromClient(JSON.stringify({
   type:'chat',sessionId:created.sessionId,message:'run an LLM'
  })).reason,'INFERENCE_TURN_NOT_AUTHORIZED');
  const goodbye=policy.fromClient(JSON.stringify({
   type:'disconnect',sessionId:created.sessionId
  }));
  assert.equal(goodbye.allowed,true);
  client.send(goodbye.body);
  await new Promise((resolve,reject)=>{
   if(client.readyState===WebSocket.CLOSED)return resolve();
   const timer=setTimeout(()=>reject(Error('ORIGINAL_WS_CLOSE_TIMEOUT')),6500);
   client.once('close',()=>{clearTimeout(timer);resolve()});
  });
  assert.equal(fetchAttempts,0);
  assert.equal(policy.snapshot().provider_requests,0);
  assert.equal(policy.snapshot().agent_turn_executed,false);
  console.log('PASS real ORIGINAL Buffalo websocket session_created/session_ready/disconnect; agent turns=0; providers=0; prewarm mocked=1');
 }finally{
  WorkerSpawner.spawn=oldSpawn;
  globalThis.fetch=oldFetch;
  if(oldAuth===undefined)delete process.env.AUTHENTICATION_KEY;
  else process.env.AUTHENTICATION_KEY=oldAuth;
  try{client?.terminate()}catch{}
  if(wss)await new Promise(resolve=>wss.close(()=>resolve()));
  if(server)await new Promise(resolve=>server.close(()=>resolve()));
  manager?.shutdown();
  rmSync(temp,{recursive:true,force:true});
 }
});
