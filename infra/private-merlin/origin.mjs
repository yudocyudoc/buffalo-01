import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {existsSync,mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {WebSocketServer} from 'ws';
import config from '../../config.js';
import {verifyLaunchContext} from '../buffalo-r2/driver.mjs';
import {MODEL,CONFIG_HASH,DENIED,Turn,requireThat} from './protocol.mjs';

const {MERLIN_PHASE:phase, MERLIN_KEY:key, MERLIN_SOURCE:source, MERLIN_EXPIRES:until} = process.env;
requireThat(['R','I'].includes(phase) && /^[a-f0-9]{64}$/.test(key) && /^[a-f0-9]{40}$/.test(source)
  && source===process.env.BUFFALO_IMAGE_SOURCE_SHA && Number(until)>Date.now()
  && process.env.ALLOW_UNSANDBOXED_FALLBACK==='false','UNARMED');
verifyLaunchContext(readFileSync('/proc/self/status','utf8'));
if (phase === 'R') {
  requireThat(!process.env.BUFFALO_PRIVATE_MERLIN_MODEL,'R_PROVIDER_CONFIGURED');
  // Parent-only schema admission. The separate AgentWorker retains its original registry.
  config.openRouterAgentProviders[DENIED] = {displayName:'Denied'};
} else {
  await import('./provider.mjs');
}
const {WebSocketHandler} = await import('../../agent/WebSocket.js');
const {SessionManager} = await import('../../agent/utilities/SessionManager.js');
const {IpcWorker,WorkerSpawner} = await import('../../agent/WorkerSpawner.js');
const {originalCase} = await import('../../scripts/full-integration/original-merlin-worker-boundary.mjs');
const {default:proxy} = await import('../../agent/utilities/CredentialProxy.js');
const {model,configSha} = originalCase();
requireThat(configSha===CONFIG_HASH,'MERLIN_CONFIGURATION_DRIFT');
const root = mkdtempSync(join(tmpdir(),'merlin-ws-'));
const sessions = new SessionManager({disableCleanup:true,tempBasePath:root});
const turn = new Turn(phase,model);
const proof = {source_commit:source,agent_config_sha256:configSha,spawn_calls:0,worker_frames:[]};
const hash = value => createHash('sha256').update(value).digest('hex');
const nativeSpawn = WorkerSpawner.spawn.bind(WorkerSpawner);
let admitted=false, pending=null, temp;
WorkerSpawner.spawn = async (...args) => {
  requireThat(admitted && Date.now()<Number(until) && ++proof.spawn_calls === 1,'SPAWN_DENIED');
  const w = await nativeSpawn(...args);
  if (!(w instanceof IpcWorker)) { w.kill('SIGKILL'); throw Error('SANDBOX_REQUIRED'); }
  temp=args[1];
  const send=w.send.bind(w);
  w.send=message=>{
    const result=send(message);
    if(message.type==='shutdown')proof.shutdown_ipc_sent=true;
    return result;
  };
  w.on('message',m=>{
    if (m.type==='to_client') proof.worker_frames.push(m.message.type);
    if (m.type==='to_client' && m.message.type==='agent_text') proof.output_sha256=hash(m.message.content);
    if (m.type==='worker_error') proof.worker_error=true;
  });
  w.once('exit',(code,signal)=>{proof.exit={code,signal};});
  return w;
};
process.env.AUTHENTICATION_KEY=randomUUID()+randomUUID();

class OriginalSocket extends EventEmitter {
  constructor(raw) {
    super();
    this.raw=raw;
    raw.on('message',(data,binary)=>{
      try {
        requireThat(!binary && Date.now()<Number(until) && pending,'NO_EXPECTED_CLIENT_FRAME');
        const frame=JSON.parse(data.toString());
        requireThat(isDeepStrictEqual(frame,pending),'UNAUTHORIZED_CLIENT_FRAME');
        pending=null;
        if(frame.type==='initialize_session'){
          admitted=true;
          frame.authenticationKey=process.env.AUTHENTICATION_KEY;
          frame.clientId='buffalo-worker-'+turn.session;
        }
        this.emit('message',Buffer.from(JSON.stringify(frame)));
      } catch { raw.close(1008,'FRAME_DENIED'); }
    });
    raw.on('close',(...args)=>this.emit('close',...args));
    raw.on('error',err=>this.emit('error',err));
  }
  get readyState(){return this.raw.readyState;}
  send(data){
    try {
      requireThat(!pending,'CLIENT_FRAME_PENDING');
      const frame=JSON.parse(data);
      pending=turn.onNative(frame);
      if(frame.type==='agent_complete') {
        proof.model_sha256 = hash(JSON.stringify(JSON.parse(readFileSync(join(temp,'model.sdjson'),'utf8'))));
      }
      this.raw.send(data);
    } catch { this.raw.close(1008,'ORIGIN_FRAME_DENIED'); }
  }
  close(code,reason){this.raw.close(code,reason);}
}

const validKey=req=>{
  const value=req.headers['x-merlin-key'];
  return typeof value==='string' && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value),Buffer.from(key));
};
const server=createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/health'){res.writeHead(204).end();return;}
  if(req.method!=='GET'||req.url!=='/proof'||!validKey(req)){res.writeHead(404).end();return;}
  try {
    requireThat(turn.state==='disconnect' && !pending && proof.exit?.code===0 && proof.exit.signal===null &&
      proof.spawn_calls===1 && proof.shutdown_ipc_sent && !proof.worker_error && temp && !existsSync(temp),'TEARDOWN_NOT_VERIFIED');
    requireThat(proof.model_sha256===MODEL,'MODEL_CHANGED');
    await proxy.stop();
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({...proof,session_id:turn.session}));
  } catch {res.writeHead(409).end();}
});
const wss=new WebSocketServer({noServer:true,maxPayload:262144});
let consumed=false;
server.on('upgrade',(req,socket,head)=>{
  if(consumed || Date.now()>=Number(until) || req.method!=='GET' || req.url!=='/api/v1' ||
     req.headers['sec-websocket-protocol'] || !validKey(req)){socket.destroy();return;}
  consumed=true;
  wss.handleUpgrade(req,socket,head,raw=>new WebSocketHandler(new OriginalSocket(raw),sessions));
});
server.listen(Number(process.env.MERLIN_PORT ?? 8080),'0.0.0.0');
