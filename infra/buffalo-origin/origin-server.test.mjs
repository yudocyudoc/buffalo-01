import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WebSocket} from 'ws';
import {startPrivateBuffaloOrigin,validateOriginEnvironment,ORIGIN_MODE}
 from './origin-server.mjs';

const auth='ci-original-buffalo-auth-no-provider-12345678';
const token='ci-origin-upgrade-token-separated-123456789';
const model={variables:[],relationships:[],title:'Native Buffalo private origin handshake'};
const sha=createHash('sha256').update(JSON.stringify(model)).digest('hex');
const config={
 mode:ORIGIN_MODE,authenticationKey:auth,upgradeKey:token,
 modelSha256:sha,commitSha:'6'.repeat(40),imageSourceSha:'6'.repeat(40),port:0,host:'127.0.0.1'
};
function busFor(ws){
 const items=[],listeners=new Set();
 ws.on('message',raw=>{
  const x=JSON.parse(raw.toString('utf8'));
  items.push(x);
  for(const l of listeners)l(x);
 });
 const awaitMessage=(fn,timeout=5000)=>new Promise((resolve,reject)=>{
  const prev=items.find(fn);
  if(prev)return resolve(prev);
  const timer=setTimeout(()=>{listeners.delete(onMessage);reject(Error('ORIGIN_MESSAGE_TIMEOUT'))},timeout);
  const onMessage=item=>{
   if(fn(item)){clearTimeout(timer);listeners.delete(onMessage);resolve(item)}
  };
  listeners.add(onMessage);
 });
 return {items,awaitMessage};
}
function client(server,headers){
 const ws=new WebSocket('ws://127.0.0.1:'+server.port+'/api/v1',{headers});
 const bus=busFor(ws);
 return {ws,bus};
}
function open(ws){
 return new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
}
function closed(ws){
 return new Promise((resolve,reject)=>{
  if(ws.readyState===WebSocket.CLOSED)return resolve({code:1000});
  const t=setTimeout(()=>reject(Error('ORIGIN_CLOSE_TIMEOUT')),5000);
  ws.once('close',(code,reason)=>{clearTimeout(t);resolve({code,reason:reason.toString()})});
 });
}
test('private origin runs ORIGINAL WebSocketHandler; initialization succeeds while agent prewarm and turns are denied',async()=>{
 const server=await startPrivateBuffaloOrigin(config);
 let ws;
 try{
  const c=client(server,{'x-buffalo-origin-token':token});
  ws=c.ws;
  await open(ws);
  const created=await c.bus.awaitMessage(x=>x.type==='session_created');
  assert.ok(created.sessionId);
  assert.equal(server.metrics().spawn_denied,0);
  const readyPromise=c.bus.awaitMessage(x=>x.type==='session_ready');
  ws.send(JSON.stringify({
   type:'initialize_session',authenticationKey:auth,
   clientId:'buffalo-worker-123e4567-e89b-42d3-a456-426614174111',
   clientProduct:'Original Buffalo private Node origin CI',clientVersion:'1.0.0',
   mode:'sfd',model,tools:[],supportsArrays:true,
   supportsModules:false,supportsSubTypes:false
  }));
  const ready=await readyPromise;
  assert.equal(ready.sessionId,created.sessionId);
  assert.equal(server.metrics().spawn_denied,1);
  assert.equal(server.metrics().agent_turns,0);
  const end=closed(ws);
  ws.send(JSON.stringify({type:'select_agent',agentId:'merlin',provider:'cloudflare',
   sessionId:created.sessionId}));
  const finish=await end;
  assert.equal(finish.code,1008);
  assert.equal(server.metrics().spawn_denied,1);
  assert.equal(server.metrics().agent_turns,0);
  assert(c.bus.items.every(x=>[
   'session_created','session_ready','error'
  ].includes(x.type)));
 }finally{
  try{ws?.terminate()}catch{}
  await server.close();
 }
});
test('missing, wrong origin key and path cannot upgrade; no agent spawn',async()=>{
 const server=await startPrivateBuffaloOrigin(config);
 try{
  for(const headers of [{},{'x-buffalo-origin-token':'bad'}]){
   const ws=new WebSocket('ws://127.0.0.1:'+server.port+'/api/v1',{headers});
   const status=await new Promise((resolve,reject)=>{
    const t=setTimeout(()=>reject(Error('UPGRADE_DENY_TIMEOUT')),5000);
    ws.once('unexpected-response',(_,res)=>{
     clearTimeout(t);const s=res.statusCode;res.resume();resolve(s);
    });
    ws.once('error',()=>{});
   });
   assert.equal(status,403);
   ws.terminate();
  }
  const wrong=new WebSocket('ws://127.0.0.1:'+server.port+'/evil',{
   headers:{'x-buffalo-origin-token':token}
  });
  const status=await new Promise((resolve,reject)=>{
   const t=setTimeout(()=>reject(Error('PATH_DENY_TIMEOUT')),5000);
   wrong.once('unexpected-response',(_,res)=>{
    clearTimeout(t);const s=res.statusCode;res.resume();resolve(s)
   });
   wrong.once('error',()=>{});
  });
  assert.equal(status,403);
  wrong.terminate();
  assert.equal(server.metrics().spawn_denied,0);
 }finally{await server.close()}
});
test('direct client cannot inject history, other model, chat or second initialize',async()=>{
 const server=await startPrivateBuffaloOrigin(config);
 try{
  for(const frame of [
   {type:'chat',sessionId:'user',message:'run Merlin'},
   {type:'initialize_session',authenticationKey:auth,
    clientId:'buffalo-worker-123e4567-e89b-42d3-a456-426614174111',
    mode:'sfd',tools:[],model:{evil:1},historicalMessages:[]},
   {type:'initialize_session',authenticationKey:auth,
    clientId:'buffalo-worker-123e4567-e89b-42d3-a456-426614174111',
    mode:'sfd',tools:[{name:'paid_tool'}],model}
  ]){
   const {ws,bus}=client(server,{'x-buffalo-origin-token':token});
   await open(ws);
   await bus.awaitMessage(x=>x.type==='session_created');
   const done=closed(ws);
   ws.send(JSON.stringify(frame));
   assert.equal((await done).code,1008);
   assert.equal(server.metrics().spawn_denied,0);
   ws.terminate();
  }
 }finally{await server.close()}
});
test('server refuses to start without a distinct internal upgrade credential and matching model',()=>{
 for(const invalid of [
  {...config,upgradeKey:auth},
  {...config,authenticationKey:undefined},
  {...config,mode:'ALLOW_INFERENCE'},
  {...config,modelSha256:'wrong'},
  {...config,commitSha:'short'},
  {...config,imageSourceSha:'f'.repeat(40)}
 ])assert.throws(()=>validateOriginEnvironment(invalid),/BUFFALO_PRIVATE_ORIGIN_CONFIG_INVALID/);
});
