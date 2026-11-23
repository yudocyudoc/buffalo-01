/**
 * One-shot PRIVATE scheduled canary: Worker -> Durable Object RPC -> pinned
 * original Buffalo Node Container. Never public, never a chat proxy.
 * Credentials for the existing Node protocol exist only in DO memory and
 * Container environment during this single test. No permanent secrets.
 */
import oldController,{BuffaloHandshakeContainer as ExistingContainer} from './container-controller.mjs';
import model from './probe-initial-model.json';

const INSTANCE='buffalo-original-handshake-only';
const MODE='HANDSHAKE_ONLY_NO_AGENT_PROCESS';
const SOURCE='a8b1ad0c02d5c3367bd24962e8fd36d277a8135d';
const MODEL='57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39';
const HANDOFF='f9c4db4e-aa31-4b2a-921e-201a5a79fd37';
const MANIFEST='4d80f1f4ee8a75ba610943826ab3858c2019a79414e5aad249f3f3342f29aa0e';
const MAX_WAIT=25000;
const randomSecret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');

export async function validateProbeModel(){
 if(await sha(JSON.stringify(model))!==MODEL)throw Error('MODEL_DIGEST_DIFFERENT');
 return true;
}
export async function sourceAllowsProbe(env){
 if(env.BUFFALO_PROBE_MODE!=='ONE_SHOT_NO_INFERENCE'||env.BUFFALO_ORIGIN_MODE!==MODE||
    env.BUFFALO_ORIGIN_COMMIT_SHA!==SOURCE||env.BUFFALO_ORIGIN_MODEL_SHA256!==MODEL||
    !env.DB?.prepare)throw Error('PROBE_ENVIRONMENT_DENIED');
 const row=await env.DB.prepare(
  'SELECT h.handoff_id,h.commit_sha,h.manifest_sha256,h.initial_model_sha256,'+
  'h.execution_allowed,a.proof_status,a.commit_sha AS proof_commit_sha,'+
  'a.execution_allowed AS proof_execution_allowed '+
  'FROM buffalo_full_handoffs h JOIN buffalo_full_source_attestations a '+
  'ON a.handoff_id=h.handoff_id WHERE h.handoff_id=?'
 ).bind(HANDOFF).first();
 if(!row||row.handoff_id!==HANDOFF||row.commit_sha!==SOURCE||
    row.manifest_sha256!==MANIFEST||row.initial_model_sha256!==MODEL||
    row.proof_commit_sha!==SOURCE||row.proof_status!=='SOURCE_ATTESTED'||
    Number(row.execution_allowed)!==0||Number(row.proof_execution_allowed)!==0)
  throw Error('PROBE_SOURCE_NOT_ATTESTED');
 const grants=await env.DB.prepare('SELECT COUNT(*) AS n FROM buffalo_full_live_grants').first();
 if(Number(grants?.n)!==0)throw Error('PROBE_INFERENCE_GRANT_PRESENT');
 await validateProbeModel();
 return true;
}
async function awaitNodeHealthy(port){
 for(let i=0;i<70;i++){
  try{
   const r=await port.fetch('http://container/health',{signal:AbortSignal.timeout(1100)});
   await r.body?.cancel();
   if(r.status===204)return;
  }catch{}
  await pause(180);
 }
 throw Error('PROBE_ORIGINAL_NODE_HEALTH_FAILED');
}
async function handshakeOnce(port,auth,upgrade){
 const response=await port.fetch(new Request('http://container/api/v1',{
  method:'GET',headers:{Upgrade:'websocket','x-buffalo-origin-token':upgrade}
 }));
 if(response.status!==101||!response.webSocket)throw Error('PROBE_HTTP_101_FAILED');
 const ws=response.webSocket;
 const frames=[];
 return new Promise((resolve,reject)=>{
  let finished=false,session=null,ready=false,disconnectSent=false;
  const finish=(error)=>{
   if(finished)return;
   finished=true;clearTimeout(timeout);
   try{if(ws.readyState!==3)ws.close()}catch{}
   if(error)reject(error);
   else resolve({http_101:true,session_created:!!session,session_ready:ready,
    disconnect_sent:disconnectSent,connection_closed:true,
    frame_types:frames,inference_path:'DISABLED_IN_ORIGINAL_NODE_WRAPPER'});
  };
  const timeout=setTimeout(()=>finish(Error('PROBE_WEBSOCKET_TIMEOUT')),MAX_WAIT);
  ws.addEventListener('message',ev=>{
   let msg;
   try{msg=JSON.parse(ev.data)}catch{finish(Error('PROBE_BAD_FRAME'));return}
   if(!msg||typeof msg.type!=='string'){finish(Error('PROBE_BAD_TYPE'));return}
   frames.push(msg.type);
   if(msg.type==='session_created'&&!session&&typeof msg.sessionId==='string'){
    session=msg.sessionId;
    ws.send(JSON.stringify({
     type:'initialize_session',authenticationKey:auth,
     clientId:'buffalo-worker-'+crypto.randomUUID(),
     clientProduct:'Private one-shot origin canary',
     clientVersion:'1.0.0',mode:'sfd',model,tools:[],
     supportsArrays:true,supportsModules:false,supportsSubTypes:false
    }));
   }else if(msg.type==='session_ready'&&session===msg.sessionId&&!ready){
    ready=true;disconnectSent=true;
    ws.send(JSON.stringify({type:'disconnect',sessionId:session}));
   }else if(msg.type!=='error'){finish(Error('PROBE_ORIGINAL_FRAME_UNEXPECTED'))}
  });
  ws.addEventListener('close',()=>finish(
   session&&ready&&disconnectSent?null:Error('PROBE_CLOSED_EARLY')
  ));
  ws.addEventListener('error',()=>finish(Error('PROBE_SOCKET_ERROR')));
  ws.accept();
 });
}
export class BuffaloHandshakeContainer extends ExistingContainer {
 async runOneShotProbe(){
  // Durable Object RPC ONLY; never reachable through the Worker fetch handler.
  // Permanent storage claim forbids retries even after crashes or deployment.
  const claimed=await this.ctx.storage.transaction(async tx=>{
   if(await tx.get('buffalo-probe-3b6-once'))return false;
   await tx.put('buffalo-probe-3b6-once',{status:'CLAIMED',at:new Date().toISOString()});
   return true;
  });
  if(!claimed)return {status:'ALREADY_CLAIMED_NO_RETRY'};
  let receipt;
  try{
   if(!this.ctx.container?.images?.base)throw Error('PROBE_IMAGE_MAP_MISSING');
   const auth=randomSecret(),upgrade=randomSecret();
   if(auth===upgrade)throw Error('PROBE_KEYS_NOT_DISTINCT');
   const container=this.ctx.container;
   if(container.running)throw Error('PROBE_CONTAINER_ALREADY_RUNNING');
   container.start({image:container.images.base,instance:'lite',enableInternet:false,
    env:{BUFFALO_ORIGIN_MODE:MODE,BUFFALO_ORIGIN_UPGRADE_TOKEN:upgrade,
     AUTHENTICATION_KEY:auth,BUFFALO_ORIGIN_MODEL_SHA256:MODEL,
     BUFFALO_ORIGIN_COMMIT_SHA:SOURCE}});
   await container.setInactivityTimeout(60_000);
   const port=container.getTcpPort(8080);
   await awaitNodeHealthy(port);
   const result=await handshakeOnce(port,auth,upgrade);
   if(!result.http_101||!result.session_created||!result.session_ready||
      !result.disconnect_sent||!result.connection_closed)
    throw Error('PROBE_INCOMPLETE_HANDSHAKE');
   receipt={status:'REAL_ORIGIN_HANDSHAKE_PASS',source_commit:SOURCE,
    handoff_id:HANDOFF,model_sha256:MODEL,...result};
  }catch(e){
   receipt={status:'REAL_ORIGIN_HANDSHAKE_FAILED',
    error_code:String(e?.message??'PROBE_UNKNOWN').slice(0,100),
    source_commit:SOURCE,handoff_id:HANDOFF};
  }
  await this.ctx.storage.put('buffalo-probe-3b6-once',
   {...receipt,finished_at:new Date().toISOString()});
  console.log('BUFFALO_ORIGIN_ONE_SHOT_RECEIPT '+JSON.stringify(receipt));
  return receipt;
 }
 async readOneShotProbe(){
  return await this.ctx.storage.get('buffalo-probe-3b6-once')??{status:'NOT_RUN'};
 }
}
export default {
 fetch:oldController.fetch,
 async scheduled(_event,env){
  // No cron is present in the static config; only the manually approved
  // temporary probe configuration can schedule this callback.
  if(env.BUFFALO_PROBE_MODE!=='ONE_SHOT_NO_INFERENCE')return;
  await sourceAllowsProbe(env);
  // Isolated laboratory receipt table, NOT a canonical source proof/grant table.
  await env.DB.prepare(
   'CREATE TABLE IF NOT EXISTS buffalo_stage3b6_private_probe_receipts ('+
   'probe_id TEXT PRIMARY KEY, handoff_id TEXT NOT NULL, commit_sha TEXT NOT NULL,'+
   'status TEXT NOT NULL, receipt_json TEXT NOT NULL,'+
   'created_at TEXT DEFAULT CURRENT_TIMESTAMP)'
  ).run();
  const receipt=await env.BUFFALO_CONTAINER.getByName(INSTANCE).runOneShotProbe();
  // Append a minimal audit receipt only in the isolated Buffalo laboratory D1.
  // This is NOT an inference grant and does not touch the source proof rows.
  if(receipt.status!=='ALREADY_CLAIMED_NO_RETRY'){
   await env.DB.prepare('INSERT INTO buffalo_stage3b6_private_probe_receipts '+
    '(probe_id,handoff_id,commit_sha,status,receipt_json) VALUES (?,?,?,?,?) '+
    'ON CONFLICT(probe_id) DO NOTHING').bind(
    'one-shot-origin-rpc-v1',HANDOFF,SOURCE,receipt.status,JSON.stringify(receipt)
   ).run();
  }
  console.log('BUFFALO_ONE_SHOT_SCHEDULED '+JSON.stringify(receipt));
 }
};
