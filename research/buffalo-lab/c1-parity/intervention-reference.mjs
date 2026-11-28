// Research-only reference; no generated prose or planner metadata is trusted.
import {digest} from '../../../infra/full-runtime/provider-wire.mjs';
import {RUN_ID,validRun} from '../../../infra/full-runtime/project-runs.mjs';
import {assessRunFeedback,validFeedback} from '../../../infra/full-runtime/run-narrative.mjs';
import {nativeSelection} from '../../../infra/full-runtime/dominance-evidence.mjs';
import {comparisonHash} from '../../../agent/tools/builtin/c1ParityComparison.js';
const check=(ok,code)=>{if(!ok)throw Error(code);};
const eq=(a,b)=>comparisonHash(a)===comparisonHash(b);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const str=x=>typeof x==='string'&&x.length>0&&x.length<=256;
const partition=x=>x===null||(Number.isSafeInteger(x)&&x>=0);
const keys=(x,ks)=>x&&typeof x==='object'&&!Array.isArray(x)&&ks.every(k=>Object.hasOwn(x,k));
const idOf=l=>'P'+l.partition+'/'+l.id.toUpperCase();
// Rotation only: reversal is a different directed cycle. JSON tuples avoid
// separator collisions. Duplicate canonical cycles are ambiguous, not merged.
export function cycleKey(cycle){
 check(Array.isArray(cycle)&&cycle.length>0&&cycle.every(str)&&new Set(cycle).size===cycle.length,'REFERENCE_CYCLE_INVALID');
 return cycle.map((_,i)=>JSON.stringify(cycle.slice(i).concat(cycle.slice(0,i)))).sort()[0];
}
function intervals(time,sets){
 const out=[];
 for(const [i,t] of time.entries()){
  const s=[...sets[i]].sort(),last=out.at(-1);
  if(last&&eq(last.cycles,s))last.end=t;
  else out.push({start:t,end:t,cycles:s});
 }
 return out;
}
export function projectNativeRecord(runId,run,model,feedback,evidence){
 const time=run.series.time,content=feedback.content;
 check(validRun(run,'server')&&run.simulator.name==='pysimlin'&&run.simulator.version==='0.8.5','REFERENCE_RUN_INVALID');
 check(model.specs&&Object.entries(run.settings).every(([k,v])=>model.specs[k]===v),'REFERENCE_SETTINGS_MISMATCH');
 check(Array.isArray(model.variables)&&model.variables.length>0,'REFERENCE_MODEL_INVALID');
 check(evidence.mode==='exhaustive'&&eq(time,evidence.time)&&Array.isArray(evidence.loops)&&evidence.loops.length>0&&Array.isArray(evidence.periods)&&Array.isArray(evidence.links),'REFERENCE_NATIVE_SHAPE');
 check(validFeedback(content,time),'REFERENCE_FEEDBACK_INVALID');
 const p=content.provenance;
 check(p?.run_id===runId&&p.run_sha256===feedback.run_sha256&&p.model_sha256===run.model_sha256&&p.revision===run.revision&&p.engine===run.simulator.name&&p.version===run.simulator.version,'REFERENCE_FEEDBACK_IDENTITY');
 check(content.normalization==='sum of absolute native loop scores within each Simlin partition at the same time'&&content.dominanceRule==='pysimlin 0.8.5 Run.dominant_periods'&&content.activitySamples===time.length,'REFERENCE_NORMALIZATION');
 const count=Math.min(time.length,100),indices=Array.from({length:count},(_,i)=>count===1?0:Math.round(i*(time.length-1)/(count-1)));
 check(eq(content.scoreTimes,indices.map(i=>time[i])),'REFERENCE_SCORE_GRID');
 const links=new Map();
 for(const e of evidence.links){
  check(keys(e,['from','to','polarity','raw'])&&str(e.from)&&str(e.to)&&typeof e.polarity==='string'&&(e.raw===null||(Array.isArray(e.raw)&&e.raw.length===time.length&&e.raw.every(v=>v===null||Number.isFinite(v)))),'REFERENCE_LINK_INVALID');
  const key=JSON.stringify([e.from,e.to]);check(!links.has(key),'REFERENCE_DUPLICATE_LINK');links.set(key,e);
 }
 const byId=new Map(),byCycle=new Map(),groups=new Map();
 for(const l of evidence.loops){
  check(keys(l,['id','cycle','partition','polarity','signed'])&&str(l.id)&&partition(l.partition)&&['R','B','Rux','Bux','U'].includes(l.polarity)&&Array.isArray(l.signed)&&l.signed.length===time.length&&l.signed.every(v=>Number.isFinite(v)&&Math.abs(v)<=1+1e-12),'REFERENCE_LOOP_INVALID');
  const identifier=idOf(l),key=cycleKey(l.cycle);
  check(!byId.has(identifier)&&!byCycle.has(key),'REFERENCE_AMBIGUOUS_CYCLE');
  const f=content.feedbackLoops.find(x=>x.identifier===identifier);
  check(f&&f.partition===l.partition&&f.nativePolarity===l.polarity&&f.polarity===(({R:'+',B:'-'})[l.polarity]??'')&&eq(f.signedRelativeScores,indices.map(i=>l.signed[i])),'REFERENCE_FEEDBACK_SCORE_MISMATCH');
  check(Array.isArray(f.links)&&f.links.length===l.cycle.length&&f.links.every((e,i)=>e.from===l.cycle[i]&&e.to===l.cycle[(i+1)%l.cycle.length]&&e.polarity===(links.get(JSON.stringify([e.from,e.to]))?.polarity??'?')),'REFERENCE_FEEDBACK_LINK_MISMATCH');
  const row={identifier,key,cycle:[...l.cycle],polarity:l.polarity,partition:l.partition,signed:[...l.signed]};
  byId.set(identifier,row);byCycle.set(key,row);
  const g=l.partition??identifier;if(!groups.has(g))groups.set(g,[]);groups.get(g).push(row);
 }
 check(content.feedbackLoops.length===byId.size,'REFERENCE_FEEDBACK_LOOP_INVENTORY');
 const normalizedPeriods=evidence.periods.map(p=>{
  check(keys(p,['partition','startTime','endTime','dominantLoops'])&&partition(p.partition)&&Array.isArray(p.dominantLoops)&&p.dominantLoops.every(str),'REFERENCE_PERIOD_INVALID');
  return {partition:p.partition,startTime:p.startTime,endTime:p.endTime,dominantLoops:p.dominantLoops.map(id=>'P'+p.partition+'/'+id.toUpperCase())};
 });
 const reported=content.dominantLoopsByPeriod.map(p=>({partition:p.partition,startTime:p.startTime,endTime:p.endTime,dominantLoops:p.dominantLoops}));
 check(eq(normalizedPeriods,reported),'REFERENCE_PERIOD_PROJECTION_MISMATCH');
 const groupPeriods=new Map(),gridIndex=new Map(time.map((t,i)=>[t,i]));
 for(const p of reported){
  check(partition(p.partition)&&gridIndex.has(p.startTime)&&gridIndex.has(p.endTime)&&p.startTime<=p.endTime&&p.dominantLoops.length>0&&new Set(p.dominantLoops).size===p.dominantLoops.length,'REFERENCE_PERIOD_INVALID');
  const first=byId.get(p.dominantLoops[0]),g=p.partition??first?.identifier;
  check(first&&groups.has(g)&&p.dominantLoops.every(id=>byId.has(id)&&(byId.get(id).partition??id)===g),'REFERENCE_PERIOD_GROUP');
  const rows=groupPeriods.get(g)??[];check(!rows.length||rows.at(-1).endTime<p.startTime,'REFERENCE_PERIOD_OVERLAP_OR_ORDER');rows.push(p);groupPeriods.set(g,rows);
 }
 const groupMap=new Map();
 for(const [g,rows] of groups){
  const members=rows.map(x=>x.key).sort(),signature=JSON.stringify(members),periods=groupPeriods.get(g)??[],sets=[];
  let cursor=0;
  for(const [i,t] of time.entries()){
   const expected=nativeSelection(rows,i);check(expected!==null,'REFERENCE_PARTITION_MASS_OR_SCORE');
   while(cursor<periods.length&&periods[cursor].endTime<t)cursor++;
   const current=periods[cursor],actual=current&&current.startTime<=t?current.dominantLoops:[];
   check(eq([...expected].sort(),[...actual].sort()),'REFERENCE_DOMINANCE_MISMATCH');
   sets.push(expected.map(id=>byId.get(id).key).sort());
  }
  groupMap.set(signature,{partition:rows[0].partition,members,sets});
 }
 return {runId,run,model,byCycle,groupMap};
}
async function loadRecord(request,id){
 check(RUN_ID.test(id),'REFERENCE_RUN_ID_INVALID');
 const path='/project/runs/'+id;
 async function read(p){const r=await request(p);check(r.status===200,'REFERENCE_RECORD_UNAVAILABLE');return r.text();}
 const [runBody,feedbackBody,evidenceBody]=await Promise.all([read(path),read(path+'/feedback'),read(path+'/ltm')]);
 const run=JSON.parse(runBody),feedback=JSON.parse(feedbackBody),evidence=JSON.parse(evidenceBody);
 const modelBody=await read('/project/model/revisions/'+run.revision),model=JSON.parse(modelBody);
 const hashes={run_sha256:await digest(runBody),model_sha256:await digest(modelBody),feedback_sha256:await digest(feedbackBody),evidence_sha256:await digest(evidenceBody)};
 check(feedback.run_id===id&&feedback.run_sha256===hashes.run_sha256&&run.model_sha256===hashes.model_sha256&&feedback.source.evidence_sha256===hashes.evidence_sha256&&evidence.run_id===id&&evidence.run_sha256===hashes.run_sha256&&evidence.model_sha256===hashes.model_sha256&&evidence.revision===run.revision&&hex(evidence.xmile_sha256),'REFERENCE_RECORD_IDENTITY');
 const source={name:run.simulator.name,version:run.simulator.version,implementation_sha256:run.simulator.implementation_sha256};
 check(eq(evidence.source,source)&&eq(feedback.source,{...source,evidence_sha256:hashes.evidence_sha256}),'REFERENCE_SOURCE_MISMATCH');
 const assessment=await assessRunFeedback(run,feedback,()=>evidenceBody);
 check(assessment.dominance.status==='supported_by_partition_scores','REFERENCE_NATIVE_ASSESSMENT_UNSUPPORTED');
 return {projected:projectNativeRecord(id,run,model,feedback,evidence),identity:{run_id:id,revision:run.revision,...hashes},original:{runBody,modelBody,feedbackBody,evidenceBody}};
}
const extrema=(values,time)=>{let min=Infinity,max=-Infinity;for(const v of values){min=Math.min(min,v);max=Math.max(max,v);}return {min:{value:min,times:time.filter((_,i)=>values[i]===min)},max:{value:max,times:time.filter((_,i)=>values[i]===max)}};};
const maxAbs=values=>values.reduce((a,v)=>Math.max(a,Math.abs(v)),0);
export function compareNativeRecords(a,b,{variable,from,to,seriesNames}){
 check(a.runId!==b.runId&&a.run.revision!==b.run.revision&&a.run.model_sha256!==b.run.model_sha256,'REFERENCE_DISTINCT_INTERVENTION');
 check(eq(a.run.settings,b.run.settings)&&eq(a.run.execution,b.run.execution)&&eq(a.run.simulator,b.run.simulator)&&eq(a.run.series.time,b.run.series.time),'REFERENCE_INCOMPATIBLE_RUNS');
 const expected=structuredClone(a.model),matches=expected.variables.filter(v=>v.name===variable);
 check(matches.length===1&&matches[0].equation===from&&from!==to,'REFERENCE_INTERVENTION_MISMATCH');
 matches[0].equation=to;check(eq(expected,b.model),'REFERENCE_UNCONTROLLED_MODEL_CHANGE');
 const time=a.run.series.time,trajectories=[];
 for(const name of seriesNames){
  const x=a.run.series[name],y=b.run.series[name];check(name!=='time'&&Array.isArray(x)&&Array.isArray(y),'REFERENCE_VARIABLE_MISSING');
  const d=y.map((v,i)=>v-x[i]);
  trajectories.push({variable:name,baseline:{initial:x[0],final:x.at(-1),...extrema(x,time)},comparison:{initial:y[0],final:y.at(-1),...extrema(y,time)},delta:{initial:d[0],final:d.at(-1),max_abs:maxAbs(d),...extrema(d,time)}});
 }
 const added=[...b.byCycle.keys()].filter(k=>!a.byCycle.has(k)).sort(),removed=[...a.byCycle.keys()].filter(k=>!b.byCycle.has(k)).sort();
 const shared=[...a.byCycle.keys()].filter(k=>b.byCycle.has(k)).sort();
 const activity=shared.map(k=>{const x=a.byCycle.get(k),y=b.byCycle.get(k);return {cycle:JSON.parse(k),baseline:{id:x.identifier,polarity:x.polarity,active_samples:x.signed.filter(v=>v!==0).length},comparison:{id:y.identifier,polarity:y.polarity,active_samples:y.signed.filter(v=>v!==0).length}};});
 const comparableGroups=[],unmatchedGroups=[];
 for(const [signature,g] of a.groupMap){
  const h=b.groupMap.get(signature);
  if(!h){unmatchedGroups.push({side:'baseline',cycles:g.members.map(k=>JSON.parse(k))});continue;}
  const loopScores=g.members.map(k=>{const x=a.byCycle.get(k),y=b.byCycle.get(k);return {cycle:JSON.parse(k),max_abs_signed_relative_delta:maxAbs(y.signed.map((v,i)=>v-x.signed[i]))};});
  const changed=time.filter((_,i)=>!eq(g.sets[i],h.sets[i]));
  const decode=rows=>rows.map(p=>({start:p.start,end:p.end,cycles:p.cycles.map(k=>JSON.parse(k))}));
  comparableGroups.push({cycles:g.members.map(k=>JSON.parse(k)),baseline_partition:g.partition,comparison_partition:h.partition,loopScores,dominance_changed_samples:changed.length,dominance_changed_times:changed,baseline_periods:decode(intervals(time,g.sets)),comparison_periods:decode(intervals(time,h.sets))});
 }
 for(const [signature,g] of b.groupMap)if(!a.groupMap.has(signature))unmatchedGroups.push({side:'comparison',cycles:g.members.map(k=>JSON.parse(k))});
 return {contract:'BUFFALO_INTERVENTION_REFERENCE_V1',scope:'saved_grid_model_comparison_not_real_world_causality',intervention:{variable,from,to},samples:time.length,time_units:a.run.settings.timeUnits,trajectories,structural_cycles:{shared:shared.map(k=>JSON.parse(k)),added:added.map(k=>JSON.parse(k)),removed:removed.map(k=>JSON.parse(k))},activity,comparableGroups,unmatchedGroups,score_units:'signed relative fraction within identical cycle-member groups; not absolute effect',semantic_accuracy:'not_measured'};
}
export async function loadInterventionReference(request,ids,options){
 check(Array.isArray(ids)&&ids.length===2&&ids[0]!==ids[1],'REFERENCE_PAIR_REQUIRED');
 const [a,b]=await Promise.all(ids.map(id=>loadRecord(request,id)));
 return {reference:{...compareNativeRecords(a.projected,b.projected,options),identities:[a.identity,b.identity]},originals:[a.original,b.original]};
}
