// Explicit Buffalo adapter; no claim of Stella comparative wire equivalence.
// Request exactly the bound pair, validate each native document separately.
import {createFeedbackRequestMessage} from '../../utilities/MessageProtocol.js';
import {generateRequestId} from './toolHelpers.js';
import {comparisonManifest,comparisonHash,loadComparisonCache} from './c1ParityComparison.js';
import {cacheModelHash} from './c1ParityCache.js';
const check=(ok,code)=>{if(!ok)throw Error(code);};
const eq=(a,b)=>comparisonHash(a)===comparisonHash(b);
export function validateComparativeFeedback(data,manifest){
 const ids=manifest.runs.map(r=>r.run_id);
 check(data&&eq(data.runIds,ids)&&Array.isArray(data.feedbackContent)&&data.feedbackContent.length===2,'C1_PAIR_FEEDBACK_ORDER_MISMATCH');
 const content=data.feedbackContent;
 check(Buffer.byteLength(JSON.stringify(content),'utf8')<=64*1024,'C1_PAIR_FEEDBACK_TOO_LARGE');
 for(const [i,f] of content.entries()){
  const r=manifest.runs[i],p=f?.provenance;
  check(p?.run_id===r.run_id&&p.run_sha256===r.run_sha256&&p.model_sha256===r.model_sha256&&p.revision===r.revision&&p.engine===r.simulator.name&&p.version===r.simulator.version,'C1_PAIR_FEEDBACK_IDENTITY_MISMATCH');
  check(f.valid===true&&Array.isArray(f.feedbackLoops)&&f.feedbackLoops.length>0&&Array.isArray(f.dominantLoopsByPeriod)&&f.dominantLoopsByPeriod.length>0&&Array.isArray(f.scoreTimes)&&f.scoreTimes.length>0&&f.scoreTimes.length<=100&&f.scoreTimes.every((t,j)=>Number.isFinite(t)&&(j===0||t>f.scoreTimes[j-1]))&&Number.isSafeInteger(f.activitySamples)&&f.activitySamples>=f.scoreTimes.length&&f.normalization==='sum of absolute native loop scores within each Simlin partition at the same time'&&f.dominanceRule==='pysimlin 0.8.5 Run.dominant_periods','C1_PAIR_FEEDBACK_SHAPE_INVALID');
  const loops=new Map();
  for(const l of f.feedbackLoops){
   check(typeof l.identifier==='string'&&!loops.has(l.identifier)&&Array.isArray(l.links)&&l.links.length>0&&Array.isArray(l.signedRelativeScores)&&l.signedRelativeScores.length===f.scoreTimes.length&&l.signedRelativeScores.every(v=>Number.isFinite(v)&&Math.abs(v)<=1+1e-12),'C1_PAIR_FEEDBACK_LOOP_INVALID');
   loops.set(l.identifier,l);
  }
  for(const period of f.dominantLoopsByPeriod){
   check(Number.isFinite(period.startTime)&&Number.isFinite(period.endTime)&&period.startTime<=period.endTime&&period.startTime>=r.settings.startTime&&period.endTime<=r.settings.stopTime&&Array.isArray(period.dominantLoops)&&period.dominantLoops.length>0&&new Set(period.dominantLoops).size===period.dominantLoops.length&&period.dominantLoops.every(id=>loops.has(id)&&loops.get(id).partition===period.partition),'C1_PAIR_FEEDBACK_PERIOD_INVALID');
  }
  check(comparisonHash(f)===manifest.feedback_sha256[i],'C1_PAIR_FEEDBACK_PAYLOAD_MISMATCH');
 }
 check(eq(content[0].scoreTimes,content[1].scoreTimes)&&content[0].activitySamples===content[1].activitySamples,'C1_PAIR_FEEDBACK_GRID_MISMATCH');
 return structuredClone(content);
}
// Caller holds comparison lease. No global feedback.json cache, no single-run
// slot reuse. At most one paired acquisition per handler invocation.
export async function recoverComparativeFeedback(manager,id,session,ids,runName,modelHash,send,{timeoutMs=30000}={}){
 const before=loadComparisonCache(manager,id,session,ids,runName);
 const manifest=structuredClone(comparisonManifest(manager,id,session,ids));
 check(cacheModelHash(manager,id)===modelHash,'C1_CACHE_MODEL_CHANGED');
 const requestId=generateRequestId('feedback'),pending=session.pendingFeedbackRequests??=new Map();
 let timer,entry;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('C1_PAIR_FEEDBACK_TIMEOUT')),timeoutMs);});
 const response=new Promise((resolve,reject)=>{entry={resolve,reject,timeout:null};pending.set(requestId,entry);});
 try{
  const [data]=await Promise.race([deadline,Promise.all([response,Promise.resolve().then(()=>send(createFeedbackRequestMessage(id,requestId,[...ids])))])]);
  check(cacheModelHash(manager,id)===modelHash,'C1_CACHE_MODEL_CHANGED');
  const after=loadComparisonCache(manager,id,session,ids,runName);
  check(eq(before,after)&&eq(manifest,comparisonManifest(manager,id,session,ids)),'C1_PAIR_FEEDBACK_CONTEXT_CHANGED');
  return validateComparativeFeedback(data,manifest);
 }finally{clearTimeout(timer);if(pending.get(requestId)===entry)pending.delete(requestId);}
}
