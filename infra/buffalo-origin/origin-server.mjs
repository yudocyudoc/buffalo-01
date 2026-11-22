/**
 * Stage 3B-4: PRIVATE Linux/Node WebSocket origin for the unmodified Buffalo
 * WebSocketHandler. Handshake-only. No agent processes, SDK calls, or providers.
 *
 * A process wrapper is necessary: the original handler prewarms WorkerSpawner
 * on initialize_session, before select_agent. This wrapper denies the spawn
 * *in the origin process* and enforces a second no-chat gate on the raw socket.
 *
 * Not a replacement for Buffalo's handler/protocol. Do not use for inference.
 */
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {createHash,timingSafeEqual} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {WebSocketServer} from 'ws';
import {WebSocketHandler} from '../../agent/WebSocket.js';
import {SessionManager} from '../../agent/utilities/SessionManager.js';
import {WorkerSpawner} from '../../agent/WorkerSpawner.js';

export const ORIGIN_MODE='HANDSHAKE_ONLY_NO_AGENT_PROCESS';
export const ORIGIN_PATH='/api/v1';
export const ORIGIN_PORT=8080;
export const FRAME_MAX_BYTES=262144;
const SHA64=/^[a-f0-9]{64}$/;
const SHA40=/^[a-f0-9]{40}$/;
const initFields=new Set([
 'type','authenticationKey','clientId','clientProduct','clientVersion',
 'mode','model','tools','supportsArrays','supportsModules','supportsSubTypes'
]);
const digest=obj=>createHash('sha256').update(JSON.stringify(obj)).digest('hex');
const equals=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string')return false;
 const x=createHash('sha256').update(a).digest();
 const y=createHash('sha256').update(b).digest();
 return timingSafeEqual(x,y)&&a.length===b.length;
};
export function validateOriginEnvironment(config){
 if(config.mode!==ORIGIN_MODE||
   typeof config.authenticationKey!=='string'||config.authenticationKey.length<32||
   typeof config.upgradeKey!=='string'||config.upgradeKey.length<32||
   config.upgradeKey===config.authenticationKey||
   !SHA64.test(config.modelSha256??'')||
   !SHA40.test(config.commitSha??''))
  throw Error('BUFFALO_PRIVATE_ORIGIN_CONFIG_INVALID');
}
const denyUpgrade=(socket,code=403)=>{
 try{socket.write(
  'HTTP/1.1 '+code+' '+(code===403?'Forbidden':'Not Found')+'\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
 )}catch{}
 socket.destroy();
};
class SafeOriginalSocket extends EventEmitter {
 constructor(raw,config){
  super();
  this.raw=raw;this.config=config;this.state='AWAIT_INITIALIZE';
  this.serverSessionId=null;
  raw.on('message',(bytes,isBinary)=>{
   if(isBinary||bytes.length>FRAME_MAX_BYTES){this.close(1008,'FRAME_REJECTED');return}
   let msg;try{msg=JSON.parse(bytes.toString('utf8'))}catch{this.close(1008,'INVALID_JSON');return}
   if(!msg||typeof msg!=='object'||Array.isArray(msg)){
    this.close(1008,'INVALID_MESSAGE');return;
   }
   if(msg.type==='initialize_session'&&this.state==='AWAIT_INITIALIZE'){
    if(Object.keys(msg).some(k=>!initFields.has(k))||
      !equals(msg.authenticationKey,this.config.authenticationKey)||
      !/^buffalo-worker-[a-z0-9-]{8,70}$/.test(msg.clientId??'')||
      msg.mode!=='sfd'||!Array.isArray(msg.tools)||msg.tools.length!==0||
      !msg.model||typeof msg.model!=='object'||Array.isArray(msg.model)||
      digest(msg.model)!==this.config.modelSha256){
     this.close(1008,'INIT_NOT_AUTHORIZED');return;
    }
    this.state='INITIALIZING';
    this.emit('message',bytes);
    return;
   }
   if(msg.type==='disconnect'&&this.serverSessionId&&
     msg.sessionId===this.serverSessionId){
    this.state='CLOSING';
    this.emit('message',bytes);
    return;
   }
   // No select_agent, chat, client tools, history, attachments or replay.
   this.close(1008,'NO_AGENT_TURNS');
  });
  raw.on('close',(code,reason)=>this.emit('close',code,reason));
  raw.on('error',error=>this.emit('error',error));
 }
 get readyState(){return this.raw.readyState}
 send(payload){
  let parsed;
  try{parsed=JSON.parse(String(payload))}catch{this.close(1011,'ORIGIN_BAD_JSON');return}
  if(parsed.type==='session_created'&&this.state==='AWAIT_INITIALIZE'&&
   typeof parsed.sessionId==='string'){
   this.serverSessionId=parsed.sessionId;
  }else if(parsed.type==='session_ready'&&this.state==='INITIALIZING'&&
   parsed.sessionId===this.serverSessionId){
   this.state='READY_HANDSHAKE_ONLY';
  }else if(parsed.type==='error'&&
   parsed.sessionId===this.serverSessionId){
   // Genuine errors from the original protocol are permitted.
  }else{
   this.close(1011,'ORIGIN_UNEXPECTED_MESSAGE');
   return;
  }
  this.raw.send(payload);
 }
 close(...args){try{this.raw.close(...args)}catch{}}
}
export async function startPrivateBuffaloOrigin(config){
 validateOriginEnvironment(config);
 const port=config.port??ORIGIN_PORT,host=config.host??'0.0.0.0';
 if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('BAD_ORIGIN_PORT');
 const existingSpawn=WorkerSpawner.spawn;
 const existingAuth=process.env.AUTHENTICATION_KEY;
 const temp=mkdtempSync(join(tmpdir(),'buffalo-private-origin-'));
 const sessions=new SessionManager({disableCleanup:true,tempBasePath:temp});
 const server=createServer((req,res)=>{
  if(req.url==='/health'&&req.method==='GET'){
   res.writeHead(204,{'cache-control':'no-store'}).end();return;
  }
  res.writeHead(404,{'cache-control':'no-store'}).end();
 });
 const wss=new WebSocketServer({noServer:true,maxPayload:FRAME_MAX_BYTES});
 let closed=false,spawnDenied=0;
 WorkerSpawner.spawn=async()=>{
  spawnDenied++;
  throw Error('BUFFALO_PRIVATE_ORIGIN_AGENT_SPAWN_DENIED');
 };
 process.env.AUTHENTICATION_KEY=config.authenticationKey;
 server.on('upgrade',(req,socket,head)=>{
  if(req.method!=='GET'||req.url!==ORIGIN_PATH||
     req.headers.upgrade?.toLowerCase()!=='websocket'||
     req.headers['sec-websocket-protocol']||
     !equals(req.headers['x-buffalo-origin-token'],config.upgradeKey)){
   denyUpgrade(socket);return;
  }
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
 });
 wss.on('connection',raw=>{
  const wrapped=new SafeOriginalSocket(raw,config);
  new WebSocketHandler(wrapped,sessions);
 });
 try{
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(port,host,resolve);
  });
 }catch(error){
  WorkerSpawner.spawn=existingSpawn;
  if(existingAuth===undefined)delete process.env.AUTHENTICATION_KEY;
  else process.env.AUTHENTICATION_KEY=existingAuth;
  sessions.shutdown();rmSync(temp,{recursive:true,force:true});
  throw error;
 }
 return {
  port:server.address().port,
  host,server,wss,
  metrics:()=>({spawn_denied:spawnDenied,agent_turns:0,mode:ORIGIN_MODE}),
  async close(){
   if(closed)return;
   closed=true;
   for(const ws of wss.clients)ws.terminate();
   await new Promise(resolve=>wss.close(resolve));
   await new Promise(resolve=>server.close(resolve));
   sessions.shutdown();
   WorkerSpawner.spawn=existingSpawn;
   if(existingAuth===undefined)delete process.env.AUTHENTICATION_KEY;
   else process.env.AUTHENTICATION_KEY=existingAuth;
   rmSync(temp,{recursive:true,force:true});
  }
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const config={
   mode:process.env.BUFFALO_ORIGIN_MODE,
   authenticationKey:process.env.AUTHENTICATION_KEY,
   upgradeKey:process.env.BUFFALO_ORIGIN_UPGRADE_TOKEN,
   modelSha256:process.env.BUFFALO_ORIGIN_MODEL_SHA256,
   commitSha:process.env.BUFFALO_ORIGIN_COMMIT_SHA,
   host:'0.0.0.0',port:ORIGIN_PORT
  };
  await startPrivateBuffaloOrigin(config);
  console.log('BUFFALO_PRIVATE_ORIGIN_HANDSHAKE_ONLY_READY');
 }catch(e){
  console.error('BUFFALO_PRIVATE_ORIGIN_START_DENIED',e?.message??String(e));
  process.exitCode=1;
 }
}
