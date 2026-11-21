/**
 * Transport integration with a preloaded fake Cloudflare origin (zero network).
 * Verify 200 length becomes local 422 BEFORE the original Buffalo loop sees it;
 * verify real 200 stop and tool_calls are forwarded unchanged.
 */
import assert from 'node:assert/strict';
import {BUFFALO_CF_MODEL} from './active-model.mjs';
import {GEMMA_MODEL,TRUNCATED_RESPONSE_CODE} from './completion-policy.mjs';

const state=globalThis.__buffaloCloudflare;
const mock=globalThis.__buffaloMockCloudflareOrigin;
assert.equal(state.offline,false,'Stub tests exercise the live response path');
assert.equal(mock.calls.length,0);
const outcome=process.env.BUFFALO_MOCK_FINISH;
const url=state.agentTarget;
const payload={model:BUFFALO_CF_MODEL,
  messages:[{role:'system',content:'Agent task'},
    {role:'user',content:'Inspect and fix clinic'}],
  tools:[{type:'function',function:{name:'read_model_section',
    parameters:{type:'object',properties:{section:{type:'string'}}}}}]
};
const response=await fetch(url,{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
assert.equal(mock.calls.length,1);
const request=mock.calls[0].wire;
assert.equal(request.model,BUFFALO_CF_MODEL);
assert.equal(request.max_completion_tokens,4096);
if (BUFFALO_CF_MODEL===GEMMA_MODEL) {
  assert.equal(request.chat_template_kwargs?.enable_thinking,false);
  assert.equal(request.reasoning_effort,undefined);
} else {
  assert.equal(request.chat_template_kwargs,undefined);
}
const receipt=state.receipts[0];
assert.equal(receipt.http_status,200,'Must preserve actual Cloudflare HTTP 200');
assert.equal(receipt.usage.neurons,45);
assert.equal(state.diagnostics().neuronBudget.usedOrHeldNeurons,45);
assert.equal(state.diagnostics().neuronBudget.unmetered,false);

if (outcome==='length') {
  assert.equal(response.status,422,'Truncated provider output must be a client error');
  const err=await response.json();
  assert.equal(err.error.code,TRUNCATED_RESPONSE_CODE);
  assert.equal(receipt.status,'OUTPUT_TRUNCATED');
  assert.equal(receipt.finish_reason,'length');
  assert.equal(receipt.client_http_status,422);
  assert.equal(state.diagnostics().truncatedResponses,1);
  assert.ok(!state.diagnostics().exhausted);
  assert.ok(state.diagnostics().neuronBudget.remainingUnreservedNeurons>0);
  await assert.rejects(
    fetch(url,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({...payload,messages:[...payload.messages,{role:'user',content:'Retry'}]})}),
    /BUFFALO_CF_HALTED_AFTER_TRUNCATION/
  );
  assert.equal(mock.calls.length,1,'Never send a second HTTP request after truncation');
  assert.equal(state.receipts.length,1);
  console.log('PASS: HTTP 200 length converted to local 422, no false completion or retry');
} else {
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.choices[0].finish_reason,outcome);
  assert.equal(state.diagnostics().truncatedResponses,0);
  assert.equal(receipt.status,'HTTP_SUCCESS');
  if(outcome==='tool_calls')
    assert.equal(receipt.tool_calls_count,1,'Valid tool-call turn must survive intact');
  console.log('PASS: HTTP 200 '+outcome+' passed to Buffalo unmodified');
}
console.log('PASS: '+BUFFALO_CF_MODEL+' reasoning wire and neuron receipts; 0 external network calls');
