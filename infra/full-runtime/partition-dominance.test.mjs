import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessDominance} from './dominance-evidence.mjs';
import {validFeedback} from './run-narrative.mjs';

function assessment(time,loops,periods) {
  const feedbackLoops=loops.map(({id,partition})=>({identifier:'P'+partition+'/'+id.toUpperCase(),partition,polarity:''}));
  const content={valid:true,feedbackLoops,dominantLoopsByPeriod:periods};
  assert(validFeedback(content,time));
  return assessDominance(content,time,{time,loops,mode:'exhaustive'});
}
const loop=(id,partition,polarity,signed)=>({id,partition,polarity,signed});
const period=(partition,startTime,endTime,...dominantLoops)=>({partition,startTime,endTime,dominantLoops});

test('validates all saved instants including one absent from a 100-point summary',()=>{
  const time=Array.from({length:201},(_,i)=>i);
  const a=time.map(t=>t===1?.4:.6);
  const loops=[loop('a',0,'R',a),loop('b',0,'B',a.map(x=>x-1))];
  const result=assessment(time,loops,[period(0,0,200,'P0/A')]);
  assert.equal(result.status,'contradicted');
  assert.equal(result.time,1);
  assert.deepEqual(result.expectedLoops,['P0/B']);
});

test('partitions compete independently, None loops each have a solo timeline',()=>{
  const loops=[loop('a',0,'R',[0,.5]),loop('b',0,'B',[0,-.5]),loop('c',null,'B',[0,-1]),loop('d',null,'U',[0,1])];
  const periods=[period(0,1,1,'P0/A'),period(null,1,1,'Pnull/C'),period(null,1,1,'Pnull/D')];
  assert.deepEqual(assessment([0,1],loops,periods),{status:'supported_by_partition_scores',
    partitionCount:3,checkedSamples:3,inactiveSamples:3,incompleteSamples:0});
});

test('uses the native runtime polarity bucket for mixed loops and signs for U; endpoints are inclusive',()=>{
  const loops=[loop('a',0,'Rux',[-.3,.3,0]),loop('b',0,'U',[.25,-.25,0]),loop('c',0,'Bux',[-.45,-.45,0])];
  const periods=[period(0,0,0,'P0/A','P0/B'),period(0,1,1,'P0/B','P0/C')];
  assert.equal(assessment([0,1,2],loops,periods).status,'supported_by_partition_scores');
  assert.equal(assessment([0,1,2],loops,[periods[0],period(0,1,2,'P0/B','P0/C')]).time,2);
  assert.equal(assessment([0,1,2],loops,[periods[0]]).time,1);
});

test('requires the ranked coalition, preserves native order at tied magnitudes',()=>{
  const loops=[loop('a',0,'R',[.35]),loop('b',0,'R',[.25]),loop('c',0,'R',[.25]),loop('d',0,'B',[-.15])];
  assert.equal(assessment([0],loops,[period(0,0,0,'P0/A','P0/B')]).status,'supported_by_partition_scores');
  assert.equal(assessment([0],loops,[period(0,0,0,'P0/A','P0/C')]).status,'contradicted');
});
