import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {WebSocket,WebSocketServer} from 'ws';
import {WebSocketHandler} from '../../agent/WebSocket.js';
import {WorkerSpawner} from '../../agent/WorkerSpawner.js';
import {SessionManager} from '../../agent/utilities/SessionManager.js';
import {handleOriginalWorkerBridge} from '../../workers/buffalo-control-plane/original-ws-bridge-lab.mjs';

const HANDOFF='6bce82ee-d179-4a2e-9317-f7f4708c5be2';
const COMMIT='66bee2d96ec71692608fc0829486c2dc130ab7a0';
const TOKEN='test-bridge-bearer-secret-123456789012345';
const AUTH='test-original-buffalo-origin-credential-123456789';
const INTERNAL='test-private-origin-upgrade-secret-123456789012';
const MODEL={variables:[],relationships:[],title:'Buffalo bridge offline no agent'};
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

class TestSocket {
 constructor(){this.emitter=new EventEmitter();this.pending=[];this.peer=null;this.readyState=0}
 addEventListener(type,cb){this.emitter.on(type,cb)}
 accept(){
  this.readyState=1;
  for(const x of this.pending.splice(0))queueMicrotask(()=>this.emitter.emit('message',x));
 }
 _incoming(data){
  if(this.readyState===3)return;
  const e={data};
  if(this.readyState!==1)this.pending.push(e);
  else queueMicrotask(()=>this.emitter.emit('message',e));
 }
 send(data){
  if(this.readyState!==1||this.peer?.readyState===3)throw Error('SOCKET_NOT_OPEN');
  this.peer._incoming(data);
 }
 close(code=1000,reason=''){
  if(this.readyState===3)return;
  this.readyState=3;
  const peer=this.peer;
  queueMicrotask(()=>this.emitter.emit('close',{code,reason}));
  if(peer&&peer.readyState!==3){
   peer.readyState=3;
   queueMicrotask(()=>peer.emitter.emit('close',{code,reason}));
  }
 }
}
function fakePair(){
 const a=new TestSocket(),b=new TestSocket();
 a.peer=b;b.peer=a;
 return {0:a,1:b};
}
class NodeOriginSocket {
 constructor(ws){
  this.ws=ws;this.emitter=new EventEmitter();this.pending=[];this.accepted=false;
  ws.on('message',data=>{
   const x={data:data.toString('utf8')};
   if(!this.accepted)this.pending.push(x);
   else queueMicrotask(()=>this.emitter.emit('message',x));
  });
  ws.on('close',(code,reason)=>this.emitter.emit('close',{
   code,reason:reason.toString('utf8')
  }));
  ws.on('error',()=>this.emitter.emit('error',{}));
 }
 get readyState(){return this.ws.readyState}
 addEventListener(t,cb){this.emitter.on(t,cb)}
 accept(){
  this.accepted=true;
  for(const e of this.pending.splice(0))queueMicrotask(()=>this.emitter.emit('message',e));
 }
 send(s){this.ws.send(s)}
 close(code,reason){if(this.ws.readyState!==WebSocket.CLOSED)this.ws.close(code,reason)}
}
function waitFor(socket,predicate,timeout=6000){
 return new Promise((resolve,reject)=>{
  const t=setTimeout(()=>{socket.emitter.off('message',receive);reject(Error('BRIDGE_TIMEOUT'))},timeout);
  function receive(event){
   let item;try{item=JSON.parse(event.data)}catch{return}
   if(predicate(item)){
    clearTimeout(t);socket.emitter.off('message',receive);resolve(item);
   }
  }
  socket.emitter.on('message',receive);
 });
}
test('Worker bridge function -> original Buffalo WebSocket, D1 proof, chat denied, no model calls',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'buffalo-ws-worker-'));
 const oldAuth=process.env.AUTHENTICATION_KEY;
 const oldSpawn=WorkerSpawner.spawn,oldFetch=globalThis.fetch;
 let server,wss,manager;
 let processStarts=0,providerAttempts=0,originConnections=0,d1Reads=0;
 process.env.AUTHENTICATION_KEY=AUTH;
 WorkerSpawner.spawn=async()=>{processStarts++;throw Error('CI_NO_AGENT_PROCESS')};
 globalThis.fetch=async()=>{providerAttempts++;throw Error('CI_NO_EXTERNAL_FETCH')};
 try{
  manager=new SessionManager({disableCleanup:true,tempBasePath:dir});
  server=createServer();
  wss=new WebSocketServer({server,path:'/api/v1',maxPayload:262144});
  wss.on('connection',ws=>new WebSocketHandler(ws,manager));
  await new Promise((resolve,reject)=>{
   server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
  });
  const port=server.address().port;
  const origin={
   async fetch(request){
    originConnections++;
    assert.equal(new URL(request.url).pathname,'/api/v1');
    assert.equal(request.headers.get('authorization'),null);
    assert.equal(request.headers.get('upgrade'),'websocket');
    assert.equal(request.headers.get('x-buffalo-origin-token'),INTERNAL);
    const ws=new WebSocket('ws://127.0.0.1:'+port+'/api/v1');
    const adapter=new NodeOriginSocket(ws);
    await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
    return {status:101,webSocket:adapter};
   }
  };
  const db={
   prepare(sql){
    assert.match(sql,/^\s*SELECT/i);d1Reads++;
    return{bind(id){
     assert.equal(id,HANDOFF);
     return{first:async()=>({
      handoff_id:HANDOFF,agent:'merlin',mode:'sfd',commit_sha:COMMIT,
      initial_model_sha256:sha(MODEL),manifest_sha256:'a'.repeat(64),
      proof_status:'SOURCE_ATTESTED',proof_commit_sha:COMMIT,
      proof_manifest_sha256:'a'.repeat(64)
     })};
    }};
   }
  };
  const env={
   DB:db,BUFFALO_ORIGIN:origin,BUFFALO_WS_LAB_BEARER:TOKEN,
   BUFFALO_ORIGIN_AUTH_KEY:AUTH,BUFFALO_ORIGIN_UPGRADE_TOKEN:INTERNAL,
   BUFFALO_WS_LAB_MODE:'HANDSHAKE_ONLY_NO_AGENT_PROCESS',
   BUFFALO_RUNTIME_COMMIT_SHA:COMMIT,
   BUFFALO_LAB_HANDOFF_ID:HANDOFF
  };
  let browser;
  const request=new Request('https://lab.invalid/v1/lab/original-ws',{
   headers:{Upgrade:'websocket',Authorization:'Bearer '+TOKEN}
  });
  const response=await handleOriginalWorkerBridge(request,env,{
   newPair:()=>{
    const pair=fakePair();browser=pair[0];return pair;
   },upgradeResponse:ws=>({status:101,webSocket:ws})
  });
  assert.equal(response.status,101);
  assert.equal(response.webSocket,browser);
  browser.accept();
  const created=await waitFor(browser,x=>x.type==='session_created');
  assert.ok(created.sessionId);
  assert.equal(processStarts,0);
  const readyPromise=waitFor(browser,x=>x.type==='session_ready');
  browser.send(JSON.stringify({
   type:'initialize_session',mode:'sfd',model:MODEL,tools:[],
   clientProduct:'Buffalo Worker Bridge CI',clientVersion:'1.0.0',
   supportsArrays:true,supportsModules:false,supportsSubTypes:false
  }));
  const ready=await readyPromise;
  assert.equal(ready.sessionId,created.sessionId);
  assert.equal(processStarts,1);
  assert.equal(providerAttempts,0);
  assert.equal(d1Reads,1);
  assert.equal(originConnections,1);
  const closePromise=new Promise((resolve,reject)=>{
   const t=setTimeout(()=>reject(Error('POLICY_CLOSE_TIMEOUT')),3500);
   browser.addEventListener('close',()=>{clearTimeout(t);resolve()});
  });
  browser.send(JSON.stringify({
   type:'chat',sessionId:created.sessionId,message:'Try running Merlin'
  }));
  await closePromise;
  assert.equal(providerAttempts,0);
  assert.equal(processStarts,1);
  console.log('PASS Worker bridge function + ORIGINAL Buffalo WS + D1 proof; no AI; prewarm stub=1');
 }finally{
  WorkerSpawner.spawn=oldSpawn;
  globalThis.fetch=oldFetch;
  if(oldAuth===undefined)delete process.env.AUTHENTICATION_KEY;
  else process.env.AUTHENTICATION_KEY=oldAuth;
  if(wss){
   for(const ws of wss.clients)ws.terminate();
   await new Promise(resolve=>wss.close(resolve));
  }
  if(server)await new Promise(resolve=>server.close(resolve));
  manager?.shutdown();
  rmSync(dir,{recursive:true,force:true});
 }
});
