/**
 * Zero-network regressions for Gemma thinking, finish_reason semantics,
 * and grading gates. Runs in plain node, no Cloudflare token required.
 */
import assert from 'node:assert/strict';
import {
  configureModelWire, inspectChatCompletion, truncatedClientResponse,
  interruptedTransport, validateAgentCompletion, invalidClientResponse,
  INVALID_RESPONSE_CODE, GEMMA_MODEL, TRUNCATED_RESPONSE_CODE
} from './completion-policy.mjs';
import {BUFFALO_CF_MODEL} from './active-model.mjs';
import {OR_SLUG} from './arena_b_ev01_cf_adapter.mjs';
import {adaptOriginalEngineRequest} from './other-engine-transport.mjs';

const inkling='@cf/thinkingmachines/inkling-2-small';
const base={model:GEMMA_MODEL,messages:[{role:'user',content:'Continue policy analysis'}],
  reasoning_effort:'low',max_completion_tokens:4096};
const gemma=configureModelWire(GEMMA_MODEL,base);
assert.equal(gemma.chat_template_kwargs.enable_thinking,false);
assert.ok(!Object.hasOwn(gemma,'reasoning_effort'),
  'Remove historical low effort to avoid contradicting enable_thinking:false');
assert.equal(base.reasoning_effort,'low','Do not mutate original Buffalo request');
assert.ok(!Object.hasOwn(base,'chat_template_kwargs'));
const ink=configureModelWire(inkling,base);
assert.deepEqual(ink,base,'Inkling retains original behavior');

const sdkEngine={
  model:OR_SLUG,messages:[
    {role:'system',content:'Build a model'},
    {role:'user',content:'Clinic'}
  ],
  response_format:{type:'json_schema',json_schema:{
    name:'sd_model',schema:{type:'object',properties:{
      variables:{type:'array'},relationships:{type:'array'}
    }}
  }},max_completion_tokens:16000
};
const adapted=adaptOriginalEngineRequest(sdkEngine);
const gemmaEngine=configureModelWire(GEMMA_MODEL,adapted.wire);
assert.equal(gemmaEngine.chat_template_kwargs.enable_thinking,false);
assert.ok(!Object.hasOwn(gemmaEngine,'reasoning_effort'));
assert.equal(adapted.wire.reasoning_effort,'low',
  'IGC adapter remains unchanged; only the final model-specific wire changes');

const length=inspectChatCompletion({choices:[{finish_reason:'length',message:{
  role:'assistant',content:'partial',tool_calls:[]}}]});
assert.deepEqual(length,{finishReason:'length',toolCallsCount:0,truncated:true});
assert.equal(inspectChatCompletion({choices:[{finish_reason:'stop',message:{
  role:'assistant',content:'done'}}]}).truncated,false);
assert.deepEqual(inspectChatCompletion({choices:[{finish_reason:'tool_calls',message:{
  tool_calls:[{id:'call_1',type:'function'}]}}]}),{
    finishReason:'tool_calls',toolCallsCount:1,truncated:false
});
const client=truncatedClientResponse();
assert.equal(client.status,422);
const err=await client.json();
assert.equal(err.error.code,TRUNCATED_RESPONSE_CODE);

assert.deepEqual(interruptedTransport({truncatedResponses:1,budgetBlockedAttempts:0}),{
  status:'output_truncated',stopReason:'CLOUDFLARE_OUTPUT_TRUNCATED'
});
assert.equal(interruptedTransport({truncatedResponses:0,budgetBlockedAttempts:0,
  neuronBudget:{unmetered:false}}),null);
assert.equal(interruptedTransport({budgetBlockedAttempts:1}).status,'budget_exhausted');
assert.equal(interruptedTransport({neuronPreflightBlockedAttempts:1}).status,
  'neuron_preflight_blocked');
assert.equal(interruptedTransport({neuronBudget:{unmetered:true}}).status,
  'unmetered_fail_closed');
assert.deepEqual(
  interruptedTransport({neuronBudget:{unmetered:true}}, [
    {http_status:499,provider_error_code:6001}
  ]),
  {status:'provider_http_error',stopReason:'CLOUDFLARE_PROVIDER_HTTP_499'},
  'Real Cloudflare 499 must be primary incident; unknown metering is secondary'
);
assert.equal(
  interruptedTransport({},[{http_status:200,status:'OUTPUT_TRUNCATED'}]),null,
  'Only diagnostics confirm a local truncated result; actual HTTP is 200'
);
// Test shapes grounded in actual original OpenAI-compatible tool wire. Do NOT
// invoke any actual tool or infer any model output in these zero-network tests.
const toolRequest={tools:[{type:'function',function:{
  name:'read_model_section',
  parameters:{type:'object',properties:{
    section:{type:'string',enum:['specs','variables','relationships','modules']}
  },required:['section']}
}}]};
const assistant=(finishReason,content,toolCalls)=>({choices:[{
  finish_reason:finishReason,message:{role:'assistant',content,tool_calls:toolCalls}
}]});
const validCall=(args='{"section":"specs"}')=>({
  id:'call_1',type:'function',function:{name:'read_model_section',arguments:args}
});
function expectInvalid(response,reason){
  const result=validateAgentCompletion(response,toolRequest);
  assert.equal(result.invalidReason,reason);
  assert.equal(result.truncated,false);
}
assert.equal(validateAgentCompletion(assistant('tool_calls','',[validCall()]),toolRequest).invalidReason,null);
assert.equal(validateAgentCompletion(assistant('stop','Model complete',[]),toolRequest).invalidReason,null);
expectInvalid(assistant('tool_calls','',[]),'EMPTY_TOOL_CALLS');
expectInvalid(assistant('tool_calls',null,undefined),'EMPTY_TOOL_CALLS');
expectInvalid(assistant('stop','   ',[]),'EMPTY_ASSISTANT_STOP');
expectInvalid(assistant('stop',null,[]),'EMPTY_ASSISTANT_STOP');
expectInvalid(assistant('stop','a',[validCall()]),'STOP_WITH_TOOL_CALLS');
expectInvalid(assistant('content_filter','',[]),'UNSUPPORTED_FINISH_REASON');
expectInvalid({choices:[]},'MISSING_ASSISTANT_MESSAGE');
expectInvalid(assistant('tool_calls','',[validCall('{bad json')]),'ARGUMENTS_INVALID_JSON');
expectInvalid(assistant('tool_calls','',[validCall('[]')]),'ARGUMENTS_NOT_OBJECT');
expectInvalid(assistant('tool_calls','',[validCall('null')]),'ARGUMENTS_NOT_OBJECT');
expectInvalid(assistant('tool_calls','',[validCall('{}')]),'ARGUMENTS_MISSING_REQUIRED_FIELD');
expectInvalid(assistant('tool_calls','',[{...validCall(),function:{
  name:'unknown_tool',arguments:'{}'}}]),'UNDECLARED_TOOL_NAME');
expectInvalid(assistant('tool_calls','',[validCall(),validCall()]),'DUPLICATE_TOOL_CALL_ID');
expectInvalid(assistant('tool_calls','',[{...validCall(),id:''}]),'MALFORMED_TOOL_CALL');
expectInvalid(assistant('tool_calls','',[{...validCall(),function:{
  name:'read_model_section',arguments:{section:'specs'}}}]),'ARGUMENTS_NOT_JSON_STRING');
const withReasoning=assistant('tool_calls','',[validCall()]);
withReasoning.choices[0].message.reasoning='synthetic thought metadata';
assert.equal(validateAgentCompletion(withReasoning,toolRequest).invalidReason,null);
assert.equal(withReasoning.choices[0].message.reasoning,'synthetic thought metadata',
  'Adapter inspection must not strip metadata from accepted provider payload');
assert.equal(validateAgentCompletion(
  assistant('length','partial',[]),toolRequest).invalidReason,null);
const localError=invalidClientResponse('ARGUMENTS_INVALID_JSON');
assert.equal(localError.status,422);
assert.equal((await localError.json()).error.code,INVALID_RESPONSE_CODE);
assert.deepEqual(interruptedTransport({invalidResponses:1}),{
  status:'provider_invalid_response',
  stopReason:'CLOUDFLARE_PROVIDER_INVALID_RESPONSE'
});
console.log('PASS: malformed tool outputs, empty completion and JSON arguments are rejected before original Merlin');
console.log('PASS: accepted tool/thinking payload stays untouched; invalid provider output has a local 422 without network');

console.log('PASS: model-specific Gemma no-thinking for both routes; Inkling unchanged');
console.log('PASS: length never counts as completion, no tool/cap override to Buffalo');
console.log('PASS: truncated outputs and resource stop flags bypass original graders (offline)');
console.log('PASS: current model '+BUFFALO_CF_MODEL+'; no provider inference');
