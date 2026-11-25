import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {LLMWrapper} from '../../utilities/LLMWrapper.js';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {loadComparison,comparisonRequest,discussPersistedRuns} from './seldon-comparison.mjs';
import SeldonBrain from '../../engines/seldon/SeldonBrain.js';
import SeldonILEUserBrain from '../../engines/seldon-ile-user/SeldonILEUserBrain.js';

const engines=['seldon','seldon-mentor','seldon-ile-user'];
const descriptive='Compare the observed Inventory trajectories. Report the initial and final values, without explaining causality.';
const causal='Which feedback loops dominate the difference in Inventory behavior, and why?';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const schema=LLMWrapper.prototype.generateSeldonResponseSchema(true).toJSONSchema();

export function createSeldonFixture(){
 let expected=null,calls=0;
 return {
  get calls(){return calls;},
  prepare(engine,prompt,runs){assert.equal(expected,null);expected={engine,prompt,runs};},
  reply(model,wire){
   assert(expected,'UNEXPECTED_SELDON_INFERENCE');
   const {engine,prompt,runs}=expected;expected=null;calls++;
   assert.equal(model,GEMMA);
   assert.deepEqual(wire.response_format,{type:'json_schema',json_schema:schema});
   const system=wire.messages.find(m=>m.role==='system')?.content;
   assert.equal(system,engine==='seldon-mentor'?SeldonBrain.MENTOR_SYSTEM_PROMPT:engine==='seldon'?SeldonBrain.DEFAULT_SYSTEM_PROMPT:SeldonILEUserBrain.DEFAULT_SYSTEM_PROMPT);
   const payload=comparisonRequest(engine,prompt,runs);
   const user=wire.messages.filter(m=>m.role==='user').map(m=>m.content).join('\n\n');
   assert(user.includes(payload.behaviorContent),'EXACT_RECOVERED_BEHAVIOR');
   assert(user.includes(payload.backgroundKnowledge),'EXACT_HISTORICAL_PROVENANCE');
   assert(user.includes(prompt));
   assert(wire.messages.some(m=>m.role==='assistant'&&m.content===JSON.stringify(payload.currentModel,null,2)),'EXACT_CURRENT_REVISION');
   assert(!Object.hasOwn(payload,'feedbackContent'));
   if(engine==='seldon-ile-user')assert(user.includes('The current simulation run the user is working with is called: "'+runs[1].id+'"'));
   const response=prompt===causal?
    {response:'Feedback information is required to identify dominant loops.',feedbackInformationRequired:true}:
    {response:'<p>Inventory starts at 10 in both runs and ends at 30 and 34.</p>',feedbackInformationRequired:false};
   return {model,usage:{prompt_tokens:500,completion_tokens:100,neurons:1.5},
    choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(response)}}]};
  }
 };
}
export async function exerciseSeldon(request,other,key,state,fixture,firstAttempt){
 // The test's comparison inputs are read from durable storage after restart,
 // not from the state object retained by the simulator test.
 const ids=[state.id1,state.id2];
 const runs=await loadComparison(request,ids);
 assert.deepEqual(runs.map(x=>x.record.series.Inventory),[[10,15,20,25,30],[10,16,22,28,34]]);
 assert.deepEqual(runs.map(x=>x.record.revision),[state.rev1,state.rev2]);
 assert.deepEqual(runs.map(x=>x.model.variables.find(v=>v.name==='Demand').equation),['DailyDemandRate','6']);
 assert.equal(runs[0].model.variables.find(v=>v.name==='DailyDemandRate').equation,'5');
 const snapshot=structuredClone(runs);
 await assert.rejects(loadComparison(request,[ids[0],ids[0]]),/SELECT_TWO_DISTINCT_RUNS/);
 await assert.rejects(loadComparison(request,[ids[0],randomUUID()]),/RUN_NOT_AVAILABLE/);
 await assert.rejects(loadComparison(other,ids),/RUN_NOT_AVAILABLE/);
 assert.equal(fixture.calls,0);
 for(const engine of engines){
  for(const prompt of [descriptive,causal]){
   fixture.prepare(engine,prompt,runs);
   const result=await discussPersistedRuns(request,engine,prompt,ids,key);
   assert.deepEqual(result.runIds,ids);
   if(prompt===causal){
    assert.equal(result.output.feedbackInformationRequired,true);
    assert.match(result.output.textContent,/Please re-run the model/);
    assert.match(result.output.textContent,/Feedback information is required/);
   }else{
    assert.equal(result.output.feedbackInformationRequired,false);
    assert.equal(result.output.textContent,'<p>Inventory starts at 10 in both runs and ends at 30 and 34.</p>');
   }
   const receiptResponse=await request('/project/inference/'+(firstAttempt+fixture.calls));
   assert.equal(receiptResponse.status,200);
   const receipt=await receiptResponse.json();
   assert.equal(receipt.status,'OK');
   assert.equal(receipt.schema_sha256,sha(schema));
   assert.equal(receipt.channel,'original-engine');
   console.log('FULL_ORIGINAL_SELDON_PERSISTED_COMPARISON '+JSON.stringify({
    engine,case:prompt===causal?'missing-feedback':'descriptive',provider:'controlled',
    run_ids:ids,revisions:runs.map(x=>x.record.revision),model_hashes:runs.map(x=>x.record.model_sha256),
    schema_sha256:receipt.schema_sha256,output:result.output
   }));
  }
 }
 assert.equal(fixture.calls,6);
 assert.equal((await request('/project/inference/'+(firstAttempt+7))).status,404);
 assert.deepEqual(await loadComparison(request,ids),snapshot);
 const latest=await request('/project/model');
 assert.equal(latest.headers.get('x-buffalo-model-sha256'),runs[1].record.model_sha256);
 assert.equal((await (await request('/project/runs')).json()).runs.length,2);
 console.log('FULL_SELDON_FAMILY_READ_ONLY_PERSISTED_COMPARISON_OFFLINE');
}
