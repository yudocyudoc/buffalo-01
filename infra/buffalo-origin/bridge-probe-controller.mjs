/**
 * Stage 3B-7: temporary, no-public-ingress RPC entrypoint for an original
 * Buffalo handshake through the existing bridge. Does not enable inference.
 *
 * Named WorkerEntrypoint = internal service-binding capability, not HTTP.
 * Existing Worker fetch remains closed exactly as before.
 */
import {WorkerEntrypoint} from 'cloudflare:workers';
import original,{BuffaloHandshakeContainer as Base} from './container-controller.mjs';
import {sourceAllowsProbe} from './probe-controller.mjs';

const INSTANCE='buffalo-original-handshake-only';
const MODE='HANDSHAKE_ONLY_NO_AGENT_PROCESS';
const SOURCE='a8b1ad0c02d5c3367bd24962e8fd36d277a8135d';
const MODEL='57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39';
const HANDOFF='f9c4db4e-aa31-4b2a-921e-201a5a79fd37';
const CLAIM='buffalo-probe-3b7-once';
const PORT=8080;
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const DENIED=()=>new Response('Not Found',{status:404});

function requestAllowed(request) {
 const url=new URL(request.url);
 return request.method==='GET'&&url.pathname==='/api/v1'&&!url.search&&
  request.headers.get('upgrade')?.toLowerCase()==='websocket'&&
  !request.headers.has('sec-websocket-protocol');
}
async function healthy(port) {
 for(let i=0;i<70;i++) {
  try{
   const response=await port.fetch('http://container/health',{signal:AbortSignal.timeout(1100)});
   await response.body?.cancel();
   if(response.status===204)return;
  }catch{}
  await delay(180);
 }
 throw Error('BRIDGE_ORIGIN_HEALTH_FAILED');
}
function safeError(error){
 return String(error?.message??'UNKNOWN').replace(/[^A-Z0-9_]/gi,'_').slice(0,85);
}
async function persistBridgeReceipt(db,result){
 // The D1 row is an audit trail. Never serialize the returned ephemeral keys.
 // Requires migrations/control-plane/lab/0003_stage3b7_observability.sql.
 await db.prepare(
  'INSERT INTO buffalo_stage3b7_private_bridge_receipts '+
  '(probe_id,handoff_id,commit_sha,status,receipt_json) VALUES (?,?,?,?,?) '+
  'ON CONFLICT(probe_id) DO UPDATE SET '+
  'status=excluded.status,receipt_json=excluded.receipt_json'
 ).bind('one-shot-private-bridge-v1',HANDOFF,SOURCE,result.status,JSON.stringify(result)).run();
}

export class BuffaloHandshakeContainer extends Base {
 bridgeKeys;
 async prepareBridgeOnce() {
  // Durable claim BEFORE any container allocation. Failed attempt is not retried.
  const claimed=await this.ctx.storage.transaction(async tx=>{
   if(await tx.get(CLAIM))return false;
   await tx.put(CLAIM,{status:'CLAIMED',at:new Date().toISOString()});
   return true;
  });
  if(!claimed)return {status:'ALREADY_CLAIMED_NO_RETRY'};
  try{
   if(!this.ctx.container?.images?.base)throw Error('BRIDGE_PROBE_IMAGE_NOT_PINNED');
   if(this.ctx.container.running)throw Error('BRIDGE_PROBE_CONTAINER_ALREADY_RUNNING');
   const auth=token(),upgrade=token();
   if(auth===upgrade)throw Error('BRIDGE_PROBE_IDENTICAL_KEYS');
   this.bridgeKeys={auth,upgrade,used:false,startedAt:Date.now()};
   this.ctx.container.start({
    image:this.ctx.container.images.base,instance:'lite',enableInternet:false,
    env:{BUFFALO_ORIGIN_MODE:MODE,AUTHENTICATION_KEY:auth,
     BUFFALO_ORIGIN_UPGRADE_TOKEN:upgrade,BUFFALO_ORIGIN_COMMIT_SHA:SOURCE,
     BUFFALO_ORIGIN_MODEL_SHA256:MODEL}
   });
   await this.ctx.container.setInactivityTimeout(60_000);
   await healthy(this.ctx.container.getTcpPort(PORT));
   // Only a named private Service Binding receives these ephemeral keys.
   // They are never persisted, logged, or exposed by the default Worker.
   return {status:'READY',auth,upgrade};
  }catch(e){
   this.bridgeKeys=undefined;
   const result={status:'BRIDGE_PROBE_PREPARE_FAILED',error_code:safeError(e)};
   await this.ctx.storage.put(CLAIM,{...result,at:new Date().toISOString()});
   return result;
  }
 }
 async fetch(request) {
  if(!requestAllowed(request))return DENIED();
  const keys=this.bridgeKeys;
  if(!keys||keys.used||Date.now()-keys.startedAt>60_000)return DENIED();
  if(request.headers.get('x-buffalo-origin-token')!==keys.upgrade)return DENIED();
  keys.used=true;
  try{
   const upstream=new Request('http://container/api/v1',{
    method:'GET',headers:{Upgrade:'websocket','x-buffalo-origin-token':keys.upgrade}
   });
   return await this.ctx.container.getTcpPort(PORT).fetch(upstream);
  }catch{return new Response('Origin unavailable',{status:503})}
 }
 async finishBridgeOnce(receipt) {
  const claimed=await this.ctx.storage.get(CLAIM);
  if(!claimed||claimed.status!=='CLAIMED')return {status:'NO_ACTIVE_BRIDGE_CLAIM'};
  if(!receipt||!['REAL_BRIDGE_HANDSHAKE_PASS','REAL_BRIDGE_HANDSHAKE_FAILED'].includes(receipt.status))
   throw Error('BRIDGE_PROBE_BAD_RECEIPT');
  if(receipt.status==='REAL_BRIDGE_HANDSHAKE_PASS'&&
     (!['http_101','session_created','session_ready',
         'disconnect_sent','connection_closed'].every(key=>receipt[key]===true)||
      !Array.isArray(receipt.frame_types)||receipt.frame_types.length!==2||
      receipt.frame_types[0]!=='session_created'||
      receipt.frame_types[1]!=='session_ready'))
   throw Error('BRIDGE_POSITIVE_EVIDENCE_INCOMPLETE');
  const result={status:receipt.status,source_commit:SOURCE,handoff_id:HANDOFF,
   model_sha256:MODEL,
   http_101:receipt.http_101===true,
   session_created:receipt.session_created===true,
   session_ready:receipt.session_ready===true,
   disconnect_sent:receipt.disconnect_sent===true,
   connection_closed:receipt.connection_closed===true,
   frame_types:Array.isArray(receipt.frame_types)?receipt.frame_types.slice(0,3):[],
   error_code:receipt.error_code??null,
   finished_at:new Date().toISOString()};
  await this.ctx.storage.put(CLAIM,result);
  this.bridgeKeys=undefined;
  console.log('BUFFALO_BRIDGE_ONE_SHOT_RECEIPT '+JSON.stringify(result));
  return result;
 }
 async readBridgeOnce(){
  return await this.ctx.storage.get(CLAIM)??{status:'NOT_RUN'};
 }
}

/** This named entrypoint is callable only through an explicitly configured
 * private Worker service binding. It exposes no public URL. */
export class BridgeProbePort extends WorkerEntrypoint {
 /** Read-only claim inspection: wakes the DO, NEVER starts its Container. */
 async readBridgeOnce(){
  if(this.env.BUFFALO_PROBE_MODE!=='ONE_SHOT_NO_INFERENCE')
   throw Error('BRIDGE_PROBE_DISABLED');
  const claim=await this.env.BUFFALO_CONTAINER.getByName(INSTANCE).readBridgeOnce();
  const status=claim?.status;
  return {status:typeof status==='string'&&[
   'NOT_RUN','CLAIMED','BRIDGE_PROBE_PREPARE_FAILED',
   'REAL_BRIDGE_HANDSHAKE_PASS','REAL_BRIDGE_HANDSHAKE_FAILED'
  ].includes(status)?status:'UNRECOGNIZED_CLAIM'};
 }
 async prepareBridgeOnce(){
  await sourceAllowsProbe(this.env);
  const result=await this.env.BUFFALO_CONTAINER.getByName(INSTANCE).prepareBridgeOnce();
  if(result.status!=='ALREADY_CLAIMED_NO_RETRY'){
   // Do not persist auth/upgrade values from READY. Only the claim state.
   await persistBridgeReceipt(this.env.DB,{
    status:result.status==='READY'?'BRIDGE_PROBE_PREPARED':result.status,
    source_commit:SOURCE,handoff_id:HANDOFF,model_sha256:MODEL,
    phase:'PREPARE',error_code:result.error_code??null
   });
  }
  return result;
 }
 async fetch(request) {
  if(this.env.BUFFALO_PROBE_MODE!=='ONE_SHOT_NO_INFERENCE')return DENIED();
  if(!requestAllowed(request))return DENIED();
  return this.env.BUFFALO_CONTAINER.getByName(INSTANCE).fetch(request);
 }
 async finishBridgeOnce(receipt) {
  if(this.env.BUFFALO_PROBE_MODE!=='ONE_SHOT_NO_INFERENCE')
   throw Error('BRIDGE_PROBE_DISABLED');
  const result=await this.env.BUFFALO_CONTAINER.getByName(INSTANCE).finishBridgeOnce(receipt);
  if(result.status==='NO_ACTIVE_BRIDGE_CLAIM')return result;
  await persistBridgeReceipt(this.env.DB,result);
  return {status:result.status};
 }
}
export default {fetch:original.fetch};
