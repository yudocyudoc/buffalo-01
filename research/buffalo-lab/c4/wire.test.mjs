import test from 'node:test';
import assert from 'node:assert/strict';
import {protocol,buildWire,inspectResult,sha} from './wire.mjs';
const capture={messages:[{role:'system',content:'SD'},{role:'user',content:'Question'}],schema:{type:'object',properties:{response:{type:'string'},feedbackInformationRequired:{type:'boolean'}},required:['response','feedbackInformationRequired'],additionalProperties:false}};
const config=id=>protocol.configs.find(c=>c.id===id);
test('only declared parameter changes across model adapters',()=>{
 for(const c of protocol.configs){
  const w=buildWire(capture,c);
  assert.equal(sha(w.messages),sha(capture.messages));
  assert.equal(sha(w.response_format.json_schema.schema),sha(capture.schema));
  assert.equal(w[c.limit],8192);
  assert.equal(w.stream,false);
 }
 const a=buildWire(capture,config('gemma-off')),b=buildWire(capture,config('gemma-on'));
 assert.deepEqual({...a,chat_template_kwargs:{enable_thinking:true}},b);
 assert(!Object.hasOwn(buildWire(capture,config('gpt-oss')),'reasoning_effort'));
 assert.throws(()=>buildWire(capture,{...config('glm'),reasoning:{chat_template_kwargs:{enable_thinking:false}}}));
});
test('valid structured response is transport success, not semantic success',()=>{
 const c=config('gemma-off');
 const r={model:c.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({response:'Explanation.',feedbackInformationRequired:false})}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}};
 const v=inspectResult(r,c,capture.schema);
 assert.equal(v.status,'TRANSPORT_OK');assert.equal(v.semantic_accuracy,'NOT_MEASURED');
 assert.equal(inspectResult({...r,model:'other'},c,capture.schema).status,'REVIEW_REQUIRED');
 assert.equal(inspectResult({...r,choices:[{...r.choices[0],finish_reason:'length'}]},c,capture.schema).status,'REVIEW_REQUIRED');
 assert.equal(inspectResult({...r,usage:undefined},c,capture.schema).status,'REVIEW_REQUIRED');
 assert.equal(inspectResult({...r,choices:[{...r.choices[0],message:{role:'assistant',content:'not json'}}]},c,capture.schema).status,'REVIEW_REQUIRED');
});
test('GPT-OSS native result is preserved without invented metadata',()=>{
 const r=inspectResult({response:{response:'Explanation.',feedbackInformationRequired:false}},config('gpt-oss'),capture.schema);
 assert.equal(r.parsed.response,'Explanation.');
 assert.equal(r.status,'REVIEW_REQUIRED');
 assert(r.reasons.includes('FINISH_UNREPORTED'));
 assert(r.reasons.includes('USAGE_UNVERIFIED'));
 assert(r.reasons.includes('MODEL_IDENTITY_UNREPORTED'));
});
