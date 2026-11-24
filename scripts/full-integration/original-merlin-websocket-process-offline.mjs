/**
 * Stage 3B-8/P — one loopback ORIGINAL Buffalo WebSocketHandler using the
 * ORIGINAL WorkerSpawner and AgentWorker. Its spawn method is transparently
 * observed, never stubbed: the original implementation must return IpcWorker.
 *
 * Selection of Merlin is exercised; chat never passes the offline frame gate.
 * No inference, Cloudflare, Container, payment, live grants or network ingress.
 */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {WebSocket,WebSocketServer} from 'ws';
import {WebSocketHandler} from '../../agent/WebSocket.js';
import {SessionManager} from '../../agent/utilities/SessionManager.js';
import {WorkerSpawner,IpcWorker} from '../../agent/WorkerSpawner.js';
import credentialProxy from '../../agent/utilities/CredentialProxy.js';
import {groups} from '../../evals/categories/policyImplementation.js';
import {OriginalMerlinProcessGate} from './original-merlin-process-gate.mjs';
import {assertProcessProbeEnvironment} from './original-merlin-worker-boundary.mjs';

export const WS_PROCESS_SCHEMA='BUFFALO_STAGE3B8_ORIGINAL_WS_PROCESS_OFFLINE_V1';
const MODEL_SHA='57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const auth='stage3b8-offline-origin-auth-not-a-secret-12345678';

function waitForBus(bus,predicate,ms=15000){
 return new Promise((resolve,reject)=>{
  const existing=bus.messages.find(predicate);
  if(existing)return resolve(existing);
  const timer=setTimeout(()=>{bus.listeners.delete(onMessage);reject(Error('3B8_REAL_WS_TIMEOUT'))},ms);
  const onMessage=m=>{if(predicate(m)){clearTimeout(timer);bus.listeners.delete(onMessage);resolve(m)}};
  bus.listeners.add(onMessage);
 });
}
function waitForWorker(worker,predicate,ms=15000){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(Error('3B8_REAL_WORKER_IPC_TIMEOUT'))},ms);
  const onMessage=m=>{if(predicate(m)){cleanup();resolve(m)}};
  const onExit=()=>{cleanup();reject(Error('3B8_REAL_WORKER_EXITED_EARLY'))};
  const cleanup=()=>{clearTimeout(timer);worker.off('message',onMessage);worker.off('exit',onExit)};
  worker.on('message',onMessage);worker.once('exit',onExit);
 });
}
const open=ws=>new Promise((resolve,reject)=>{
 ws.once('open',resolve);ws.once('error',reject)
});
const closed=ws=>new Promise((resolve,reject)=>{
 if(ws.readyState===WebSocket.CLOSED)return resolve({code:1000});
 const timer=setTimeout(()=>reject(Error('3B8_REAL_WS_CLOSE_TIMEOUT')),10000);
 ws.once('close',(code)=>{clearTimeout(timer);resolve({code})});
});

export async function originalWebSocketProcessOffline({commit}={}){
 const bwrap=spawnSync('bwrap',['--version'],{encoding:'utf8',timeout:3000});
 assertProcessProbeEnvironment({commit,bwrapAvailable:bwrap.status===0});
 const cases=groups.policyImplementation;
 const first=cases.find(x=>x.expectations?.scenario==='dialysisClinic'&&x.heldOut===false);
 assert(first,'3B8_ORIGINAL_CASE_MISSING');
 const model=structuredClone(first.currentModel);
 assert.equal(sha(model),MODEL_SHA,'3B8_ORIGINAL_MODEL_DRIFT');
 const root=mkdtempSync(join(tmpdir(),'buffalo-3b8-ws-process-'));
 const oldSpawn=WorkerSpawner.spawn;
 const oldAuth=process.env.AUTHENTICATION_KEY;
 let server,wss,client,manager,realWorker,workerExited=false,spawnCalls=0;
 const bus={messages:[],listeners:new Set(),denied:[]};
 const workerErrors=[];
 try{
  // Transparent observer only: delegate to original WorkerSpawner every time.
  WorkerSpawner.spawn=async(...args)=>{
   spawnCalls++;
   const w=await oldSpawn(...args);
   if(!(w instanceof IpcWorker)){
    try{w.kill('SIGKILL')}catch{}
    throw Error('3B8_UNSANDBOXED_WORKER_FORBIDDEN');
   }
   realWorker=w;
   w.on('message',m=>{if(m.type==='worker_error')workerErrors.push(m.error)});
   w.once('exit',()=>{workerExited=true});
   return w;
  };
  process.env.AUTHENTICATION_KEY=auth;
  server=createServer();
  manager=new SessionManager({disableCleanup:true,tempBasePath:root});
  wss=new WebSocketServer({server,path:'/api/v1',maxPayload:262144});
  wss.on('connection',ws=>new WebSocketHandler(ws,manager));
  await new Promise((res,rej)=>{server.once('error',rej);server.listen(0,'127.0.0.1',res)});
  const gate=new OriginalMerlinProcessGate({sourceCommit:commit,runtimeCommit:commit,
   modelSha256:MODEL_SHA,authenticationKey:auth,
   clientId:'buffalo-worker-'+randomUUID(),processApproved:true});
  client=new WebSocket('ws://127.0.0.1:'+server.address().port+'/api/v1');
  client.on('message',raw=>{
   const result=gate.fromBuffalo(raw.toString('utf8'));
   if(!result.allowed){bus.denied.push(result.reason);try{client.close(1011)}catch{};return}
   const item=JSON.parse(result.body);
   bus.messages.push(item);
   for(const listener of bus.listeners)listener(item);
  });
  await open(client);
  const created=await waitForBus(bus,m=>m.type==='session_created');
  const init={type:'initialize_session',clientProduct:'Buffalo WebSocket Lab',
   clientVersion:'1.0.0',mode:'sfd',model,tools:[],supportsArrays:true,
   supportsModules:false,supportsSubTypes:false};
  const a=gate.fromClient(JSON.stringify(init));
  assert.equal(a.allowed,true,a.reason);
  client.send(a.body);
  const ready=await waitForBus(bus,m=>m.type==='session_ready');
  assert.equal(ready.sessionId,created.sessionId);
  const selection=gate.fromClient(JSON.stringify({
   type:'select_agent',sessionId:created.sessionId,agentId:'merlin',provider:'cloudflare'}));
  assert.equal(selection.allowed,true,selection.reason);
  client.send(selection.body);
  const selected=await waitForBus(bus,m=>m.type==='agent_selected');
  assert.equal(selected.agentId,'merlin');
  assert.equal(selected.currentProvider,'cloudflare');
  assert.equal(spawnCalls,1,'3B8_PREWARM_SHOULD_SPAWN_ONCE');
  assert(realWorker instanceof IpcWorker,'3B8_REAL_BWRAP_WORKER_NOT_OBSERVED');
  // An IPC round trip after select_agent is an ordering barrier: it must come
  // from the REAL AgentWorker after processing its selection message.
  const requestId=randomUUID();
  const response=waitForWorker(realWorker,m=>m.type==='context_response'&&m.requestId===requestId);
  realWorker.send({type:'get_context',requestId});
  assert.deepEqual((await response).context,[]);
  assert.deepEqual(workerErrors,[],'3B8_REAL_WORKER_ERROR');
  assert.equal(gate.fromClient(JSON.stringify({
   type:'chat',sessionId:created.sessionId,message:'Tell me about stocks'})).reason,
   'INFERENCE_OR_MUTATION_NOT_AUTHORIZED_IN_P');
  assert.equal(gate.fromClient(JSON.stringify({
   type:'tool_call_response',sessionId:created.sessionId,callId:'x',result:{}})).allowed,false);
  assert.equal(bus.messages.some(m=>['get_current_model','agent_complete','tool_call_request','run_model'].includes(m.type)),false);
  assert.equal(sha(JSON.parse(readFileSync(join(manager.getSessionTempDir(created.sessionId),'model.sdjson'),'utf8'))),MODEL_SHA);
  const end=closed(client);
  const bye=gate.fromClient(JSON.stringify({type:'disconnect',sessionId:created.sessionId}));
  assert.equal(bye.allowed,true,bye.reason);
  client.send(bye.body);
  assert.equal((await end).code,1000);
  // Original WebSocketHandler awaits worker cleanup before close.
  assert.equal(workerExited,true,'3B8_WORKER_NOT_REAPED_BY_ORIGINAL_HANDLER');
  assert.deepEqual(bus.denied,[],'3B8_ORIGIN_FRAME_UNEXPECTED');
  assert.deepEqual(workerErrors,[],'3B8_WORKER_ERROR');
  return Object.freeze({schema:WS_PROCESS_SCHEMA,status:'ORIGINAL_MERLIN_WS_PROCESS_OFFLINE_PASS',
   checkout_commit:commit,model_sha256:MODEL_SHA,agent:'merlin',provider_selected:'cloudflare',
   handler_original:true,spawner_delegated_original:true,worker_original:true,
   worker_sandbox_bwrap:true,real_ipc_barrier:true,worker_spawn_calls:spawnCalls,
   worker_reaped:workerExited,original_frames:bus.messages.map(m=>m.type),
   agent_turn_executed:false,provider_requests_measured:false,
   cloudflare_deployed:false,execution_allowed:false});
 }finally{
  WorkerSpawner.spawn=oldSpawn;
  if(oldAuth===undefined)delete process.env.AUTHENTICATION_KEY;
  else process.env.AUTHENTICATION_KEY=oldAuth;
  try{client?.terminate()}catch{}
  try{realWorker?.kill('SIGKILL')}catch{}
  if(wss)await new Promise(res=>wss.close(()=>res()));
  if(server)await new Promise(res=>server.close(()=>res()));
  manager?.shutdown();
  await credentialProxy.stop();
  rmSync(root,{recursive:true,force:true});
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==4||process.argv[2]!=='--commit')throw Error('3B8_CLI_COMMIT_REQUIRED');
  const receipt=await originalWebSocketProcessOffline({commit:process.argv[3]});
  console.log('BUFFALO_3B8_WS_PROCESS_EVIDENCE='+JSON.stringify(receipt));
 }catch(e){console.error('BUFFALO_3B8_WS_PROCESS_FAILURE',e?.message??String(e));process.exitCode=1;}
}
