import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBassReference} from './bass-feedback-reference.mjs';
import {bassDiscussionRequest,discussBassReference} from './seldon-bass-reference.mjs';
test('fixed original reference is paired without invented trajectory, run ID or expected answers',()=>{
 const ref=loadBassReference();
 for(const engine of ['seldon','seldon-mentor','seldon-ile-user']){
  const {body,provenance}=bassDiscussionRequest(engine);
  assert.deepEqual(Object.keys(body).sort(),['backgroundKnowledge','currentModel','feedbackContent','prompt']);
  assert.deepEqual(body.currentModel,ref.model);
  assert.deepEqual(body.feedbackContent,ref.feedback);
  assert.equal(body.prompt,ref.prompt);
  assert.deepEqual(provenance,ref.provenance);
  assert.equal(provenance.source_run_id,null);assert.equal(provenance.computed_by_buffalo,false);
  for(const fact of ref.expectations)assert(!body.backgroundKnowledge.includes(fact));
 }
 const changed=bassDiscussionRequest('seldon').body;changed.feedbackContent.feedbackLoops.pop();
 assert.equal(bassDiscussionRequest('seldon').body.feedbackContent.feedbackLoops.length,2);
});
test('invalid engine is denied before any request; an upstream failure is not retried',async()=>{
 let calls=0;
 const request=async()=>{calls++;return Response.json({success:false});};
 await assert.rejects(discussBassReference(request,'quantitative','fixture'),/UNSUPPORTED_BASS/);
 assert.equal(calls,0);
 await assert.rejects(discussBassReference(request,'seldon','fixture'),/BASS_DISCUSSION_ENGINE_FAILURE/);
 assert.equal(calls,1);
});
