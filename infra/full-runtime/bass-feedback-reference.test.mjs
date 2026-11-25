import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBassReference,validateBassReference,assertBlob,SOURCE} from './bass-feedback-reference.mjs';
const scores='Percent of Model Behavior Explained by Loop';
test('original Bass reference matches upstream blobs and original five-fact case',()=>{
 const {model,feedback,provenance,summary,expectations}=loadBassReference();
 assert.equal(provenance.source_kind,'upstream-precomputed-reference');
 assert.equal(provenance.computed_by_buffalo,false);
 assert.equal(provenance.trajectory_available,false);
 assert.equal(provenance.source_run_id,null);
 assert.equal(Object.hasOwn(model.specs,'integrationMethod'),false);
 assert.equal(provenance.xmile_method,'Euler');
 assert.equal(summary.points_per_loop,241);
 assert.equal(expectations.length,5);
 assert.deepEqual(summary.samples[1],{time:9.5625,R1:51.16862575482285,B1:48.83137424517715});
 assert.deepEqual(summary.samples[2],{time:9.625,R1:48.82615608559289,B1:51.17384391440711});
 assert.equal(feedback.feedbackLoops.length,2);
});
test('byte drift fails pinned source identity',()=>{
 assert.throws(()=>assertBlob(Buffer.from('{}'),SOURCE.json_blob),/UPSTREAM_BLOB_IDENTITY/);
});
test('wrong period, reversed edge, wrong polarity, missing sample and corrupt score fail',()=>{
 for(const corrupt of [
  x=>x.feedback.dominantLoopsByPeriod[0].endTime=10,
  x=>{const l=x.feedback.feedbackLoops[0].links[0];[l.from,l.to]=[l.to,l.from];},
  x=>x.feedback.feedbackLoops[1].links[1].polarity='+',
  x=>x.feedback.feedbackLoops[0][scores].pop(),
  x=>x.feedback.feedbackLoops[0][scores][153].value=99,
  x=>{const a=x.feedback.feedbackLoops[0][scores][154],b=x.feedback.feedbackLoops[1][scores][154];[a.value,b.value]=[b.value,a.value];},
  x=>x.feedback.feedbackLoops[1][scores][1].time=0,
  x=>x.model.relationships.pop()
 ]){
  const {model,feedback}=loadBassReference();const x={model,feedback};corrupt(x);
  assert.throws(()=>validateBassReference(x));
 }
});
