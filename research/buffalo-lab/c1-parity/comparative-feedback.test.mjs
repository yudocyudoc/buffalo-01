import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {comparisonHash} from '../../../agent/tools/builtin/c1ParityComparison.js';
import {validateComparativeFeedback} from '../../../agent/tools/builtin/c1ParityComparativeFeedback.js';
function fixture(){
 const runs=[1,2].map(i=>({run_id:randomUUID(),revision:i,run_sha256:String(i).repeat(64),model_sha256:String(i+2).repeat(64),simulator:{name:'pysimlin',version:'0.8.5'},settings:{startTime:0,stopTime:1}}));
 const feedbackContent=runs.map(r=>({valid:true,provenance:{run_id:r.run_id,revision:r.revision,run_sha256:r.run_sha256,model_sha256:r.model_sha256,engine:r.simulator.name,version:r.simulator.version},feedbackLoops:[{identifier:'P0/B1',partition:0,links:[{from:'x',to:'x'}],signedRelativeScores:[-1,-1]}],dominantLoopsByPeriod:[{partition:0,startTime:0,endTime:1,dominantLoops:['P0/B1']}],scoreTimes:[0,1],activitySamples:2,normalization:'sum of absolute native loop scores within each Simlin partition at the same time',dominanceRule:'pysimlin 0.8.5 Run.dominant_periods'}));
 const manifest={runs,feedback_sha256:feedbackContent.map(comparisonHash)};
 return {manifest,data:{runIds:runs.map(r=>r.run_id),feedbackContent}};
}
test('exact ordered native feedback documents remain separate even with identical loop IDs',()=>{
 const {manifest,data}=fixture();const result=validateComparativeFeedback(data,manifest);assert.deepEqual(result,data.feedbackContent);assert.notEqual(result,data.feedbackContent);assert.notEqual(result[0].provenance.run_id,result[1].provenance.run_id);
});
test('pair feedback rejects reversed or missing documents and every identity mismatch',()=>{
 const {manifest,data}=fixture();
 for(const d of [{...data,runIds:[...data.runIds].reverse()},{...data,feedbackContent:[data.feedbackContent[0]]}])assert.throws(()=>validateComparativeFeedback(d,manifest),/C1_PAIR_FEEDBACK_ORDER_MISMATCH/);
 assert.throws(()=>validateComparativeFeedback({...data,feedbackContent:[...data.feedbackContent].reverse()},manifest),/C1_PAIR_FEEDBACK_IDENTITY_MISMATCH/);
 for(const k of ['run_id','revision','run_sha256','model_sha256','engine','version']){const d=structuredClone(data);d.feedbackContent[0].provenance[k]='other';assert.throws(()=>validateComparativeFeedback(d,manifest),/C1_PAIR_FEEDBACK_IDENTITY_MISMATCH/);}
});
test('score mutation, dangling period, cross-partition reference and different grids fail',()=>{
 const {manifest,data}=fixture();
 for(const [mutate,code] of [[f=>{f.feedbackLoops[0].signedRelativeScores[0]=-.5},'PAYLOAD_MISMATCH'],[f=>{f.dominantLoopsByPeriod[0].dominantLoops=['missing']},'PERIOD_INVALID'],[f=>{f.dominantLoopsByPeriod[0].partition=1},'PERIOD_INVALID'],[f=>{f.scoreTimes=[0,.5]},'GRID_MISMATCH']]){
  const d=structuredClone(data),m=structuredClone(manifest);mutate(d.feedbackContent[0]);if(code==='GRID_MISMATCH')m.feedback_sha256[0]=comparisonHash(d.feedbackContent[0]);
  assert.throws(()=>validateComparativeFeedback(d,m),new RegExp('C1_PAIR_FEEDBACK_'+code));
 }
});
