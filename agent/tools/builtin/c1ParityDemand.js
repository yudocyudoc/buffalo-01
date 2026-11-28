// Called while the consumer holds the session cache lease. Register the
// resolver before sending so an immediate IPC response cannot be lost.
import { createFeedbackRequestMessage } from '../../utilities/MessageProtocol.js';
import { generateRequestId } from './toolHelpers.js';
import { cacheModelHash, explicitRun, loadBoundCache, recordCache } from './c1ParityCache.js';

export async function recoverBoundFeedback(manager,id,session,ids,modelHash,sendToClient,{timeoutMs=30000}={}){
 const runId=explicitRun(ids);
 const before=loadBoundCache(manager,id,session,ids,{allowMissingFeedback:true});
 if(before.feedbackContent)throw Error('C1_DEMAND_NOT_MISSING');
 if(cacheModelHash(manager,id)!==modelHash)throw Error('C1_CACHE_MODEL_CHANGED');
 const requestId=generateRequestId('feedback');
 const pending=session.pendingFeedbackRequests??=new Map();
 let timer,entry;
 // AgentWorker clears entry.timeout upon reply, so keep a separate deadline
 // for the combined send/reply operation.
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('C1_DEMAND_TIMEOUT')),timeoutMs);});
 const response=new Promise((resolve,reject)=>{
  entry={resolve,reject,timeout:null};pending.set(requestId,entry);
 });
 try{
  // Promise.all installs rejection handlers on both promises before send;
  // timeout also bounds a send that never settles.
  const [data]=await Promise.race([deadline,Promise.all([response,Promise.resolve().then(()=>sendToClient(createFeedbackRequestMessage(id,requestId,[runId])))])]);
  if(cacheModelHash(manager,id)!==modelHash)throw Error('C1_CACHE_MODEL_CHANGED');
  // Recheck registered behavior before recording new feedback.
  const after=loadBoundCache(manager,id,session,ids,{allowMissingFeedback:true});
  if(after.behaviorContent!==before.behaviorContent||after.feedbackContent)throw Error('C1_DEMAND_EVIDENCE_CHANGED');
  const payload={feedbackContent:data?.feedbackContent,runIds:data?.runIds};
  // Validate before touching the cache file.
  if(!Array.isArray(payload.runIds)||payload.runIds.length!==1||payload.runIds[0]!==runId)throw Error('C1_CACHE_FEEDBACK_RUN_MISMATCH');
  const p=payload.feedbackContent?.provenance;
  if(p?.run_id!==runId||typeof p.run_sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.run_sha256)||typeof p.model_sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.model_sha256)||!Number.isSafeInteger(p.revision)||p.revision<1)throw Error('C1_CACHE_FEEDBACK_PROVENANCE_INVALID');
  manager.writeDataToDisk(id,'feedback.json',payload);
  recordCache(manager,id,session,'feedback',runId,modelHash,'feedback.json',payload);
  return loadBoundCache(manager,id,session,ids);
 }finally{
  clearTimeout(timer);
  if(pending.get(requestId)===entry)pending.delete(requestId);
 }
}
