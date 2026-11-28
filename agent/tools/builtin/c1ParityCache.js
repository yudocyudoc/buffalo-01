// Experimental cache boundary, only enabled by the isolated C1-Parity runner.
// In-memory receipts belong to the actual session object, not to writable files.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const states=new WeakMap();
const require=(ok,code)=>{if(!ok)throw Error(code);};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const strictCacheEnabled=()=>process.env.C1_PARITY_STRICT_CACHE==='true';
export const demandEnabled=()=>strictCacheEnabled()&&process.env.C1_PARITY_FEEDBACK_DEMAND==='true';
function state(session){let s=states.get(session);if(!s){s={busy:false};states.set(session,s);}return s;}
export function cacheLease(session){
 const s=state(session);require(!s.busy,'C1_CACHE_BUSY');s.busy=true;return ()=>{s.busy=false;};
}
export function cacheModelHash(manager,id){
 const model=manager.getClientModel(id);require(model&&typeof model==='object','C1_CACHE_MODEL_MISSING');return hash(model);
}
export function explicitRun(ids){
 require(Array.isArray(ids)&&ids.length===1&&typeof ids[0]==='string'&&ids[0].length>0,'C1_CACHE_EXPLICIT_SINGLE_RUN_REQUIRED');
 return ids[0];
}
export function invalidateCacheSlot(session,kind){delete state(session)[kind];}
function validBehavior(data,runId){
 require(data&&typeof data==='object'&&!Array.isArray(data)&&Object.keys(data).length===1&&Object.hasOwn(data,runId),'C1_CACHE_BEHAVIOR_RUN_MISMATCH');
 const b=data[runId];const t=b?.time;
 require(b&&Array.isArray(t)&&t.length>0&&t.every((v,i)=>Number.isFinite(v)&&(i===0||v>t[i-1])),'C1_CACHE_GRID_INVALID');
 const keys=Object.keys(b).filter(k=>k!=='time');
 require(keys.length>0&&keys.every(k=>Array.isArray(b[k])&&b[k].length===t.length&&b[k].every(Number.isFinite)),'C1_CACHE_COLUMNS_INVALID');
 return b;
}
function validFeedback(data,runId){
 require(data&&explicitRun(data.runIds)===runId,'C1_CACHE_FEEDBACK_RUN_MISMATCH');
 const p=data.feedbackContent?.provenance;
 require(p?.run_id===runId&&hex(p.run_sha256)&&hex(p.model_sha256)&&Number.isSafeInteger(p.revision)&&p.revision>0,'C1_CACHE_FEEDBACK_PROVENANCE_INVALID');
 return data.feedbackContent;
}
// Capture the exact session-model serialization at acquisition (not the raw
// persisted SD-JSON digest, which belongs to the native client's source receipt).
export function recordCache(manager,id,session,kind,runId,modelHash,filename,data){
 require(cacheModelHash(manager,id)===modelHash,'C1_CACHE_MODEL_CHANGED');
 if(kind==='feedback')validFeedback(data,runId);else validBehavior(data,runId);
 const saved=JSON.parse(readFileSync(join(manager.getSessionTempDir(id),filename),'utf8'));
 require(hash(saved)===hash(data),'C1_CACHE_WRITE_MISMATCH');
 state(session)[kind]={runId,modelHash,filename,payloadHash:hash(data)};
}
export function loadBoundCache(manager,id,session,ids,{allowMissingFeedback=false}={}){
 const runId=explicitRun(ids),s=state(session),modelHash=cacheModelHash(manager,id);
 // Only a genuinely absent receipt may trigger recovery; an invalid or
 // mismatched registered receipt is never treated as a cache miss.
 require(s.behavior&&(s.feedback||allowMissingFeedback),'C1_CACHE_EVIDENCE_MISSING');
 const get=kind=>{
  const r=s[kind];
  require(r.runId===runId,'C1_CACHE_'+kind.toUpperCase()+'_RUN_MISMATCH');
  require(r.modelHash===modelHash,'C1_CACHE_MODEL_CHANGED');
  const data=JSON.parse(readFileSync(join(manager.getSessionTempDir(id),r.filename),'utf8'));
  require(hash(data)===r.payloadHash,'C1_CACHE_PAYLOAD_CHANGED');
  return data;
 };
 const feedbackContent=s.feedback?validFeedback(get('feedback'),runId):undefined;
 const behaviorContent=JSON.stringify(validBehavior(get('behavior'),runId));
 return {feedbackContent,behaviorContent};
}
