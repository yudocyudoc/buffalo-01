/**
 * Buffalo stage 3B-3 — isolated Worker-side WebSocket bridge.
 *
 * NEVER enabled for paid chat. The ORIGINAL Buffalo /api/v1 WebSocket protocol
 * runs behind a private service binding. No arbitrary URL, no inference grant.
 * Stage 3B-2 OriginalHandshakeFrameGate is the *exact* frame policy.
 *
 * To deploy: main module + original-ws-handshake-gate.mjs as ES modules;
 * node:crypto supported by Workers on compatibility date >= 2026-08-04.
 * Origin binding must be a private service that runs original Buffalo with
 * agent process spawning disabled for this handshake-only laboratory.
 */
import {OriginalHandshakeFrameGate} from '../../scripts/full-integration/original-ws-handshake-gate.mjs';

export const BRIDGE_SCHEMA='BUFFALO_ORIGINAL_WS_WORKER_BRIDGE_LAB_V1';
const ID='6bce82ee-d179-4a2e-9317-f7f4708c5be2';
const ORIGINAL_PATH='/api/v1';
const REJECTED=new Set([1004,1005,1006,1015]);
const json=(error,status=403)=>Response.json({
 schema:BRIDGE_SCHEMA,error,bridge_started:false,agent_executed:false,
 provider_requests:0
},{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const regex40=/^[a-f0-9]{40}$/;
const regex64=/^[a-f0-9]{64}$/;
const safeClose=(ws,code=1008,reason='POLICY_DENIED')=>{
 try{
  if(ws.readyState===3)return;
  ws.close(REJECTED.has(code)||code<1000||code>=5000?1011:code,
   String(reason).slice(0,90));
 }catch{try{ws.close()}catch{}}
};
async function authorize(request,secret){
 if(typeof secret!=='string'||secret.length<32)return false;
 const value=request.headers.get('authorization')??'';
 const provided=value.startsWith('Bearer ')?value.slice(7):'';
 const a=new TextEncoder();
 const [x,y]=await Promise.all([
  crypto.subtle.digest('SHA-256',a.encode(provided)),
  crypto.subtle.digest('SHA-256',a.encode(secret))
 ]);
 const u=new Uint8Array(x),v=new Uint8Array(y);
 let diff=provided.length===secret.length?0:1;
 for(let i=0;i<u.length;i++)diff|=u[i]^v[i];
 return diff===0;
}
async function readVerifiedSource(db,commit){
 if(!db?.prepare||!regex40.test(commit??''))return null;
 const sql=[
  'SELECT h.handoff_id,h.agent,h.mode,h.commit_sha,',
  'h.initial_model_sha256,h.manifest_sha256,',
  'a.proof_status,a.commit_sha AS proof_commit_sha,',
  'a.manifest_sha256 AS proof_manifest_sha256',
  'FROM buffalo_full_handoffs h',
  'JOIN buffalo_full_source_attestations a ON a.handoff_id=h.handoff_id',
  'WHERE h.handoff_id=?'
 ].join(' ');
 const row=await db.prepare(sql).bind(ID).first();
 if(!row||row.handoff_id!==ID||row.agent!=='merlin'||
  row.mode!=='sfd'||!regex64.test(row.initial_model_sha256??'')||
  !regex64.test(row.manifest_sha256??'')||
  row.proof_status!=='SOURCE_ATTESTED'||row.commit_sha!==commit||
  row.proof_commit_sha!==commit||
  row.proof_manifest_sha256!==row.manifest_sha256)return null;
 return {modelSha256:row.initial_model_sha256,commit};
}
/** Separate test seam. Native Workers have WebSocketPair and Response(101). */
export function linkOriginalSockets(browser,origin,gate){
 let stopped=false;
 const finish=(code=1000,reason='CLOSED')=>{
  if(stopped)return;
  stopped=true;
  safeClose(browser,code,reason);
  safeClose(origin,code,reason);
 };
 const wire=(source,target,filter)=>{
  source.addEventListener('message',event=>{
   if(stopped)return;
   // The existing frame gate denies binary/oversized/invalid payloads.
   let verdict;
   try{verdict=filter.call(gate,event.data)}
   catch{finish(1008,'FRAME_VALIDATION_ERROR');return}
   if(!verdict?.allowed){finish(1008,'FRAME_REJECTED');return}
   try{target.send(verdict.body)}catch{finish(1011,'RELAY_FAILED')}
  });
  source.addEventListener('close',event=>
   finish(Number(event?.code)||1000,String(event?.reason||'CLOSED')));
  source.addEventListener('error',()=>finish(1011,'UPSTREAM_ERROR'));
 };
 wire(browser,origin,gate.fromClient);
 wire(origin,browser,gate.fromBuffalo);
 browser.accept({allowHalfOpen:true});
 origin.accept({allowHalfOpen:true});
 return {close:finish,snapshot:()=>gate.snapshot()};
}
export async function handleOriginalWorkerBridge(request,env,deps={}){
 const url=new URL(request.url);
 if(url.pathname!=='/v1/lab/original-ws'||url.search)return json('NOT_FOUND',404);
 if(request.method!=='GET')return json('METHOD_NOT_ALLOWED',405);
 if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')
  return json('WEBSOCKET_REQUIRED',426);
 if(request.headers.get('sec-websocket-protocol'))
  return json('SUBPROTOCOL_NOT_ALLOWED',400);
 if(!await authorize(request,env.BUFFALO_WS_LAB_BEARER))
  return json('UNAUTHORIZED',401);
 // A D1 source attestation is NOT permission for inference. This private
 // endpoint only authorizes the original no-inference handshake.
 if(env.BUFFALO_WS_LAB_MODE!=='HANDSHAKE_ONLY_NO_AGENT_PROCESS'||
    !env.BUFFALO_ORIGIN?.fetch||
    typeof env.BUFFALO_ORIGIN_AUTH_KEY!=='string'||
    env.BUFFALO_ORIGIN_AUTH_KEY.length<32)
  return json('NO_SAFE_ORIGIN_CONFIGURED',503);
 let source;
 try{source=await readVerifiedSource(env.DB,env.BUFFALO_RUNTIME_COMMIT_SHA)}
 catch{return json('SOURCE_LOOKUP_FAILED',503)}
 if(!source)return json('ORIGINAL_SOURCE_NOT_ATTESTED_FOR_RUNTIME',403);
 const pairFactory=deps.newPair??(()=>new WebSocketPair());
 const upgradeResponse=deps.upgradeResponse??(ws=>
  new Response(null,{status:101,webSocket:ws}));
 // Binding is fixed by deployment. Client cannot provide a URL or headers
 // for the upstream private runtime, nor learn the origin authentication key.
 let response;
 try{
  response=await env.BUFFALO_ORIGIN.fetch(new Request(
   'https://buffalo-internal.invalid'+ORIGINAL_PATH,
   {method:'GET',headers:{Upgrade:'websocket'}}));
 }catch{return json('ORIGIN_CONNECTION_FAILED',503)}
 if(response?.status!==101||!response.webSocket)
  return json('ORIGIN_WEBSOCKET_UNAVAILABLE',503);
 let pair,relay;
 try{
  pair=Object.values(pairFactory());
  if(pair.length!==2)throw Error('INVALID_PAIR');
  const gate=new OriginalHandshakeFrameGate({
   modelSha256:source.modelSha256,
   authenticationKey:env.BUFFALO_ORIGIN_AUTH_KEY,
   clientId:'buffalo-worker-'+crypto.randomUUID()
  });
  relay=linkOriginalSockets(pair[1],response.webSocket,gate);
  return upgradeResponse(pair[0]);
 }catch{
  relay?.close(1011,'BRIDGE_CREATION_FAILED');
  safeClose(response.webSocket,1011,'BRIDGE_CREATION_FAILED');
  return json('BRIDGE_CREATION_FAILED',503);
 }
}
export default {fetch:handleOriginalWorkerBridge};
