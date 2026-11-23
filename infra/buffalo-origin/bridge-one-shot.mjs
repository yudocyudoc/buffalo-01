/**
 * Stage 3B-7 private scheduled bridge client. Uses the ORIGINAL Worker-side
 * OriginalHandshakeFrameGate via handleOriginalWorkerBridge. No public fetch.
 * Does not transmit credentials to clients, logs or D1.
 */
import {handleOriginalWorkerBridge} from '../../workers/buffalo-control-plane/original-ws-bridge-lab.mjs';
import model from './probe-initial-model.json';

const COMMIT='a8b1ad0c02d5c3367bd24962e8fd36d277a8135d';
const MODEL='57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39';
const HANDOFF='f9c4db4e-aa31-4b2a-921e-201a5a79fd37';
const MODE='HANDSHAKE_ONLY_NO_AGENT_PROCESS';
const PING='ONE_SHOT_PRIVATE_BRIDGE_NO_INFERENCE';
const randomSecret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),
 x=>x.toString(16).padStart(2,'0')).join('');
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
function safeError(e){return String(e?.message??'UNKNOWN').replace(/[^A-Z0-9_]/gi,'_').slice(0,85)}
export async function bridgePreflight(env) {
 if(env.BUFFALO_BRIDGE_PROBE_MODE!==PING||
    env.BUFFALO_WS_LAB_MODE!==MODE||
    env.BUFFALO_RUNTIME_COMMIT_SHA!==COMMIT||
    env.BUFFALO_LAB_HANDOFF_ID!==HANDOFF||
    !env.DB?.prepare||!env.BUFFALO_ORIGIN?.prepareBridgeOnce||
    !env.BUFFALO_ORIGIN?.fetch||!env.BUFFALO_ORIGIN?.finishBridgeOnce)
  throw Error('BRIDGE_PROBE_CONFIG_DENIED');
 if(await digest(model)!==MODEL)throw Error('BRIDGE_PROBE_MODEL_DIGEST_MISMATCH');
 const row=await env.DB.prepare(
  'SELECT h.handoff_id,h.agent,h.mode,h.commit_sha,h.initial_model_sha256,'+
  'h.manifest_sha256,h.execution_allowed,a.proof_status,'+
  'a.commit_sha AS proof_commit_sha,a.manifest_sha256 AS proof_manifest_sha256,'+
  'a.execution_allowed AS proof_execution_allowed '+
  'FROM buffalo_full_handoffs h JOIN buffalo_full_source_attestations a '+
  'ON a.handoff_id=h.handoff_id WHERE h.handoff_id=?'
 ).bind(HANDOFF).first();
 if(!row||row.handoff_id!==HANDOFF||row.agent!=='merlin'||row.mode!=='sfd'||
    row.commit_sha!==COMMIT||row.proof_commit_sha!==COMMIT||
    row.initial_model_sha256!==MODEL||row.proof_status!=='SOURCE_ATTESTED'||
    row.proof_manifest_sha256!==row.manifest_sha256||
    Number(row.execution_allowed)!==0||Number(row.proof_execution_allowed)!==0)
  throw Error('BRIDGE_PROBE_SOURCE_DENIED');
 const grants=await env.DB.prepare('SELECT COUNT(*) AS n FROM buffalo_full_live_grants').first();
 if(Number(grants?.n)!==0)throw Error('BRIDGE_PROBE_INFERENCE_GRANT_FOUND');
 return true;
}
export function handshakeBridgeSocket(ws) {
 return new Promise((resolve,reject)=>{
  let created=null,ready=false,disconnectSent=false,finished=false;
  const types=[];
  const timer=setTimeout(()=>finish(Error('BRIDGE_SOCKET_TIMEOUT')),30_000);
  function finish(error) {
   if(finished)return;
   finished=true;clearTimeout(timer);
   try{if(ws.readyState!==3)ws.close()}catch{}
   if(error)reject(error);
   else resolve({status:'REAL_BRIDGE_HANDSHAKE_PASS',http_101:true,
    session_created:!!created,session_ready:ready,disconnect_sent:disconnectSent,
    connection_closed:true,frame_types:types});
  }
  ws.addEventListener('message',e=>{
   let msg;
   try{msg=JSON.parse(e.data)}catch{finish(Error('BRIDGE_FRAME_BAD_JSON'));return;}
   if(!msg||typeof msg.type!=='string'){finish(Error('BRIDGE_FRAME_BAD_TYPE'));return;}
   types.push(msg.type);
   if(msg.type==='session_created'&&!created&&typeof msg.sessionId==='string'){
    created=msg.sessionId;
    // Gate injects auth key and client ID; probe does not provide them.
    ws.send(JSON.stringify({
     type:'initialize_session',clientProduct:'Buffalo private bridge canary',
     clientVersion:'1.0.0',mode:'sfd',model,tools:[],
     supportsArrays:true,supportsModules:false,supportsSubTypes:false
    }));
   }else if(msg.type==='session_ready'&&msg.sessionId===created&&!ready){
    ready=true;disconnectSent=true;
    ws.send(JSON.stringify({type:'disconnect',sessionId:created}));
   }else{finish(Error('BRIDGE_UNEXPECTED_ORIGINAL_FRAME'));}
  });
  ws.addEventListener('close',()=>finish(
   created&&ready&&disconnectSent?null:Error('BRIDGE_SOCKET_CLOSED_EARLY')
  ));
  ws.addEventListener('error',()=>finish(Error('BRIDGE_SOCKET_ERROR')));
  ws.accept();
 });
}
export async function runPrivateBridgeOnce(env){
 await bridgePreflight(env);
 const granted=await env.BUFFALO_ORIGIN.prepareBridgeOnce();
 if(granted?.status!=='READY')
  return {status:granted?.status??'BRIDGE_PROBE_NOT_READY'};
 let receipt;
 try{
  if(typeof granted.auth!=='string'||granted.auth.length<32||
     typeof granted.upgrade!=='string'||granted.upgrade.length<32||
     granted.auth===granted.upgrade)throw Error('BRIDGE_BAD_EPHEMERAL_CREDENTIALS');
  const bearer=randomSecret();
  const sessionEnv={DB:env.DB,BUFFALO_ORIGIN:env.BUFFALO_ORIGIN,
   BUFFALO_WS_LAB_MODE:MODE,BUFFALO_LAB_HANDOFF_ID:HANDOFF,
   BUFFALO_RUNTIME_COMMIT_SHA:COMMIT,BUFFALO_WS_LAB_BEARER:bearer,
   BUFFALO_ORIGIN_AUTH_KEY:granted.auth,
   BUFFALO_ORIGIN_UPGRADE_TOKEN:granted.upgrade};
  const request=new Request('https://buffalo-internal.invalid/v1/lab/original-ws',{
   method:'GET',headers:{Upgrade:'websocket',Authorization:'Bearer '+bearer}
  });
  const response=await handleOriginalWorkerBridge(request,sessionEnv);
  if(response.status!==101||!response.webSocket)
   throw Error('BRIDGE_NO_HTTP_101_'+response.status);
  receipt=await handshakeBridgeSocket(response.webSocket);
 }catch(e){
  receipt={status:'REAL_BRIDGE_HANDSHAKE_FAILED',error_code:safeError(e)};
 }
 // Write only non-secret evidence; a failed transport must not be hidden by CI.
 const saved=await env.BUFFALO_ORIGIN.finishBridgeOnce(receipt);
 if(saved?.status!==receipt.status)throw Error('BRIDGE_RECEIPT_NOT_PERSISTED');
 console.log('BUFFALO_PRIVATE_BRIDGE_ONE_SHOT '+JSON.stringify(receipt));
 return receipt;
}
export default {
 fetch(){return new Response('Not Found',{status:404})},
 async scheduled(_event,env){
  if(env.BUFFALO_BRIDGE_PROBE_MODE!==PING)return;
  const receipt=await runPrivateBridgeOnce(env);
  if(receipt.status!=='REAL_BRIDGE_HANDSHAKE_PASS')
   console.log('BUFFALO_BRIDGE_NEGATIVE_OR_INCOMPLETE '+JSON.stringify(receipt));
 }
};
