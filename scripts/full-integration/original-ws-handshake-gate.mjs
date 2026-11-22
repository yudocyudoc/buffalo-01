/**
 * Stage 3B-2 — the ORIGINAL Buffalo WebSocket handshake, fail-closed.
 *
 * This pure policy is only for a no-inference handshake. It is NOT a production
 * chat proxy and will never permit select_agent, chat, custom tools, files,
 * arbitrary histories, client tool results, or provider selection.
 *
 * Source of message names: agent/utilities/MessageProtocol.js (unchanged).
 */
import {createHash} from 'node:crypto';

export const ORIGINAL_WS_HANDSHAKE_SCHEMA='BUFFALO_ORIGINAL_WS_HANDSHAKE_GATE_V1';
export const HANDSHAKE_FRAME_LIMIT=262144; // input model cap; later assess larger originals
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=reason=>({allowed:false,reason});
const pass=body=>({allowed:true,reason:'ALLOW_ORIGINAL_HANDSHAKE',body});

export class OriginalHandshakeFrameGate{
 constructor({modelSha256,authenticationKey,clientId='buffalo-offline-handshake-client'}={}){
  if(!/^[a-f0-9]{64}$/.test(modelSha256??''))throw Error('WS_GATE_MODEL_SHA_REQUIRED');
  if(typeof authenticationKey!=='string'||authenticationKey.length<32)
   throw Error('WS_GATE_ORIGIN_AUTH_REQUIRED');
  if(typeof clientId!=='string'||clientId.length<1||clientId.length>128)
   throw Error('WS_GATE_CLIENT_ID_REQUIRED');
  this.modelSha256=modelSha256;this.authenticationKey=authenticationKey;
  this.clientId=clientId;
  this.serverSessionId=null;this.state='AWAIT_SESSION_CREATED';
  this.inbound=0;this.outbound=0;
 }
 /** Upstream ORIGINAL Buffalo -> client. Observe but never fake a server frame. */
 fromBuffalo(frame){
  if(typeof frame!=='string'||Buffer.byteLength(frame,'utf8')>HANDSHAKE_FRAME_LIMIT)
   return fail('ORIGIN_FRAME_OVERSIZE');
  let message;try{message=JSON.parse(frame)}catch{return fail('ORIGIN_FRAME_INVALID_JSON')}
  if(!message||typeof message!=='object'||Array.isArray(message))
   return fail('ORIGIN_FRAME_INVALID_SHAPE');
  if(this.state==='AWAIT_SESSION_CREATED'&&message.type==='session_created'&&
   typeof message.sessionId==='string'&&message.sessionId.length>0){
   this.serverSessionId=message.sessionId;
   this.state='AWAIT_INITIALIZE';
  }else if(this.state==='AWAIT_SESSION_READY'&&message.type==='session_ready'&&
   message.sessionId===this.serverSessionId){
   this.state='READY_HANDSHAKE_ONLY';
  }else if(message.type==='error'&&
   message.sessionId===this.serverSessionId){
   // Preserve errors exactly as sent by the original Buffalo handler.
  }else{
   return fail('ORIGIN_FRAME_UNEXPECTED_'+String(message.type??'UNKNOWN').replace(/[^A-Z0-9_]/ig,'').slice(0,32));
  }
  this.outbound++;
  return pass(frame);
 }
 /** Client -> ORIGINAL Buffalo. Client never gets to inject origin auth key. */
 fromClient(frame){
  if(typeof frame!=='string'||Buffer.byteLength(frame,'utf8')>HANDSHAKE_FRAME_LIMIT)
   return fail('CLIENT_FRAME_OVERSIZE');
  let body;try{body=JSON.parse(frame)}catch{return fail('CLIENT_FRAME_INVALID_JSON')}
  if(!body||typeof body!=='object'||Array.isArray(body))
   return fail('CLIENT_FRAME_INVALID_SHAPE');
  if(body.type==='initialize_session'&&this.state==='AWAIT_INITIALIZE'){
   if(Object.keys(body).some(k=>![
    'type','clientProduct','clientVersion','mode','model','tools',
    'supportsArrays','supportsModules','supportsSubTypes'
   ].includes(k)))
    return fail('CLIENT_UNAUTHORIZED_INITIALIZE_FIELDS');
   if(body.mode!=='sfd'||!Array.isArray(body.tools)||body.tools.length!==0||
      typeof body.clientProduct!=='string'||body.clientProduct.length<1||
      typeof body.clientVersion!=='string'||body.clientVersion.length<1||
      !body.model||typeof body.model!=='object'||Array.isArray(body.model)||
      digest(body.model)!==this.modelSha256)
    return fail('CLIENT_INITIAL_MODEL_OR_CAPABILITIES_MISMATCH');
   this.state='AWAIT_SESSION_READY';
   this.inbound++;
   return pass(JSON.stringify({...body,authenticationKey:this.authenticationKey,clientId:this.clientId}));
  }
  if(body.type==='disconnect'&&this.state!=='AWAIT_SESSION_CREATED'&&
     body.sessionId===this.serverSessionId){
   this.inbound++;
   this.state='CLOSING';
   return pass(frame);
  }
  if(body.type==='select_agent'||body.type==='chat')
   return fail('INFERENCE_TURN_NOT_AUTHORIZED');
  return fail('CLIENT_FRAME_NOT_ALLOWED_IN_'+this.state);
 }
 snapshot(){
  return Object.freeze({schema:ORIGINAL_WS_HANDSHAKE_SCHEMA,
   state:this.state,inbound_frames:this.inbound,outbound_frames:this.outbound,
   inference_authorized:false,provider_requests:0,agent_turn_executed:false,
   websocket_bridge_enabled:false});
 }
}
