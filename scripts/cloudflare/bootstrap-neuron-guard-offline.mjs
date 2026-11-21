/**
 * End-to-end bootstrap guard regression: even with a valid request, the
 * projected neuron budget rejects the POST before offline-network processing.
 * Requires BUFFALO_CF_OFFLINE=1, BUFFALO_CF_MAX_NEURONS=200.
 */
import assert from 'node:assert/strict';
import { OR_SLUG } from './arena_b_ev01_cf_adapter.mjs';

assert.equal(process.env.BUFFALO_CF_OFFLINE,'1');
assert.equal(globalThis.__buffaloCloudflare.maxNeurons,200);
const request={
  model: OR_SLUG,
  messages:[
    {role:'system',content:'Build a system dynamics model'},
    {role:'user',content:'Describe how the stock changes when inflow exceeds outflow.'}
  ],
  response_format: {type:'json_schema',json_schema:{
    name:'sd_model',
    schema:{type:'object',properties:{
      variables:{type:'array'},relationships:{type:'array'}
    }}
  }},
  max_completion_tokens:16000
};
await assert.rejects(
  () => fetch('https://openrouter.ai/api/v1/chat/completions',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(request)
  }),
  /BUFFALO_CF_NEURON_PREFLIGHT_BUDGET_BLOCKED/
);
assert.equal(globalThis.__buffaloCloudflare.receipts.length,0);
const d=globalThis.__buffaloCloudflare.diagnostics();
assert.equal(d.neuronPreflightBlockedAttempts,1);
assert.equal(d.neuronBudget.blockedPreflight,1);
assert.equal(d.neuronBudget.usedOrHeldNeurons,0);
console.log('PASS: '+globalThis.__buffaloCloudflare.model+
  ' blocks oversized engine inference BEFORE network and without reserving a POST');
