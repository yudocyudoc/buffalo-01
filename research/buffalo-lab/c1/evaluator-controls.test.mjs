import test from 'node:test';
import assert from 'node:assert/strict';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
import {evaluate,groups} from '../../../evals/categories/feedbackExplanation.js';

test('original evaluation inventory and controlled judge boundary',async()=>{
 const original=LLMWrapper.prototype.createChatCompletion;
 const params=LLMWrapper.prototype.getLLMParameters;
 const calls=[];
 let reply='true';
 try{
  LLMWrapper.prototype.getLLMParameters=()=>({underlyingModel:'controlled-offline'});
  LLMWrapper.prototype.createChatCompletion=async function(messages,model){
   assert.equal(model,'controlled-offline');calls.push(messages);
   return {content:reply};
  };
  const cases=Object.values(groups).flat();
  assert.equal(cases.length,6);
  assert.equal(cases.reduce((n,c)=>n+c.expectations.length,0),34);
  assert(cases.every(c=>c.additionalParameters.feedbackContent&&!c.additionalParameters.behaviorContent));
  const expectation=['There are two feedback loops.'];
  const response={output:{textContent:'There are two feedback loops. A stock equals 999999 at time 4.'}};
  assert.deepEqual(await evaluate(response,expectation),[]);
  assert.equal(calls.length,1);
  assert(calls[0][1].content.includes('999999'));
  assert(calls[0][2].content.includes(expectation[0]));
  reply='false';
  assert.equal((await evaluate(response,expectation))[0].type,'Missing expected fact');
  reply='not true';
  assert.deepEqual(await evaluate(response,expectation),[],'Historical substring behavior');
 }finally{
  LLMWrapper.prototype.createChatCompletion=original;
  LLMWrapper.prototype.getLLMParameters=params;
 }
});
