import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LLMWrapper} from '../../utilities/LLMWrapper.js';
import SeldonBrain from '../../engines/seldon/SeldonBrain.js';
import SeldonILEUserBrain from '../../engines/seldon-ile-user/SeldonILEUserBrain.js';
import {loadBassReference} from './bass-feedback-reference.mjs';
import {bassDiscussionRequest,discussBassReference} from './seldon-bass-reference.mjs';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {ENGINE_MAX_TOKENS} from './engine-protocol.mjs';

const engines=['seldon','seldon-mentor','seldon-ile-user'];
const schema=LLMWrapper.prototype.generateSeldonResponseSchema(true).toJSONSchema();
const sha=x=>createHash('sha256').update(x).digest('hex');
const responses={
 seldon:'<p>R1 is reinforcing and dominates before year 9.625; B1 is balancing and dominates from that sample onward.</p>',
 'seldon-mentor':'<p>What changes as potential adopters become scarce near year 9.625?</p>',
 'seldon-ile-user':'<p>Word of mouth drives early adoption, until fewer people remain to adopt.</p>'
};
export function assertBassWire(engine,wire){
 const {model,feedback,provenance,prompt}=loadBassReference();
 const brain=engine==='seldon-ile-user'?SeldonILEUserBrain:SeldonBrain;
 const system=engine==='seldon-mentor'?SeldonBrain.MENTOR_SYSTEM_PROMPT:brain.DEFAULT_SYSTEM_PROMPT;
 const background=bassDiscussionRequest(engine).body.backgroundKnowledge;
 const user=[
  brain.DEFAULT_BACKGROUND_PROMPT.replaceAll('{backgroundKnowledge}',background),
  brain.DEFAULT_STRUCTURE_PROMPT,
  brain.DEFAULT_FEEDBACK_PROMPT.replaceAll('{feedbackContent}',JSON.stringify(feedback,null,2)),
  prompt
 ].join('\n\n');
 const jsonMention=[system,JSON.stringify(model,null,2),user].some(x=>/json/i.test(x));
 assert.deepEqual(wire.messages,[
  {role:'system',content:system+(jsonMention?'':'\n\nRespond with valid JSON.')},
  {role:'assistant',content:JSON.stringify(model,null,2)},
  {role:'user',content:user}
 ],'EXACT_ORIGINAL_BASS_MESSAGES');
 assert.deepEqual(wire.response_format,{type:'json_schema',json_schema:schema});
 assert.equal(wire.max_completion_tokens,ENGINE_MAX_TOKENS);
 assert.equal(wire.stream,false);
 assert.deepEqual(wire.chat_template_kwargs,{enable_thinking:false});
 // Check hashes of the actually received model and feedback JSON, not merely
 // hashes supplied in the surrounding provenance text.
 const feedbackStart=user.indexOf(JSON.stringify(feedback,null,2));
 assert(feedbackStart>=0);
 const actualFeedback=wire.messages[2].content.slice(feedbackStart,feedbackStart+JSON.stringify(feedback,null,2).length);
 const actualModel=JSON.parse(wire.messages[1].content);
 const parsed=JSON.parse(actualFeedback);
 assert.equal(sha(JSON.stringify(actualModel)),provenance.model_sha256);
 assert.equal(sha(JSON.stringify(parsed)),provenance.feedback_sha256);
 assert.equal(parsed.feedbackLoops.reduce((n,l)=>n+l['Percent of Model Behavior Explained by Loop'].length,0),482);
 return {request_sha256:sha(JSON.stringify(wire)),request_bytes:Buffer.byteLength(JSON.stringify(wire)),model_sha256:provenance.model_sha256,feedback_sha256:provenance.feedback_sha256};
}
export function createBassFixture(){
 let expected=null,records=[];
 return {
  get records(){return structuredClone(records);},
  prepare(engine){assert.equal(expected,null);expected=engine;},
  reply(model,wire){
   assert(expected,'UNEXPECTED_BASS_INFERENCE');assert.equal(model,GEMMA);
   const engine=expected;expected=null;
   const evidence=assertBassWire(engine,wire);
   records.push({engine,...evidence});
   // The original response schema's flag means feedback is needed to answer
   // the question, not necessarily absent. With valid feedback the original
   // brain must not prepend its missing-information warning.
   return {model,usage:{prompt_tokens:500,completion_tokens:100,neurons:1.5},
    choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({response:responses[engine],feedbackInformationRequired:true})}}]};
  }
 };
}
export async function exerciseBassReference(request,key,fixture){
 const initial=loadBassReference();
 assert.equal((await request('/project/model')).status,404);
 assert.deepEqual(await (await request('/project/runs')).json(),{runs:[],next_after:null});
 assert.equal((await request('/project/inference/1')).status,404);
 for(const [i,engine] of engines.entries()){
  fixture.prepare(engine);
  const result=await discussBassReference(request,engine,key);
  assert.deepEqual(result.provenance,initial.provenance);
  assert.deepEqual(result.output,{textContent:responses[engine],feedbackInformationRequired:true});
  const evidence=fixture.records[i];
  assert.equal(evidence.engine,engine);
  const response=await request('/project/inference/'+(i+1));assert.equal(response.status,200);
  const receipt=await response.json();
  assert.equal(receipt.status,'OK');assert.equal(receipt.channel,'original-engine');
  assert.equal(receipt.schema_sha256,sha(JSON.stringify(schema)));
  assert.equal(receipt.request_sha256,evidence.request_sha256);
  assert.equal(receipt.request_bytes,evidence.request_bytes);
  assert.equal(receipt.predicates.schema_valid,true);
  assert(receipt.request_bytes<=131072);
  console.log('FULL_SELDON_BASS_REFERENCE_DELIVERED '+JSON.stringify({engine,provider:'controlled',source_kind:initial.provenance.source_kind,points:482,source_run_id:null,...evidence,schema_sha256:receipt.schema_sha256,output:result.output}));
 }
 assert.equal(fixture.records.length,3);
 assert.equal((await request('/project/inference/4')).status,404);
 assert.equal((await request('/project/model')).status,404);
 assert.deepEqual(await (await request('/project/runs')).json(),{runs:[],next_after:null});
 assert.deepEqual(loadBassReference(),initial);
 console.log('FULL_SELDON_BASS_REFERENCE_INTEGRITY_OFFLINE');
}
