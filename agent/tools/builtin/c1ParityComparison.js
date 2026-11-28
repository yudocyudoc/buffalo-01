// Experimental, ordered two-run descriptive comparison. The compatible
// client provides a manifest from immutable project storage; this is not
// independent attestation against a dishonest client.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {SDModelSchema} from '../../utilities/MessageProtocol.js';
import {cacheModelHash,strictCacheEnabled} from './c1ParityCache.js';
const slots=new WeakMap(),check=(ok,code)=>{if(!ok)throw Error(code);};
const hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const comparisonHash=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
export const comparisonEnabled=()=>strictCacheEnabled()&&process.env.C1_PARITY_COMPARISON==='true';
const eq=(a,b)=>comparisonHash(a)===comparisonHash(b);
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const str=x=>typeof x==='string'&&x.trim().length>0&&x.length<=256;
const validModel=x=>SDModelSchema.safeParse(x).success&&Array.isArray(x.variables)&&x.variables.length>0&&x.variables.every(v=>str(v.name)&&str(v.type)&&typeof v.equation==='string')&&new Set(x.variables.map(v=>v.name)).size===x.variables.length;
const validSettings=x=>exact(x,['startTime','stopTime','dt','timeUnits','integrationMethod'])&&[x.startTime,x.stopTime,x.dt].every(Number.isFinite)&&x.stopTime>=x.startTime&&x.dt>0&&str(x.timeUnits)&&str(x.integrationMethod);
const validExecution=x=>exact(x,['integrationMethod','dt'])&&str(x.integrationMethod)&&Number.isFinite(x.dt)&&x.dt>0;
const validSimulator=x=>exact(x,['name','version','source','implementation_sha256'])&&x.source==='server'&&str(x.name)&&str(x.version)&&hex(x.implementation_sha256);
export const MAX_COMPARISON_MANIFEST_BYTES=48*1024;

export function comparisonManifest(manager,id,session,ids){
 const m=session.context?.c1Comparison;
 check(m&&Array.isArray(m.runs)&&m.runs.length===2,'C1_COMPARE_MANIFEST_MISSING');
 check(exact(m,['runs','variables','detailed','behavior_sha256'])&&m.runs.every(r=>exact(r,['run_id','revision','model_sha256','run_sha256','simulator','settings','execution','model'])),'C1_COMPARE_MANIFEST_INVALID');
 check(Buffer.byteLength(JSON.stringify(m),'utf8')<=MAX_COMPARISON_MANIFEST_BYTES,'C1_COMPARE_MANIFEST_TOO_LARGE');
 const pair=m.runs.map(r=>r.run_id);
 check(pair.every(uuid)&&new Set(pair).size===2&&Array.isArray(ids)&&eq(ids,pair),'C1_COMPARE_ORDERED_PAIR_REQUIRED');
 check(m.runs.every(r=>hex(r.model_sha256)&&hex(r.run_sha256)&&Number.isSafeInteger(r.revision)&&r.revision>0&&validSimulator(r.simulator)&&validSettings(r.settings)&&validExecution(r.execution)&&validModel(r.model)&&r.model.specs&&Object.entries(r.settings).every(([k,v])=>r.model.specs[k]===v)),'C1_COMPARE_PROVENANCE_INVALID');
 const [a,b]=m.runs;
 // This pilot is specifically a cross-revision intervention, not replicate runs.
 check(a.revision!==b.revision&&a.model_sha256!==b.model_sha256&&a.run_sha256!==b.run_sha256&&!eq(a.model,b.model),'C1_COMPARE_DISTINCT_REVISIONS_REQUIRED');
 check(eq(a.settings,b.settings)&&eq(a.execution,b.execution)&&eq(a.simulator,b.simulator),'C1_COMPARE_INCOMPATIBLE_RUNS');
 check(eq(SDModelSchema.parse(b.model),SDModelSchema.parse(manager.getClientModel(id))),'C1_COMPARE_CURRENT_MODEL_MISMATCH');
 check(Array.isArray(m.variables)&&m.variables.length>0&&new Set(m.variables).size===m.variables.length&&m.variables.length<=20&&m.variables.every(v=>str(v)&&v.toLowerCase()!=='time'&&m.runs.every(r=>r.model.variables.some(x=>x.name===v)))&&m.detailed===false&&hex(m.behavior_sha256),'C1_COMPARE_MANIFEST_INVALID');
 return m;
}
export function invalidateComparison(session){slots.delete(session);}
export function validatePairData(data,m){
 const ids=m.runs.map(r=>r.run_id);
 check(data&&typeof data==='object'&&Object.keys(data).length===2&&ids.every(id=>Object.hasOwn(data,id)),'C1_COMPARE_BEHAVIOR_PAIR_MISMATCH');
 const [a,b]=ids.map(id=>data[id]);
 const keys=['time',...m.variables].sort();
 for(const x of [a,b]){
  check(x&&eq(Object.keys(x).sort(),keys),'C1_COMPARE_COLUMNS_MISMATCH');
  const t=x.time;
  check(Array.isArray(t)&&t.length>0&&t.length<=50&&t.every((v,i)=>Number.isFinite(v)&&(i===0||v>t[i-1])),'C1_COMPARE_GRID_INVALID');
  check(m.variables.every(k=>Array.isArray(x[k])&&x[k].length===t.length&&x[k].every(Number.isFinite)),'C1_COMPARE_COLUMNS_INVALID');
 }
 check(eq(a.time,b.time),'C1_COMPARE_GRID_MISMATCH');
 check(comparisonHash(data)===m.behavior_sha256,'C1_COMPARE_PAYLOAD_MISMATCH');
}
export function recordComparison(manager,id,session,ids,modelHash,manifestHash,filename,data){
 const m=comparisonManifest(manager,id,session,ids);
 check(cacheModelHash(manager,id)===modelHash&&comparisonHash(m)===manifestHash,'C1_COMPARE_CONTEXT_CHANGED');
 validatePairData(data,m);
 check(eq(JSON.parse(readFileSync(join(manager.getSessionTempDir(id),filename),'utf8')),data),'C1_COMPARE_WRITE_MISMATCH');
 slots.set(session,{modelHash,manifestHash,filename,payloadHash:comparisonHash(data)});
}
export function loadComparisonCache(manager,id,session,ids,runName){
 const m=comparisonManifest(manager,id,session,ids);
 check(runName===ids[1],'C1_COMPARE_CURRENT_RUN_REQUIRED');
 const r=slots.get(session);check(r,'C1_COMPARE_EVIDENCE_MISSING');
 check(cacheModelHash(manager,id)===r.modelHash&&comparisonHash(m)===r.manifestHash,'C1_COMPARE_CONTEXT_CHANGED');
 const data=JSON.parse(readFileSync(join(manager.getSessionTempDir(id),r.filename),'utf8'));
 validatePairData(data,m);check(comparisonHash(data)===r.payloadHash,'C1_COMPARE_PAYLOAD_MISMATCH');
 return {behaviorContent:JSON.stringify(Object.fromEntries(ids.map(k=>[k,data[k]]))),backgroundKnowledge:
 'Two immutable server-simulated runs, ordered baseline then comparison. The current model is the comparison revision only. Historical models and provenance are supplied below. Only sampled behavior is supplied; no comparative feedback/loop scores. Do not invent dominance or claim a causal attribution from the comparison alone.\n'+JSON.stringify(m)};
}
