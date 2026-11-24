/**
 * Stage 3B-8/P — fail-closed *offline* policy for selection of the ORIGINAL
 * Merlin process. This is not a deployed Worker, a live grant, or a chat gate.
 *
 * IMPORTANT: Original WebSocketHandler prewarms WorkerSpawner on initialize,
 * before select_agent. Process approval must precede initialization.
 *
 * 3B-7's OriginalHandshakeFrameGate remains unchanged and never allows chat.
 */
import {createHash} from 'node:crypto';

export const MERLIN_PROCESS_GATE_SCHEMA='BUFFALO_STAGE3B8_OFFLINE_PROCESS_GATE_V1';
const LIMIT=262144;
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const initKeys=new Set(['type','clientProduct','clientVersion','mode','model','tools',
 'supportsArrays','supportsModules','supportsSubTypes']);
const selectKeys=new Set(['type','sessionId','agentId','provider']);
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const denied=reason=>({allowed:false,reason});
const allowed=body=>({allowed:true,reason:'OFFLINE_PROCESS_FRAME_ACCEPTED',body});

export class OriginalMerlinProcessGate{
 constructor({sourceCommit,runtimeCommit,modelSha256,authenticationKey,clientId,
  processApproved=false}={}){
  if(!SHA40.test(sourceCommit??'')||runtimeCommit!==sourceCommit||
     !SHA64.test(modelSha256??'')||
     typeof authenticationKey!=='string'||authenticationKey.length<32||
     typeof clientId!=='string'||!/^buffalo-worker-[a-z0-9-]{8,70}$/.test(clientId))
   throw Error('3B8_PROCESS_GATE_IDENTITY_REQUIRED');
  this.modelSha256=modelSha256;
  this.authenticationKey=authenticationKey;
  this.clientId=clientId;
  this.sourceCommit=sourceCommit;
  // This boolean is injected by the trusted OFFLINE test harness, never from
  // the network. In a future remote runtime it requires an independent grant.
  this.processApproved=processApproved===true;
  this.state='AWAIT_CREATED';
  this.sessionId=null;
  this.inbound=0;this.outbound=0;
 }
 #parse(frame,prefix){
  if(typeof frame!=='string'||Buffer.byteLength(frame,'utf8')>LIMIT)
   return {error:prefix+'_OVERSIZE_OR_BINARY'};
  let value;
  try{value=JSON.parse(frame)}catch{return {error:prefix+'_INVALID_JSON'}}
  if(!value||typeof value!=='object'||Array.isArray(value))
   return {error:prefix+'_INVALID_SHAPE'};
  return {value};
 }
 fromBuffalo(frame){
  const parsed=this.#parse(frame,'ORIGIN');
  if(parsed.error)return denied(parsed.error);
  const m=parsed.value;
  if(this.state==='AWAIT_CREATED'&&m.type==='session_created'&&
     UUID.test(m.sessionId??'')){
   this.sessionId=m.sessionId;
   this.state='AWAIT_INIT';
  }else if(this.state==='AWAIT_READY'&&m.type==='session_ready'&&
     m.sessionId===this.sessionId){
   this.state='READY_FOR_SELECT';
  }else if(this.state==='AWAIT_SELECTED'&&m.type==='agent_selected'&&
     m.sessionId===this.sessionId&&m.agentId==='merlin'&&m.currentProvider==='cloudflare'){
   this.state='SELECTED_NO_CHAT';
  }else if(this.state==='SELECTED_NO_CHAT'&&m.type==='agent_text'&&
     m.sessionId===this.sessionId&&m.isThinking===false&&
     typeof m.content==='string'&&
     /^Merlin \([^\r\n]{1,72}\) — What can I do for you today\?$/.test(m.content)){
   // Fixed welcome sent by WebSocketHandler, *not* a model output.
  }else if(m.type==='error'&&m.sessionId===this.sessionId&&
     this.state==='AWAIT_SELECTED'&&m.errorCode==='AGENT_SELECTION_ERROR'){
   this.state='SELECTION_ERROR';
  }else return denied('ORIGIN_FRAME_NOT_ALLOWED_IN_'+this.state);
  this.outbound++;
  return allowed(frame);
 }
 fromClient(frame){
  const parsed=this.#parse(frame,'CLIENT');
  if(parsed.error)return denied(parsed.error);
  const m=parsed.value;
  if(m.type==='initialize_session'&&this.state==='AWAIT_INIT'){
   // The genuine handler performs a process prewarm at initialization.
   if(!this.processApproved)return denied('PROCESS_NOT_APPROVED_BEFORE_INITIALIZE');
   if(Object.keys(m).some(k=>!initKeys.has(k))||
      m.mode!=='sfd'||!Array.isArray(m.tools)||m.tools.length!==0||
      typeof m.clientProduct!=='string'||m.clientProduct.length===0||
      typeof m.clientVersion!=='string'||m.clientVersion.length===0||
      !m.model||typeof m.model!=='object'||Array.isArray(m.model)||
      digest(m.model)!==this.modelSha256)
     return denied('INITIAL_MODEL_OR_FIELDS_NOT_AUTHORIZED');
   this.state='AWAIT_READY';this.inbound++;
   return allowed(JSON.stringify({...m,authenticationKey:this.authenticationKey,clientId:this.clientId}));
  }
  if(m.type==='select_agent'&&this.state==='READY_FOR_SELECT'){
   if(Object.keys(m).some(k=>!selectKeys.has(k))||
      m.sessionId!==this.sessionId||m.agentId!=='merlin'||m.provider!=='cloudflare')
    return denied('AGENT_SELECTION_NOT_AUTHORIZED');
   this.state='AWAIT_SELECTED';this.inbound++;
   return allowed(frame);
  }
  if(m.type==='disconnect'&&this.sessionId&&
     this.state!=='AWAIT_CREATED'&&this.state!=='CLOSING'&&
     Object.keys(m).every(k=>k==='type'||k==='sessionId')&&
     m.sessionId===this.sessionId){
   this.state='CLOSING';this.inbound++;
   return allowed(frame);
  }
  if(m.type==='chat'||m.type==='tool_call_response'||m.type==='update_model'||
     m.type==='run_model'||m.type==='select_agent')
   return denied('INFERENCE_OR_MUTATION_NOT_AUTHORIZED_IN_P');
  return denied('CLIENT_FRAME_NOT_ALLOWED_IN_'+this.state);
 }
 snapshot(){return Object.freeze({
  schema:MERLIN_PROCESS_GATE_SCHEMA,source_commit:this.sourceCommit,
  model_sha256:this.modelSha256,state:this.state,
  process_preflight_approved:this.processApproved,
  process_execution_verified:false,provider_inference_authorized:false,
  agent_turn_executed:false,provider_requests_measured:false,
  inbound_frames:this.inbound,outbound_frames:this.outbound
 });}
}
