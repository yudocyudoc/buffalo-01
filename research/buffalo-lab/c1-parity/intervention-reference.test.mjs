import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest} from '../../../infra/full-runtime/provider-wire.mjs';
import {cycleKey,projectNativeRecord,compareNativeRecords,loadInterventionReference} from './intervention-reference.mjs';
const source={name:'pysimlin',version:'0.8.5',implementation_sha256:'a'.repeat(64)},settings={startTime:0,stopTime:2,dt:1,timeUnits:'Months',integrationMethod:'RK4'};
function fixture(i=1){
 const id=randomUUID(),model={specs:{...settings},variables:[{name:'Target',type:'variable',equation:i===1?'100':'110'}]},run={revision:i,model_sha256:String(i).repeat(64),settings:{...settings},execution:{dt:1,integrationMethod:'RK4'},simulator:{...source,source:'server'},series:{time:[0,1,2],x:i===1?[1,3,2]:[2,6,4]}};
 const loop={id:i===1?'b1':'b9',cycle:i===1?['x','y']:['y','x'],partition:i===1?0:3,polarity:'B',signed:[0,-1,-1]};
 const evidence={mode:'exhaustive',time:[0,1,2],loops:[loop],links:[{from:'x',to:'y',polarity:'+',raw:[0,1,1]},{from:'y',to:'x',polarity:'-',raw:[0,-1,-1]}],periods:[{partition:loop.partition,startTime:1,endTime:2,dominantLoops:[loop.id]}]};
 const lid='P'+loop.partition+'/'+loop.id.toUpperCase();
 const feedback={run_id:id,run_sha256:'f'.repeat(64),content:{valid:true,provenance:{run_id:id,run_sha256:'f'.repeat(64),revision:i,model_sha256:run.model_sha256,engine:'pysimlin',version:'0.8.5'},scoreTimes:[0,1,2],activitySamples:3,normalization:'sum of absolute native loop scores within each Simlin partition at the same time',dominanceRule:'pysimlin 0.8.5 Run.dominant_periods',feedbackLoops:[{identifier:lid,partition:loop.partition,nativePolarity:'B',polarity:'-',signedRelativeScores:[0,-1,-1],links:loop.cycle.map((from,j)=>({from,to:loop.cycle[(j+1)%2],polarity:from==='x'?'+':'-'}))}],dominantLoopsByPeriod:[{partition:loop.partition,startTime:1,endTime:2,dominantLoops:[lid]}]}};
 const project=()=>projectNativeRecord(id,run,model,feedback,evidence);
 return {id,run,model,feedback,evidence,project};
}
const options={variable:'Target',from:'100',to:'110',seriesNames:['x']};
test('directed cycle rotation is invariant; reversal, delimiter and repeated vertex not conflated',()=>{
 assert.equal(cycleKey(['x','y','z']),cycleKey(['z','x','y']));assert.notEqual(cycleKey(['x','y','z']),cycleKey(['z','y','x']));
 assert.notEqual(cycleKey(['a,b','c']),cycleKey(['a','b,c']));assert.throws(()=>cycleKey(['x','x']),/REFERENCE_CYCLE_INVALID/);
});
test('exact full-grid reference separates amplitude change from unchanged relative scores and dominance despite ID/partition renaming',()=>{
 const a=fixture(1),b=fixture(2);
 a.feedback.content.extra='UNVERIFIED_FREE_TEXT';
 const r=compareNativeRecords(a.project(),b.project(),options);
 assert.equal(r.trajectories[0].delta.max_abs,3);assert.deepEqual(r.trajectories[0].delta.max,{value:3,times:[1]});
 assert.equal(r.comparableGroups[0].loopScores[0].max_abs_signed_relative_delta,0);assert.equal(r.comparableGroups[0].dominance_changed_samples,0);
 assert.deepEqual(r.comparableGroups[0].baseline_periods,[{start:0,end:0,cycles:[]},{start:1,end:2,cycles:[['x','y']]}]);
 assert.equal(r.structural_cycles.shared.length,1);assert(!JSON.stringify(r).includes('UNVERIFIED_FREE_TEXT'));
 b.model.variables.push({name:'Other',type:'variable',equation:'1'});assert.throws(()=>compareNativeRecords(a.project(),b.project(),options),/REFERENCE_UNCONTROLLED_MODEL_CHANGE/);
});
test('full-grid projection rejects non-normalized scores, invalid partitions, overlapping periods and corrupt sample projection',()=>{
 for(const [mutate,code] of [
  [f=>{f.evidence.loops[0].signed[1]=-.5;f.feedback.content.feedbackLoops[0].signedRelativeScores[1]=-.5},'REFERENCE_PARTITION_MASS_OR_SCORE'],
  [f=>{delete f.evidence.loops[0].partition},'REFERENCE_LOOP_INVALID'],
  [f=>{f.feedback.content.scoreTimes=[0,1,3]},'REFERENCE_SCORE_GRID'],
  [f=>{f.feedback.content.feedbackLoops[0].signedRelativeScores[1]=-.7},'REFERENCE_FEEDBACK_SCORE_MISMATCH'],
  [f=>{f.evidence.periods.push({...f.evidence.periods[0],startTime:2});f.feedback.content.dominantLoopsByPeriod.push({...f.feedback.content.dominantLoopsByPeriod[0],startTime:2})},'REFERENCE_PERIOD_OVERLAP_OR_ORDER'],
  [f=>{f.evidence.periods[0].startTime=0;f.feedback.content.dominantLoopsByPeriod[0].startTime=0},'REFERENCE_DOMINANCE_MISMATCH'],
  [f=>{f.feedback.content.feedbackLoops[0].links[0].to='other'},'REFERENCE_FEEDBACK_LINK_MISMATCH']
 ]){const f=fixture();mutate(f);assert.throws(f.project,new RegExp(code));}
});
test('group changes never produce relative-score deltas across different denominators',()=>{
 const a=fixture(1),b=fixture(2);
 const l=b.evidence.loops[0];l.cycle=['z'];b.evidence.links.push({from:'z',to:'z',polarity:'-',raw:[0,-1,-1]});b.feedback.content.feedbackLoops[0].links=[{from:'z',to:'z',polarity:'-'}];
 const r=compareNativeRecords(a.project(),b.project(),options);
 assert.deepEqual(r.structural_cycles.added,[['z']]);assert.deepEqual(r.structural_cycles.removed,[['x','y']]);assert.equal(r.comparableGroups.length,0);assert.equal(r.unmatchedGroups.length,2);
});
test('null partitions are separate singleton groups; inactive samples retained',()=>{
 const f=fixture();
 const l=f.evidence.loops[0];l.partition=null;
 const g=f.feedback.content.feedbackLoops[0];g.partition=null;g.identifier='Pnull/B1';
 f.evidence.periods[0].partition=null;f.feedback.content.dominantLoopsByPeriod[0].partition=null;f.feedback.content.dominantLoopsByPeriod[0].dominantLoops=['Pnull/B1'];
 f.evidence.loops.push({id:'b2',partition:null,cycle:['z'],polarity:'B',signed:[0,-1,-1]});
 f.evidence.links.push({from:'z',to:'z',polarity:'-',raw:[0,-1,-1]});
 f.feedback.content.feedbackLoops.push({identifier:'Pnull/B2',partition:null,nativePolarity:'B',polarity:'-',signedRelativeScores:[0,-1,-1],links:[{from:'z',to:'z',polarity:'-'}]});
 f.evidence.periods.push({partition:null,startTime:1,endTime:2,dominantLoops:['b2']});f.feedback.content.dominantLoopsByPeriod.push({partition:null,startTime:1,endTime:2,dominantLoops:['Pnull/B2']});
 assert.equal(f.project().groupMap.size,2);
});
async function stored(f){
 const modelBody=JSON.stringify(f.model);f.run.model_sha256=await digest(modelBody);
 const runBody=JSON.stringify(f.run),runHash=await digest(runBody);
 Object.assign(f.evidence,{run_id:f.id,run_sha256:runHash,revision:f.run.revision,model_sha256:f.run.model_sha256,source,xmile_sha256:'e'.repeat(64)});
 const evidenceBody=JSON.stringify(f.evidence);
 Object.assign(f.feedback,{run_sha256:runHash,source:{...source,evidence_sha256:await digest(evidenceBody)}});
 Object.assign(f.feedback.content.provenance,{run_sha256:runHash,model_sha256:f.run.model_sha256});
 return {modelBody,runBody,evidenceBody,feedbackBody:JSON.stringify(f.feedback)};
}
test('reference loader binds exact stored bytes, rejects tamper and retains originals separately',async()=>{
 const a=fixture(1),b=fixture(2),rows=new Map();
 for(const f of [a,b]){const bodies=await stored(f);const p='/project/runs/'+f.id;rows.set(p,bodies.runBody);rows.set(p+'/feedback',bodies.feedbackBody);rows.set(p+'/ltm',bodies.evidenceBody);rows.set('/project/model/revisions/'+f.run.revision,bodies.modelBody);}
 const request=async path=>rows.has(path)?new Response(rows.get(path)):new Response(null,{status:404});
 const ids=[a.id,b.id],r=await loadInterventionReference(request,ids,options);assert.equal(r.reference.identities.length,2);assert.equal(r.originals[0].runBody,rows.get('/project/runs/'+a.id));
 const path='/project/runs/'+a.id+'/ltm';rows.set(path,rows.get(path)+' ');await assert.rejects(loadInterventionReference(request,ids,options),/REFERENCE_RECORD_IDENTITY/);
});
